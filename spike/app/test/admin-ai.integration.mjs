import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import pg from 'pg';
import { copyServerFiles } from './helpers/server-files.mjs';

// The admin panel's AI endpoints on the shipped server with a real database.
//
//   * who may read or change the settings: the administrator of the deployment's own tenant,
//     nobody else - not a librarian, not a reader, not an administrator of another tenant;
//   * a state-changing call without the CSRF header is refused;
//   * invalid values (over a ceiling, unknown field, unknown collection) are refused with 400;
//   * the secrets (token, account id, model) never appear in any admin response;
//   * a save lands in app_settings and in the audit log with the actor, and the public
//     /api/config follows the switch at once;
//   * the collection list the panel offers is the administrator's own tenant's, not all tenants'.
//
//   node test/admin-ai.integration.mjs      (needs Docker)

const exec = promisify(execFile);
const appDir = fileURLToPath(new URL('../', import.meta.url));
const repoDir = path.resolve(appDir, '../..');
const tempParent = path.join(appDir, 'tmp');
const runId = randomUUID();
const container = `akademik-admin-ai-${runId}`;

const PLATFORM = '5799f2a5-3d90-41b1-90de-9da07d776052';
const OTHER_TENANT = '33333333-3333-3333-3333-333333333333';
const OA_COLLECTION = '74149e93-39dd-50ba-b120-a75415d9b0ca';
const PRIVATE_COLLECTION = '44444444-4444-4444-4444-444444444444';
const FOREIGN_COLLECTION = '55555555-5555-5555-5555-555555555555';
const SECRET_TOKEN = 'cf-token-' + randomBytes(12).toString('hex');
const SECRET_ACCOUNT = randomBytes(16).toString('hex');
const SECRET_MODEL = '@cf/secret/model-' + randomBytes(4).toString('hex');

const adminPassword = randomBytes(24).toString('hex');
const appPassword = randomBytes(24).toString('hex');
const userPassword = randomBytes(18).toString('hex');
const sessionSecret = randomBytes(32).toString('hex');
let children = [];
let tempDir;
let admin;
let containerCreated = false;
let checks = 0;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const docker = async (...args) => (await exec('docker', args, { timeout: 90_000, maxBuffer: 1024 * 1024 })).stdout.trim();
const check = (condition, message) => { assert.ok(condition, message); checks += 1; };
const same = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks += 1; };

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
  await new Promise((resolve, reject) => socket.close((error) => (error ? reject(error) : resolve())));
  return port;
}

async function request(base, route, session, { method = 'GET', body, csrf = true } = {}) {
  const headers = {};
  if (session) {
    headers.cookie = session.cookie;
    if (csrf) headers['x-csrf-token'] = session.csrf;
  }
  if (body !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(body); }
  const response = await fetch(base + route, { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(30_000) });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { /* not JSON */ }
  return { status: response.status, text, data, cookies: response.headers.getSetCookie().map((c) => c.split(';')[0]) };
}

async function login(base, email) {
  const result = await request(base, '/api/login', null, { method: 'POST', body: { email, password: userPassword } });
  assert.equal(result.status, 200, `login ${email}: ${result.text}`);
  const csrf = result.cookies.find((c) => c.startsWith('akademik_csrf='));
  return { cookie: result.cookies.join('; '), csrf: csrf ? decodeURIComponent(csrf.slice('akademik_csrf='.length)) : '' };
}

async function setup() {
  await docker('version', '--format', '{{.Server.Version}}');
  await mkdir(tempParent, { recursive: true });
  tempDir = await mkdtemp(path.join(tempParent, 'adminai-'));
  const sandboxApp = path.join(tempDir, 'app');
  await mkdir(path.join(sandboxApp, 'public', 'seed'), { recursive: true });
  await copyServerFiles(appDir, sandboxApp);
  await writeFile(path.join(sandboxApp, 'public', 'seed', 'sample.pdf'), 'placeholder');

  await docker('run', '--detach', '--rm', '--name', container, '--label', `akademik.admin-ai-test=${runId}`,
    '--tmpfs', '/var/lib/postgresql/data', '--publish', '127.0.0.1::5432',
    '--env', 'POSTGRES_USER=ai_admin', '--env', 'POSTGRES_DB=ai_test', '--env', `POSTGRES_PASSWORD=${adminPassword}`, 'postgres:16-alpine');
  containerCreated = true;
  const port = Number((await docker('port', container, '5432/tcp')).match(/:(\d+)\s*$/)?.[1]);
  assert.ok(port, 'port mapping');
  const adminUrl = `postgres://ai_admin:${adminPassword}@127.0.0.1:${port}/ai_test`;
  await eventually('PostgreSQL readiness', async () => {
    const probe = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 1000 });
    try { await probe.connect(); return true; } finally { await probe.end().catch(() => {}); }
  }, 60_000);
  admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(await readFile(path.join(repoDir, 'db/schema.sql'), 'utf8'));
  await admin.query(`alter role akademik_app password '${appPassword}'`);
  for (const file of ['018-tenant-for-login.sql', '028-ai-usage.sql', '029-admin-settings.sql', '030-ai-usage-labels.sql']) {
    await admin.query(await readFile(path.join(repoDir, 'db/migrations', file), 'utf8'));
  }

  const salt = randomBytes(16).toString('hex');
  const hash = `scrypt$${salt}$${scryptSync(userPassword, salt, 64).toString('hex')}`;
  await admin.query("insert into tenants (id, name, slug) values ($1, 'LibEdge', 'libedge'), ($2, 'Other Uni', 'other')", [PLATFORM, OTHER_TENANT]);
  const users = {};
  for (const [key, tenant, email, role] of [
    ['boss', PLATFORM, 'boss@libedge.com', 'admin'],
    ['librarian', PLATFORM, 'librarian@libedge.com', 'librarian'],
    ['reader', PLATFORM, 'reader@libedge.com', 'reader'],
    ['otherAdmin', OTHER_TENANT, 'admin@other.edu', 'admin'],
  ]) {
    const id = randomUUID();
    await admin.query(
      'insert into users (id, tenant_id, email, display_name, role, password_hash, max_sessions) values ($1, $2, $3, $3, $4, $5, 10)',
      [id, tenant, email, role, hash],
    );
    users[key] = { id, email };
  }
  await admin.query(
    `insert into collections (id, tenant_id, title, slug) values
       ($1, $4, 'Açık Erişim', 'oa'), ($2, $4, 'Özel Koleksiyon', 'private'), ($3, $5, 'Foreign Collection', 'foreign')`,
    [OA_COLLECTION, PRIVATE_COLLECTION, FOREIGN_COLLECTION, PLATFORM, OTHER_TENANT],
  );
  return { port, users };
}

async function startApp(port) {
  const appPort = await freePort();
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: path.join(tempDir, 'app'),
    env: {
      ...process.env,
      DATABASE_URL: `postgres://akademik_app:${appPassword}@127.0.0.1:${port}/ai_test`,
      PORT: String(appPort), DEMO_TENANT_ID: PLATFORM, SESSION_SECRET: sessionSecret,
      LIBREAD_AI_ENABLED: '1', LIBREAD_AI_ACCOUNT_ID: SECRET_ACCOUNT, LIBREAD_AI_API_TOKEN: SECRET_TOKEN, LIBREAD_AI_MODEL: SECRET_MODEL,
    },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  const entry = { child, log: '' };
  children.push(entry);
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => { entry.log = (entry.log + chunk).slice(-20_000); });
  const base = `http://127.0.0.1:${appPort}`;
  await eventually('app startup', async () => {
    assert.equal(child.exitCode, null, `server exited: ${entry.log}`);
    const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  }, 60_000);
  return { base, entry };
}

const good = { enabled: true, perMinute: 5, perUserDay: 30, perGlobalDay: 100, collectionIds: [OA_COLLECTION] };

async function main() {
  const { port, users } = await setup();
  const { base } = await startApp(port);

  same((await request(base, '/api/config')).data.aiSelection, true, 'the feature is on from the environment');

  // 1. who may read
  const boss = await login(base, users.boss.email);
  const read = await request(base, '/api/admin/ai', boss);
  same(read.status, 200, 'the platform administrator reads the panel data');
  same(read.data.envEnabled, true, 'environment switch reported');
  same(read.data.ceilings, { perMinute: 30, perUserDay: 200, perGlobalDay: 150 }, 'ceilings are reported');
  same(read.data.collections.map((c) => c.title).sort(), ['Açık Erişim', 'Özel Koleksiyon'], "only this tenant's collections, not the other tenant's");
  for (const secret of [SECRET_TOKEN, SECRET_ACCOUNT, SECRET_MODEL]) check(!read.text.includes(secret), 'a secret appeared in an admin response');
  check(!('token' in read.data) && !('accountId' in read.data), 'no secret fields in the payload');

  for (const [who, email] of [['librarian', users.librarian.email], ['reader', users.reader.email], ['other tenant admin', users.otherAdmin.email]]) {
    const session = await login(base, email);
    same((await request(base, '/api/admin/ai', session)).status, 403, `${who} cannot read the settings`);
    same((await request(base, '/api/admin/audit', session)).status, 403, `${who} cannot read the audit log`);
    same((await request(base, '/api/admin/ai', session, { method: 'PUT', body: { ...good, enabled: false } })).status, 403, `${who} cannot change the settings`);
  }
  same((await request(base, '/api/config')).data.aiSelection, true, 'nothing the refused callers sent had any effect');
  same((await admin.query('select count(*)::int as n from app_settings')).rows[0].n, 0, 'no row was written by a refused call');

  // the usage list names people, including those of another tenant, and only those who used the feature
  await admin.query("insert into ai_usage_daily (day, scope, subject, used) values ((now() at time zone 'utc')::date, 'user', $1, 4), ((now() at time zone 'utc')::date, 'user', $2, 2), ((now() at time zone 'utc')::date, 'global', '-', 6)", [users.otherAdmin.id, users.boss.id]);
  const named = (await request(base, '/api/admin/ai', boss)).data.usage.topToday;
  same(named.map((r) => [r.email, r.tenant_slug, r.used]), [['admin@other.edu', 'other', 4], ['boss@libedge.com', 'libedge', 2]], 'users of both tenants are named, heaviest first');
  check(!named.some((r) => r.email === users.reader.email || r.email === users.librarian.email), 'people who never used the feature are not listed');

  // 2. CSRF and validation
  same((await request(base, '/api/admin/ai', boss, { method: 'PUT', body: good, csrf: false })).status, 403, 'PUT without CSRF header');
  for (const [label, body] of [
    ['global over the ceiling', { ...good, perGlobalDay: 151 }],
    ['user over the ceiling', { ...good, perUserDay: 201, perGlobalDay: 150 }],
    ['per-minute over the ceiling', { ...good, perMinute: 31 }],
    ['zero', { ...good, perMinute: 0 }],
    ['user cap above global cap', { ...good, perUserDay: 120, perGlobalDay: 100 }],
    ['unknown field', { ...good, token: 'x' }],
    ['model smuggled in', { ...good, model: '@cf/other/model' }],
    ['collection of another tenant', { ...good, collectionIds: [FOREIGN_COLLECTION] }],
    ['collection that does not exist', { ...good, collectionIds: [randomUUID()] }],
    ['no collections', { ...good, collectionIds: [] }],
    ['string number', { ...good, perMinute: '5' }],
  ]) {
    const result = await request(base, '/api/admin/ai', boss, { method: 'PUT', body });
    same(result.status, 400, `refused: ${label}`);
  }
  same((await admin.query('select count(*)::int as n from admin_audit_log')).rows[0].n, 0, 'refused saves leave no audit row');

  // 3. a valid save: stored, audited, public config follows
  const off = { ...good, enabled: false, perGlobalDay: 60, collectionIds: [OA_COLLECTION, PRIVATE_COLLECTION] };
  const saved = await request(base, '/api/admin/ai', boss, { method: 'PUT', body: off });
  same(saved.status, 200, 'valid save accepted');
  same((await admin.query("select value from app_settings where key = 'ai'")).rows[0].value, off, 'stored as sent');
  same((await request(base, '/api/config')).data.aiSelection, false, 'the public config follows the switch at once');
  const after = await request(base, '/api/admin/ai', boss);
  same([after.data.active, after.data.effective.perGlobalDay, after.data.effective.collectionIds.length], [false, 60, 2], 'effective values reflect the save');

  const audit = await request(base, '/api/admin/audit', boss);
  same(audit.status, 200, 'audit readable by the administrator');
  same(audit.data.length, 1, 'one audit row');
  same([audit.data[0].actor_email, audit.data[0].action], [users.boss.email, 'ai.settings.update'], 'actor and action recorded');
  same([audit.data[0].detail.before, audit.data[0].detail.after], [null, off], 'before and after recorded');
  check(!audit.text.includes(SECRET_TOKEN) && !audit.text.includes(SECRET_ACCOUNT), 'no secret in the audit log');

  // 4. while off, the AI endpoint refuses, whoever asks
  const reader = await login(base, users.reader.email);
  const refused = await request(base, '/api/ai/selection', reader, { method: 'POST', body: { bookId: randomUUID(), mode: 'explain', lang: 'en', text: 'x'.repeat(40) } });
  check([404, 503].includes(refused.status), `AI endpoint refuses while switched off (${refused.status})`);

  // 5. switch back on; the second audit row records the first save as before
  same((await request(base, '/api/admin/ai', boss, { method: 'PUT', body: good })).status, 200, 'switched back on');
  same((await request(base, '/api/config')).data.aiSelection, true, 'public config follows the switch back on');
  const history = (await request(base, '/api/admin/audit', boss)).data;
  same([history.length, history[0].detail.before.enabled, history[0].detail.after.enabled], [2, false, true], 'history is newest first with before and after');

  console.log(JSON.stringify({ passed: true, checks }));
}

try {
  await main();
} catch (error) {
  console.error(error);
  console.error(children.map((c) => c.log).join('\n').split('\n').slice(-15).join('\n'));
  process.exitCode = 1;
} finally {
  for (const { child } of children) child.kill();
  await admin?.end().catch(() => {});
  if (containerCreated) {
    await docker('stop', container).catch(() => {});
    await docker('rm', '--force', container).catch(() => {});
  }
  if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => {});
}
