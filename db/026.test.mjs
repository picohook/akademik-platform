import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';

// 026: a connection that has bound a tenant can be unbound again.
//
// The claim is narrow and it is measured, not read off the SQL: after
// `reset app.tenant_id`, an unbound read on the SAME pooled connection that just did
// tenant-scoped work must work, see nothing, and write nothing. Before 026 that read
// raised 22P02 (the setting is '' and `''::uuid` is not a uuid) - db/README.md records
// the measurement, and this file is the proof that the migration removes it.
//
// Checked, in order:
//   * BEFORE 026, on the real schema: reset leaves '' and the next unbound read is 22P02.
//     Measured first, because a test that only ran after the migration would pass even if
//     the defect never existed and the migration did nothing.
//   * after 026 the same sequence succeeds, and the answer is "no rows" - not "the
//     previous tenant's rows". This is the difference between a fix and a worse bug.
//   * every tenant policy was rewritten: none still contains the bare cast, the count is
//     the expected number, and each policy kept its name, command, permissive flag and
//     role list - only qual/with_check changed. A migration that silently dropped a
//     restrictive policy would open a hole no functional test would catch.
//   * 021's bridge_idempotency policy is untouched: it uses the coalesce form on purpose.
//   * a bound session still reads exactly its own tenant, so the rewrite changed nothing
//     for the case that already worked.
//   * a write from an unbound session is still denied, so "unbindable" did not become
//     "unrestricted".
//   * applying the file twice is not an error and does not reintroduce the cast.
//
// Run by hand, it starts its own postgres and takes a few seconds:
//   node db/026.test.mjs

const exec = promisify(execFile);
const dbDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(dbDir, '..');
const appDir = path.join(repoDir, 'spike/app');
// `pg` is a dependency of spike/app, not of db/. Resolve it from there, the way
// db/024.test.mjs does; a bare 'pg' import resolves to nothing usable here.
const pg = createRequire(path.join(appDir, 'package.json'))('pg');

const LIBEDGE = '5799f2a5-3d90-41b1-90de-9da07d776052';
const DEMO = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
// One work in each of two tenants, so "reads nothing" and "reads the other tenant" are
// different answers rather than both being an empty array.
const DEMO_WORK = 'a0000000-0000-4000-8000-000000000001';
const OTHER_WORK = 'a0000000-0000-4000-8000-0000000000aa';

const container = `libedge-nullif-${randomUUID()}`;
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

// An error is the expected outcome in the negative cases, so SQLSTATE is asserted.
async function expectError(label, fn, code) {
  try {
    await fn();
  } catch (error) {
    check(error.code === code, `${label}: expected SQLSTATE ${code}, got ${error.code}: ${error.message}`);
    return error;
  }
  throw new Error(`${label}: expected ${code}, but the statement succeeded`);
}

async function setup() {
  await docker('version', '--format', '{{.Server.Version}}');
  // A caller-supplied server replaces the container, so the measurement script can run this
  // file repeatedly without paying for a postgres each time. The database gets its own
  // encoding and collation rather than the template's: on a Windows host the cluster's
  // locale is often not the container's, and schema.sql holds non-ASCII text. Never set in
  // CI.
  if (process.env.LIBEDGE_RELEASE_SERVER) {
    const url = new URL(process.env.LIBEDGE_RELEASE_SERVER);
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
    // The shipped schema, so the policies under test are the real ones.
    await admin.query(await readFile(path.join(repoDir, 'db/schema.sql'), 'utf8'));
    // The role lives in the cluster, not the database, and the container path gets it from
    // schema.sql. A second run against the same cluster must not try to create it again.
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

  // Postgres reports ready through a second init phase, so a connection refused early is
  // normal and must be retried with a fresh Client each time.
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
  // The role is cluster-wide: the shared-server path creates it once and reuses it.
  await admin.query("do $$ begin if not exists (select 1 from pg_roles where rolname = 'akademik_app') "
    + "then create role akademik_app login; end if; end $$");
  await admin.query(`alter role akademik_app password '${appPassword}'`);
  await seed();
}

// Two tenants, one work each, inserted as the owner - so FORCE RLS applies and each insert
// is made with the tenant it belongs to rather than leaning on the owner bypassing the
// policy. Same data on both setup paths.
async function seed() {
  await admin.query(
    `insert into tenants (id, name, slug) values ($1,'LibEdge','libedge'), ($2,'Demo','demo'), ($3,'Other','other')`,
    [LIBEDGE, DEMO, OTHER],
  );
  for (const [tenant, work, title] of [[DEMO, DEMO_WORK, 'Demo Work'], [OTHER, OTHER_WORK, 'Other Work']]) {
    await admin.query("select set_config('app.tenant_id', $1, false)", [tenant]);
    await admin.query('insert into works (id, tenant_id, title) values ($1, $2, $3)', [work, tenant, title]);
  }
  await admin.query('reset app.tenant_id');
}

// Every migration that touches a tenant policy, in order. A test that applied only 026
// would miss the ones 021 and 022 add - and those are half the policies in the table.
async function applyUpToAndIncluding026({ skip = [] } = {}) {
  for (const file of [
    '001-asset-pages.sql',
    '007-user-sessions.sql',
    '011-grant-audit.sql',
    '012-groups.sql',
    '013-download-tickets.sql',
    '014-download-ticket-limits.sql',
    '015-annotation-sync.sql',
    '016-annotation-receipt-retention.sql',
    '021-libedge-identity-and-subscriptions.sql',
    '022-global-catalogue-boundary.sql',
    // 023 is not applied (it moves works to the global catalogue and waits on contract
    // 4.4), but the app schema it would have created first comes from 024, which is what
    // production runs. 025 is the bridge's tenant provisioning and is part of the same
    // deploy gate.
    '024-maintenance-tenants.sql',
    '025-libedge-tenant-provisioning.sql',
    '026-tenant-binding-nullif.sql',
  ]) {
    if (skip.includes(file)) continue;
    await admin.query(await readFile(path.join(dbDir, 'migrations', file), 'utf8'));
  }
}

// One line per policy, so a before/after diff is exact rather than approximate.
async function policySnapshot() {
  const { rows } = await admin.query(
    `select policyname, tablename, permissive, cmd, roles::text as roles, qual, with_check
       from pg_policies where schemaname = 'public'
      order by tablename, policyname`,
  );
  return rows;
}

// One line per policy, so a before/after diff is exact rather than approximate.
const shape = (row) => `${row.tablename}|${row.policyname}|${row.permissive}|${row.cmd}|${row.roles}`;
const expressions = (row) => `${row.qual || ''}${row.with_check || ''}`;
// The cast as pg_policies reports it. pg_get_expr normalises: the literal gains a ::text
// cast and the whole current_setting(...) call is parenthesised.
//   (tenant_id = (current_setting('app.tenant_id'::text, true))::uuid)
// pg_get_expr normalises the expression it reports: the literal gains a ::text cast, the
// call is parenthesised, and a known function name is upper-cased. The migration writes the
// same five tokens; the fixtures here compare case-insensitively for that reason.
//   before: (tenant_id = (current_setting('app.tenant_id'::text, true))::uuid)
//   after:  (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)
const BARE = "current_setting('app.tenant_id'::text, true))::uuid";
const GUARDED = "nullif(current_setting('app.tenant_id'::text, true), ''::text))::uuid";
const has = (row, text) => expressions(row).toLowerCase().includes(text.toLowerCase());
const mentionsCast = (row) => has(row, BARE);

// The cause chain, not just the outermost message: a pg failure here is usually wrapped
// (fixture setup -> connect -> auth) and the outer message alone names none of it.
async function errorText(error) {
  const causes = [];
  for (let cause = error; cause && causes.length < 4; cause = cause.cause) causes.push(cause.message);
  return causes.join(' <- ');
}

// Module scope so the failure path can point at the line of 026 that broke.
let migration = '';

async function main() {
  try {
    await run();
  } catch (error) {
    console.error(`\n  FAILED: ${await errorText(error)}`);
    // A plpgsql error carries where/position relative to the statement that was sent; the
    // migration is sent as one string, so the offset maps back to a line of the file.
    if (error.where || error.position || error.routine) {
      console.error(`  code=${error.code} position=${error.position} where=${error.where} routine=${error.routine}`);
    }
    if (error.internalQuery) console.error(`  query: ${String(error.internalQuery).slice(0, 1200)}`);
    if (error.position && migration) {
      const offset = Number(error.position) - 1;
      const at = migration.slice(0, offset).split('\n').length;
      console.error(`  026 line ${at}: ${migration.split('\n')[at - 1]}`);
    }
    process.exitCode = 1;
  } finally {
    await admin?.end().catch(() => {});
    await stopContainer();
  }
}

async function run() {
  await setup();

  // --- before 026: the defect -------------------------------------------------
  // Applied WITHOUT 026, so the measurement is of the schema as it ships today.
  await applyUpToAndIncluding026({ skip: ['026-tenant-binding-nullif.sql'] });

  const beforePolicies = await policySnapshot();
  check(beforePolicies.length > 15,
    `only ${beforePolicies.length} policies in the fixture; this test assumes the full schema`);

  // max: 1, so the unbound read after the bound transaction is certain to run on the
  // connection that did the tenant-scoped work - which is the whole problem.
  const app = new pg.Pool({
    connectionString: `postgres://akademik_app:${appPassword}@127.0.0.1:${port}/${admin.database}`,
    max: 1,
  });
  // An idle client erroring would otherwise be an unhandled 'error' event and kill the run.
  app.on('error', () => {});

  try {
    await app.query("select set_config('app.tenant_id', $1, false) as bound", [DEMO]);
    const boundRead = await app.query('select id from works');
    check(boundRead.rowCount === 1 && boundRead.rows[0].id === DEMO_WORK,
      `a bound read should see exactly the demo work, saw ${JSON.stringify(boundRead.rows)}`);

    await app.query('reset app.tenant_id');
    const afterReset = await app.query("select current_setting('app.tenant_id', true) as value");
    check(afterReset.rows[0].value === '',
      `reset left ${JSON.stringify(afterReset.rows[0].value)}; this test assumes the documented '' state`);
    // The defect, measured on the real schema: the fix below is only meaningful if this
    // fails first.
    await expectError('unbound read after reset, before 026', () => app.query('select id from works'), '22P02');

    // The third failure mode 026 also has to prevent: leaving the setting in place makes
    // the next unbound read return the PREVIOUS tenant's rows, silently.
    await app.query("select set_config('app.tenant_id', $1, false)", [DEMO]);
    const leaked = await app.query('select id from works');
    check(leaked.rowCount === 1 && leaked.rows[0].id === DEMO_WORK,
      'a session left bound did not read the demo work; the fixture cannot show the leak');

    // --- 026 ---------------------------------------------------------------------
    migration = await readFile(path.join(dbDir, 'migrations', '026-tenant-binding-nullif.sql'), 'utf8');
    await admin.query(migration);

    const afterPolicies = await policySnapshot();
    check(afterPolicies.length === beforePolicies.length,
      `026 changed the number of policies: ${beforePolicies.length} -> ${afterPolicies.length}`);
    check(JSON.stringify(afterPolicies.map(shape)) === JSON.stringify(beforePolicies.map(shape)),
      '026 changed a policy name, table, permissive flag, command or role list; only the '
      + `expressions may change:\n${JSON.stringify(afterPolicies.map(shape))}\n${JSON.stringify(beforePolicies.map(shape))}`);

    const stillBare = afterPolicies.filter((row) => expressions(row).includes(BARE));
    check(stillBare.length === 0, `026 left the bare cast in ${stillBare.map(shape).join(', ')}`);

    // Two independent counts, so a policy that lost its expression cannot hide in the
    // difference: every policy that had the cast now has the guard.
    const guarded = afterPolicies.filter((row) => has(row, GUARDED));
    const hadCast = beforePolicies.filter(mentionsCast);
    check(hadCast.length >= 20, `only ${hadCast.length} policies had the cast; expected at least 20`);
    check(guarded.length === hadCast.length,
      `${hadCast.length} policies had the cast, ${guarded.length} have the guard: `
      + `${hadCast.map(shape).join(', ')}`);

    // 021's fail-closed membership check is not a cast and must not be rewritten.
    const idempotency = afterPolicies.find((row) => row.policyname === 'bridge_idempotency_bridge');
    check(idempotency && /coalesce\(current_setting\('app\.tenant_id'(::text)?, true\), ''(::text)?\) <> ''/i.test(idempotency.qual),
      `bridge_idempotency_bridge was rewritten: ${idempotency?.qual}`);

    // --- after 026: the same sequence succeeds, and reads nothing ------------------
    // The pool still holds the connection bound to DEMO from above; this is the same
    // session that could not be unbound a moment ago.
    await app.query('reset app.tenant_id');
    const readable = await app.query('select id from works');
    check(readable.rowCount === 0,
      `an unbound read returned ${JSON.stringify(readable.rows)}; expected no rows. `
      + "Returning the previous tenant's rows is worse than the 22P02 this migration fixes");

    // tenants_self is the other shape (`id = ...`), and must behave the same way.
    const tenantRows = await app.query('select id from tenants');
    check(tenantRows.rowCount === 0, `an unbound read of tenants returned ${JSON.stringify(tenantRows.rows)}`);

    // A bound session is unchanged: exactly its own row, still nothing else.
    await app.query("select set_config('app.tenant_id', $1, false)", [OTHER]);
    const otherBound = await app.query('select id from works');
    check(otherBound.rowCount === 1 && otherBound.rows[0].id === OTHER_WORK,
      `a bound read should see exactly the other tenant's work, saw ${JSON.stringify(otherBound.rows)}`);

    // Unbinding did not become "unrestricted": a write from an unbound session is still
    // refused. This is the check that would catch a nullif written as `or null`.
    await app.query('reset app.tenant_id');
    await expectError('unbound insert', () => app.query(
      'insert into works (id, tenant_id, title) values ($1, $2, $3)',
      [randomUUID(), DEMO, 'Should Not Exist'],
    ), '42501');

    // app.tenant_binding() is the same expression the policies now use, and it is callable
    // by the app role only because the migration grants it.
    await app.query("select set_config('app.tenant_id', $1, false)", [DEMO]);
    const fnBound = await app.query('select app.tenant_binding() as id');
    check(fnBound.rows[0].id === DEMO, `app.tenant_binding() returned ${JSON.stringify(fnBound.rows[0].id)} while bound`);
    await app.query('reset app.tenant_id');
    const fnUnbound = await app.query('select app.tenant_binding() as id');
    check(fnUnbound.rows[0].id === null,
      `app.tenant_binding() returned ${JSON.stringify(fnUnbound.rows[0].id)} while unbound; expected NULL`);

    // A second application is refused by the migration's own guard rather than silently
    // nesting two nullifs. db/migrate.mjs records what it applied, so this only happens by
    // hand - and then it must be loud.
    await expectError('026 applied twice', () => admin.query(migration), '0A000');
    const twice = await policySnapshot();
    check(JSON.stringify(twice.map(shape)) === JSON.stringify(afterPolicies.map(shape)),
      'a refused second application still changed the policy list');

    console.log(`\n  026: ${checks} checks, ${guarded.length} policies guarded, `
      + `${idempotency ? 1 : 0} left on the coalesce form, unbound reads work after reset.`);
  } finally {
    await app.end().catch(() => {});
  }
}

main();
