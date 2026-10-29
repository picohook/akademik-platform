#!/usr/bin/env node
// Migration 026, release order: 021, 022, 024, 025 - then the four attacks from 022, which
// must stay denied, and only then 026 and the same four again.
//
// Read-only with respect to the repository: migrations and the 022 attacks are loaded with
// git show from a ref, so nothing is written into the working tree.
//
//   node --version            (v22, libuv 1.48+)
//   node db/026-before-after.mjs --ref origin/main
//
// Imports: node:test only. The 022 attack tests are read from the ref and run as a child
// process, because that is how they were written (they start their own postgres).
// pg is resolved from spike/app, the same way every other file in db/ does.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const dbDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(dbDir, '..');
const appDir = path.join(repoDir, 'spike/app');
const pg = createRequire(path.join(appDir, 'package.json'))('pg');

// The ref the evidence is taken from. main, and not a branch: the point of this file is to
// say what main does today, and what it would do with 026 applied.
const REF = (() => {
  const index = process.argv.indexOf('--ref');
  return index === -1 ? 'origin/main' : process.argv[index + 1];
})();

const container = `libedge-026-evidence-${randomUUID()}`;
// The fixture the four attacks use: two tenants, a global collection and a global work, in
// ids that are distinct from the ones 026.test.mjs uses so this file can be run beside it.
const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const WORK_A = 'a0000000-0000-4000-8000-0000000000a1';
const WORK_B = 'a0000000-0000-4000-8000-0000000000b2';
const WORK_GLOBAL = 'a0000000-0000-4000-8000-0000000000ff';
const COLLECTION_A = '88888888-8888-4888-8888-8888888888a1';
const COLLECTION_OTHER = '88888888-8888-4888-8888-8888888888b2';
const COLLECTION_GLOBAL = '88888888-8888-4888-8888-888888888800';
let database = 'mig';
const adminPassword = randomBytes(18).toString('hex');
const appPassword = randomBytes(18).toString('hex');
const catalogPassword = randomBytes(18).toString('hex');
let port;
let admin;
let checks = 0;

const check = (condition, message) => { assert.ok(condition, message); checks += 1; };

async function docker(...args) {
  return (await exec('docker', args, { timeout: 90_000, maxBuffer: 4 * 1024 * 1024 })).stdout.trim();
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

// A file as it exists at REF, without touching the working tree.
async function atRef(file) {
  return (await exec('git', ['show', `${REF}:${file}`], { cwd: repoDir, maxBuffer: 8 * 1024 * 1024 })).stdout;
}

// An error is the expected outcome in the negative cases, so the SQLSTATE is asserted.
async function expectError(label, fn, code) {
  try {
    await fn();
  } catch (error) {
    assert.equal(error.code, code, `${label}: expected SQLSTATE ${code}, got ${error.code}: ${error.message}`);
    checks += 1;
    return;
  }
  throw new Error(`${label}: expected ${code}, but the statement succeeded`);
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
}

// Every policy in the schema, with the columns a reviewer compares.
async function policySnapshot() {
  return (await admin.query(
    `select tablename, policyname, cmd, permissive::text as permissive, roles::text as roles, qual, with_check
       from pg_policies where schemaname = 'public'
      order by tablename, policyname`,
  )).rows;
}

async function rlsSnapshot() {
  return (await admin.query(
    `select c.relname as table, c.relrowsecurity as rls, c.relforcerowsecurity as force
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' order by c.relname`,
  )).rows;
}

async function functionSnapshot() {
  return (await admin.query(
    `select p.proname as fn,
            has_function_privilege('akademik_app', p.oid, 'execute') as app_execute,
            has_function_privilege('akademik_catalog', p.oid, 'execute') as catalog_execute
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app' order by p.proname`,
  )).rows;
}

// The 022 attacks, unchanged, run against a database built by this process. Written out to a
// temporary file next to db/ because the file they live in applies its own migrations and
// starts its own postgres; only its migration list is rewritten, in memory.
async function run022Attacks({ with026 }) {
  const source = await atRef('db/021-022.test.mjs');
  const list = `['021-libedge-identity-and-subscriptions.sql', '022-global-catalogue-boundary.sql', '024-maintenance-tenants.sql'${with026 ? ", '026-tenant-binding-nullif.sql'" : ''}]`;
  const patched = source.replace(
    "['021-libedge-identity-and-subscriptions.sql', '022-global-catalogue-boundary.sql']",
    list,
  );
  assert.ok(patched !== source,
    'the 022 attacks file no longer has the migration list this file rewrites');
  const file = path.join(dbDir, `.026-attacks-${randomUUID()}.mjs`);
  await writeFile(file, patched, 'utf8');
  try {
    const { stdout } = await exec(process.execPath, [file], { timeout: 300_000, maxBuffer: 4 * 1024 * 1024 });
    return stdout.trim().split('\n').filter(Boolean).pop();
  } finally {
    await rm(file, { force: true });
  }
}
// Asserts that one specific attack was DENIED, rather than that the whole file exited 0.
// The file's own counts are printed, but not trusted on their own: a harness that quietly
// skipped its attempt block would still print "35 checks passed", so this file runs its own
// four attacks here, against the same roles.
async function assertFourAttacks({ label, with026 }) {
  const client = new pg.Client({ connectionString: `postgres://akademik_app:${appPassword}@127.0.0.1:${port}/${database}` });
  await client.connect();
  try {
    // Never reuse rows from a previous attempt: attack 4 in the earlier call may have left a
    // global work behind, and "0 rows moved" would then be measured against different data.
    await admin.query('reset app.tenant_id');
    await admin.query("select set_config('app.tenant_id', $1, false)", [TENANT_A]);
    await admin.query(`delete from collection_items`);
    await admin.query('delete from works');
    await admin.query('delete from collections');
    await admin.query('reset app.tenant_id');
    // The tenants the fixture belongs to.
    await admin.query(`insert into tenants (id, name, slug) values
      ($1, 'Tenant A', 'tenant-a'), ($2, 'Tenant B', 'tenant-b') on conflict (id) do nothing`,
    [TENANT_A, TENANT_B]);
    // The fixture rows the four attacks use. Each row is written with ITS OWN tenant bound,
    // and every insert's rowCount is checked: binding tenant A while inserting tenant B's row
    // writes nothing at all (the policy filters it, and `on conflict do nothing` reports zero
    // rows), which is how tenant B's line went missing and made attack 1 pass for the wrong
    // reason during development.
    await admin.query('reset app.tenant_id');
    for (const [sql, params, what] of [
      [`insert into works (id, tenant_id, title) values ($1, $2, 'A work')`, [WORK_A, TENANT_A], 'A work'],
      [`insert into works (id, tenant_id, title) values ($1, $2, 'B work')`, [WORK_B, TENANT_B], 'B work'],
      [`insert into collections (id, tenant_id, title, slug) values ($1, $2, 'A collection', 'a-collection')`, [COLLECTION_A, TENANT_A], 'A collection'],
      [`insert into collections (id, tenant_id, title, slug) values ($1, $2, 'B collection', 'b-collection')`, [COLLECTION_OTHER, TENANT_B], 'B collection'],
      [`insert into collections (id, tenant_id, title, slug) values ($1, null, 'Global collection', 'global-collection')`, [COLLECTION_GLOBAL], 'the global collection'],
    ]) {
      await admin.query('reset app.tenant_id');
      if (params.length > 1) await admin.query("select set_config('app.tenant_id', $1, false)", [params[1]]);
      const inserted = await admin.query(sql, params);
      check(inserted.rowCount === 1, `${label}: ${what} was not written (rowCount ${inserted.rowCount})`);
    }
    await admin.query('reset app.tenant_id');
    await admin.query("select set_config('app.tenant_id', $1, false)", [TENANT_A]);
    const itemA = await admin.query('insert into collection_items (collection_id, work_id) values ($1, $2)', [COLLECTION_A, WORK_A]);
    check(itemA.rowCount === 1, `${label}: tenant A's collection line was not written`);
    await admin.query('reset app.tenant_id');
    await admin.query("select set_config('app.tenant_id', $1, false)", [TENANT_B]);
    const itemB = await admin.query('insert into collection_items (collection_id, work_id, tenant_id) values ($1, $2, $3)',
      [COLLECTION_OTHER, WORK_B, TENANT_B]);
    check(itemB.rowCount === 1, `${label}: tenant B's collection line was not written`);
    await admin.query('reset app.tenant_id');
    await admin.query(`insert into works (id, tenant_id, title) values ($1, null, 'Global work') on conflict do nothing`, [WORK_GLOBAL]);
    await admin.query('reset app.tenant_id');

    await client.query("select set_config('app.tenant_id', $1, false)", [TENANT_A]);

    // The fixture, stated rather than assumed: attack 1 is only meaningful if tenant B's line
    // exists as well as tenant A's. `collection_items` carries a tenant_id of its own - 022
    // adds the column and backfills it from the collection - and that is what the policy
    // reads, so the column is what this checks.
    const lines = await admin.query('select collection_id, tenant_id from collection_items order by collection_id');
    check(lines.rows.length === 2, `${label} 0: expected two collection_items lines, found ${lines.rows.length}`);
    check(lines.rows.some((row) => row.tenant_id === TENANT_B),
      `${label} 0b: tenant B's line is missing, so the cross-tenant read proves nothing`);

    // 1. cross-tenant read of another tenant's collection_items: zero rows, not an error.
    const leak = await client.query('select count(*)::int n from collection_items where collection_id = $1',
      [COLLECTION_OTHER]);
    check(leak.rows[0].n === 0, `${label} 1: tenant A read ${leak.rows[0].n} rows of tenant B's collection_items`);
    // and its own is still readable, so the policy was not simply broken
    const own = await client.query('select count(*)::int n from collection_items where collection_id = $1',
      [COLLECTION_A]);
    check(own.rows[0].n === 1, `${label} 1b: the owning tenant lost read on its own collection_items`);

    // 2. adding a line to a GLOBAL collection changes catalogue membership: refused.
    await expectError(`${label} 2`, () => client.query(
      'insert into collection_items (collection_id, work_id) values ($1, $2)', [COLLECTION_GLOBAL, WORK_A],
    ), '42501');

    // 3. pulling a global work into the caller's tenant: the row must not change hands.
    const pulled = await client.query('update works set tenant_id = $1 where id = $2 and tenant_id is null',
      [TENANT_A, WORK_GLOBAL]);
    check(pulled.rowCount === 0, `${label} 3: the app moved ${pulled.rowCount} global works into its own tenant`);
    const stillGlobal = await admin.query('select tenant_id from works where id = $1', [WORK_GLOBAL]);
    check(stillGlobal.rows[0].tenant_id === null, `${label} 3b: a global work is now owned by ${stillGlobal.rows[0].tenant_id}`);

    // 4. inserting a global row directly, which 022 closed by giving the app's policies a
    //    WITH CHECK: refused.
    //
    //    The id is random on purpose. With a fixed id this "passes" against a policy that has
    //    no WITH CHECK at all, because the row from the previous attempt is still there and
    //    the insert fails on its primary key - a duplicate, not a denial. That is exactly how
    //    the negative control for this function first slipped through.
    const smuggled = randomUUID();
    await expectError(`${label} 4`, () => client.query(
      `insert into works (id, tenant_id, title) values ($1, null, 'Smuggled')`, [smuggled],
    ), '42501');
    const smuggledRows = await admin.query('select count(*)::int n from works where id = $1', [smuggled]);
    check(smuggledRows.rows[0].n === 0, `${label} 4b: a global work was written anyway`);

    // And the tenant's own row is still writable - the fix did not over-restrict.
    await client.query(`insert into works (id, tenant_id, title) values (gen_random_uuid(), $1, 'Own')`, [TENANT_A]);
    checks += 1;
  } finally {
    await client.end().catch(() => {});
    await admin.query('reset app.tenant_id').catch(() => {});
  }
}

async function main() {
  const report = { ref: REF, attacks: {}, catalog: {}, functions: null };
  try {
    await setup();
    await admin.query(await atRef('db/schema.sql'));
    await admin.query("do $$ begin if not exists (select 1 from pg_roles where rolname = 'akademik_app') "
      + 'then create role akademik_app login; end if; end $$');
    await admin.query(`alter role akademik_app password '${appPassword}'`);

    // Production order. 023 is not in it on purpose: it waits on contract 4.4.
    for (const file of ['021-libedge-identity-and-subscriptions.sql', '022-global-catalogue-boundary.sql',
      '024-maintenance-tenants.sql', '025-libedge-tenant-provisioning.sql']) {
      await admin.query(await atRef(`db/migrations/${file}`));
    }

    // 022 creates akademik_catalog as NOLOGIN on purpose; this throwaway database gets a
    // password so the 022 attacks can connect as it, exactly as their own harness does.
    await admin.query(`alter role akademik_catalog login password '${catalogPassword}'`);

    const before = await policySnapshot();
    const rlsBefore = await rlsSnapshot();
    const functionsBefore = await functionSnapshot();
    check(before.length === 50, `expected 50 policies before 026, found ${before.length}`);

    // Negative control: the four 022 attacks against the schema as production runs it today.
    report.attacks.before026 = await run022Attacks({ with026: false });
    await assertFourAttacks({ label: 'before 026', with026: false });

    // 026, measured. Wall clock over the catalog work only, so the number is "how long the
    // policy lock is held", not "how long this script took".
    const started = process.hrtime.bigint();
    await admin.query(await atRef('db/migrations/026-tenant-binding-nullif.sql'));
    report.elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

    const after = await policySnapshot();
    const rlsAfter = await rlsSnapshot();
    const functionsAfter = await functionSnapshot();
    check(JSON.stringify(rlsBefore) === JSON.stringify(rlsAfter),
      '026 changed ENABLE/FORCE ROW LEVEL SECURITY on a table');

    // Shape: the same policies exist, and each kept its command, permissive flag and roles.
    const key = (row) => `${row.tablename}|${row.policyname}`;
    check(JSON.stringify(after.map(key)) === JSON.stringify(before.map(key)),
      '026 changed which policies exist');
    const beforeByKey = new Map(before.map((row) => [key(row), row]));
    const changed = [];
    const unchanged = [];
    for (const row of after) {
      const was = beforeByKey.get(key(row));
      check(was.cmd === row.cmd && was.permissive === row.permissive && was.roles === row.roles,
        `${key(row)}: 026 changed cmd, permissive or roles`);
      (was.qual === row.qual && was.with_check === row.with_check ? unchanged : changed).push({ row, was });
    }
    check(changed.length === 25, `expected 25 rewritten policies, found ${changed.length}`);
    check(unchanged.length === 25, `expected 25 untouched policies, found ${unchanged.length}`);

    // The catalog policies - whose expression says "tenant_id is null", the boundary 022
    // drew - are all untouched, and every policy akademik_catalog is subject to says so.
    const mentionsNull = (row) => /tenant_id is null/i.test(`${row.qual || ''}${row.with_check || ''}`);
    const catalogPolicies = after.filter(mentionsNull);
    const catalogKeys = new Set(catalogPolicies.map(key));
    const untouchedCatalog = unchanged.filter(({ row }) => catalogKeys.has(key(row)));
    check(catalogPolicies.length === 12,
      `expected 12 policies mentioning "tenant_id is null", found ${catalogPolicies.length}`);
    check(untouchedCatalog.length === 6,
      `the six catalog_role policies must be untouched, ${untouchedCatalog.length} were`);
    const catalogRole = after.filter((row) => row.roles.includes('akademik_catalog'));
    check(catalogRole.length === 6, `expected 6 policies for akademik_catalog, found ${catalogRole.length}`);
    for (const row of catalogRole) {
      check(mentionsNull(row), `${key(row)}: a catalog policy no longer says "tenant_id is null"`);
    }
    report.catalog = {
      catalogRolePolicies: catalogRole.map((row) => `${row.tablename}.${row.policyname} (${row.cmd})`),
      mentioningNullTenant: catalogPolicies.map((row) => `${row.tablename}.${row.policyname}`),
      rewrittenAmongThem: changed.filter(({ row }) => catalogKeys.has(key(row)))
        .map(({ row }) => `${row.tablename}.${row.policyname}`),
    };

    // app.tenant_binding() is the only function 026 adds, and only akademik_app may call it.
    report.functions = {
      added: functionsAfter.filter((row) => !functionsBefore.some((was) => was.fn === row.fn))
        .map((row) => `${row.fn} (akademik_app execute:${row.app_execute}, akademik_catalog execute:${row.catalog_execute})`),
      before: functionsBefore.map((row) => `${row.fn} (akademik_app execute:${row.app_execute}, akademik_catalog execute:${row.catalog_execute})`),
    };

    // With 026 applied: the same four attacks, the same file, the same assertions.
    report.attacks.after026 = await run022Attacks({ with026: true });
    // Negative control for this file's own attack checks. `LIBEDGE_EVIDENCE_PROVE=1` drops
    // the collection_items tenant policy first, and the checks below must then FAIL - they do
    // ("1b: the owning tenant lost read"), which is what makes the pass meaningful. A typo
    // that made an attack never run would otherwise look exactly like a denial; this file has
    // already been through one such mistake (attack 4 passing on a primary-key clash).
    if (process.env.LIBEDGE_EVIDENCE_PROVE) {
      console.error('PROVE: dropping collection_items_tenant, the checks below must fail');
      await admin.query('drop policy collection_items_tenant on collection_items');
    }
    await assertFourAttacks({ label: 'after 026', with026: true });

    // Applying it twice is loud and changes nothing.
    const migration = await atRef('db/migrations/026-tenant-binding-nullif.sql');
    const beforeSecond = await policySnapshot();
    await expectError('026 applied twice', () => admin.query(migration), '0A000');
    check(JSON.stringify(await policySnapshot()) === JSON.stringify(beforeSecond),
      'a refused second application still changed the policies');

    // Not an assertion: the table the PR body carries, generated from pg_policies.
    const lines = ['| # | table | policy | cmd | permissive | roles | qual / with_check |', '|---|---|---|---|---|---|---|'];
    after.forEach((row, index) => {
      const was = beforeByKey.get(key(row));
      const cell = (column) => (was[column] === row[column]
        ? `\`${row[column] || '-'}\``
        : `BEFORE \`${was[column] || '-'}\`<br>AFTER \`${row[column] || '-'}\``);
      const withCheck = row.with_check || was.with_check ? `<br>with_check: ${cell('with_check')}` : '';
      lines.push(`| ${index + 1} | \`${row.tablename}\` | \`${row.policyname}\` | ${row.cmd} | ${row.permissive} | ${row.roles} | ${cell('qual')}${withCheck} |`);
    });
    report.table = lines.join('\n');
    report.changedPolicies = changed.map(({ row }) => `${row.tablename}.${row.policyname}`);
  } catch (error) {
    console.error(`\n  FAILED before 026: ${error.message}`);
    if (error.where) console.error(`  where=${error.where}`);
    console.error(`  attacks output: ${JSON.stringify(report.attacks)}`);
    process.exitCode = 1;
  } finally {
    await admin?.end().catch(() => {});
    await stopContainer();
  }
  if (process.exitCode) return;
  report.checks = checks;
  const summary = { ...report, table: undefined };
  console.log(`\n=== EVIDENCE ${JSON.stringify(summary)}`);
  console.log(`\n  026 evidence: ${checks} checks, ${report.changedPolicies?.length} rewritten, `
    + `${50 - (report.changedPolicies?.length || 0)} untouched.`);
  try {
    await writeFile(path.join(repoDir, 'tmp/026-evidence.json'), JSON.stringify(report, null, 2), 'utf8');
    await writeFile(path.join(repoDir, 'tmp/026-policies-table.md'), report.table, 'utf8');
    console.log('  wrote tmp/026-evidence.json and tmp/026-policies-table.md');
  } catch (error) {
    console.log(`  (could not write the report files: ${error.message})`);
  }
}

main();

