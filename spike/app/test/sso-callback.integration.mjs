// Reader-side SSO end to end (contract 2.3 steps 7-11, 2.5, 2.6, 11 #12/#14/#15/#17),
// against a real PostgreSQL 16 with the real migrations applied.
//
// Why a real database. Everything this file is about lives in the server: the jti table's
// primary key, FORCE RLS on libedge_sessions, the tenant binding the policy reads, the
// advisory lock of 2.6. A mock client would agree with any of those and prove nothing.
//
// The negative controls are the test. Each one asserts a refusal that is *required* by the
// contract, and each one fails if its check is removed from the code - they are not
// "does it work" checks but "does it fail" checks:
//
//   1 reuse of a token                 (11 #14)  a second callback with the same token
//   2 expired token                    (2.2)
//   3 a signature from another key     (2.3/1-3)
//   4 a cookie state that is not the token's nonce (11 #14)
//   5 institution token against the individual tenant (11 #15)
//   6 disabled account after a valid token: refuse, and no user row (11 #12)
//   7 revoked membership               (11 #17)
//   8 the session's own absolute end   (2.5)
//   9 a session id read under another tenant returns zero rows (RLS)
//
// Run by hand:
//   node test/sso-callback.integration.mjs

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createPrivateKey, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';

import { handleCallback } from '../sso/callback.mjs';
import { withBridgeAdmin, withBridgeTenant } from '../libedge-bridge-db.mjs';
import { parsePublicKeys } from '../sso/ed25519.mjs';
import { readSsoSession } from '../sso/session.mjs';
import { signToken } from '../sso/vectors.mjs';

const exec = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');
const repoDir = path.resolve(appDir, '../..');
const dbDir = path.join(repoDir, 'db');
const pg = createRequire(path.join(appDir, 'package.json'))('pg');

const ISSUER = 'libedge';
const AUDIENCE = 'elibrary.libedge.com';
const NOW = Date.parse('2026-11-01T09:00:00Z');
const SESSION_HOURS = 12;

const STAFF_TENANT = '5799f2a5-3d90-41b1-90de-9da07d776052';
const INSTITUTION_TENANT = '4a4a4a4a-4a4a-4a4a-8a4a-4a4a4a4a4a4a';
const INDIVIDUAL_TENANT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const INSTITUTION = '42';

const container = `libedge-sso-${randomUUID()}`;
const adminPassword = randomBytes(18).toString('hex');
const appPassword = randomBytes(18).toString('hex');
let port;
let admin;
let pool;
let checks = 0;

const check = (condition, message) => { assert.ok(condition, message); checks += 1; };

async function docker(...args) {
  return (await exec('docker', args, { timeout: 90_000, maxBuffer: 1024 * 1024 })).stdout.trim();
}

async function stopContainer() {
  await docker('stop', container).catch(() => {});
  await docker('rm', '--force', container).catch(() => {});
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
// Fixture
// ---------------------------------------------------------------------------

async function setup() {
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
      admin = candidate;
      break;
    } catch (error) {
      lastError = error;
      await candidate.end().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  if (!admin) throw new Error(`postgres did not become reachable: ${lastError?.message}`);

  // The shipped schema, so the policies and the users table under test are the real ones.
  await admin.query(await readFile(path.join(repoDir, 'db/schema.sql'), 'utf8'));

  // 021 grants to the catalog role, which 022 creates in the real sequence. Nothing here
  // reads the catalogue, but the grants name a role, so it has to exist first.
  await admin.query(
    "do $$ begin create role akademik_catalog; exception when duplicate_object then null; end $$");

  // 021 brings libedge_accounts, libedge_memberships and sso_consumed_jti; 024 the
  // maintenance pattern 027 copies; 025 the tenant resolver the callback uses; 026 the
  // nullif binding; 027 the tables this test is about. 022 and 023 are not needed: nothing
  // here reads the catalogue.
  for (const file of [
    '021-libedge-identity-and-subscriptions.sql',
    '024-maintenance-tenants.sql',
    '025-libedge-tenant-provisioning.sql',
    '026-tenant-binding-nullif.sql',
    '027-reader-sso.sql',
  ]) {
    await admin.query(await readFile(path.join(dbDir, 'migrations', file), 'utf8'));
  }

  await admin.query(`alter role akademik_app password '${appPassword}'`);
  await admin.query(
    `insert into tenants (id, name, slug, libedge_kind, libedge_ref) values
       ($1, 'LibEdge', 'libedge', 'staff', 'libedge'),
       ($2, 'Kurum 42', 'kurum-42', 'institution', $4),
       ($3, 'Bireysel', 'bireysel', 'individual', 'b2c')`,
    [STAFF_TENANT, INSTITUTION_TENANT, INDIVIDUAL_TENANT, INSTITUTION]);

  pool = new pg.Pool({
    connectionString: `postgres://akademik_app:${appPassword}@127.0.0.1:${port}/mig`,
    max: 4,
  });
}

// The keys the test server would be configured with: the repository's test vector, plus a
// second, unrelated key for the wrong-signature control.
const vectorKeys = JSON.parse(
  await readFile(path.join(repoDir, 'docs/contracts/vectors/ed25519-test-keys.json'), 'utf8'));
const foreign = generateKeyPairSync('ed25519');
const keySet = parsePublicKeys(JSON.stringify([
  { kid: vectorKeys.kid, ...vectorKeys.publicJwk },
  { kid: 'other', kty: 'OKP', crv: 'Ed25519', ...foreign.publicKey.export({ format: 'jwk' }) },
]));
const signer = createPrivateKey({ key: vectorKeys.privateJwk, format: 'jwk' });

let nonceCounter = 0;
function token(overrides = {}, { key = signer, kid = vectorKeys.kid } = {}) {
  nonceCounter += 1;
  const now = Math.floor(NOW / 1000);
  const claims = {
    iss: ISSUER,
    aud: AUDIENCE,
    sub: 'lu_7f3c1a9e4b2d',
    ctx: 'institution',
    inst: INSTITUTION,
    role: 'reader',
    iat: now,
    exp: now + 60,
    // A fresh nonce per token, so each control exercises one refusal and not the replay
    // guard left behind by the previous one.
    nonce: `n${String(nonceCounter).padStart(3, '0')}${'x'.repeat(32)}`,
    jti: randomBytes(18).toString('base64url'),
    email: 'ayse@example.edu.tr',
    ...overrides,
  };
  for (const name of Object.keys(claims)) if (claims[name] === undefined) delete claims[name];
  return { token: signToken(key, { alg: 'EdDSA', kid }, claims), claims };
}

// One callback, called the way server.mjs calls it. `withAdmin` runs unbound - that is
// where 2.3/7 resolves the tenant - and `withTenant` binds the tenant this function was
// given, exactly like withTenant in server.mjs.
async function callback(granted, { cookieState, now = NOW, audit } = {}) {
  const events = [];
  const result = await handleCallback({
    token: granted.token,
    nonce: granted.claims.nonce,
    cookieState: cookieState === undefined ? granted.claims.nonce : cookieState,
    pool,
    withAdmin: (fn) => withBridgeAdmin(pool, fn),
    withTenant: (tenantId, fn) => withBridgeTenant(pool, tenantId, fn),
    keys: keySet,
    issuer: ISSUER,
    audience: AUDIENCE,
    sessionHours: SESSION_HOURS,
    now,
    ip: '203.0.113.7',
    audit: audit ?? (async (event) => {
      // The default sink writes the row, the way server.mjs's logAudit does, and the event
      // is also kept so a test can assert what the callback reported without a query.
      events.push(event);
      await writeAudit(event);
    }),
  });
  return { ...result, events };
}

async function writeAudit(event) {
  await pool.query(
    `insert into sso_auth_events (outcome, reason, ctx, libedge_user_id, session_id, ip)
     values ($1, $2, $3, $4, $5, $6)`,
    [event.outcome, event.reason ?? null, event.ctx ?? null,
      event.libedgeUserId ?? null, event.sessionId ?? null, event.ip ?? null]);
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

// The row counts each control is allowed to leave behind, read as the owner so RLS cannot
// hide a row the app role failed to write.
async function state() {
  const { rows } = await admin.query(
    `select
       (select count(*)::int from sso_consumed_jti) as jtis,
       (select count(*)::int from libedge_sessions) as sessions,
       (select count(*)::int from users where libedge_user_id is not null) as users`);
  return rows[0];
}

async function happyPath() {
  const before = await state();
  const granted = token();
  const result = await callback(granted);
  check(result.ok === true, `a valid token must sign in, got ${result.reason}`);
  check(result.session.role === 'reader', 'an institution reader is a reader here too');
  check(result.session.tenantId === INSTITUTION_TENANT, 'the tenant is resolved from the token');

  // 2.5: twelve hours, absolute, from the callback's own clock.
  const hours = (result.session.expiresAt - NOW) / 3600_000;
  check(Math.abs(hours - SESSION_HOURS) < 0.001, `session should end in ${SESSION_HOURS}h, was ${hours}`);

  const after = await state();
  check(after.jtis === before.jtis + 1, 'exactly one jti is consumed');
  check(after.sessions === before.sessions + 1, 'exactly one session row is created');
  check(after.users === before.users + 1, 'the user row is created just in time');
  check(result.events.length === 1 && result.events[0].outcome === 'login',
    '7.5: a successful handoff writes sso.login');
  check(result.events[0].sessionId === result.session.sessionId, 'the audit names the session');

  const session = await auditRows();
  check(session[0].outcome === 'login' && session[0].ip === '203.0.113.7',
    'the audit row carries the outcome and the IP, and nothing else about the token');
  check(!JSON.stringify(session[0]).includes(granted.claims.jti),
    'neither the token nor its jti is stored in the audit');

  // 2.2's optional `name` claim is display only. 3.3 already fixes the identity key, so this
  // checks the two places a made-up value would mislead: the user row the UI reads, and the
  // email column, which must stay the real address rather than being overwritten by a name.
  const named = token({ name: 'Ayşe Yılmaz', email: 'ayse.yilmaz@example.edu.tr' });
  const namedResult = await callback(named);
  check(namedResult.ok === true, `a token with a name must sign in, got ${namedResult.reason}`);
  const { rows } = await admin.query(
    'select display_name, email from users where libedge_user_id = $1', [named.claims.sub]);
  check(rows[0]?.display_name === 'Ayşe Yılmaz',
    `the name claim becomes display_name, got ${rows[0]?.display_name}`);
  check(rows[0]?.email === 'ayse.yilmaz@example.edu.tr',
    `email stays the address, got ${rows[0]?.email}`);
  // ...and a token without `name` leaves the address in place rather than blanking the row.
  const plainly = token({ email: 'ayse@example.edu.tr' });
  const plainlyResult = await callback(plainly);
  check(plainlyResult.ok === true, `a token without a name must sign in, got ${plainlyResult.reason}`);
  const afterName = await admin.query(
    'select display_name, email from users where libedge_user_id = $1', [plainly.claims.sub]);
  check(afterName.rows[0]?.display_name === 'Ayşe Yılmaz',
    'a later token without `name` does not blank an existing display name');
  check(afterName.rows[0]?.email === 'ayse@example.edu.tr', 'the address is updated on every sign-in');
  return { ...result, claims: granted.claims };
}

async function auditRows() {
  const { rows } = await admin.query(
    'select at, outcome, reason, ctx, libedge_user_id, session_id, ip from sso_auth_events order by id');
  return rows;
}

async function controls(baseline) {
  // 1. The same token twice (11 #14). The second call is a replay, and it does not create
  //    a second session or a second jti row.
  const first = await callback(baseline.granted);
  check(first.ok === true, 'the baseline token should still work once more');
  const before = await state();
  const replay = await callback(baseline.granted);
  check(replay.ok === false && replay.reason === 'replayed', `replay: ${replay.reason}`);
  const after = await state();
  check(after.jtis === before.jtis, 'a replayed token consumes no new jti');
  check(after.sessions === before.sessions, 'a replayed token creates no session');

  // 2. Expired (2.2).
  const expired = token({ iat: Math.floor(NOW / 1000) - 120, exp: Math.floor(NOW / 1000) - 60 });
  const expiredResult = await callback(expired);
  check(expiredResult.reason === 'expired', `expired: ${expiredResult.reason}`);

  // 3. A signature from a key we do not hold (2.3/1-3). The kid is ours, so the refusal is
  //    the signature and not the lookup.
  const { privateKey: strangerKey } = generateKeyPairSync('ed25519');
  const forged = token({}, { key: strangerKey });
  const forgedResult = await callback(forged);
  check(forgedResult.reason === 'invalid_signature', `forged: ${forgedResult.reason}`);

  // 4. A cookie state that is not the token's nonce (11 #14): the login-CSRF control.
  const csrf = token();
  const csrfResult = await callback(csrf, { cookieState: 'A'.repeat(43) });
  check(csrfResult.reason === 'state_mismatch', `state: ${csrfResult.reason}`);

  // 5. An institution token handed to the individual tenant (11 #15). The token claims an
  //    institution this server does not know; the tenant must not fall back to the
  //    individual or staff tenant, and nothing must be created.
  const before5 = await state();
  const unknownInst = token({ inst: '999' });
  const unknownResult = await callback(unknownInst);
  check(unknownResult.reason === 'unknown_tenant', `unknown inst: ${unknownResult.reason}`);
  check((await state()).users === before5.users, 'no user row for an unknown tenant');

  // ...and the mirror image: a token whose ctx says institution but whose inst names the
  // individual tenant's ref must be unknown, not silently resolved.
  const crossed = await callback(token({ inst: 'b2c' }));
  check(crossed.reason === 'unknown_tenant', `crossed ref: ${crossed.reason}`);

  // 6. A token with no `email` (2.2 requires it). The refusal is a claim refusal, and it
  //    happens before step 7 - so no jti is burned and no tenant is looked up, which matters
  //    because a jti burned here would make the corrected token a "replay". Nothing is
  //    written: this is the "no synthetic address" rule, made visible.
  const before6 = await state();
  const noEmail = token({ email: undefined });
  const noEmailResult = await callback(noEmail);
  check(noEmailResult.reason === 'bad_claims', `no email: ${noEmailResult.reason}`);
  const after6 = await state();
  check(after6.jtis === before6.jtis, 'a token without email consumes no jti');
  check(after6.users === before6.users, 'a token without email creates no user row');
  check(after6.sessions === before6.sessions, 'a token without email creates no session');
}

// 6 and 7 need state the callback reads before it writes: the account and the membership.
// They run after the happy path, against the same person, and each is undone before the
// next one so a failure names one cause.
async function accountAndMembershipControls(subject) {
  // 6. A disabled account with an otherwise valid token (11 #12). The refusal must come
  //    from the account, and it must not create a user row on the way.
  // A disabled account refuses even a *valid* token, and creates nothing.
  // `revision` is not null: 021 uses it to order LibEdge's own updates, and a fixture that
  // leaves it out would be testing the constraint rather than the callback.
  await admin.query(
    `insert into libedge_accounts (libedge_user_id, status, revision) values ($1, 'disabled', 1)
     on conflict (libedge_user_id) do update set status = 'disabled', revision = excluded.revision`,
    ['lu_disabled_never_seen']);
  const beforeDisabled = await state();
  const disabled = await callback(token({ sub: 'lu_disabled_never_seen' }));
  check(disabled.reason === 'account_disabled', `disabled: ${disabled.reason}`);
  const afterDisabled = await state();
  check(afterDisabled.sessions === beforeDisabled.sessions, 'no session for a disabled account');
  // 11 #12 in its strict form: no user row is created on the way to the refusal.
  const fresh = await admin.query(
    'select 1 from users where libedge_user_id = $1', ['lu_disabled_never_seen']);
  check(fresh.rows.length === 0, 'no user row is created for a disabled account');

  // The same refusal for an identity that already has a row: the existing session is not
  // renewed either.
  await admin.query(
    `insert into libedge_accounts (libedge_user_id, status, revision) values ($1, 'disabled', 2)
     on conflict (libedge_user_id) do update set status = 'disabled', revision = excluded.revision`,
    [subject]);
  const beforeSubject = await state();
  const subjectDisabled = await callback(token({ sub: subject }));
  check(subjectDisabled.reason === 'account_disabled', `subject disabled: ${subjectDisabled.reason}`);
  check((await state()).sessions === beforeSubject.sessions, 'no session for the disabled subject');
  await admin.query(
    'delete from libedge_accounts where libedge_user_id in ($1, $2)',
    [subject, 'lu_disabled_never_seen']);

  // 7. A revoked membership (11 #17): the account is fine, the tenant's membership is not.
  await admin.query(
    `insert into libedge_memberships (tenant_id, libedge_user_id, status, revision)
     values ($1, $2, 'revoked', 2)
     on conflict (tenant_id, libedge_user_id)
       do update set status = 'revoked', revision = excluded.revision`,
    [INSTITUTION_TENANT, subject]);
  const beforeRevoked = await state();
  const revoked = await callback(token({ sub: subject }));
  check(revoked.reason === 'membership_revoked', `revoked: ${revoked.reason}`);
  const afterRevoked = await state();
  check(afterRevoked.sessions === beforeRevoked.sessions, 'no session for a revoked membership');
  check(afterRevoked.jtis === beforeRevoked.jtis,
    'a policy refusal does not burn the jti: 2.3 puts the membership check before it');
  await admin.query(
    'delete from libedge_memberships where tenant_id = $1 and libedge_user_id = $2',
    [INSTITUTION_TENANT, subject]);
}

// 8 and 9 are about reading the session back, which is where FORCE RLS and the absolute
// end actually bite.
async function sessionControls(signedIn) {
  const payload = { sid: signedIn.session.sessionId, tenant: signedIn.session.tenantId };
  const bind = (tenantId, fn) => withBridgeTenant(pool, tenantId, fn);

  // 8. The row's own end (2.5). Twelve hours and one second after sign-in the same cookie
  //    is no longer a session, even though nothing has changed in it.
  const beforeEnd = await readSsoSession(payload, { withTenant: bind });
  check(beforeEnd !== null, 'the session reads back while it is live');

  await admin.query(
    "update libedge_sessions set expires_at = now() - interval '1 second' where session_id = $1",
    [payload.sid]);
  const afterEnd = await readSsoSession(payload, { withTenant: bind });
  check(afterEnd === null, 'a session past its absolute end reads as no session');
  await admin.query(
    'update libedge_sessions set expires_at = $2 where session_id = $1',
    [payload.sid, new Date(signedIn.session.expiresAt)]);

  // 9. The RLS control: the same signed cookie, but bound to another tenant. The row
  //    exists and is live; the policy is what refuses to return it. The cookie's tenant is
  //    the only thing that decided which tenant was bound, and a sid is not a key that
  //    spans tenants.
  const foreignRead = await readSsoSession(
    { sid: payload.sid, tenant: INDIVIDUAL_TENANT }, { withTenant: bind });
  check(foreignRead === null, 'a session read under another tenant returns zero rows');

  // ...and unbound, which is what a lookup that forgot to bind would look like: also zero,
  // rather than an error or a row.
  const unbound = await withBridgeAdmin(pool, async (client) => {
    const { rows } = await client.query(
      'select 1 from libedge_sessions where session_id = $1', [payload.sid]);
    return rows.length;
  });
  check(unbound === 0, 'an unbound read of libedge_sessions returns nothing');

  // A revoked row is gone even for the right tenant (2.5).
  await admin.query(
    'update libedge_sessions set revoked_at = now() where session_id = $1', [payload.sid]);
  check(await readSsoSession(payload, { withTenant: bind }) === null,
    'a revoked session reads as no session');
}

// The 90-day retention of 7.5, through the function 027 installs.
async function retentionControl() {
  await admin.query(
    `insert into sso_auth_events (at, outcome, reason)
     values (now() - interval '91 days', 'reject', 'invalid_signature'),
            (now() - interval '89 days', 'reject', 'invalid_signature')`);
  const before = await admin.query('select count(*)::int as count from sso_auth_events');
  const { rows } = await pool.query(
    "select app.sso_auth_events_purge('90 days') as removed");
  check(rows[0].removed === 1, `exactly the 91-day-old row is purged, removed ${rows[0].removed}`);
  const after = await admin.query('select count(*)::int as count from sso_auth_events');
  check(after.rows[0].count === before.rows[0].count - 1, 'the 89-day-old row is kept');

  // The app role cannot delete audit rows by hand: only the sweep can.
  let refused = false;
  try {
    await pool.query('delete from sso_auth_events');
  } catch (error) {
    refused = error.code === '42501';
  }
  check(refused, 'akademik_app has no DELETE on sso_auth_events');
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

async function main() {
  await setup();
  try {
    const signedIn = await happyPath();
    await controls({ granted: token() });
    await accountAndMembershipControls(signedIn.claims.sub);
    await sessionControls(signedIn);
    await retentionControl();
  } finally {
    await pool?.end().catch(() => {});
    await admin?.end().catch(() => {});
    await stopContainer();
  }

  console.log(`\n  ok - ${checks} checks\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
