// The real endpoint: POST /auth/libedge/callback over HTTP, through server.mjs.
//
// Why this file exists. sso-callback.integration.mjs calls handleCallback() directly and
// passes `withSession` itself, so every check it makes is a check on the callback module's
// contract. That is exactly the shape of test that passes while the *server* is wrong: for
// a while server.mjs passed a `withTenant` that binds a tenant and releases the connection
// per statement, so 2.3's "steps 5-11 in one transaction" was not true in production and no
// module-level test could see it. The same happened with the form: the module accepted a
// `nonce` field the contract does not have, and the server dutifully required it.
//
// So this file starts the actual server process, against a real database, and drives it the
// way a browser and the LibEdge Worker would: GET /auth/libedge/start, then a form POST that
// carries the token and nothing else, with the state cookie the start response set. What it
// asserts is what a reader would get: a 303 to "/" with a session cookie, a row in
// libedge_sessions, an audit row, and - for each refusal - a 403 with the state cookie
// cleared and no session.
//
// Run by hand (needs docker and the pg client):
//   node test/sso-http.integration.mjs
//
// The only thing it fakes is the clock. The server reads Date.now() and a handoff token lives
// 60 seconds, so tokens are minted relative to the real time of the request instead of a
// fixed instant: one control sits inside exp + 30 and one outside it, with the same code.

import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash, createPrivateKey, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { parsePublicKeys } from '../sso/ed25519.mjs';
import { SESSION_COOKIE, readCookieToken } from '../sso/session.mjs';
import { signToken } from '../sso/vectors.mjs';

const exec = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');
const repoDir = path.resolve(appDir, '../..');
const dbDir = path.join(repoDir, 'db');
const pg = createRequire(path.join(appDir, 'package.json'))('pg');

const ISSUER = 'libedge';
const AUDIENCE = 'elibrary.libedge.com';
// The second institution. The happy path deliberately does not use a tenant the server could
// have defaulted to: server.mjs falls back to DEMO_TENANT_ID (1111…), and "the session landed
// in whatever tenant was handy" is exactly the bug a single-tenant fixture cannot see.
const INSTITUTION_TENANT = '4a4a4a4a-4a4a-4a4a-8a4a-4a4a4a4a4a4a';
const INSTITUTION = '42';
// The version every existing user row in this test carries. Not 0, so a cookie signed from
// the schema default instead of from the row fails /api/me rather than passing by luck.
const PROVISIONED_VERSION = 3;
const PROVISIONED_SUB = 'lu_http_provisioned';
const PROVISIONED_EMAIL = 'okuyucu42@example.edu.tr';
// A third institution, for the paths that create the reader just in time.
const OTHER_TENANT = '5b5b5b5b-5b5b-5b5b-8b5b-5b5b5b5b5b5b';
const OTHER_INSTITUTION = '43';
const SECRET = 'http-test-session-secret';

const container = `libedge-sso-http-${randomUUID()}`;
const adminPassword = randomBytes(18).toString('hex');
const appPassword = randomBytes(18).toString('hex');

let port;
let httpPort;
let admin;
let checks = 0;

const check = (condition, message) => { assert.ok(condition, message); checks += 1; };

async function docker(...args) {
  return (await exec('docker', args, { timeout: 90_000, maxBuffer: 1024 * 1024 })).stdout.trim();
}

async function stopContainer() {
  await docker('rm', '--force', container).catch(() => {});
}

// Ending the admin connection while the container is going down is normal at teardown, but an
// unhandled 'error' event on a pg Client kills the process - which would turn a green run into
// a crash with no output. Registered once, at module load, for that reason.
function guardClient(client) {
  client.on('error', (error) => {
    // After `end()` was called the socket closing is expected; calling it an error would
    // make a green run look like a broken one.
    if (client.ended) return;
    console.error('admin connection error:', error.message);
  });
  return client;
}

async function freePort() {
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const value = socket.address().port;
  await new Promise((resolve, reject) => socket.close((error) => (error ? reject(error) : resolve())));
  return value;
}

// ---------------------------------------------------------------------------
// Fixture: a database and a server process, both real
// ---------------------------------------------------------------------------

async function setupDatabase() {
  await docker('version', '--format', '{{.Server.Version}}');
  port = await freePort();
  await docker('run', '--detach', '--rm', '--name', container,
    '--tmpfs', '/var/lib/postgresql/data',
    '--publish', `127.0.0.1:${port}:5432`,
    '--env', 'POSTGRES_USER=mig_admin',
    '--env', 'POSTGRES_DB=mig',
    '--env', `POSTGRES_PASSWORD=${adminPassword}`, 'postgres:16-alpine');

  let lastError;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const candidate = new pg.Client({
      connectionString: `postgres://mig_admin:${adminPassword}@127.0.0.1:${port}/mig`,
    });
    try {
      await candidate.connect();
      admin = guardClient(candidate);
      break;
    } catch (error) {
      lastError = error;
      await candidate.end().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  if (!admin) throw new Error(`postgres did not become reachable: ${lastError?.message}`);

  await admin.query(await readFile(path.join(repoDir, 'db/schema.sql'), 'utf8'));
  await admin.query(
    "do $$ begin create role akademik_catalog; exception when duplicate_object then null; end $$");
  for (const file of [
    '021-libedge-identity-and-subscriptions.sql',
    '024-maintenance-tenants.sql',
    '025-libedge-tenant-provisioning.sql',
    '026-tenant-binding-nullif.sql',
    '027-reader-sso.sql',
  ]) {
    await admin.query(await readFile(path.join(dbDir, 'migrations', file), 'utf8'));
  }

  await admin.query(
    `insert into tenants (id, name, slug, libedge_kind, libedge_ref) values
       ($1, 'Kurum 42', 'kurum-42', 'institution', $2),
       ($3, 'Kurum 43', 'kurum-43', 'institution', $4)`,
    [INSTITUTION_TENANT, INSTITUTION, OTHER_TENANT, OTHER_INSTITUTION]);

  // The user the happy path signs in, provisioned ahead of the handoff with a version that is
  // not the schema default. Users have no RLS policy (the tenant is a column, not a policy),
  // so the owner can seed the row directly; 021's account and membership rows are what the
  // callback actually checks, and they are inserted here too so the sign-in is a plain update
  // of an existing reader rather than a JIT creation.
  await admin.query(
    `insert into users (tenant_id, email, display_name, libedge_user_id, role, session_version)
     values ($1, $2, $3, $4, 'reader', $5)`,
    [INSTITUTION_TENANT, PROVISIONED_EMAIL, 'Provisioned Reader', PROVISIONED_SUB,
      PROVISIONED_VERSION]);
  await admin.query(
    `insert into libedge_accounts (libedge_user_id, status, revision)
     values ($1, 'active', 1)`, [PROVISIONED_SUB]);
  await admin.query(
    `insert into libedge_memberships (tenant_id, libedge_user_id, status, revision)
     values ($1, $2, 'active', 1)`, [INSTITUTION_TENANT, PROVISIONED_SUB]);

  // The server's pool connects as the application role, as in a deployment. That role may
  // not set its own password, so it is changed here by the owner.
  await admin.query(`alter role akademik_app password '${appPassword}'`);
  // A dropped connection must not become an unhandled event: the checks below report the
  // failure that matters, and a crashed process would hide it.
  admin.on('error', (error) => { console.error('admin connection error:', error.message); });
}
// The handoff keys: the repository's test vector, and a second key for the forged control.
const vectorKeys = JSON.parse(
  await readFile(path.join(repoDir, 'docs/contracts/vectors/ed25519-test-keys.json'), 'utf8'));
const foreign = generateKeyPairSync('ed25519');
const keysJson = JSON.stringify([
  { kid: vectorKeys.kid, ...vectorKeys.publicJwk },
  { kid: 'other', kty: 'OKP', crv: 'Ed25519', ...foreign.publicKey.export({ format: 'jwk' }) },
]);
parsePublicKeys(keysJson);
const signer = createPrivateKey({ key: vectorKeys.privateJwk, format: 'jwk' });

let minted = 0;

// A token for this instant. `skew` moves exp relative to now, so "inside the 30 second
// grace" and "outside it" are the same code path with a different number - the only way to
// test a tolerance against a real clock without touching the clock.
function mint({ skew = 50, overrides = {} } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + skew;
  minted += 1;
  // The state is what the cookie carries; the token carries only its hash (2.3/4). They are
  // minted together so that a correct handoff is the default rather than a special case.
  const state = randomBytes(32).toString('base64url');
  const claims = {
    iss: ISSUER,
    aud: AUDIENCE,
    sub: `lu_http_${String(minted).padStart(3, '0')}`,
    ctx: 'institution',
    inst: INSTITUTION,
    role: 'reader',
    iat: exp > now ? now : exp - 1,
    exp,
    jti: randomBytes(32).toString('base64url'),
    email: `oku${minted}@example.edu.tr`,
    nonce: createHash('sha256').update(state, 'utf8').digest('base64url'),
    ...overrides,
  };
  return { token: signToken(signer, { alg: 'EdDSA', kid: vectorKeys.kid }, claims), claims, state };
}

async function counts() {
  const { rows } = await admin.query(
    `select (select count(*)::int from sso_consumed_jti) as jtis,
            (select count(*)::int from libedge_sessions) as sessions,
            (select count(*)::int from sso_auth_events where outcome = 'login') as logins,
            (select count(*)::int from sso_auth_events where outcome = 'reject') as rejects`);
  return rows[0];
}

// The start route as a browser first sees it: a 302 to LibEdge carrying only the hash of the
// state, and a `__Host-sso_state` cookie carrying the state itself.
async function start() {
  const response = await fetch(`http://127.0.0.1:${httpPort}/auth/libedge/start?ctx=institution`, {
    redirect: 'manual',
  });
  const location = new URL(response.headers.get('location'));
  const cookie = response.headers.getSetCookie()
    .find((line) => line.startsWith('__Host-sso_state=')) ?? '';
  return {
    response,
    location,
    cookie: cookie.split(';')[0],
    // The whole Set-Cookie header, attributes included: the `__Host-` requirements are a
    // property of the header, not of the name=value pair.
    setCookie: cookie,
    state: cookie.split(';')[0].slice('__Host-sso_state='.length),
  };
}

// The callback as the Worker's form posts it: `token` and nothing else. A test that added a
// `nonce` field here would be hiding the very bug this file was written to catch.
async function postCallback({ token, cookie }) {
  const response = await fetch(`http://127.0.0.1:${httpPort}/auth/libedge/callback`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(cookie ? { cookie } : {}),
    },
    body: new URLSearchParams({ token }).toString(),
  });
  const setCookies = response.headers.getSetCookie();
  const pair = (name) => setCookies
    .map((line) => line.split(';')[0])
    .find((value) => value.startsWith(`${name}=`));
  return {
    response,
    setCookies,
    body: await response.text(),
    session: pair(SESSION_COOKIE),
    stateCleared: setCookies.some((line) => line.startsWith('__Host-sso_state=;')),
  };
}

// The server is a child process, and it is up only when it says so on stdout. Watching that
// line rather than polling the port keeps a slow start from looking like a failed request.
async function startServer(env) {
  httpPort = await freePort();
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: appDir,
    env: { ...process.env, ...env, PORT: String(httpPort) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { log += chunk; });
  child.stderr.on('data', (chunk) => { log += chunk; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${log}`)), 60_000);
    const poll = setInterval(() => {
      if (log.includes('[web] http://localhost:')) {
        clearInterval(poll);
        clearTimeout(timer);
        resolve();
      }
    }, 50);
    child.once('exit', (code) => {
      clearInterval(poll);
      clearTimeout(timer);
      reject(new Error(`server exited with ${code}:\n${log}`));
    });
  });
  child.log = () => log;
  return child;
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 5000))]);
}

// What a deployment would set. The test adds only its own addresses.
function serverEnv() {
  const env = {
    DATABASE_URL: `postgres://akademik_app:${appPassword}@127.0.0.1:${port}/mig`,
    DATABASE_CATALOG_URL: '',
    SESSION_SECRET: SECRET,
    LIBEDGE_SSO_PUBLIC_KEYS: keysJson,
    LIBEDGE_SSO_ISSUER: ISSUER,
    LIBEDGE_SSO_AUDIENCE: AUDIENCE,
    LIBEDGE_SSO_HANDOFF_URL: 'https://libedge.com/elibrary/handoff',
    LIBEDGE_SSO_SESSION_HOURS: '12',
  };
  delete env.NODE_ENV;
  return env;
}

async function startAndHappyPath() {
  // 1. The start route. It is the only place the state is created, and the response must not
  //    carry it anywhere but the cookie: the redirect goes to LibEdge with the hash.
  const started = await start();
  check(started.response.status === 302, `start: ${started.response.status}`);
  check(/^[A-Za-z0-9_-]{43}$/.test(started.state),
    `start: state must be 256 bits of base64url, got ${started.state.length} chars`);
  check(started.location.origin + started.location.pathname
    === 'https://libedge.com/elibrary/handoff', `start: ${started.location.href}`);
  check(started.location.searchParams.get('state_hash')
    === createHash('sha256').update(started.state, 'utf8').digest('base64url'),
  'start: the handoff URL carries the hash of the state');
  check(!started.location.href.includes(started.state), 'start: the state itself never leaves in a URL');
  check(/SameSite=Lax/.test(started.setCookie) && /; Secure/.test(started.setCookie)
    && /; Path=\//.test(started.setCookie) && !/Domain/i.test(started.setCookie),
  `start: cookie attributes, got ${started.setCookie}`);

  // 2. The happy path, 2.1/4 to the letter: a token alone in the form, the state in the
  //    cookie. This is the request that failed while the server required a `nonce` field and
  //    compared the cookie with the raw state. The reader already exists here, with
  //    session_version 3, so step 10 is the update path and the cookie has to carry that
  //    version rather than a default.
  const grant = mint({
    overrides: { sub: PROVISIONED_SUB, email: PROVISIONED_EMAIL, name: 'Provisioned Reader' },
  });
  const before = await counts();
  const ok = await postCallback({ token: grant.token, cookie: `__Host-sso_state=${grant.state}` });
  check(ok.response.status === 303, `callback: ${ok.response.status} ${ok.body.slice(0, 160)}`);
  check(ok.response.headers.get('location') === '/', 'callback redirects to /');
  check(ok.stateCleared, 'callback clears the state cookie on success');
  check(Boolean(ok.session), 'callback sets a session cookie');
  check(!ok.setCookies.join(' ').includes(grant.token), 'the token never appears in a header');

  const payload = readCookieToken(ok.session.slice(`${SESSION_COOKIE}=`.length), SECRET);
  check(payload !== null, 'the session cookie verifies with the server secret');
  check(payload?.sso === true && payload?.tenant === INSTITUTION_TENANT,
    `the cookie marks an SSO session in the token's tenant, got ${payload?.tenant}`);
  check(payload?.tenant !== '11111111-1111-1111-1111-111111111111',
    'the session is not in the server default tenant');
  // The version comes from the user row read inside the sign-in transaction. A cookie signed
  // from the schema default (0) or from a second read that skipped the row would differ here,
  // and would then be refused by sessionIsValid on the very next request.
  check(payload?.ver === PROVISIONED_VERSION,
    `the cookie carries the user's session_version ${PROVISIONED_VERSION}, got ${payload?.ver}`);
  check(typeof payload?.csrf === 'string' && payload.csrf.length >= 20,
    'the cookie carries a fresh csrf value');

  const after = await counts();
  check(after.sessions === before.sessions + 1, 'one libedge_sessions row');
  check(after.jtis === before.jtis + 1, 'one consumed jti');
  check(after.logins === before.logins + 1, 'one sso.login audit row');
  check(after.rejects === before.rejects, 'a successful sign-in writes no reject row');

  const { rows: sessionRows } = await admin.query(
    'select jti, tenant_id, user_id from libedge_sessions where session_id = $1', [payload.sid]);
  check(sessionRows.length === 1 && sessionRows[0].jti === grant.claims.jti,
    'the session row carries the jti that opened it');
  check(sessionRows[0]?.tenant_id === INSTITUTION_TENANT,
    `the session row is in the token's tenant, got ${sessionRows[0]?.tenant_id}`);
  const { rows: jtiRows } = await admin.query(
    'select expires_at from sso_consumed_jti where jti = $1', [grant.claims.jti]);
  const kept = new Date(jtiRows[0].expires_at).getTime() - (grant.claims.exp + 30) * 1000;
  check(Math.abs(kept) < 2000, `the replay row is kept until exp + 30s, off by ${kept}ms`);

  // 2b. The cookie has to work, not just look right. A 303 alone would pass even if the
  //     session could never be read back - the version check, the tenant binding and the
  //     libedge_sessions row are all in that read path, and none of them is exercised by the
  //     redirect. /api/me is the exact request the reader's first page load makes.
  const me = await fetch(`http://127.0.0.1:${httpPort}/api/me`, {
    headers: { cookie: ok.session },
  });
  // The body is read once, then checked: calling text() inside the assertion message would
  // consume it even on success, and the json() below would fail with "Body is unusable".
  const meBody = await me.json();
  check(me.status === 200, `/api/me with the new cookie: ${me.status} ${JSON.stringify(meBody)}`);
  check(meBody.id === sessionRows[0].user_id,
    `the browser is the reader whose row was written, got ${meBody.id}`);
  check(meBody.id !== undefined && meBody.email === PROVISIONED_EMAIL,
    `and it is the provisioned reader, got ${meBody.email}`);
  // The row itself was updated, not just the cookie: step 10 writes display_name while the row
  // still carries the address it was seeded with. And the version in the cookie is the one the
  // database still reports: bumping it - an admin's "sign out everywhere" - must end the
  // session, which is the only reason the value is in the cookie at all.
  await admin.query(
    'update users set session_version = session_version + 1 where id = $1', [meBody.id]);
  const bumped = await fetch(`http://127.0.0.1:${httpPort}/api/me`, {
    headers: { cookie: ok.session },
  });
  check(bumped.status === 401, `a version bump invalidates the cookie: /api/me ${bumped.status}`);
  await admin.query(
    'update users set session_version = $2 where id = $1', [meBody.id, PROVISIONED_VERSION]);
  const { rows: userRows } = await admin.query(
    'select display_name, session_version from users where id = $1', [meBody.id]);
  // The cookie carries the name the callback resolved - step 10's display name, which falls
  // back to the address only when the token has no `name` claim.
  check(userRows[0]?.display_name === 'Provisioned Reader',
    `step 10 wrote the display name, got ${userRows[0]?.display_name}`);
  check(Number(userRows[0]?.session_version) === PROVISIONED_VERSION,
    'the session did not bump the version it was issued against');
  // The token here has no `name` claim, so the callback falls back to the address - and the
  // reader's own name in our database is not overwritten. The response reports the cookie's
  // value, which is the identity the reader signed in as.
  check(meBody.role === 'reader' && meBody.displayName === meBody.email,
    `the body is the reader the token names, got ${JSON.stringify(meBody)}`);
  // A 401 here would have cleared the cookie; a 200 must leave it alone.
  check(!me.headers.getSetCookie().some((line) => line.startsWith(`${SESSION_COOKIE}=`)),
    '/api/me does not reissue or clear the session cookie');

  // 3. The same token again: a replay, refused, and no second session.
  const replay = await postCallback({ token: grant.token, cookie: `__Host-sso_state=${grant.state}` });
  check(replay.response.status === 403, `replay: ${replay.response.status}`);
  check(!replay.session, 'a replay sets no session cookie');
  check(replay.stateCleared, 'a replay clears the state cookie');
  check((await counts()).sessions === after.sessions, 'a replay creates no session row');
  const replayMe = await fetch(`http://127.0.0.1:${httpPort}/api/me`, {
    headers: { cookie: ok.session },
  });
  check(replayMe.status === 200, 'a replay attempt does not disturb the live session');
}

async function stateControls() {
  // 4. The state goes in the cookie, its hash in the token. Sending the raw state as the
  //    nonce - the bug that got past the module tests - must be refused here.
  const raw = mint();
  const rawToken = signToken(signer, { alg: 'EdDSA', kid: vectorKeys.kid },
    { ...raw.claims, nonce: raw.state });
  const rawResult = await postCallback({ token: rawToken, cookie: `__Host-sso_state=${raw.state}` });
  check(rawResult.response.status === 403, `raw state as nonce: ${rawResult.response.status}`);

  // 5. No cookie at all is a mismatch, not a free pass - and it does not burn the jti, so the
  //    same token works once the browser has the cookie back.
  const noCookie = mint();
  const before = await counts();
  const without = await postCallback({ token: noCookie.token });
  check(without.response.status === 403, `no cookie: ${without.response.status}`);
  check(!without.session, 'no cookie, no session');
  check((await counts()).jtis === before.jtis, 'a state mismatch consumes no jti');
  const retried = await postCallback({
    token: noCookie.token, cookie: `__Host-sso_state=${noCookie.state}`,
  });
  check(retried.response.status === 303, `retry after mismatch: ${retried.response.status}`);

  // 6. A refusal looks the same to the reader whatever the reason: one message, the state
  //    cookie cleared, and no code or reason in the body (2.3, 7.5).
  for (const [label, result] of [['state mismatch', rawResult], ['no state cookie', without]]) {
    check(result.stateCleared, `${label}: the state cookie is cleared`);
    check(/LibEdge/.test(result.body), `${label}: the page sends the reader back to LibEdge`);
    check(!/state_mismatch|bad_claims|replayed/.test(result.body), `${label}: no reason in the body`);
  }
}

// 2.2/3's 30 second tolerance, measured against the server's own clock: inside the window the
// reader is signed in, outside it is a 403. A fixed `now` cannot be used - the server reads
// Date.now() - so the tokens are minted relative to it.
async function skewControls() {
  const inside = mint({ skew: -20 });
  const accepted = await postCallback({
    token: inside.token, cookie: `__Host-sso_state=${inside.state}`,
  });
  check(accepted.response.status === 303,
    `a token 20s past exp is still accepted (exp + 30): ${accepted.response.status}`);

  const outside = mint({ skew: -40 });
  const refused = await postCallback({
    token: outside.token, cookie: `__Host-sso_state=${outside.state}`,
  });
  check(refused.response.status === 403, `a token 40s past exp is refused: ${refused.response.status}`);
  check(!refused.session, 'an expired token sets no session');
}

// The transaction of 2.3/5-11, on the server's own connection. The module test asserts the
// contract; this asserts that server.mjs hands the callback a helper that honours it. The
// probe is a trigger, because a trigger runs inside whichever transaction is doing the insert
// and can therefore report on it - from outside, only pg_locks can see that transaction.
async function transactionControls() {
  await admin.query(
    'create table if not exists probe_events (label text, tenant text, in_tx boolean, at timestamptz default now())');
  // The app role must be able to write the probe row; nothing else about the table matters,
  // and it is dropped with the container.
  await admin.query('grant insert, select on probe_events to akademik_app');
  // `in_tx` is true only inside an explicit transaction: `transaction_timestamp()` is fixed at
  // the first statement of one, and equals `statement_timestamp()` outside one.
  await admin.query(`
    create or replace function probe_user_insert() returns trigger language plpgsql as $fn$
    begin
      insert into probe_events (label, tenant, in_tx)
      values ('user_insert', current_setting('app.tenant_id', true),
              transaction_timestamp() <> statement_timestamp());
      return new;
    end $fn$`);
  await admin.query(
    'create trigger probe_user_insert before insert on users for each row execute function probe_user_insert()');

  // The rollback arm: a trigger raises at step 11, after steps 5-10 have run, so the consumed
  // jti written at step 9 has to disappear with the transaction. If the server ran these steps
  // outside a transaction the jti would stay behind and the reader's retry would be a "replay".
  await admin.query(`
    create or replace function probe_session_insert() returns trigger language plpgsql as $fn$
    begin
      if new.libedge_user_id like 'lu_http_rb%' then
        raise exception 'probe: refusing the session insert';
      end if;
      return new;
    end $fn$`);
  await admin.query(
    'create trigger probe_session_insert before insert on libedge_sessions for each row execute function probe_session_insert()');

  // 7. The tenant is bound, and it is bound inside a transaction. The reader here is created
  //    just in time, in yet another tenant (43), so the binding cannot be the happy path's
  //    tenant left over on the connection, and a created row starts at version 0 - taken from
  //    the row, not assumed.
  const grant = mint({ overrides: { ctx: 'institution', inst: OTHER_INSTITUTION } });
  const ok = await postCallback({ token: grant.token, cookie: `__Host-sso_state=${grant.state}` });
  check(ok.response.status === 303, `trigger probe callback: ${ok.response.status}`);
  const { rows: events } = await admin.query(
    'select tenant, in_tx from probe_events order by at desc limit 1');
  check(events.length === 1, 'the user insert ran through the probe trigger');
  check(events[0].tenant === OTHER_TENANT,
    `steps 5-11 are bound to the token's tenant, saw ${events[0].tenant}`);
  check(events[0].tenant !== '11111111-1111-1111-1111-111111111111',
    'and not the server default tenant');
  check(events[0].in_tx === true, 'the user insert runs inside a transaction');

  // 8. A failure at step 11 takes step 9 with it.
  const rb = mint({ overrides: { sub: `lu_http_rb_${randomUUID().slice(0, 8)}` } });
  const before = await counts();
  const failed = await postCallback({ token: rb.token, cookie: `__Host-sso_state=${rb.state}` });
  check(failed.response.status === 500,
    `a database failure is a 500, not a 403: ${failed.response.status}`);
  check(!failed.session, 'a failed sign-in sets no session');
  const after = await counts();
  check(after.jtis === before.jtis, 'the jti of the failed handoff was rolled back');
  check(after.sessions === before.sessions, 'and no session row was written');
  const { rows: burned } = await admin.query(
    'select 1 from sso_consumed_jti where jti = $1', [rb.claims.jti]);
  check(burned.length === 0, 'no replay row for the failed handoff');

  // 9. The failure is still audited (7.5), under its own reason.
  const { rows: auditRows } = await admin.query(
    "select reason from sso_auth_events where libedge_user_id = $1 and outcome = 'reject'",
    [rb.claims.sub]);
  check(auditRows.length === 1 && auditRows[0].reason === 'session_store_unavailable',
    `the failed sign-in is audited, saw ${JSON.stringify(auditRows)}`);
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

async function closeAdmin() {
  if (!admin) return;
  admin.ended = true;
  await admin.end().catch(() => {});
}

async function main() {
  await setupDatabase();
  let child = null;
  try {
    child = await startServer(serverEnv());
    await startAndHappyPath();
    await stateControls();
    await skewControls();
    await transactionControls();
  } catch (error) {
    // The server's own output is the answer when a request dies mid-flight, so it is printed
    // with the failure rather than left in a pipe nobody reads.
    console.error('server output:\n' + (child?.log?.() ?? '(none)'));
    throw error;
  } finally {
    await stopServer(child);
    await closeAdmin();
    await stopContainer();
  }
  console.log(`\n  ok - ${checks} checks\n`);
}

main().catch(async (error) => {
  console.error(error);
  await closeAdmin();
  await stopContainer();
  process.exitCode = 1;
});
