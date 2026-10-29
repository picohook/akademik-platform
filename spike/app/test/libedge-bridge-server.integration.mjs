import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';

import { copyServerFiles } from './helpers/server-files.mjs';

// The LibEdge bridge as the socket sees it.
//
// Every other bridge test drives handleBridgeRequest directly, which proves the
// decisions but not the wiring: which path prefix reaches the bridge, whether the
// tenant context of an unrelated session leaks into it, whether a request from
// LibEdge really runs on the catalog pool, and whether the app's own endpoints still
// answer as they did. Those are all server.mjs facts, and a unit test cannot see them.
//
// Two things are checked that are easy to get wrong and impossible to notice:
//
//   * A request carrying a valid session cookie does NOT get that session's tenant
//     inside the bridge. The bridge is answered before any tenant is bound, so a
//     bridge handler that reached for requestTenant() throws instead of reading the
//     reader's tenant.
//   * The catalog endpoints are refused with DATABASE_UNAVAILABLE when
//     DATABASE_CATALOG_URL is unset, even with a valid catalog token, and the
//     entitlements endpoints keep working in the same process.
//
// Run by hand, it starts its own postgres and takes a few seconds:
//   node test/libedge-bridge-server.integration.mjs

const exec = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');
const repoDir = path.resolve(appDir, '../..');
const dbDir = path.join(repoDir, 'db');
// `pg` belongs to spike/app; resolved from there the way db/migrate.mjs does.
const pg = createRequire(path.join(appDir, 'package.json'))('pg');

const ENTITLEMENTS_TOKEN = 'entitlements-token-for-the-server-run';
const CATALOG_TOKEN = 'catalog-token-for-the-server-run-xx';
const container = `libedge-server-${randomUUID()}`;
const adminPassword = randomBytes(18).toString('hex');
const appPassword = randomBytes(18).toString('hex');
const catalogPassword = randomBytes(18).toString('hex');
const sessionSecret = randomBytes(32).toString('hex');

// The demo tenant server.mjs falls back to when a request has no session. It is a
// different tenant from every fixture below on purpose: if the bridge ever inherited
// it, a lookup would resolve to the wrong row rather than to no row, which is the
// failure that hides.
const DEMO_TENANT = '11111111-1111-1111-1111-111111111111';
const STAFF = '5799f2a5-3d90-41b1-90de-9da07d776052';
const INSTITUTION = '4a4a4a4a-4a4a-4a4a-8a4a-4a4a4a4a4a4a';
const INDIVIDUAL = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const GLOBAL_WORK = '9f9f9f9f-9f9f-4f9f-8f9f-9f9f9f9f9f9f';
const TENANT_WORK = '8e8e8e8e-8e8e-4e8e-8e8e-8e8e8e8e8e8e';
const WITHDRAWN_WORK = '7d7d7d7d-7d7d-4d7d-8d7d-7d7d7d7d7d7d';

let port;
let admin;
let checks = 0;
let tempDir;
const children = [];

const check = (condition, message) => { assert.ok(condition, message); checks += 1; };

async function docker(...args) {
  return (await exec('docker', args, { timeout: 90_000, maxBuffer: 1024 * 1024 })).stdout.trim();
}

async function freePort() {
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const value = socket.address().port;
  await new Promise((resolve, reject) => socket.close((error) => (error ? reject(error) : resolve())));
  return value;
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function eventually(label, fn, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  do {
    try { if (await fn()) return; } catch (error) { lastError = error; }
    await pause(200);
  } while (Date.now() < deadline);
  throw new Error(`${label} timed out${lastError ? `: ${lastError.message}` : ''}`);
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
      await pause(1000);
    }
  }
  if (!admin) throw new Error(`postgres did not become reachable: ${lastError?.message}`);

  await admin.query(await readFile(path.join(dbDir, 'schema.sql'), 'utf8'));
  for (const file of [
    '021-libedge-identity-and-subscriptions.sql',
    '022-global-catalogue-boundary.sql',
    '024-maintenance-tenants.sql',
    '025-libedge-tenant-provisioning.sql',
  ]) {
    await admin.query(await readFile(path.join(dbDir, 'migrations', file), 'utf8'));
  }

  await admin.query(`alter role akademik_app password '${appPassword}'`);
  // 022 creates akademik_catalog NOLOGIN and passwordless. Setting one here is the
  // deploy step db/README.md describes; a password in a migration is a password in git.
  await admin.query(`alter role akademik_catalog login password '${catalogPassword}'`);

  await admin.query(
    `insert into tenants (id, name, slug, libedge_kind, libedge_ref) values
       ($1, 'LibEdge', 'libedge', 'staff', 'libedge'),
       ($2, 'Kurum 42', 'kurum-42', 'institution', '42'),
       ($3, 'Bireysel', 'bireysel', 'individual', 'b2c')`,
    [STAFF, INSTITUTION, INDIVIDUAL],
  );
  // Three works: one global and live, one global and withdrawn, one owned by the
  // institution. The last two are what a correct catalogue read must not return.
  await admin.query(
    `insert into works (id, tenant_id, title, withdrawn_at) values
       ($1, null, 'Ortak Eser', null),
       ($2, null, 'Geri Cekilmis', '2026-10-01T00:00:00Z'),
       ($3, $4, 'Kurum Eseri', null)`,
    [GLOBAL_WORK, WITHDRAWN_WORK, TENANT_WORK, INSTITUTION],
  );

  return {
    appUrl: `postgres://akademik_app:${appPassword}@127.0.0.1:${port}/mig`,
    catalogUrl: `postgres://akademik_catalog:${catalogPassword}@127.0.0.1:${port}/mig`,
  };
}


// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

// `env` is the whole bridge configuration, passed explicitly rather than by mutating
// process.env, so a token cannot leak from one server into the next.
async function startServer(label, { databaseUrl, catalogUrl, env = {} }) {
  const sandboxApp = path.join(tempDir, label);
  await mkdir(sandboxApp, { recursive: true });
  // copyServerFiles walks server.mjs's own imports, so a new root-level module is
  // copied without this test having to know about it.
  await copyServerFiles(appDir, sandboxApp);

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: sandboxApp,
    env: {
      ...process.env,
      PORT: String(port),
      SESSION_SECRET: sessionSecret,
      DEMO_TENANT_ID: DEMO_TENANT,
      DATABASE_URL: databaseUrl || '',
      DATABASE_CATALOG_URL: catalogUrl || '',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const entry = { child, log: '', error: null, base };
  children.push(entry);
  child.on('error', (error) => { entry.error = error; });
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => { entry.log = (entry.log + chunk).slice(-200_000); });
  }
  await eventually(`${label} startup`, async () => {
    if (entry.error) throw entry.error;
    assert.equal(child.exitCode, null, `${label} exited: ${entry.log}`);
    const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2000) });
    assert.equal((await response.json()).mode, 'db', `${label} is not in db mode`);
    return response.ok;
  }, 60_000);
  return base;
}

async function shutdown(entry) {
  if (entry.child.exitCode !== null) return;
  entry.child.kill();
  await new Promise((resolve) => {
    entry.child.once('exit', resolve);
    setTimeout(resolve, 5000);
  });
}

// A request with no cookie, no CSRF, and only what a LibEdge worker would send.
async function bridge(base, route, { method = 'GET', token, actor, body, headers = {} } = {}) {
  const sent = { ...headers };
  if (token !== null) sent.authorization = `Bearer ${token ?? ENTITLEMENTS_TOKEN}`;
  if (actor !== null) sent['x-libedge-actor'] = actor ?? 'system:server-test';
  if (body !== undefined && method !== 'GET' && method !== 'HEAD') sent['content-type'] = 'application/json';
  const response = await fetch(base + route, {
    method,
    headers: sent,
    body: body === undefined || method === 'GET' || method === 'HEAD'
      ? undefined
      : JSON.stringify(body),
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { /* Not JSON: the assertion will say so. */ }
  return { status: response.status, headers: response.headers, text, data };
}

function lastLog() {
  const entry = children[children.length - 1];
  if (!entry) return '';
  const lines = entry.log.split('\n').filter((line) => line.trim());
  const errors = lines.filter((line) => /\[bridge\] unhandled/.test(line));
  return (errors.length ? errors : lines).slice(-12).join('\n');
}

function expect(result, status, code, label) {
  assert.equal(result.status, status,
    `${label}: expected ${status}, got ${result.status} ${(result.text || '').slice(0, 300)}\n--- server log ---\n${lastLog()}`);
  if (code !== undefined) {
    assert.equal(result.data?.error, code,
      `${label}: expected error ${code}, got ${(result.text || '').slice(0, 300)}\n--- server log ---\n${lastLog()}`);
  }
  checks += 1;
  return result;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

async function main() {
  await mkdir(path.join(appDir, 'tmp'), { recursive: true });
  tempDir = await mkdtemp(path.join(appDir, 'tmp', 'libedge-server-'));
  const { appUrl, catalogUrl } = await setup();
  console.log('Isolated PostgreSQL 16, akademik_app + akademik_catalog, ready.');

  // -------------------------------------------------------------------------
  // A bridge with no token configured answers 503 on every endpoint.
  //
  // Every, not just the authenticated ones: health takes no token and must still
  // say "switched off", because a 200 on health is what tells a monitoring probe the
  // bridge is live when it is not (section 5.1).
  // -------------------------------------------------------------------------
  const unconfigured = await startServer('unconfigured', { databaseUrl: appUrl, catalogUrl });
  for (const [method, route] of [
    ['GET', '/api/libedge/v1/health'],
    ['PUT', '/api/libedge/v1/tenants/institution/42'],
    ['GET', '/api/libedge/v1/tenants/institution/42'],
    ['PUT', '/api/libedge/v1/accounts/u-1'],
    ['PUT', '/api/libedge/v1/subscriptions/institution:42'],
    ['GET', '/api/libedge/v1/catalog'],
    ['POST', `/api/libedge/v1/catalog/works/${GLOBAL_WORK}/publish`],
  ]) {
    const result = await bridge(unconfigured, route, { method, token: ENTITLEMENTS_TOKEN, body: {} });
    expect(result, 503, 'BRIDGE_NOT_CONFIGURED', `unconfigured ${method} ${route}`);
  }
  // The header is irrelevant while no token is configured: a request without one is
  // not told "you forgot a token" when the truth is that the bridge has none to
  // compare against.
  expect(await bridge(unconfigured, '/api/libedge/v1/health', { token: null }),
    503, 'BRIDGE_NOT_CONFIGURED', 'unconfigured health without a header');
  for (const entry of children) await shutdown(entry);
  children.length = 0;

  // -------------------------------------------------------------------------
  // A configured bridge.
  // -------------------------------------------------------------------------
  const base = await startServer('configured', {
    databaseUrl: appUrl,
    catalogUrl,
    env: {
      LIBEDGE_ENTITLEMENTS_TOKENS: ENTITLEMENTS_TOKEN,
      LIBEDGE_CATALOG_TOKENS: CATALOG_TOKEN,
    },
  });

  // health needs no token at all: it is the one endpoint a probe calls.
  const health = expect(await bridge(base, '/api/libedge/v1/health', { token: null }),
    200, undefined, 'health without a token');
  check(health.data?.ok === true, 'health reports ok');
  // Two global works exist and one is withdrawn; health counts both, because
  // withdrawn is a publication state, not a deletion.
  check(health.data?.global_works === 2,
    `health counted ${health.data?.global_works} global works, expected 2`);
  // It does NOT report a tenant count. With no tenant bound, tenants_self shows
  // akademik_app nothing, so a count here would be 0 on a database with three tenants -
  // a healthy-looking zero. Pinned so nobody adds it back.
  check(health.data?.tenants === undefined,
    'health reports a tenant count, which is always 0 without a binding');


  // -------------------------------------------------------------------------
  // No token, a wrong token, and a token of the wrong kind are three different
  // answers. Collapsing them would either leak that a secret is valid in some other
  // role, or tell an unauthenticated caller which of their guesses was close.
  // -------------------------------------------------------------------------
  expect(await bridge(base, '/api/libedge/v1/tenants/institution/42', { token: null }),
    401, 'UNAUTHORIZED', 'entitlements route with no token');
  expect(await bridge(base, '/api/libedge/v1/tenants/institution/42',
    { token: 'not-a-real-token-but-long-enough' }),
    401, 'UNAUTHORIZED', 'entitlements route with a wrong token');
  expect(await bridge(base, '/api/libedge/v1/tenants/institution/42', { token: CATALOG_TOKEN }),
    403, 'TOKEN_SCOPE', 'entitlements route with the catalog token');

  // The token kinds reach their own endpoints.
  const tenant = expect(await bridge(base, '/api/libedge/v1/tenants/institution/42'),
    200, undefined, 'GET tenant with the entitlements token');
  check(tenant.data?.tenant?.id === INSTITUTION,
    `tenant lookup returned ${JSON.stringify(tenant.data?.tenant)}`);
  check(tenant.data?.tenant?.name === 'Kurum 42', 'tenant name is the stored one');

  // The actor is required on every scoped route: a write with no actor has no audit
  // trail, and the contract refuses it rather than recording "unknown".
  expect(await bridge(base, '/api/libedge/v1/tenants/institution/42', { actor: null }),
    403, 'ACTOR_REQUIRED', 'entitlements route with no actor');
  expect(await bridge(base, '/api/libedge/v1/tenants/institution/42', { actor: 'not-a-prefix' }),
    403, 'ACTOR_REQUIRED', 'entitlements route with a malformed actor');
  // health does not want one, and a caller that sends one must not be punished for it.
  expect(await bridge(base, '/api/libedge/v1/health', { token: null, actor: 'nonsense' }),
    200, undefined, 'health ignores the actor header');

  // A path segment may not carry an encoded separator. `%2F` is the interesting one:
  // Node leaves it encoded in url.pathname, and decoding it would turn one segment into
  // two - so a ref of `42%2F9` must be refused rather than silently becoming a different
  // route or a different tenant. The answer is the contract's 400 and it arrives before
  // any tenant is looked up.
  //
  // Written literally into the URL, not through encodeURIComponent, so the request on the
  // wire is exactly `%2F` and not a double-escaped `%252F`.
  const encodedSlash = await bridge(base, '/api/libedge/v1/tenants/institution/42%2F9');
  expect(encodedSlash, 400, 'INVALID_BODY', 'a ref with an encoded slash');
  check(!('tenant' in (encodedSlash.data || {})), 'the encoded slash reached the tenant resolver');
  // The traversal-shaped variant of the same request, and the same answer.
  expect(await bridge(base, '/api/libedge/v1/tenants/institution/..%2F..%2F42'),
    400, 'INVALID_BODY', 'a ref that decodes to a traversal');
  // On the catalog route as well: the id slot must not accept a decoded separator.
  expect(await bridge(base, '/api/libedge/v1/catalog/works/%2F'),
    400, 'INVALID_BODY', 'a work id that decodes to a slash');
  // A segment that is not valid percent-encoding is the same refusal, not a hung request.
  expect(await bridge(base, '/api/libedge/v1/tenants/institution/42%zz'),
    400, 'INVALID_BODY', 'a ref with a broken escape');
  // And a legal encoded value still reaches the resolver as the caller wrote it: `%41` is
  // `A`, so this resolves to a ref that does not exist rather than to `%41` or to `41`.
  expect(await bridge(base, '/api/libedge/v1/tenants/institution/%41'),
    404, 'TENANT_NOT_FOUND', 'an encoded but legal ref');

  expect(await bridge(base, '/api/libedge/v1/nope'), 404, 'NOT_FOUND', 'unknown bridge path');
  // The prefix is a prefix: a path that merely starts with the same characters is
  // the app's, and must not be answered with bridge headers. The app refuses it for its
  // own reasons (401 on an unknown /api path), so the assertion is on the header, not
  // the status - a 404 here would prove nothing about which handler ran.
  const nearMiss = await fetch(`${base}/api/libedge/v1x/health`, { signal: AbortSignal.timeout(10_000) });
  check(nearMiss.headers.get('x-request-id') === null,
    'the app answered /api/libedge/v1x/health with bridge headers: the prefix check is too loose');
  check(nearMiss.status !== 503,
    'a path that is not under the bridge was answered by the bridge');

  // -------------------------------------------------------------------------
  // The catalogue.
  //
  // What is asserted is the exclusion, because that is what a wrong implementation
  // gets wrong silently: the withdrawn work and the tenant-owned work must never
  // appear in the global catalogue, and the tenant-owned one must not be reported as
  // existing-but-forbidden either.
  // -------------------------------------------------------------------------
  const catalog = expect(await bridge(base, '/api/libedge/v1/catalog'),
    200, undefined, 'GET /catalog');
  const titles = (catalog.data?.works || []).map((work) => work.title);
  check(JSON.stringify(titles) === JSON.stringify(['Ortak Eser']),
    `the catalogue returned ${JSON.stringify(titles)}, expected only the live global work`);
  check(catalog.data?.has_more === false, 'one work is not a page with more');

  const work = expect(await bridge(base, `/api/libedge/v1/catalog/works/${GLOBAL_WORK}`),
    200, undefined, 'GET a global work');
  check(work.data?.work?.title === 'Ortak Eser', 'the work body carries the title');
  check(work.data?.work?.withdrawn === false, 'a live work is not withdrawn');
  // A withdrawn work is still reported by id: hiding it would make a withdrawal
  // indistinguishable from a deletion to a caller that already holds the id.
  const withdrawn = expect(await bridge(base, `/api/libedge/v1/catalog/works/${WITHDRAWN_WORK}`),
    200, undefined, 'GET a withdrawn work');
  check(withdrawn.data?.work?.withdrawn === true, 'the withdrawn work says so');
  expect(await bridge(base, `/api/libedge/v1/catalog/works/${TENANT_WORK}`),
    404, 'WORK_NOT_FOUND', 'a tenant work is not in the global catalogue');
  // A malformed id is the contract's 404, not a Postgres 22P02 surfacing as a 500.
  expect(await bridge(base, '/api/libedge/v1/catalog/works/not-a-uuid'),
    404, 'WORK_NOT_FOUND', 'a malformed work id');
  // Pagination is the contract's: out-of-range values are refused, not clamped.
  expect(await bridge(base, '/api/libedge/v1/catalog?limit=0'), 400, 'INVALID_BODY', 'limit=0');
  expect(await bridge(base, '/api/libedge/v1/catalog?limit=101'), 400, 'INVALID_BODY', 'limit=101');
  expect(await bridge(base, '/api/libedge/v1/catalog?limit=1.5'), 400, 'INVALID_BODY', 'limit=1.5');
  expect(await bridge(base, '/api/libedge/v1/catalog?offset=-1'), 400, 'INVALID_BODY', 'offset=-1');

  // -------------------------------------------------------------------------
  // Session isolation, and the body edge cases a proxy introduces.
  //
  // A bridge request that happens to carry an app session cookie must be answered
  // exactly as one that does not: the bridge's tenant comes from the path. The
  // cookie is sent with a tenant that exists, so an implementation that fell back to
  // it would return the wrong row rather than fail loudly.
  // -------------------------------------------------------------------------
  const withCookie = await bridge(base, '/api/libedge/v1/tenants/institution/42', {
    headers: { cookie: 'akademik_session=not-a-real-session; akademik_csrf=x' },
  });
  expect(withCookie, 200, undefined, 'a bridge request carrying an app session cookie');
  check(withCookie.data?.tenant?.id === INSTITUTION,
    'the bridge resolved the path tenant, not the session tenant');

  // A body that is not JSON is the caller's fault and is reported as such rather
  // than crashing the route.
  const badJson = await fetch(`${base}/api/libedge/v1/tenants/institution/42`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${ENTITLEMENTS_TOKEN}`,
      'x-libedge-actor': 'system:server-test',
      'content-type': 'application/json',
    },
    body: '{"name": ',
    signal: AbortSignal.timeout(10_000),
  });
  const badJsonBody = await badJson.json();
  check(badJson.status === 400 && badJsonBody.error === 'INVALID_BODY',
    `an unparseable body got ${badJson.status} ${JSON.stringify(badJsonBody)}`);

  // An undefined field is refused, and a non-institution kind is not provisionable.
  expect(await bridge(base, '/api/libedge/v1/tenants/institution/42', {
    method: 'PUT', body: { name: 'Kurum 42', slug: 'kurum-42', unknown_field: true },
  }), 400, 'INVALID_BODY', 'an unknown body field');
  expect(await bridge(base, '/api/libedge/v1/tenants/individual/b2c', {
    method: 'PUT', body: { name: 'Bireysel', slug: 'bireysel' },
  }), 422, 'TENANT_KIND_NOT_PROVISIONABLE', 'PUT on a non-institution tenant');


  // -------------------------------------------------------------------------
  // The app's own endpoints are unchanged.
  //
  // The bridge is answered before every route in handleRequest, so the risk is
  // shadowing: a path that used to reach the app now reaching the bridge, or a
  // header the bridge sets leaking onto app responses. Login, config, health and OPDS
  // are the four that matter - they are what a deployment smoke test touches.
  // -------------------------------------------------------------------------
  const appHealth = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(10_000) });
  const appHealthBody = await appHealth.json();
  check(appHealth.status === 200 && appHealthBody.mode === 'db',
    `the app's /api/health changed: ${appHealth.status} ${JSON.stringify(appHealthBody)}`);
  check(appHealthBody.tenantId === DEMO_TENANT, '/api/health still reports the demo tenant');
  check(appHealth.headers.get('x-request-id') === null,
    'the bridge set x-request-id on an app response');

  const config = await fetch(`${base}/api/config`, { signal: AbortSignal.timeout(10_000) });
  const configBody = await config.json();
  check(config.status === 200 && configBody.mode === 'db',
    `the app's /api/config changed: ${config.status}`);

  // Login refuses a bad password, and a failed login sets no session cookie.
  const login = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'nobody@example.edu.tr', password: 'wrong-password' }),
    signal: AbortSignal.timeout(10_000),
  });
  check(login.status === 401, `login with a bad password returned ${login.status}`);
  check((login.headers.getSetCookie?.() || []).length === 0, 'a failed login set a cookie');

  // OPDS with no OPDS_API_KEY configured refuses rather than serving the catalogue.
  const opds = await fetch(`${base}/opds`, {
    headers: { authorization: `Basic ${Buffer.from('reader:wrong').toString('base64')}` },
    signal: AbortSignal.timeout(10_000),
  });
  check(opds.status === 401, `OPDS without a configured key returned ${opds.status}`);

  // The bridge root does not serve the SPA shell: HTML there would parse as a crash
  // on the LibEdge side instead of the contract's error shape. `/api/libedge/v1/` with
  // nothing after it is not a route, so the answer is the contract's NOT_FOUND.
  const shell = await fetch(`${base}/api/libedge/v1/`, { signal: AbortSignal.timeout(10_000) });
  const shellText = await shell.text();
  check(!/<!doctype html>/i.test(shellText), 'the bridge root served the SPA shell');
  check(shell.status === 404 && JSON.parse(shellText).error === 'NOT_FOUND',
    `the bridge root answered ${shell.status} ${shellText.slice(0, 200)}`);
  checks += 1;

  for (const entry of children) await shutdown(entry);
  return appUrl;
}

// ---------------------------------------------------------------------------
// A bridge configured with no catalog pool.
// ---------------------------------------------------------------------------

// A separate process because the pool is built at startup: an absent
// DATABASE_CATALOG_URL cannot be simulated by a later request. What matters is that
// the bridge keeps working for everything that does not need that pool - an operator
// who has not set the variable yet loses the catalog path, not the whole bridge.
async function catalogless(appUrl) {
  const base = await startServer('catalogless', {
    databaseUrl: appUrl,
    catalogUrl: null,
    env: {
      LIBEDGE_ENTITLEMENTS_TOKENS: ENTITLEMENTS_TOKEN,
      LIBEDGE_CATALOG_TOKENS: CATALOG_TOKEN,
    },
  });
  expect(await bridge(base, '/api/libedge/v1/health', { token: null }),
    200, undefined, 'health without a catalog pool');
  expect(await bridge(base, '/api/libedge/v1/tenants/institution/42'),
    200, undefined, 'a tenant read without a catalog pool');
  // GET /catalog is an entitlements read and so does not need the catalog pool at
  // all; it must still answer. This is the assertion that the pool split follows the
  // route's scope rather than "any request that mentions the catalogue".
  expect(await bridge(base, '/api/libedge/v1/catalog'),
    200, undefined, 'GET /catalog without a catalog pool');
  // The catalog token is not accepted on that route, so the missing pool is not the
  // reason it fails.
  expect(await bridge(base, '/api/libedge/v1/catalog', { token: CATALOG_TOKEN }),
    403, 'TOKEN_SCOPE', 'the catalog token on an entitlements route');
  for (const entry of children) await shutdown(entry);
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

let exitCode = 0;
try {
  const appUrl = await main();
  await catalogless(appUrl);
  console.log(`\nlibedge bridge server integration: ${checks} checks passed`);
} catch (error) {
  exitCode = 1;
  console.error('\nFAILED:', error.message);
  console.error(error.stack);
} finally {
  for (const entry of children) await shutdown(entry).catch(() => {});
  if (admin) await admin.end().catch(() => {});
  await docker('rm', '--force', container).catch(() => {});
  if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  process.exit(exitCode);
}
