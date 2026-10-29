import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile, writeFile, rm } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';

// Can withBridgeTenant hand its connection back to the pool once 026 is applied?
//
// 026 rewrites every tenant policy to `nullif(current_setting('app.tenant_id', true), '')::uuid`,
// so `reset app.tenant_id` genuinely unbinds (db/026.test.mjs measures exactly that on one
// pooled connection). The question here is the next one, and it is a different one:
//
//   with 026 applied, may withBridgeTenant `client.release()` instead of `release(true)` -
//   and if it does, does the next query on that same pooled connection see nothing?
//
// Both arms run in their own process against the same database, because the choice is read
// from the environment when the module loads:
//
//   A. destroy  - client.release(true)                      (today)
//   B. reset    - reset app.tenant_id, then client.release()
//
// And B is measured against a database WITHOUT 026 first. If B worked there, 026 would be
// pointless and this file would be theatre; that arm is what makes the comparison a
// measurement. The tenant-leak check is the same in both: after a tenant-scoped call, an
// unbound read through the max:1 pool must return no rows - "the demo work" is the answer
// that means a reused connection kept its tenant.
//
// Run by hand, it starts its own postgres and takes a few seconds:
//   node db/026-release.test.mjs

const exec = promisify(execFile);
const dbDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(dbDir, '..');
const appDir = path.join(repoDir, 'spike/app');
const pg = createRequire(path.join(appDir, 'package.json'))('pg');

const DEMO = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const DEMO_WORK = 'a0000000-0000-4000-8000-000000000001';
const OTHER_WORK = 'a0000000-0000-4000-8000-0000000000aa';

const container = `libedge-release-${randomUUID()}`;
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

// ---------------------------------------------------------------------------
// The probe: one process, one arm
// ---------------------------------------------------------------------------
// Runs when LIBEDGE_RELEASE_PROBE_URL is set, which is how this file re-invokes itself.
// Writes one JSON line; the assertions live in the harness so a crash here is reported as
// a crash instead of as a failed assertion in the middle of the run. An uncaught exception
// is a crash, and without this handler it would leave stdout empty and look like silence.
process.on('uncaughtException', (error) => {
  console.log(JSON.stringify({ ok: false, error: `uncaught: ${error.code || ''} ${error.message}` }));
  process.exit(1);
});

async function probe() {
  const { withBridgeTenant, bridgeTenantStats } = await import('../spike/app/libedge-bridge-db.mjs');
  // max: 1 - after the tenant-scoped call returns its connection, the NEXT query on this
  // pool is necessarily on the same connection. Nothing else can prove reuse so cheaply.
  const pool = new pg.Pool({ connectionString: process.env.LIBEDGE_RELEASE_PROBE_URL, max: 1 });
  // A pool without its own 'error' listener throws on an idle client error; this one is
  // reported in the JSON instead of killing the process with no output.
  pool.on('error', (error) => { out.error = `pool: ${error.message}`; });
  const out = { ok: true, ids: null, unbound: null, error: null };
  try {
    // `seen` and not `rows` or `stats` inside the callback: both are names `pg` owns, and a
    // local that shadows them makes the mapped rows read as undefined with no error.
    const seenIds = await withBridgeTenant(pool, DEMO, async (client) => {
      const seen = await client.query('select id from works');
      return seen.rows.map((row) => row.id);
    });
    out.ids = seenIds;
    // No binding, no withBridgeTenant: the query a health check or a maintenance job runs.
    const unboundRead = await pool.query('select id from works');
    out.unbound = unboundRead.rows.map((row) => row.id);
  } catch (error) {
    out.ok = false;
    out.error = `${error.code || ''} ${error.message}`;
  } finally {
    // `counts` and not `stats`: `stats` is a property of the pool's own objects, and the
    // counter must not shadow it.
    out.counts = { ...bridgeTenantStats };
    await pool.end().catch(() => {});
  }
  console.log(JSON.stringify(out));
}

// ---------------------------------------------------------------------------
// Is this file being run, or being examined?
// ---------------------------------------------------------------------------
// The probe arm re-invokes this file, and the harness is written with top-level `await`,
// so `node --check` refuses it too (ESM syntax check). Neither may start a container, so
// the probe entry point is the only thing on load; everything else happens inside main().
const isCommand = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (process.env.LIBEDGE_RELEASE_PROBE_URL) {
  await probe();
  process.exit(0);
}

if (isCommand) {
  await main();
  await admin?.end().catch(() => {});
  await stopContainer();
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

async function errorText(error) {
  const causes = [];
  for (let cause = error; cause && causes.length < 4; cause = cause.cause) causes.push(cause.message);
  return causes.join(' <- ');
}

async function setup() {
  await docker('version', '--format', '{{.Server.Version}}');
  if (process.env.LIBEDGE_RELEASE_SERVER) {
    const url = new URL(process.env.LIBEDGE_RELEASE_SERVER);
    // Both scripts create a database called release_026 and drop it first, so the same
    // name is safe: whichever runs, it starts from an empty one of its own. utf8 and C
    // collation rather than the template's, because the host locale is not the container's
    // and schema.sql holds non-ASCII text. See db/026.test.mjs.
    try {
      admin = new pg.Client({ connectionString: url.toString() });
      await admin.connect();
      await admin.query('drop database if exists release_026 with (force)');
      await admin.query("create database release_026 template template0 encoding 'UTF8' "
        + "lc_collate 'C' lc_ctype 'C'");
    } catch (error) {
      throw new Error(`the shared server refused the fixture: ${error.message}`);
    } finally {
      await admin?.end().catch(() => {});
    }
    url.pathname = '/release_026';
    admin = new pg.Client({ connectionString: url.toString() });
    try {
      await admin.connect();
    } catch (error) {
      throw new Error(`could not connect to the fixture database: ${error.message}`);
    }
    port = url.port;
    await admin.query(await readFile(path.join(repoDir, 'db/schema.sql'), 'utf8'));
    await admin.query("do $$ begin if not exists (select 1 from pg_roles where rolname = 'akademik_app') "
      + "then create role akademik_app login; end if; end $$");
    await admin.query(`alter role akademik_app password '${appPassword}'`);
    await seed();
    return;
  }
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

  await admin.query(await readFile(path.join(repoDir, 'db/schema.sql'), 'utf8'));
  await admin.query(`alter role akademik_app password '${appPassword}'`);
  await seed();
}

// The same data on both paths: two tenants, one work each.
async function seed() {
  await admin.query(
    'insert into tenants (id, name, slug) values ($1, $2, $3), ($4, $5, $6)',
    [DEMO, 'Demo', 'demo', OTHER, 'Other', 'other'],
  );
  // The owner is FORCEd too, so each insert is made with the tenant it belongs to.
  for (const [tenant, work] of [[DEMO, DEMO_WORK], [OTHER, OTHER_WORK]]) {
    await admin.query("select set_config('app.tenant_id', $1, false)", [tenant]);
    await admin.query('insert into works (id, tenant_id, title) values ($1, $2, $3)', [work, tenant, work]);
  }
  await admin.query('reset app.tenant_id');

  // The role exists once per cluster, and the container starts in the image's own locale, so
  // neither needs creating here. Everything after this point is the same on both paths.
}

// The migrations a production database has before 026. 023 is not applied (it waits on
// contract 4.4); 024 creates the app schema the others use.
async function applyMigrations() {
  for (const file of [
    '021-libedge-identity-and-subscriptions.sql',
    '022-global-catalogue-boundary.sql',
    '024-maintenance-tenants.sql',
    '025-libedge-tenant-provisioning.sql',
  ]) {
    await admin.query(await readFile(path.join(dbDir, 'migrations', file), 'utf8'));
  }
}

// The probe arm is launched from a generated script that already holds the connection URL.
// A child started with `env: { ...process.env, KEY: value }` receives the new key truncated
// to nine characters, so every attempt to pass LIBEDGE_RELEASE_PROBE_URL to the child
// produced a process that did not run the arm at all - it printed nothing and the harness
// blamed the migration. The script removes the problem instead of documenting it further.
async function runProbe({ reset }) {
  const script = path.join(dbDir, `.probe-${randomUUID()}.mjs`);
  const source = `import { spawn } from 'node:child_process';
const env = { ...process.env, LIBEDGE_RELEASE_PROBE_URL: ${JSON.stringify(probeUrl())} };
${reset ? "env.LIBEDGE_BRIDGE_MEASURE_RESET = '1';" : 'delete env.LIBEDGE_BRIDGE_MEASURE_RESET;'}
delete env.LIBEDGE_RELEASE_SERVER;
const child = spawn(process.execPath, [${JSON.stringify(fileURLToPath(import.meta.url))}],
  { env, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
let err = '';
child.stdout.on('data', (chunk) => { out += chunk; });
child.stderr.on('data', (chunk) => { err += chunk; });
await new Promise((resolve) => child.on('close', resolve));
process.stderr.write(err);
console.log(out.trim());
`;
  try {
    await writeFile(script, source);
    const { stdout, stderr } = await new Promise((resolve) => {
      execFile(process.execPath, [script],
        { cwd: appDir, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
        (error, out, err) => resolve({ stdout: String(out || ''), stderr: String(err || '') }));
    });
    const text = stdout.trim().split('\n').pop() || '';
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* reported as no JSON below */ }
    return { parsed, text, stderr };
  } finally {
    await rm(script, { force: true });
  }
}

function probeUrl() {
  return `postgres://akademik_app:${appPassword}@127.0.0.1:${port}/${admin.database}`;
}

async function main() {
  try {
    await run();
  } catch (error) {
    console.error(`\n  FAILED: ${await errorText(error)}`);
    process.exitCode = 1;
  }
}

async function run() {
  await setup();
  await applyMigrations();

  // --- B, without 026: it must fail --------------------------------------------
  // Measured first. A reset that already worked here would mean the policies never needed
  // rewriting, and the comparison below would prove nothing.
  const withoutMigration = await runProbe({ reset: true });
  check(withoutMigration.parsed !== null,
    `the probe produced no JSON. stderr: ${withoutMigration.stderr.slice(0, 400)}`);
  check(withoutMigration.parsed.ok === false,
    `returning the connection worked WITHOUT 026 (${withoutMigration.text.slice(0, 300)}); `
    + 'the policy rewrite is then unnecessary or the probe is not measuring it');
  check(/22P02/.test(withoutMigration.parsed.error || ''),
    `without 026 the unbound read failed with ${JSON.stringify(withoutMigration.parsed.error)}; expected 22P02`);

  // --- with 026 ---------------------------------------------------------------
  await admin.query(await readFile(path.join(dbDir, 'migrations', '026-tenant-binding-nullif.sql'), 'utf8'));

  const reset = await runProbe({ reset: true });
  check(reset.parsed !== null, `the probe produced no JSON. stderr: ${reset.stderr.slice(0, 400)}`);
  check(reset.parsed.ok === true, `with 026 the reset arm failed: ${reset.parsed.error}`);
  check(JSON.stringify(reset.parsed.ids) === JSON.stringify([DEMO_WORK]),
    `the tenant-scoped read returned ${JSON.stringify(reset.parsed.ids)}, expected the demo work. `
    + `Raw: ${reset.text.slice(0, 400)}`);
  // The claim. An empty list is the only correct answer; the demo work means the reused
  // connection still had the previous tenant bound.
  check(JSON.stringify(reset.parsed.unbound) === '[]',
    `an unbound read after the tenant-scoped call returned ${JSON.stringify(reset.parsed.unbound)}; `
    + 'a reused connection must not carry the previous tenant');
  // The mechanism, asserted rather than inferred from timing: the connection was reset and
  // handed back, not destroyed.
  check(reset.parsed.counts.reset === 1 && reset.parsed.counts.destroyed === 0
    && reset.parsed.counts.resetFailed === 0,
    `the reset arm reported ${JSON.stringify(reset.parsed.counts)}; expected one reset, no destroy`);

  // --- the same sequence on today's path, for the comparison ------------------
  const destroy = await runProbe({ reset: false });
  check(destroy.parsed !== null, `the destroy probe produced no JSON. stderr: ${destroy.stderr.slice(0, 400)}`);
  check(destroy.parsed.ok === true && JSON.stringify(destroy.parsed.unbound) === '[]',
    `the destroy arm produced ${destroy.text.slice(0, 300)}`);
  check(destroy.parsed.counts.destroyed === 1 && destroy.parsed.counts.reset === 0,
    `the destroy arm reported ${JSON.stringify(destroy.parsed.counts)}; expected one destroy, no reset`);

  console.log(`\n  026 release: ${checks} checks. Without 026 the reset arm fails (22P02); `
    + 'with 026 it unbinds, reads nothing, and hands the connection back.');
}

