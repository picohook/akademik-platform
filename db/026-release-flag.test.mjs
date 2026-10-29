import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile, writeFile, rm } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';

// What withBridgeTenant does when LIBEDGE_BRIDGE_MEASURE_RESET=1 and 026 is NOT applied.
//
// The claim this file stops being taken on trust: `reset app.tenant_id` does NOT fail on a
// database without 026. It succeeds, the GUC is left as '', and the 22P02 arrives on the
// NEXT unbound query - on whichever request picks that connection up out of the pool. A
// reset arm that only wraps `reset` therefore counts nothing, hands a connection that
// cannot be unbound back to the pool, and blames the next request for the failure.
//
// So the arm resets and then evaluates the predicate the policies themselves use,
// `nullif(current_setting('app.tenant_id', true), '')::uuid`. Without 026 that statement is
// the first thing to raise:
//
//   flag on, WITHOUT 026:  resetFailed = 1, reset = 0, connection destroyed
//   flag on, WITH 026:     reset = 1, resetFailed = 0, connection handed back
//
// Both arms run in a child process against the same database, because the flag is read when
// libedge-bridge-db.mjs is loaded. The second arm is not decoration: without it, a check
// query that always failed would pass the first three assertions.
//
// Run by hand, it starts its own postgres and takes a few seconds:
//   node db/026-release-flag.test.mjs

const exec = promisify(execFile);
const dbDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(dbDir, '..');
const appDir = path.join(repoDir, 'spike/app');
const pg = createRequire(path.join(appDir, 'package.json'))('pg');

const DEMO = '11111111-1111-4111-8111-111111111111';
const DEMO_WORK = 'a0000000-0000-4000-8000-000000000001';

const container = `libedge-flag-${randomUUID()}`;
const adminPassword = randomBytes(18).toString('hex');
const appPassword = randomBytes(18).toString('hex');
let port;
let admin;
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

async function errorText(error) {
  const causes = [];
  for (let cause = error; cause && causes.length < 4; cause = cause.cause) causes.push(cause.message);
  return causes.join(' <- ');
}

const isCommand = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

async function main() {
  try {
    await run();
  } catch (error) {
    console.error(`\n  FAILED: ${await errorText(error)}`);
    process.exitCode = 1;
  } finally {
    await admin?.end().catch(() => {});
    await stopContainer();
  }
}

// ---------------------------------------------------------------------------
// The probe: one process, flag on, one database state
// ---------------------------------------------------------------------------
// Runs when LIBEDGE_FLAG_PROBE_URL is set, which is how this file re-invokes itself. One
// JSON line on stdout; the assertions live in the harness, so a crash reads as a crash here
// instead of as a failed assertion halfway through.
process.on('uncaughtException', (error) => {
  console.log(JSON.stringify({ ok: false, error: `uncaught: ${error.code || ''} ${error.message}` }));
  process.exit(1);
});

async function probe() {
  const { withBridgeTenant, bridgeTenantStats } = await import('../spike/app/libedge-bridge-db.mjs');
  // max: 1, so anything that runs after the tenant-scoped call runs on the same connection.
  const pool = new pg.Pool({ connectionString: process.env.LIBEDGE_FLAG_PROBE_URL, max: 1 });
  const out = { ok: true, ids: null, unbound: null, error: null };
  pool.on('error', (error) => { out.poolError = error.message; });
  try {
    // `seen`, not `rows` or `stats`: pg owns both names on its own objects.
    out.ids = await withBridgeTenant(pool, DEMO, async (client) => {
      const seen = await client.query('select id from works');
      return seen.rows.map((row) => row.id);
    });
    const unbound = await pool.query('select id from works');
    out.unbound = unbound.rows.map((row) => row.id);
  } catch (error) {
    out.ok = false;
    out.error = `${error.code || ''} ${error.message}`;
  } finally {
    out.counts = { ...bridgeTenantStats };
    await pool.end().catch(() => {});
  }
  console.log(JSON.stringify(out));
}

if (process.env.LIBEDGE_FLAG_PROBE_URL) {
  await probe();
  process.exit(0);
}



// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

async function run() {
  await setup();

  // --- WITHOUT 026, flag on ------------------------------------------------
  // `reset app.tenant_id` succeeds on this database. Only the check query after it raises,
  // which is precisely why the check has to be there: counting `reset` alone would report
  // success and hand the poisoned connection back.
  const before = await runProbe();
  check(before.parsed !== null,
    `the probe produced no JSON. stderr: ${before.stderr.slice(0, 400)}`);
  check(before.parsed.ok === true,
    'the tenant-scoped call itself must succeed; it is the reset that cannot be trusted: '
    + before.text.slice(0, 400));
  check(JSON.stringify(before.parsed.ids) === JSON.stringify([DEMO_WORK]),
    `the tenant-scoped read returned ${JSON.stringify(before.parsed.ids)}, expected the demo work`);
  check(before.parsed.counts.resetFailed === 1,
    `without 026 the reset arm reported ${JSON.stringify(before.parsed.counts)}; expected `
    + 'resetFailed = 1. A bare `reset` succeeds there and the 22P02 lands on the next '
    + 'request, so a 0 here means the check query is missing');
  check(before.parsed.counts.reset === 0,
    `without 026 the reset arm counted ${before.parsed.counts.reset} successful resets; none `
    + 'may be counted, the connection was not unbound');
  check(before.parsed.counts.destroyed === 1,
    `without 026 the reset arm reported ${JSON.stringify(before.parsed.counts)}; the `
    + 'connection had to be destroyed rather than handed back');

  // --- WITH 026, flag on ---------------------------------------------------
  // Without this arm the three assertions above would also pass on a check query that
  // always fails.
  await admin.query(await readFile(path.join(dbDir, 'migrations', '026-tenant-binding-nullif.sql'), 'utf8'));
  const after = await runProbe();
  check(after.parsed !== null, `the probe produced no JSON. stderr: ${after.stderr.slice(0, 400)}`);
  check(after.parsed.counts.reset === 1 && after.parsed.counts.resetFailed === 0,
    `with 026 the arm reported ${JSON.stringify(after.parsed.counts)}; expected reset = 1 and `
    + 'resetFailed = 0 - the check query must pass once the policies are guarded');
  check(after.parsed.counts.destroyed === 0,
    `with 026 the connection was destroyed anyway (${JSON.stringify(after.parsed.counts)}); `
    + 'the point of 026 is that it can go back to the pool');
  check(JSON.stringify(after.parsed.unbound) === '[]',
    `after the tenant-scoped call an unbound read returned ${JSON.stringify(after.parsed.unbound)}; `
    + 'a connection back in the pool must not carry the previous tenant');

  console.log(`\n  026 release flag: ${checks} checks. Flag on without 026: resetFailed=1, `
    + 'reset=0, connection destroyed. Flag on with 026: reset=1, resetFailed=0, connection reused.');
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

  // The shipped schema, so the policies under test are the real ones.
  await admin.query(await readFile(path.join(repoDir, 'db/schema.sql'), 'utf8'));
  // 021, 022, 024 and 025: what a production database has BEFORE 026. 023 waits on
  // contract 4.4 and is not part of this deploy.
  for (const file of [
    '021-libedge-identity-and-subscriptions.sql',
    '022-global-catalogue-boundary.sql',
    '024-maintenance-tenants.sql',
    '025-libedge-tenant-provisioning.sql',
  ]) {
    await admin.query(await readFile(path.join(dbDir, 'migrations', file), 'utf8'));
  }

  await admin.query(`alter role akademik_app password '${appPassword}'`);
  // One tenant, one work. The owner is FORCEd too, so the row is inserted with its tenant.
  await admin.query("insert into tenants (id, name, slug) values ($1, 'Demo', 'demo')", [DEMO]);
  await admin.query("select set_config('app.tenant_id', $1, false)", [DEMO]);
  await admin.query('insert into works (id, tenant_id, title) values ($1, $2, $3)',
    [DEMO_WORK, DEMO, 'Demo Work']);
  await admin.query('reset app.tenant_id');
}

function probeUrl() {
  return `postgres://akademik_app:${appPassword}@127.0.0.1:${port}/${admin.database}`;
}


// `import.meta.url` in THIS file, already absolute: fileURLToPath is taken from a URL, not
// resolved against the child's cwd. Passing a Windows path through JSON.stringify into a
// generated script turned `\U` into an escape, and the child then ran a file that did not
// exist while both of its streams looked empty.
const selfPath = fileURLToPath(import.meta.url);

// A generated script rather than `env: { ...process.env, KEY: value }` on the child: that
// inline form delivered the URL truncated, the child printed nothing, and the harness
// reported the silence as a failed migration. The script removes the ambiguity.
async function runProbe() {
  const script = path.join(dbDir, `.flag-probe-${randomUUID()}.mjs`);
  const source = `import { spawn } from 'node:child_process';
const env = { ...process.env, LIBEDGE_FLAG_PROBE_URL: ${JSON.stringify(probeUrl())} };
env.LIBEDGE_BRIDGE_MEASURE_RESET = '1';
const child = spawn(process.execPath, [${JSON.stringify(selfPath)}],
  { env, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
let err = '';
child.stdout.on('data', (chunk) => { out += chunk; });
child.stderr.on('data', (chunk) => { err += chunk; });
const code = await new Promise((resolve) => child.on('close', resolve));
if (code !== 0) process.stderr.write('the probe exited ' + code + '\\n');
process.stderr.write(err);
console.log(out.trim());
`;
  try {
    await writeFile(script, source);
    const result = await new Promise((resolve) => {
      execFile(process.execPath, [script],
        { cwd: appDir, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
        (error, out, err) => resolve({
          stdout: String(out || ''),
          stderr: String(err || ''),
          failure: error ? `${error.code || ''} ${error.message}` : null,
        }));
    });
    if (result.failure) console.error(`the probe process failed: ${result.failure}`);
    const text = result.stdout.trim().split('\n').pop() || '';
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* reported as no JSON below */ }
    return { parsed, text, stderr: result.stderr };
  } finally {
    await rm(script, { force: true });
  }
}


if (isCommand) {
  await main();
}

