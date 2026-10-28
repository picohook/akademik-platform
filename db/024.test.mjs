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

// 024: app.maintenance_tenants(), the list a timer sweeps.
//
// The claim is not "the function exists". It is "a timer that calls it covers every
// tenant". So the fixture is built to break the alternative: three tenants, and the
// app connection binds NONE of them - which is exactly the state a timer runs in,
// because no request is in flight. If the list were `select id from tenants` the
// app would get zero rows here (tenants_self compares id to a NULL setting), and
// with a tenant bound it would get exactly one - the bound one, not its own.
//
// Checked:
//   * the plain query returns 0 rows for an unbound app role and 1 when one tenant
//     is bound, so the measurement below is about the function and not about a
//     fixture that happens to be single-tenant;
//   * the function returns every id, in a stable order, to the app role, and the
//     same list while a tenant is bound;
//   * it returns an id column named tenant_id, because server.mjs reads that;
//   * it exposes nothing but ids - no name, no slug, no status;
//   * the catalog role cannot execute it;
//   * a tenant inserted after the migration is picked up, so the list is read at
//     call time rather than captured once.
//
// Run by hand, it starts its own postgres and takes a few seconds:
//   node db/024.test.mjs

const exec = promisify(execFile);
const dbDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(dbDir, '..');
const appDir = path.join(repoDir, 'spike/app');
// `pg` is a dependency of spike/app, not of db/. Resolve it from there, the way
// db/migrate.mjs and db/019.test.mjs do; a bare 'pg' import from this directory
// resolves to nothing usable and the connection dies mid-script with "Connection
// terminated unexpectedly", which looks like a migration failure and is not one.
const pg = createRequire(path.join(appDir, 'package.json'))('pg');

const LIBEDGE = '5799f2a5-3d90-41b1-90de-9da07d776052';
const DEMO = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const LATER = '33333333-3333-4333-8333-333333333333';
// Sorted by uuid, the three inserted tenants are DEMO < OTHER < LIBEDGE - not the
// order they are inserted in, so a function returning insertion order would fail
// here. Written out rather than computed so the expectation is readable.
const EXPECTED = [DEMO, OTHER, LIBEDGE];

const container = `libedge-maintenance-${randomUUID()}`;
const adminPassword = randomBytes(18).toString('hex');
const appPassword = randomBytes(18).toString('hex');
const catalogPassword = randomBytes(18).toString('hex');
let port;
let admin;
let checks = 0;

const check = (condition, message) => { assert.ok(condition, message); checks += 1; };

async function docker(...args) {
  return (await exec('docker', args, { timeout: 90_000, maxBuffer: 1024 * 1024 })).stdout.trim();
}


// `--rm` is not reliable on Docker Desktop for Windows: the container is stopped
// but the entry survives. Stop, then remove by the exact name this run generated.
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

async function connect(role, password) {
  const client = new pg.Client({
    connectionString: `postgres://${role}:${password}@127.0.0.1:${port}/mig`,
  });
  await client.connect();
  return client;
}

async function asTenant(client, tenantId, fn) {
  await client.query("select set_config('app.tenant_id', $1, false)", [tenantId]);
  return fn();
}

// All ids the function returns, as strings, whatever the column shape.
async function listTenants(client) {
  const { rows } = await client.query('select tenant_id from app.maintenance_tenants()');
  return rows.map((row) => row.tenant_id);
}

// An error is the expected outcome in the negative cases, so the SQLSTATE is
// asserted rather than just "it threw".
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
  port = await freePort();
  await docker('run', '--detach', '--rm', '--name', container,
    '--tmpfs', '/var/lib/postgresql/data',
    '--publish', `127.0.0.1:${port}:5432`,
    '--env', 'POSTGRES_USER=mig_admin',
    '--env', 'POSTGRES_DB=mig',
    '--env', `POSTGRES_PASSWORD=${adminPassword}`, 'postgres:16-alpine');

  // Postgres reports ready through a second init phase, so a connection refused
  // early is normal and must be retried with a fresh Client each time.
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

  // The shipped schema, so the policy under test is the real one and not a
  // hand-built approximation. It includes tenants_self and the akademik_app role.
  await admin.query(await readFile(path.join(repoDir, 'db/schema.sql'), 'utf8'));
  await admin.query(`alter role akademik_app password '${appPassword}'`);

  // Tenants are inserted by the owner before the migration runs: the migration must
  // find them without being told which ones to expect.
  await admin.query(
    `insert into tenants (id, name, slug) values ($1,'LibEdge','libedge'), ($2,'Demo','demo'), ($3,'Other','other')`,
    [LIBEDGE, DEMO, OTHER],
  );
}

async function applyMigrations() {
  // 021 and 022 first: 024 names the catalog role, and a test that ran against a
  // schema thinner than production would prove less than it claims.
  for (const file of [
    '021-libedge-identity-and-subscriptions.sql',
    '022-global-catalogue-boundary.sql',
    '024-maintenance-tenants.sql',
  ]) {
    await admin.query(await readFile(path.join(dbDir, 'migrations', file), 'utf8'));
  }
}

async function main() {
  await setup();

  const app = await connect('akademik_app', appPassword);
  let catalog;
  try {
    // --- before the migration: the plain query is the bug -----------------------
    // Measured first, and on the real role. If this returned three rows the rest of
    // this file would prove nothing: the function would be unnecessary and the
    // sweeper could have used the query all along.
    const unbound = await app.query('select id from tenants');
    check(unbound.rowCount === 0,
      `the plain query returned ${unbound.rowCount} rows for an unbound app role; tenant isolation is not what this test assumes`);
    const bound = await asTenant(app, DEMO, () => app.query('select id from tenants'));
    check(bound.rowCount === 1 && bound.rows[0].id === DEMO,
      `the plain query did not reduce to the bound tenant (${JSON.stringify(bound.rows)})`);
    // `reset`, not set_config(''): leaves the setting unset, which is the state a
    // fresh pooled connection is in. set_config('') leaves '' behind, and ''::uuid
    // raises 22P02 on the next policy check - unrelated to what is being measured.
    await app.query('reset app.tenant_id');

    // And the function is genuinely absent, so the fallback in server.mjs is the
    // situation an image without 024 is in. The code is 3F000, not 42883: Postgres
    // resolves the schema before the function, and the `app` schema does not exist
    // until this migration creates it.
    await expectError('maintenance_tenants before 024', () => app.query('select * from app.maintenance_tenants()'), '3F000');

    await applyMigrations();

    // Only now does the role exist: 022 creates it.
    await admin.query(`alter role akademik_catalog login password '${catalogPassword}'`);
    catalog = await connect('akademik_catalog', catalogPassword);

    // --- every tenant, to the role that needs it --------------------------------
    const listed = await app.query('select tenant_id from app.maintenance_tenants()');
    // Every comparison is on the returned ids, not on rowCount: a function that
    // returns one NULL row, or a junction with a NULL id, must not pass by looking
    // like it returned something.
    const ids = await listTenants(app);
    check(ids.length === 3 && ids.every(Boolean),
      `app role saw ${ids.length} ids (${JSON.stringify(ids)}), expected 3 non-null ids`);
    check(JSON.stringify(ids) === JSON.stringify(EXPECTED),
      `unexpected tenant list or order: ${JSON.stringify(ids)} vs ${JSON.stringify(EXPECTED)}`);
    check(ids.includes(LIBEDGE) && ids.includes(DEMO) && ids.includes(OTHER),
      `the list is missing a tenant: ${JSON.stringify(ids)}`);

    // The column name is part of the contract: server.mjs maps row.tenant_id.
    check(listed.fields.some((field) => field.name === 'tenant_id'),
      `no tenant_id column in ${JSON.stringify(listed.fields.map((field) => field.name))}`);
    // Ids only. A name or slug here would be a data leak dressed as a list.
    check(listed.fields.length === 1,
      `the function exposes ${listed.fields.length} columns (${listed.fields.map((f) => f.name).join(', ')}); expected tenant_id only`);

    // The same answer while a tenant is bound. A function that narrowed to
    // app.tenant_id would pass an unbound-only test and still sweep one tenant -
    // which is the bug this file exists for, so it is measured separately.
    const boundList = await asTenant(app, DEMO, () => listTenants(app));
    check(JSON.stringify(boundList) === JSON.stringify(EXPECTED),
      `with tenant ${DEMO} bound the list became ${JSON.stringify(boundList)}; the sweep must not depend on which tenant is bound`);
    await app.query('reset app.tenant_id');

    // --- read at call time, not captured at apply time --------------------------
    await admin.query(`insert into tenants (id, name, slug) values ($1,'Later','later')`, [LATER]);
    const afterInsert = await listTenants(app);
    check(afterInsert.length === 4, `a tenant added after 024 was not listed (${JSON.stringify(afterInsert)})`);
    check(afterInsert.includes(LATER), 'the new tenant is missing from the list');

    // The catalog role is not granted EXECUTE - and that refusal is itself the
    // narrowness check: the only role that may call this is the app.
    await expectError('catalog executes maintenance_tenants', () => catalog.query('select * from app.maintenance_tenants()'), '42501');

    // And the owner sees the same list. `tenants` is FORCEd for the owner too, so
    // this is the second half of the SECURITY DEFINER check: the function must not
    // depend on a role that bypasses RLS. It passes here because of `set local
    // row_security = off`, which the owner may do and akademik_app may not.
    const ownerList = await listTenants(admin);
    check(JSON.stringify(ownerList) === JSON.stringify([...EXPECTED, LATER].sort()),
      `the owner sees ${JSON.stringify(ownerList)}; the function must return the same list for every role`);

    // --- the timer reads exactly this -------------------------------------------
    // Not the HTTP path (that is test:social-drm), but the query server.mjs issues,
    // so a rename on either side fails here rather than in a sweep nobody watches.
    const source = await readFile(path.join(appDir, 'server.mjs'), 'utf8');
    check(source.includes('select tenant_id from app.maintenance_tenants()'),
      'server.mjs no longer issues the query this file grants; the sweep would fall back to the env tenant');
    // The fallback must tolerate the codes the two states actually produce: 3F000
    // before this file runs (measured above), 42883 after the schema exists but
    // before the function, 42501 when EXECUTE is missing. A fallback that only knew
    // 42883 threw on every timer tick of the database that exists today.
    for (const code of ['3F000', '42883', '42501']) {
      check(new RegExp(`error\\.code === '${code}'`).test(source),
        `server.mjs no longer catches ${code}; the sweep would throw instead of falling back to the env tenant`);
    }

    console.log(`\n  024: ${checks} checks, app role swept ${afterInsert.length} tenants with no tenant bound.`);
  } finally {
    await app.end().catch(() => {});
    await catalog?.end().catch(() => {});
  }
}

main()
  .then(async () => {
    await admin?.end().catch(() => {});
    await stopContainer();
  })
  .catch(async (error) => {
    console.error(`\n  FAILED: ${error.message}`);
    await admin?.end().catch(() => {});
    await stopContainer();
    process.exitCode = 1;
  });
