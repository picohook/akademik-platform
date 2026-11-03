import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyServerFiles } from './helpers/server-files.mjs';
import { promisify } from 'node:util';
import pg from 'pg';

// Access control: who sees which books.
//
// The fixture is the measured production shape, not an invented one. EC2 has
// exactly two tenants, the catalogue lives under 5799f2a5-... and the demo
// tenant 11111111-... is empty. The single grants row carries tenant_id
// 5799f2a5-... but subject_id 11111111-... - the real mismatch - so it matches
// no user at all. That is what made grantAllows()'s empty-list `true` so
// dangerous: it hid the broken grant by granting everything to everyone.

const exec = promisify(execFile);
const appDir = fileURLToPath(new URL('../', import.meta.url));
const repoDir = path.resolve(appDir, '../..');
const tempParent = path.join(appDir, 'tmp');
const runId = randomUUID();
const container = `akademik-tenant-${runId}`;

// Measured EC2 identifiers. Do not replace with invented tenants: the point of
// this file is that it would have failed on the real database.
const LIBEDGE_TENANT = '5799f2a5-3d90-41b1-90de-9da07d776052';
const DEMO_TENANT = '11111111-1111-1111-1111-111111111111';
const COLLECTION_ID = '88888888-8888-8888-8888-888888888888';
const SEED_GRANT = '77777777-7777-7777-7777-777777777777';
const WORKS = Array.from({ length: 13 }, (_, i) => ({
  work: `a0000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
  edition: `b0000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
  asset: `c0000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
  title: `LibEdge catalogue title ${String(i + 1).padStart(2, '0')}`,
}));

const adminPassword = randomBytes(24).toString('hex');
const appPassword = randomBytes(24).toString('hex');
const userPassword = randomBytes(18).toString('hex');
const sessionSecret = randomBytes(32).toString('hex');
const children = [];
let containerCreated = false;
let tempDir;
let admin;
let cleanupPromise;
let checks = 0;
let scenarioCount = 0;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function docker(...args) {
  return (await exec('docker', args, { timeout: 90_000, maxBuffer: 1024 * 1024 })).stdout.trim();
}

async function eventually(label, fn, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  do {
    try { if (await fn()) return; } catch (error) { lastError = error; }
    await pause(200);
  } while (Date.now() < deadline);
  throw new Error(`${label} timed out${lastError ? `: ${lastError.message}` : ''}`);
}

async function freePort() {
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  return port;
}

// DEMO_TENANT_ID is set to a tenant that is deliberately NOT where the
// catalogue lives. The old code trusted this env value for every query; a
// passing test proves the session's tenant wins instead.
async function startApp(databaseUrl, demoEnvTenant, extraEnv = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: path.join(tempDir, 'app'),
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      PORT: String(port),
      DEMO_TENANT_ID: demoEnvTenant,
      SESSION_SECRET: sessionSecret,
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const entry = { child, log: '', error: null, base: `http://127.0.0.1:${port}` };
  children.push(entry);
  child.on('error', (error) => { entry.error = error; });
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => { entry.log = (entry.log + chunk).slice(-20_000); });
  }
  await eventually('app startup', async () => {
    if (entry.error) throw entry.error;
    assert.equal(child.exitCode, null, `server exited: ${entry.log}`);
    const response = await fetch(`${entry.base}/api/health`, { signal: AbortSignal.timeout(2000) });
    assert.equal((await response.json()).mode, 'db');
    return response.ok;
  }, 60_000);
  return entry.base;
}

async function request(base, route, session, { method = 'GET', body, headers: extraHeaders = {} } = {}) {
  const headers = { ...extraHeaders };
  if (session) {
    headers.cookie = session.cookie;
    headers['x-csrf-token'] = session.csrf;
  }
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const response = await fetch(base + route, {
    method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { /* non-JSON route */ }
  const cookies = response.headers.getSetCookie().map((cookie) => cookie.split(';')[0]);
  return { status: response.status, headers: response.headers, text, data, cookies };
}

async function login(base, email, expected = 200, password = userPassword) {
  const result = await request(base, '/api/login', null, {
    method: 'POST', body: { email, password },
  });
  assert.equal(result.status, expected, `login ${email}: ${result.text}`);
  const csrf = result.cookies.find((cookie) => cookie.startsWith('akademik_csrf='));
  return {
    ...result,
    cookie: result.cookies.join('; '),
    csrf: csrf ? decodeURIComponent(csrf.slice('akademik_csrf='.length)) : '',
  };
}

function check(condition, message) {
  assert.ok(condition, message);
  checks++;
}

// Assert on the catalogue endpoint, because that is what a user actually sees.
async function visibleTitles(base, session) {
  const result = await request(base, '/api/books', session);
  assert.equal(result.status, 200, `list books: ${result.text}`);
  const books = Array.isArray(result.data) ? result.data : result.data?.books;
  assert.ok(Array.isArray(books), `expected an array, got: ${result.text.slice(0, 200)}`);
  return books.map((book) => book.work_title || book.title).sort();
}

async function setup() {
  await docker('version', '--format', '{{.Server.Version}}');
  await mkdir(tempParent, { recursive: true });
  tempDir = await mkdtemp(path.join(tempParent, 'tenant-'));
  const sandboxApp = path.join(tempDir, 'app');
  await mkdir(path.join(sandboxApp, 'public', 'seed'), { recursive: true });
  await copyServerFiles(appDir, sandboxApp);
  // The demo books point at seed/sample.pdf; create it so a demo read reaches
  // storage instead of failing on a missing file and masking an access denial.
  await writeFile(path.join(sandboxApp, 'public', 'seed', 'tenant.pdf'), 'placeholder');
  await writeFile(path.join(sandboxApp, 'public', 'seed', 'sample.pdf'), 'placeholder');

  await docker('run', '--detach', '--rm', '--name', container,
    '--label', `akademik.tenant-test=${runId}`,
    '--tmpfs', '/var/lib/postgresql/data',
    '--publish', '127.0.0.1::5432',
    '--env', 'POSTGRES_USER=tenant_admin',
    '--env', 'POSTGRES_DB=tenant_test',
    '--env', `POSTGRES_PASSWORD=${adminPassword}`, 'postgres:16-alpine');
  containerCreated = true;
  const mapping = await docker('port', container, '5432/tcp');
  const port = Number(mapping.match(/:(\d+)\s*$/)?.[1]);
  assert.ok(port, `unexpected port mapping: ${mapping}`);
  const adminUrl = `postgres://tenant_admin:${adminPassword}@127.0.0.1:${port}/tenant_test`;
  await eventually('PostgreSQL readiness', async () => {
    const probe = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 1000 });
    try { await probe.connect(); return true; } finally { await probe.end().catch(() => {}); }
  }, 60_000);
  admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  // schema.sql only; seed.sql would add the demo tenant's own fixtures and
  // hide the very asymmetry this file exists to reproduce.
  await admin.query(await readFile(path.join(repoDir, 'db/schema.sql'), 'utf8'));
  await admin.query(`alter role akademik_app password '${appPassword}'`);

  const { rows: [role] } = await admin.query(
    "select rolsuper, rolbypassrls from pg_roles where rolname = 'akademik_app'",
  );
  assert.equal(role.rolsuper, false);
  assert.equal(role.rolbypassrls, false);

  // Login has to resolve an email to a tenant before any tenant is bound, and
  // `users` is under RLS, so the app role cannot do it alone. Run the real
  // migration, not a copy of it: this test must exercise what ships.
  await admin.query(await readFile(path.join(repoDir, 'db/migrations/018-tenant-for-login.sql'), 'utf8'));

  const salt = randomBytes(16).toString('hex');
  const hash = `scrypt$${salt}$${scryptSync(userPassword, salt, 64).toString('hex')}`;

  // Measured EC2 tenants: exactly these two, nothing invented.
  await admin.query(
    `insert into tenants (id, name, slug) values
       ($1, 'Demo Üniversitesi', 'demo-universitesi'),
       ($2, 'LibEdge', 'libedge')`, [DEMO_TENANT, LIBEDGE_TENANT],
  );

  const users = {};
  for (const [key, tenantId, email, roleName] of [
    ['admin', LIBEDGE_TENANT, 'altan@libedge.com', 'admin'],
    ['ungranted', LIBEDGE_TENANT, 'ungranted@libedge.com', 'reader'],
  ]) {
    const id = randomUUID();
    await admin.query(
      `insert into users (id, tenant_id, email, display_name, role, password_hash, max_sessions)
       values ($1, $2, $3, $3, $4, $5, 10)`, [id, tenantId, email, roleName, hash],
    );
    users[key] = { id, email, tenantId };
  }

  // The 13 works live under LibEdge, never under the demo tenant.
  for (const row of WORKS) {
    await admin.query(
      `insert into works (id, tenant_id, title, language, subjects) values ($1, $2, $3, 'tr', '{}')`,
      [row.work, LIBEDGE_TENANT, row.title],
    );
    await admin.query(
      `insert into editions (id, tenant_id, work_id, publisher) values ($1, $2, $3, 'LibEdge Yayınları')`,
      [row.edition, LIBEDGE_TENANT, row.work],
    );
    await admin.query(
      `insert into assets (id, tenant_id, edition_id, format, storage_key, page_count)
       values ($1, $2, $3, 'pdf', 'seed/tenant.pdf', 1)`,
      [row.asset, LIBEDGE_TENANT, row.edition],
    );
  }
  await admin.query(
    `insert into collections (id, tenant_id, title, slug) values ($1, $2, 'LibEdge Koleksiyonu', 'libedge')`,
    [COLLECTION_ID, LIBEDGE_TENANT],
  );
  for (const row of WORKS) {
    await admin.query(
      `insert into collection_items (collection_id, work_id) values ($1, $2)`, [COLLECTION_ID, row.work],
    );
  }

  return { port, hash, users };
}

async function grant(port) {
  return `postgres://akademik_app:${appPassword}@127.0.0.1:${port}/tenant_test`;
}

// Scenario 1: the production breakage, reproduced and then denied.
//
// The only grants row names subject_id 11111111-... (demo) while its tenant is
// 5799f2a5-... (LibEdge), so it matches no user. Under fail-open the reader saw
// all 13 works; that is the defect. Failure to decide access must deny.
async function adminGrantTenantTest(context) {
  const base = await startApp(await grant(context.port), DEMO_TENANT);
  const manager = await login(base, context.users.admin.email);
  const before = await visibleTitles(base, manager);
  check(before.length === 0, 'no grant means no books before grant creation');
  const result = await request(base, '/api/grants', manager, { method: 'POST', body: { subjectType: 'tenant', scopeType: 'all', source: 'manual' } });
  check(result.status === 201, 'tenant manager can create own grant: ' + result.text);
  check(result.data.tenant_id === undefined || result.data.tenant_id === LIBEDGE_TENANT, 'returned grant belongs to session tenant');
  check(result.data.subject_id === LIBEDGE_TENANT, 'tenant grant subject is the session tenant, not the process default');
  const row = (await admin.query('select tenant_id, subject_id from grants where id = $1', [result.data.id])).rows[0];
  check(row.tenant_id === LIBEDGE_TENANT && row.subject_id === LIBEDGE_TENANT, 'real Postgres stores matching tenant and subject');
  check((await visibleTitles(base, manager)).length === WORKS.length, 'new grant actually unlocks the session tenant catalogue');
  const reader = await login(base, context.users.ungranted.email);
  check((await visibleTitles(base, reader)).length === WORKS.length, 'same-tenant reader gets intended grant');
  const denied = await request(base, '/api/grants', reader, { method: 'POST', body: { subjectType: 'tenant', scopeType: 'all' } });
  check(denied.status === 403, 'ordinary reader cannot create a grant');
  const audit = (await admin.query('select tenant_id from grant_audit where grant_id = $1', [result.data.id])).rows;
  check(audit.length === 1 && audit[0].tenant_id === LIBEDGE_TENANT, 'grant audit stays in correct tenant');
  const list = await request(base, '/api/grants', manager);
  check(list.status === 200 && list.data.some(g => g.id === result.data.id), 'manager sees created grant');
  const removed = await request(base, '/api/grants/' + result.data.id, manager, { method: 'DELETE' });
  check(removed.status === 200, 'manager removes own test grant');
  check((await visibleTitles(base, reader)).length === 0, 'revocation removes access again');
  scenarioCount++; console.log('PASS admin grant follows authenticated tenant with a different process default.');
}

async function cleanup() {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    for (const { child } of children) {
      if (child.exitCode === null) {
        const exited = once(child, 'exit').catch(() => {});
        child.kill();
        await Promise.race([exited, pause(3000)]);
        if (child.exitCode === null) { child.kill('SIGKILL'); await exited; }
      }
    }
    await admin?.end().catch(() => {});
    if (containerCreated) {
      // Only remove the randomly named container carrying our exact run label.
      const label = await docker('inspect', '--format', '{{ index .Config.Labels "akademik.tenant-test" }}', container);
      assert.equal(label, runId, 'refusing to remove a container not owned by this test');
      await docker('rm', '--force', container);
    }
    if (tempDir) {
      const target = path.resolve(tempDir);
      const relative = path.relative(path.resolve(tempParent), target);
      assert.ok(relative.startsWith('tenant-') && !relative.includes(path.sep) && !path.isAbsolute(relative), 'unsafe test cleanup path');
      await rm(target, { recursive: true, force: true });
    }
  })();
  return cleanupPromise;
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => { void cleanup().finally(() => process.exit(130)); });
}

try {
  const context = await setup();
  console.log(`Fixture: 2 tenants (measured EC2 ids), ${WORKS.length} works under LibEdge, grant mismatched on purpose.`);
  await adminGrantTenantTest(context);

  // Timers fire outside any request. `startDownloadMaintenance` runs one tick
  // immediately at startup and then every 60s; with no tenant bound, withTenant
  // throws. That must not happen - the sweeper has to name its tenant itself
  // instead of inheriting whatever the env says. Give the first ticks time to
  // land and assert the server never logged a failure.
  await pause(2500);
  const maintenanceFailures = children
    .flatMap(({ log }) => log.split('\n'))
    .filter((line) => /maintenance failed|no tenant bound/.test(line));
  check(maintenanceFailures.length === 0,
    `scheduled maintenance failed outside a request:\n${maintenanceFailures.join('\n')}`);
  console.log(`\n${scenarioCount} tenant-access scenarios passed (${checks} checks).`);
} catch (error) {
  console.error(error);
  for (const { log } of children) {
    const redacted = [adminPassword, appPassword, userPassword]
      .reduce((text, secret) => text.replaceAll(secret, '[redacted]'), log);
    console.error(redacted.split('\n').slice(-20).join('\n'));
  }
  process.exitCode = 1;
} finally {
  await cleanup();
}
