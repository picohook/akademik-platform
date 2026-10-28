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
async function ungrantedTest(context) {
  const databaseUrl = await grant(context.port);
  const base = await startApp(databaseUrl, LIBEDGE_TENANT);
  await admin.query(
    `insert into grants (id, tenant_id, subject_type, subject_id, scope_type, scope_id, status)
     values ($1, $2, 'tenant', $3, 'collection', $4, 'active')`,
    [SEED_GRANT, LIBEDGE_TENANT, DEMO_TENANT, COLLECTION_ID],
  );

  const reader = await login(base, context.users.ungranted.email);
  const titles = await visibleTitles(base, reader);
  check(titles.length === 0, `ungranted reader saw ${titles.length} works, expected 0: ${titles.slice(0, 3).join(', ')}`);

  // A book the reader may not see must also be denied by id, not just filtered
  // out of the list: a hidden list with an open detail route is no barrier.
  // There is no GET /api/books/:id; the per-book route is the search one, which
  // is what canAccessBook guards.
  const detail = await request(base, `/api/books/${WORKS[0].work}/search?q=a`, reader);
  check(detail.status === 403 || detail.status === 404,
    `ungranted reader used a hidden book directly: ${detail.status}`);

  scenarioCount++;
  console.log('PASS grants: reader with no matching grant sees 0 of 13 works, and is denied by id.');

  // An unknown address must look exactly like a bad password: 401, not 500 and
  // not a different message.
  const unknown = await request(base, '/api/login', null, {
    method: 'POST', body: { email: 'nobody@libedge.com', password: 'wrong-password-value' },
  });
  check(unknown.status === 401, `unknown account answered ${unknown.status}, expected 401`);
  const wrongPassword = await request(base, '/api/login', null, {
    method: 'POST', body: { email: context.users.ungranted.email, password: 'wrong-password-value' },
  });
  check(wrongPassword.status === 401 && wrongPassword.text === unknown.text,
    `bad password and unknown account are distinguishable: ${wrongPassword.text} vs ${unknown.text}`);

  return base;
}

// Scenario 2: a grant that actually points at the user's own tenant and scope.
// This is the state EC2 should have been in, and the one fail-closed must keep
// working. DEMO_TENANT_ID is set to the demo tenant on purpose: if the session
// were ignored in favour of env, this would return nothing.
async function grantedTest(context) {
  const databaseUrl = await grant(context.port);
  const base = await startApp(databaseUrl, DEMO_TENANT);

  await admin.query('update grants set subject_id = $1 where id = $2', [LIBEDGE_TENANT, SEED_GRANT]);

  const reader = await login(base, context.users.ungranted.email);
  const titles = await visibleTitles(base, reader);
  check(titles.length === WORKS.length,
    `granted reader saw ${titles.length} works, expected ${WORKS.length}`);

  const detail = await request(base, `/api/books/${WORKS[0].work}/search?q=a`, reader);
  check(detail.status === 200, `granted reader was denied a book they hold: ${detail.status} ${detail.text.slice(0, 200)}`);

  scenarioCount++;
  console.log(`PASS grants: reader with a matching collection grant sees all ${WORKS.length} works.`);
  return base;
}

// Scenario 3: the admin keeps the catalogue. This is the regression the whole
// ordering exists to prevent - flipping grantAllows alone empties the site for
// everyone including the admin.
async function adminTest(context) {
  const databaseUrl = await grant(context.port);
  const base = await startApp(databaseUrl, LIBEDGE_TENANT);

  const session = await login(base, context.users.admin.email);
  const titles = await visibleTitles(base, session);
  check(titles.length === WORKS.length,
    `admin saw ${titles.length} works, expected ${WORKS.length}`);

  // Sees the books through the grant, not through a role bypass.
  await admin.query("update grants set status = 'revoked' where id = $1", [SEED_GRANT]);
  const afterRevoke = await visibleTitles(base, session);
  check(afterRevoke.length === 0,
    `admin still saw ${afterRevoke.length} works after the grant was revoked; access is not grant-based`);
  await admin.query("update grants set status = 'active' where id = $1", [SEED_GRANT]);

  scenarioCount++;
  console.log('PASS grants: admin sees all 13 works, and loses them when the grant is revoked.');
}

// Scenario 3b: editing a book must write in the tenant the caller signed in to.
//
// updateBook() was the one place that still passed the env tenant into its
// UPDATE statements instead of requestTenant(). The fixture gives it the demo
// tenant as DEMO_TENANT_ID while the admin - and the whole catalogue - live
// under LibEdge, so an edit aimed at env matches no row: the PATCH answers 200
// because nothing failed, and the change is silently lost. That is worse than
// an error, because the metadata the catalogue depends on (authors, used by
// search and OPDS) stops being editable without anyone seeing a failure.
async function updateBookTenantTest(context) {
  const databaseUrl = await grant(context.port);
  const base = await startApp(databaseUrl, DEMO_TENANT);
  await admin.query("update grants set status = 'active' where id = $1", [SEED_GRANT]);

  const session = await login(base, context.users.admin.email);
  const work = WORKS[0];

  const patched = await request(base, `/api/books/${work.work}`, session, {
    method: 'PATCH',
    body: { title: 'LibEdge catalogue title 01 (edited)', authors: 'Yazar, Deneme', year: 2024 },
  });
  check(patched.status === 200, `admin PATCH answered ${patched.status}: ${patched.text.slice(0, 200)}`);

  const stored = await admin.query(
    `select w.title, w.metadata->'authors' as authors, w.tenant_id, e.publication_year
       from works w join editions e on e.work_id = w.id
      where w.id = $1`, [work.work],
  );
  const row = stored.rows[0];
  check(row.title === 'LibEdge catalogue title 01 (edited)',
    `works.title unchanged after PATCH: ${JSON.stringify(row.title)} - the write went to the env tenant`);
  check(row.tenant_id === LIBEDGE_TENANT,
    `works.tenant_id is ${row.tenant_id}, expected ${LIBEDGE_TENANT}`);
  check(Array.isArray(row.authors) && row.authors[0]?.family === 'Yazar',
    `metadata.authors not written: ${JSON.stringify(row.authors)}`);

  // The edition and asset branches of the same function take the same tenant.
  check(Number(row.publication_year) === 2024,
    `editions.publication_year unchanged: ${JSON.stringify(row.publication_year)}`);

  const asset = await admin.query(
    `select a.allow_download from assets a where a.edition_id = $1`, [work.edition],
  );
  check(asset.rowCount === 1, `asset row for ${work.edition} not found`);

  // A tenant's admin must not reach another tenant's work by id: the write is
  // scoped by the session tenant, so a work outside it matches no row.
  const otherTenantWork = randomUUID();
  await admin.query(
    `insert into works (id, tenant_id, title, language) values ($1, $2, 'Demo tenant work', 'tr')`,
    [otherTenantWork, DEMO_TENANT],
  );
  const foreign = await request(base, `/api/books/${otherTenantWork}`, session, {
    method: 'PATCH', body: { title: 'Cross-tenant edit' },
  });
  check(foreign.status === 404 || foreign.status === 403,
    `admin edited a work outside its tenant: ${foreign.status}`);
  const foreignRow = await admin.query('select title from works where id = $1', [otherTenantWork]);
  check(foreignRow.rows[0].title === 'Demo tenant work',
    `cross-tenant title changed to ${JSON.stringify(foreignRow.rows[0].title)}`);

  scenarioCount++;
  console.log('PASS updateBook: edits land in the session tenant (title, authors, edition), foreign work untouched.');
}

// Scenario 3c: the OPDS feed is not a browser session.
//
// /opds is fetched by reading apps with an API key and no cookie, so nothing
// binds a session tenant for it and `users` is under FORCE row level security.
// The feed then queried the env tenant - the demo one - while the OPDS user
// lives in LibEdge, and built its urn:uuid id from that same env value. An
// authenticated OPDS client therefore authenticated against the wrong tenant.
// There is no session to fall back on, so the tenant is named explicitly.
async function opdsTenantTest(context) {
  const databaseUrl = await grant(context.port);
  const apiKey = 'opds-test-key-0123456789';
  const base = await startApp(databaseUrl, DEMO_TENANT, {
    OPDS_API_KEY: apiKey,
    OPDS_USER_EMAIL: context.users.admin.email,
    OPDS_TENANT_ID: LIBEDGE_TENANT,
  });
  await admin.query("update grants set status = 'active', subject_id = $1 where id = $2",
    [LIBEDGE_TENANT, SEED_GRANT]);

  const feed = await request(base, '/opds', null, {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  check(feed.status === 200, `OPDS feed answered ${feed.status}: ${feed.text.slice(0, 300)}`);
  for (const row of WORKS) {
    check(feed.text.includes(row.title),
      `OPDS feed missing "${row.title}" - the feed queried the env tenant, not the OPDS tenant`);
  }
  check(feed.text.includes(`<id>urn:uuid:${LIBEDGE_TENANT}</id>`),
    `OPDS feed id is not the OPDS tenant's; got: ${(feed.text.match(/<id>[^<]*<\/id>/) || ['none'])[0]}`);

  // The key still has to matter: without it the route stays closed.
  const anonymous = await request(base, '/opds', null);
  check(anonymous.status === 401, `OPDS without a key answered ${anonymous.status}, expected 401`);
  if (feed.status !== 200) console.error('APP LOG:', children[children.length - 1].log);

  scenarioCount++;
  console.log(`PASS OPDS: feed lists all ${WORKS.length} works under the token's tenant, no cookie needed.`);
}

// Demo mode has no database: its books, users and grants live in memory. The
// fail-closed decision applies there too, so the in-memory fixtures must carry
// the grant db/seed.sql gives the demo tenant. Before, the empty list was
// invisible because grantAllows() returned true for it; now it would lock
// every demo user out, and demo mode is what local work and the storage
// regression test run against.
async function demoModeTest() {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: path.join(tempDir, 'app'),
    env: {
      ...process.env,
      DATABASE_URL: '',
      STORAGE_DRIVER: 'local',
      PORT: String(port),
      SESSION_SECRET: sessionSecret,
      DEMO_TENANT_ID: LIBEDGE_TENANT,
      // Pin the demo credentials rather than inheriting whatever the parent
      // shell has; the test logs in with these.
      DEMO_EMAIL: 'reader@example.edu.tr',
      DEMO_PASSWORD: 'demo1234',
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
  await eventually('demo mode startup', async () => {
    if (entry.error) throw entry.error;
    assert.equal(child.exitCode, null, `server exited: ${entry.log}`);
    const response = await fetch(`${entry.base}/api/health`, { signal: AbortSignal.timeout(2000) });
    assert.equal((await response.json()).mode, 'demo');
    return response.ok;
  }, 30_000);

  const session = await login(entry.base, 'reader@example.edu.tr', 200, 'demo1234');
  const books = await request(entry.base, '/api/books', session);
  check(books.status === 200, `demo catalogue answered ${books.status}: ${books.text.slice(0, 200)}`);
  const list = Array.isArray(books.data) ? books.data : books.data?.books;
  check(Array.isArray(list) && list.length > 0,
    `demo mode locked the reader out of its own catalogue (${list?.length ?? 'no'} books)`);

  const first = list[0];
  const file = await request(entry.base, `/api/books/${first.id}/file`, session);
  check(file.status !== 403 && file.status !== 404,
    `demo reader was denied the file of its own book: ${file.status}`);

  scenarioCount++;
  console.log(`PASS demo mode: in-memory fixtures still grant access (${list.length} books, file ${file.status}).`);
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
  await ungrantedTest(context);
  await grantedTest(context);
  await adminTest(context);
  await updateBookTenantTest(context);
  await opdsTenantTest(context);
  await demoModeTest();

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
