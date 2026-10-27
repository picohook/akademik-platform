import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { once } from 'node:events';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import pg from 'pg';
import { PDFDocument, StandardFonts } from 'pdf-lib';

// Always provision our own container. Never accept DATABASE_URL or an existing
// container: these tests revoke permissions and delete sessions deliberately.
const exec = promisify(execFile);
const appDir = fileURLToPath(new URL('../', import.meta.url));
const repoDir = path.resolve(appDir, '../..');
const tempParent = path.join(appDir, 'tmp');
const runId = randomUUID();
const container = `akademik-security-${runId}`;
const tenantId = '11111111-1111-1111-1111-111111111111';
const seedWork = '33333333-3333-3333-3333-333333333333';
const seedAsset = '55555555-5555-5555-5555-555555555555';
const seedGrant = '77777777-7777-7777-7777-777777777777';
const password = randomBytes(24).toString('hex');
const appPassword = randomBytes(24).toString('hex');
const userPassword = randomBytes(18).toString('hex');
const sessionSecret = randomBytes(32).toString('hex');
const children = [];
let containerCreated = false;
let tempDir;
let admin;
let cleanupPromise;
let checks = 0;

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

async function startApp(databaseUrl) {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: path.join(tempDir, 'app'),
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      PORT: String(port),
      DEMO_TENANT_ID: tenantId,
      SESSION_SECRET: sessionSecret,
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

async function request(base, route, session, { method = 'GET', body } = {}) {
  const headers = {};
  if (session) {
    headers.cookie = session.cookie;
    headers['x-csrf-token'] = session.csrf;
  }
  if (body !== undefined && !(body instanceof FormData)) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const response = await fetch(base + route, {
    method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { /* File/XML response. */ }
  const cookies = response.headers.getSetCookie().map((cookie) => cookie.split(';')[0]);
  return { status: response.status, headers: response.headers, text, data, cookies };
}

async function login(base, email, expected = 200) {
  const result = await request(base, '/api/login', null, {
    method: 'POST', body: { email, password: userPassword },
  });
  assert.equal(result.status, expected, `login ${email}: ${result.text}`);
  const csrf = result.cookies.find((cookie) => cookie.startsWith('akademik_csrf='));
  return {
    ...result,
    cookie: result.cookies.join('; '),
    csrf: csrf ? decodeURIComponent(csrf.slice('akademik_csrf='.length)) : '',
  };
}

function status(result, expected, label) {
  assert.equal(result.status, expected, `${label}: ${result.text.slice(0, 300)}`);
  checks++;
  return result;
}

async function pdfBytes(text) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage().drawText(text, { font, x: 30, y: 500 });
  return pdf.save();
}

async function upload(base, session, title) {
  const body = new FormData();
  body.set('title', title);
  body.set('language', 'en');
  body.set('file', new Blob([await pdfBytes(title)], { type: 'application/pdf' }), 'security.pdf');
  return status(await request(base, '/api/upload', session, { method: 'POST', body }), 201, 'upload').data;
}

async function setup() {
  await docker('version', '--format', '{{.Server.Version}}');
  await mkdir(tempParent, { recursive: true });
  tempDir = await mkdtemp(path.join(tempParent, 'security-'));
  const sandboxApp = path.join(tempDir, 'app');
  await mkdir(path.join(sandboxApp, 'public', 'seed'), { recursive: true });
  await mkdir(path.join(sandboxApp, 'public', 'ocr', seedAsset), { recursive: true });
  for (const file of ['server.mjs', 'tenant-context.mjs', 'storage.mjs', 'download-tickets.mjs', 'annotation-sync.mjs', 'social-watermark.mjs', 'indexer.mjs', 'public/search.mjs', 'public/book-variants.mjs']) {
    await copyFile(path.join(appDir, file), path.join(sandboxApp, file));
  }
  await writeFile(path.join(sandboxApp, 'public', 'seed', 'security.pdf'), await pdfBytes('Security seed'));
  await writeFile(path.join(sandboxApp, 'public', 'ocr', seedAsset, 'page-001.hocr'), '<html>security OCR</html>');

  await docker('run', '--detach', '--rm', '--name', container,
    '--label', `akademik.security-test=${runId}`,
    '--tmpfs', '/var/lib/postgresql/data',
    '--publish', '127.0.0.1::5432',
    '--env', 'POSTGRES_USER=security_admin',
    '--env', 'POSTGRES_DB=security_test',
    '--env', `POSTGRES_PASSWORD=${password}`, 'postgres:16-alpine');
  containerCreated = true;
  const mapping = await docker('port', container, '5432/tcp');
  const port = Number(mapping.match(/:(\d+)\s*$/)?.[1]);
  assert.ok(port, `unexpected port mapping: ${mapping}`);
  const adminUrl = `postgres://security_admin:${password}@127.0.0.1:${port}/security_test`;
  await eventually('PostgreSQL readiness', async () => {
    const probe = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 1000 });
    try { await probe.connect(); return true; } finally { await probe.end().catch(() => {}); }
  }, 60_000);
  admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(await readFile(path.join(repoDir, 'db/schema.sql'), 'utf8'));
  await admin.query(await readFile(path.join(repoDir, 'db/seed.sql'), 'utf8'));
  // Generated hexadecimal password; no external credentials enter this SQL.
  await admin.query(`alter role akademik_app password '${appPassword}'`);
  const { rows: [role] } = await admin.query(
    "select rolsuper, rolbypassrls from pg_roles where rolname = 'akademik_app'",
  );
  assert.equal(role.rolsuper, false);
  assert.equal(role.rolbypassrls, false);
  const salt = randomBytes(16).toString('hex');
  const hash = `scrypt$${salt}$${scryptSync(userPassword, salt, 64).toString('hex')}`;
  // Login resolves an email to its tenant before any tenant is bound, and
  // `users` is under RLS, so the app role needs this helper. Run the real
  // migration rather than a copy: a copy can drift from what ships.
  await admin.query(await readFile(path.join(repoDir, 'db/migrations/018-tenant-for-login.sql'), 'utf8'));
  await admin.query('update users set password_hash = $1', [hash]);
  const users = [];
  for (const [email, roleName] of [
    ['publisher-a@security.test', 'publisher'], ['publisher-b@security.test', 'publisher'],
    ...Array.from({ length: 8 }, (_, i) => [`race-${i}@security.test`, 'reader']),
  ]) {
    const id = randomUUID();
    await admin.query(
      `insert into users (id, tenant_id, email, display_name, role, password_hash, max_sessions)
       values ($1, $2, $3, $3, $4, $5, 10)`, [id, tenantId, email, roleName, hash],
    );
    users.push({ id, email });
  }
  await admin.query("update assets set storage_key = 'seed/security.pdf', watermark = false where id = $1", [seedAsset]);
  const databaseUrl = `postgres://akademik_app:${appPassword}@127.0.0.1:${port}/security_test`;
  const base = await startApp(databaseUrl);
  const peer = await startApp(databaseUrl);
  console.log('Isolated PostgreSQL 16, non-superuser app role, two Node servers ready.');
  return { base, peer, adminUrl, users };
}

async function publisherTest({ base, users }) {
  const first = await login(base, 'publisher-a@security.test');
  const second = await login(base, 'publisher-b@security.test');
  const own = await upload(base, first, 'Publisher A security book');
  const other = await upload(base, second, 'Publisher B security book');
  assert.equal(own.metadata.uploaded_by, users[0].id);
  assert.equal(other.metadata.uploaded_by, users[1].id);
  status(await request(base, `/api/books/${own.id}`, first, {
    method: 'PATCH', body: { title: 'Publisher A edited' },
  }), 200, 'publisher edits own upload');
  assert.equal((await admin.query('select title from works where id = $1', [own.id])).rows[0].title, 'Publisher A edited');

  for (const id of [other.id, other.asset_id, seedWork]) {
    status(await request(base, `/api/books/${id}`, first, {
      method: 'PATCH', body: { title: 'Unauthorized change' },
    }), 403, 'publisher cannot edit another/ownerless book');
    status(await request(base, `/api/books/${id}`, first, { method: 'DELETE' }), 403, 'publisher cannot delete another/ownerless book');
  }
  for (const [route, method, body] of [
    ['/api/grants', 'GET'], ['/api/grants', 'POST', { scopeType: 'all' }],
    [`/api/grants/${seedGrant}`, 'DELETE'], ['/api/grants/audit', 'GET'],
    ['/api/grants/usage', 'GET'], ['/api/groups', 'GET'],
    ['/api/groups', 'POST', { name: 'Unauthorized group' }],
    [`/api/groups/${randomUUID()}/members`, 'POST', { email: users[0].email }],
    ['/api/collections', 'GET'], ['/api/reports/usage.csv', 'GET'],
  ]) {
    status(await request(base, route, first, { method, body }), 403, `publisher denied ${method} ${route}`);
  }
  assert.equal((await admin.query('select title from works where id = $1', [other.id])).rows[0].title, other.title);
  assert.equal((await admin.query('select count(*)::int as n from grants')).rows[0].n, 1);
  assert.equal((await admin.query('select count(*)::int as n from user_groups')).rows[0].n, 0);
  status(await request(base, `/api/books/${own.id}`, first, { method: 'DELETE' }), 200, 'publisher deletes own upload');
  assert.equal((await admin.query('select count(*)::int as n from works where id = $1', [own.id])).rows[0].n, 0);
  await assert.rejects(stat(path.join(tempDir, 'app/public', own.storage_key)), { code: 'ENOENT' });
  assert.ok(await stat(path.join(tempDir, 'app/public', other.storage_key)));
  await request(base, '/api/logout', first, { method: 'POST' });
  await request(base, '/api/logout', second, { method: 'POST' });
  console.log('PASS publisher: real uploads, persisted ownership, edit/delete isolation, restricted management endpoints.');
  return other;
}

async function grantFailureTest({ base }, hidden) {
  await admin.query("update grants set scope_type = 'title', scope_id = $1 where id = $2", [seedWork, seedGrant]);
  const reader = await login(base, 'reader@example.edu.tr');
  const before = status(await request(base, '/api/books', reader), 200, 'restricted catalog');
  assert.deepEqual(before.data.map((book) => book.id), [seedWork]);
  const protectedRoutes = [
    '/api/search?q=Publisher', `/api/books/${seedWork}/file`,
    `/api/books/${seedWork}/search?q=security`,
    `/ocr/${seedAsset}/page-001.hocr`, '/opds',
  ];
  const ticketPath = `/api/books/${seedWork}/download-ticket`;
  const downloadPath = `/api/books/${seedWork}/download`;
  async function issueTicket(label) {
    const issued = status(await request(base, ticketPath, reader, { method: 'POST', body: {} }), 201, label);
    assert.match(issued.data.ticket, /^[a-f0-9]{64}$/);
    return issued.data.ticket;
  }
  const download = (ticket) => request(base, downloadPath, reader, { method: 'POST', body: { ticket } });
  for (const route of protectedRoutes) {
    status(await request(base, route, reader), 200, `allowed before fault ${route}`);
  }
  status(await request(base, downloadPath, reader), 403, 'legacy GET download denied before fault');
  status(await download(await issueTicket('ticket issued before grant fault')), 200, 'ticket download before grant fault');
  const pendingTicket = await issueTicket('spare ticket issued before grant fault');
  status(await request(base, `/api/books/${hidden.id}/file`, reader), 404, 'hidden file before fault');
  await admin.query('revoke select on grants from akademik_app');
  try {
    status(await request(base, '/api/me', reader), 200, 'session remains valid during grant fault');
    for (const route of [
      '/api/books', `/api/books/${hidden.id}/file`, ...protectedRoutes,
    ]) {
      const result = status(await request(base, route, reader), 500, `grant SQL fault ${route}`);
      assert.match(result.headers.get('content-type'), /application\/json/);
      assert.equal(result.text.includes(hidden.title), false);
    }
    status(await request(base, ticketPath, reader, { method: 'POST', body: {} }), 500, 'grant SQL fault blocks ticket issue');
    status(await download(pendingTicket), 500, 'grant SQL fault blocks previously issued ticket consume');
    status(await request(base, downloadPath, reader), 403, 'legacy GET remains denied during grant SQL fault');
    status(await request(base, '/api/me', reader), 200, 'server and session survive all grant faults');
  } finally {
    await admin.query('grant select on grants to akademik_app');
  }
  const after = status(await request(base, '/api/books', reader), 200, 'catalog recovers after SQL permission restored');
  assert.deepEqual(after.data.map((book) => book.id), [seedWork]);
  for (const route of protectedRoutes) {
    status(await request(base, route, reader), 200, `access recovers ${route}`);
  }
  status(await download(pendingTicket), 200, 'grant SQL fault did not consume ticket; permission recovery allows it');
  status(await download(await issueTicket('new ticket issue recovers')), 200, 'new ticket download recovers after SQL permission restored');
  status(await request(base, downloadPath, reader), 403, 'legacy GET remains denied after recovery');
  await request(base, '/api/logout', reader, { method: 'POST' });
  console.log('PASS grants: real SQL permission error blocks catalog/search/files/download/OCR/OPDS; auth stays valid; access recovers.');
}

async function concurrencyTest({ base, peer, adminUrl, users }) {
  const racers = users.slice(2);
  await admin.query("update grants set scope_type = 'all', scope_id = null, seat_limit = 2 where id = $1", [seedGrant]);
  for (let wave = 0; wave < 3; wave++) {
    await admin.query('delete from user_sessions');
    const gate = new pg.Client({ connectionString: adminUrl });
    await gate.connect();
    let pending;
    let waiting;
    try {
      await gate.query('begin');
      await gate.query('select pg_advisory_xact_lock(hashtext($1::text))', [`tenant:${tenantId}`]);
      // Both processes must reach a real database lock before it is released.
      // Without the tenant lock, requests finish and this barrier fails.
      pending = Promise.all(racers.map((user, i) =>
        request(i % 2 ? peer : base, '/api/login', null, {
          method: 'POST', body: { email: user.email, password: userPassword },
        })));
      pending.catch(() => {});
      await eventually('two servers waiting on tenant lock', async () => {
        const { rows: [row] } = await admin.query(
          `select count(*)::int as n from pg_stat_activity
            where usename = 'akademik_app' and wait_event_type = 'Lock' and wait_event = 'advisory'`,
        );
        waiting = row.n;
        return row.n >= 2;
      }, 15_000);
      assert.equal((await admin.query('select count(*)::int as n from user_sessions')).rows[0].n, 0);
    } finally {
      await gate.query('rollback').catch(() => {});
      await gate.end();
    }
    const results = await pending;
    const accepted = results.filter((result) => result.status === 200);
    const denied = results.filter((result) => result.status === 429);
    assert.equal(accepted.length, 2, `wave ${wave + 1}: successful logins`);
    assert.equal(denied.length, 6, `wave ${wave + 1}: denied logins ${JSON.stringify(results.map((r) => r.data))}`);
    assert.ok(denied.every((result) => result.data.error === 'tenant seat limit reached'));
    assert.equal((await admin.query('select count(*)::int as n from user_sessions')).rows[0].n, 2);
    checks += 4;
    console.log(`  wave ${wave + 1}: ${waiting} blocked contenders, 8 requests across 2 servers -> 2 accepted / 6 rejected / 2 DB sessions`);
  }
  // Per-user limits must continue to work with the extra tenant lock.
  await admin.query('delete from user_sessions');
  await admin.query('update grants set seat_limit = null');
  await admin.query('update users set max_sessions = 1 where id = $1', [racers[0].id]);
  const sameUser = await Promise.all(Array.from({ length: 4 }, (_, i) =>
    request(i % 2 ? peer : base, '/api/login', null, {
      method: 'POST', body: { email: racers[0].email, password: userPassword },
    })));
  assert.equal(sameUser.filter((result) => result.status === 200).length, 1);
  assert.equal(sameUser.filter((result) => result.status === 429 && result.data.error === 'session limit reached').length, 3);
  assert.equal((await admin.query('select count(*)::int as n from user_sessions')).rows[0].n, 1);
  checks += 3;
  console.log('PASS concurrency: 3 synchronized waves, tenant cap held across processes; per-user cap also held.');
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
      const label = await docker('inspect', '--format', '{{ index .Config.Labels "akademik.security-test" }}', container);
      assert.equal(label, runId, 'refusing to remove a container not owned by this test');
      await docker('rm', '--force', container);
    }
    if (tempDir) {
      const target = path.resolve(tempDir);
      const relative = path.relative(path.resolve(tempParent), target);
      assert.ok(relative.startsWith('security-') && !relative.includes(path.sep) && !path.isAbsolute(relative), 'unsafe test cleanup path');
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
  const hidden = await publisherTest(context);
  await grantFailureTest(context, hidden);
  await concurrencyTest(context);
  console.log(`\n3 security integration scenarios passed (${checks} HTTP/DB checks).`);
} catch (error) {
  console.error(error);
  for (const { log } of children) {
    const redacted = [password, appPassword, userPassword].reduce((text, secret) => text.replaceAll(secret, '[redacted]'), log);
    console.error(redacted.split('\n').slice(-20).join('\n'));
  }
  process.exitCode = 1;
} finally {
  await cleanup();
  console.log('Temporary app files and PostgreSQL container removed.');
}
