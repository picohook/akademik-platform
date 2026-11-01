import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';

// 029 + 030: runtime settings, the audit trail and the usage name lookup, on the real tables as the app role.
//
// The unit tests of spike/app/ai-settings.mjs use an in-memory fake. This runs the shipped
// store against a real postgres as akademik_app (not the owner):
//   * 029 applies twice (idempotent);
//   * save() writes the setting and one audit row in one transaction, the second save
//     records the first as "before", and get() reads it back without any tenant bound;
//   * the app role can append to admin_audit_log but cannot update or delete a row of it;
//   * a failed save leaves neither a changed setting nor an audit row;
//   * usage() and audit() run with the users join (email resolved where the user exists);
//   * the key constraint rejects a malformed key;
//   * 030: app.ai_usage_user_labels() names a user of ANOTHER tenant who used the feature (users is
//     under row level security, so a plain join cannot), and returns nobody who never used it.
//
//   node db/029.test.mjs

const exec = promisify(execFile);
const dbDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(dbDir, '..');
const appDir = path.join(repoDir, 'spike/app');
const pg = createRequire(path.join(appDir, 'package.json'))('pg');


const container = `libedge-admin-settings-${randomUUID()}`;
const adminPassword = randomBytes(18).toString('hex');
const appPassword = randomBytes(18).toString('hex');
let port;
let admin;
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks += 1; };

async function docker(...args) {
  return (await exec('docker', args, { timeout: 90_000, maxBuffer: 1024 * 1024 })).stdout.trim();
}
// `--rm` is not reliable on Docker Desktop for Windows; stop, then remove by exact name.
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

const appUrl = () => `postgres://akademik_app:${appPassword}@127.0.0.1:${port}/mig`;

// Every reservation gets its own connection, so they genuinely overlap on the server.
function withOwnConnection(fn) {
  return (async () => {
    const client = new pg.Client({ connectionString: appUrl() });
    await client.connect();
    try { return await fn(client); } finally { await client.end().catch(() => {}); }
  })();
}


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
    const candidate = new pg.Client({ connectionString: `postgres://mig_admin:${adminPassword}@127.0.0.1:${port}/mig` });
    try { await candidate.connect(); admin = candidate; break; } catch (error) {
      lastError = error;
      await candidate.end().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  if (!admin) throw new Error(`postgres did not become reachable: ${lastError?.message}`);
  await admin.query(await readFile(path.join(repoDir, 'db/schema.sql'), 'utf8'));
  await admin.query(`alter role akademik_app password '${appPassword}'`);
}

async function main() {
  await setup();
  const { createSettingsStore } = await import(pathToFileURL(path.join(appDir, 'ai-settings.mjs')).href);
  await admin.query(await readFile(path.join(dbDir, 'migrations', '028-ai-usage.sql'), 'utf8')); // the usage table 029's panel reads
  const label030 = await readFile(path.join(dbDir, 'migrations', '030-ai-usage-labels.sql'), 'utf8');
  const sql = await readFile(path.join(dbDir, 'migrations', '029-admin-settings.sql'), 'utf8');
  await admin.query(sql);
  await admin.query(sql); // idempotent
  await admin.query(label030);
  await admin.query(label030); // idempotent
  checks += 1;

  const tenant = randomUUID();
  const userId = randomUUID();
  await admin.query("insert into tenants (id, name, slug) values ($1, 'T', 't')", [tenant]);
  await admin.query("insert into users (id, tenant_id, email, display_name, role) values ($1, $2, 'boss@example.edu', 'Boss', 'admin')", [userId, tenant]);
  await admin.query("insert into ai_usage_daily (day, scope, subject, used) values ((now() at time zone 'utc')::date, 'global', '-', 7), ((now() at time zone 'utc')::date, 'user', $1, 7)", [userId]);

  // One connection per call, as the app role. withDb binds the tenant (an admin route);
  // withPlain binds nothing (the public /api/config).
  const run = async (fn, bind) => {
    const client = new pg.Client({ connectionString: appUrl() });
    await client.connect();
    try {
      if (bind) await client.query("select set_config('app.tenant_id', $1, false)", [tenant]);
      return await fn(client);
    } finally { await client.end().catch(() => {}); }
  };
  const store = createSettingsStore({ withDb: (fn) => run(fn, true), withPlain: (fn) => run(fn, false), ttlMs: 0 });

  const first = { enabled: true, perMinute: 5, perUserDay: 30, perGlobalDay: 100, collectionIds: ['74149e93-39dd-50ba-b120-a75415d9b0ca'] };
  const second = { ...first, enabled: false, perGlobalDay: 50 };

  check(await store.get() === null, 'nothing stored yet');
  await store.save(userId, first);
  check(JSON.stringify(await store.get()) === JSON.stringify(first), 'saved settings are read back with no tenant bound');
  await store.save(userId, second);
  const log = await store.audit(10);
  check(log.length === 2, 'two saves, two audit rows');
  check(log[0].detail.before.enabled === true && log[0].detail.after.enabled === false, 'newest row records first as before, second as after');
  check(log[1].detail.before === null, 'the first save had no before');
  check(log[0].actor_email === 'boss@example.edu' && log[0].action === 'ai.settings.update', 'actor resolved to an email, action recorded');

  // the audit trail is append-only for the app role
  for (const statement of ['update admin_audit_log set action = \'x\'', 'delete from admin_audit_log', 'truncate admin_audit_log']) {
    let denied = false;
    try { await run((client) => client.query(statement)); } catch (error) { denied = error.code === '42501'; }
    check(denied, 'the app role must not be able to run: ' + statement);
  }

  // a failing audit insert takes the setting change with it
  const before = JSON.stringify(await store.get());
  const breaking = createSettingsStore({
    withDb: (fn) => run((client) => fn({
      query: (text, params) => (/insert into admin_audit_log/i.test(text) ? Promise.reject(new Error('audit down')) : client.query(text, params)),
    }), true),
    withPlain: (fn) => run(fn, false),
    ttlMs: 0,
  });
  let failed = false;
  try { await breaking.save(userId, { ...first, perMinute: 9 }); } catch { failed = true; }
  check(failed, 'save surfaces the audit failure');
  check(JSON.stringify(await store.get()) === before, 'the setting did not change when its audit row failed');
  check((await store.audit(10)).length === 2, 'no partial audit row');

  // 030: a reader of another tenant used the feature, a second reader never did
  const otherTenant = randomUUID();
  const otherUser = randomUUID();
  const idleUser = randomUUID();
  await admin.query("insert into tenants (id, name, slug) values ($1, 'Individuals', 'libedge-individual')", [otherTenant]);
  await admin.query("insert into users (id, tenant_id, email, display_name, role) values ($1, $3, 'reader@example.org', 'Ayşe Yılmaz', 'reader'), ($2, $3, 'idle@example.org', 'Idle', 'reader')", [otherUser, idleUser, otherTenant]);
  await admin.query("insert into ai_usage_daily (day, scope, subject, used) values ((now() at time zone 'utc')::date, 'user', $1, 9), ((now() at time zone 'utc')::date, 'user', 'not-a-uuid', 1)", [otherUser]);
  const labels = (await run((client) => client.query('select * from app.ai_usage_user_labels() order by email'), false)).rows;
  check(labels.some((r) => r.email === 'reader@example.org' && r.display_name === 'Ayşe Yılmaz' && r.tenant_slug === 'libedge-individual'), 'a user of another tenant is named, with no tenant bound');
  check(!labels.some((r) => r.email === 'idle@example.org'), 'a user who never used the feature is not exposed');
  check(labels.every((r) => Object.keys(r).sort().join() === 'display_name,email,tenant_slug,user_id'), 'only id, e-mail, name and tenant slug come back');
  const visible = (await run((client) => client.query("select email from users where email = 'reader@example.org'"), true)).rowCount;
  check(visible === 0, 'row level security still hides the other tenant from a plain read (' + visible + ' rows): only the function can name them');
  const usage = await store.usage(30);
  check(usage.days.length === 1 && usage.days[0].total === 7 && usage.days[0].users === 3, 'per-day totals and distinct user rows (boss, the other-tenant user, one with a malformed subject)');
  check(usage.topToday.length === 3, 'every user row is listed');
  check(usage.topToday[0].email === 'reader@example.org' && usage.topToday[0].used === 9 && usage.topToday[0].display_name === 'Ayşe Yılmaz' && usage.topToday[0].tenant_slug === 'libedge-individual', 'the other-tenant user is named in the usage list');
  check(usage.topToday[1].email === 'boss@example.edu' && usage.topToday[1].used === 7, 'the same-tenant user is named too');
  check(usage.topToday[2].email === null && usage.topToday[2].used === 1, 'a malformed subject does not break the query and stays unnamed');

  let badKey = false;
  try { await admin.query("insert into app_settings (key, value) values ('Bad Key', '{}')"); } catch (error) { badKey = error.code === '23514'; }
  check(badKey, 'a malformed key is rejected by the constraint');

  console.log(JSON.stringify({ passed: true, checks }));
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await admin?.end().catch(() => {});
  await stopContainer();
}
