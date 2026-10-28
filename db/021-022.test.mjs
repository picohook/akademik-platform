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

// 021 and 022: the schema and the global-catalogue boundary.
//
// The claims this file exists to check are security claims, so they are checked
// by trying to break them rather than by reading the SQL:
//
//   * akademik_app cannot INSERT a row into the global catalogue - it used to be
//     able to, because every policy was USING-only and WITH CHECK inherited it.
//   * akademik_catalog cannot write a staff tenant's row directly, even though
//     its own policy is permissive - the restrictive policy is what stops it.
//   * catalog_publish_work() is the only way across, and it moves exactly one
//     work's rows, leaving annotations and grants alone.
//   * 021/022 move no existing work: the fixture's works are still tenant-owned
//     after both files run.
//
// Run by hand, it starts its own postgres and takes about a minute:
//   node db/021-022.test.mjs

const exec = promisify(execFile);
const dbDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(dbDir, '..');
const appDir = path.join(repoDir, 'spike/app');
// `pg` is a dependency of spike/app, not of db/. Resolve it from there, the way
// db/migrate.mjs and db/019.test.mjs do; a bare 'pg' import from this directory
// resolves to nothing usable and the connection dies mid-script with
// "Connection terminated unexpectedly", which looks like a migration failure and
// is not one.
const pg = createRequire(path.join(appDir, 'package.json'))('pg');

const LIBEDGE = '5799f2a5-3d90-41b1-90de-9da07d776052';
const DEMO = '11111111-1111-1111-1111-111111111111';
const COLLECTION = '88888888-8888-8888-8888-888888888888';
const WORK = 'a0000000-0000-4000-8000-000000000001';
const EDITION = 'b0000000-0000-4000-8000-000000000001';
const ASSET = 'c0000000-0000-4000-8000-000000000001';
const STAFF_USER = '99999999-9999-4999-8999-999999999999';

const container = `libedge-migrations-${randomUUID()}`;
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
// but the entry survives, and repeated runs leave a pile of them. Stop, then
// remove by the exact name this run generated.
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

// Each connection behaves like the real one: a role, a pool, and for the app the
// tenant binding the request handler always sets.
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

// An error from the database is the expected outcome in the negative cases, so
// the SQLSTATE is asserted rather than just "it threw".
async function expectError(label, fn, code) {
  try {
    await fn();
  } catch (error) {
    if (code) check(error.code === code, `${label}: expected SQLSTATE ${code}, got ${error.code}: ${error.message}`);
    else checks += 1;
    return error;
  }
  throw new Error(`${label}: expected a permission error, but the statement succeeded`);
}

async function setup() {
  await docker('version', '--format', '{{.Server.Version}}');
  // A free port, not a fixed one: a leftover container from an interrupted run
  // would otherwise make this connect to the wrong database.
  port = await freePort();
  await docker('run', '--detach', '--rm', '--name', container,
    '--tmpfs', '/var/lib/postgresql/data',
    '--publish', `127.0.0.1:${port}:5432`,
    '--env', 'POSTGRES_USER=mig_admin',
    '--env', 'POSTGRES_DB=mig',
    '--env', `POSTGRES_PASSWORD=${adminPassword}`, 'postgres:16-alpine');

  // Postgres reports ready through a second init phase, so a connection refused
  // early is normal and must be retried. A Client cannot be reused after a failed
  // connect, so each attempt gets its own - reusing one silently leaves `admin`
  // set to a dead client, which is how this test first failed with
  // "Connection terminated unexpectedly" on the very first query.
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

  // schema.sql is the shipped shape, including the permissive USING-only policies
  // this migration is about. Not a hand-built approximation of it.
  await admin.query(await readFile(path.join(repoDir, 'db/schema.sql'), 'utf8'));
  await admin.query(`alter role akademik_app password '${appPassword}'`);

  // The measured EC2 fixture: two tenants, the catalogue under LibEdge, and the
  // demo tenant empty. 13 works, one work given an annotation so we can prove
  // publish does not carry reader data across.
  await admin.query(
    `insert into tenants (id, name, slug) values ($1,'LibEdge','libedge'), ($2,'Demo','demo')`,
    [LIBEDGE, DEMO],
  );
  await admin.query(
    `insert into users (id, tenant_id, email, display_name, role)
     values ($1, $2, 'staff@libedge.com', 'Staff', 'admin')`, [STAFF_USER, LIBEDGE],
  );
  await admin.query(
    `insert into users (id, tenant_id, email, display_name, role)
     values (gen_random_uuid(), $1, 'reader@demo.test', 'Demo Reader', 'reader')`, [DEMO],
  );

  for (let index = 0; index < 13; index += 1) {
    const work = `a0000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
    const edition = `b0000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
    const asset = `c0000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
    await admin.query(`insert into works (id, tenant_id, title, language) values ($1,$2,$3,'tr')`,
      [work, LIBEDGE, `LibEdge title ${index + 1}`]);
    await admin.query(`insert into editions (id, tenant_id, work_id, publisher) values ($1,$2,$3,'LibEdge')`,
      [edition, LIBEDGE, work]);
    await admin.query(`insert into assets (id, tenant_id, edition_id, format, storage_key, page_count) values ($1,$2,$3,'pdf','seed/x.pdf',1)`,
      [asset, LIBEDGE, edition]);
    if (index === 0) {
      await admin.query(`insert into asset_pages (asset_id, tenant_id, page_no, text_content) values ($1,$2,1,'page one')`,
        [asset, LIBEDGE]);
    }
  }
  await admin.query(`insert into collections (id, tenant_id, title, slug) values ($1,$2,'LibEdge Open','open')`,
    [COLLECTION, LIBEDGE]);
  await admin.query(
    `insert into collection_items (collection_id, work_id, position) values ($1,$2,0)`, [COLLECTION, WORK],
  );
  await admin.query(
    `insert into annotations (id, tenant_id, user_id, asset_id, anchor) values (gen_random_uuid(),$1,$2,$3,'{}'::jsonb)`,
    [LIBEDGE, STAFF_USER, ASSET],
  );
  await admin.query(
    `insert into grants (id, tenant_id, subject_type, subject_id, scope_type, status)
     values (gen_random_uuid(),$1,'tenant',$1,'all','active')`, [LIBEDGE],
  );
}

async function applyMigrations() {
  for (const file of ['021-libedge-identity-and-subscriptions.sql', '022-global-catalogue-boundary.sql']) {
    await admin.query(await readFile(path.join(dbDir, 'migrations', file), 'utf8'));
  }
}
async function main() {
  await setup();
  const before = await admin.query('select count(*)::int n from works where tenant_id is not null');
  check(before.rows[0].n === 13, `fixture should have 13 tenant-owned works, has ${before.rows[0].n}`);

  // --- 021/022 must move no data -------------------------------------------------
  await applyMigrations();
  const after = await admin.query(
    'select count(*)::int total, count(*) filter (where tenant_id is not null)::int owned from works',
  );
  check(after.rows[0].total === 13 && after.rows[0].owned === 13,
    `migrations 021/022 moved works: total ${after.rows[0].total}, tenant-owned ${after.rows[0].owned} (expected 13/13)`);

  // The backfill ran: a collection_items row now carries its collection's tenant,
  // which the column never had before.
  const items = await admin.query('select tenant_id from collection_items where collection_id = $1', [COLLECTION]);
  check(items.rows[0].tenant_id === LIBEDGE,
    `collection_items.tenant_id not backfilled: ${JSON.stringify(items.rows[0].tenant_id)}`);

  // The staff tenant is what publish keys on (contract 3.2).
  await admin.query("update tenants set libedge_kind = 'staff', libedge_ref = 'libedge' where id = $1", [LIBEDGE]);
  await admin.query("update tenants set libedge_kind = 'individual', libedge_ref = 'b2c' where id = $1", [DEMO]);

  const app = await connect('akademik_app', appPassword);
  await admin.query(`alter role akademik_catalog login password '${catalogPassword}'`);
  const catalog = await connect('akademik_catalog', catalogPassword);

  try {
    // --- akademik_app cannot write the global catalogue --------------------------
    // The latent hole 022 closes: the app's policies are USING-only, so a global
    // INSERT used to be permitted. WITH CHECK now comes from USING, which is false
    // for a NULL tenant_id while app.tenant_id is bound.
    await asTenant(app, LIBEDGE, async () => {
      await expectError('app inserts a global work', () => app.query(
        `insert into works (id, tenant_id, title, language) values (gen_random_uuid(), null, 'Smuggled', 'tr')`,
      ), '42501');
      // The app can still write its own tenant's rows - nothing was over-restricted.
      await app.query(
        `insert into works (id, tenant_id, title, language) values (gen_random_uuid(), $1, 'Own work', 'tr')`,
        [LIBEDGE],
      );
      checks += 1;
    });

    // --- akademik_catalog cannot write a tenant row directly ---------------------
    // Permissive-only would have allowed this: the app's policy still applies to the
    // catalog role and permissive policies are ORed. The restrictive one denies it.
    await asTenant(catalog, LIBEDGE, async () => {
      await expectError('catalog writes a staff work directly', () => catalog.query(
        `update works set title = 'Catalog edited this' where id = $1`, [WORK],
      ), '42501');
      checks += 1;
    });

    // --- catalog_publish_work is the only way across ------------------------------
    const beforePublish = await admin.query('select count(*)::int as n from works where tenant_id = $1', [LIBEDGE]);
    const tenantOwnedBeforePublish = Number(beforePublish.rows[0].n);
    await asTenant(catalog, LIBEDGE, async () => {
      await catalog.query('select catalog_publish_work($1)', [WORK]);
      checks += 1;
    });

    const published = await admin.query(
      `select w.tenant_id as work_tenant, e.tenant_id as edition_tenant, a.tenant_id as asset_tenant,
              p.tenant_id as page_tenant
         from works w
         join editions e on e.work_id = w.id
         join assets a on a.edition_id = e.id
         left join asset_pages p on p.asset_id = a.id
        where w.id = $1`, [WORK],
    );
    const row = published.rows[0];
    check(row.work_tenant === null && row.edition_tenant === null && row.asset_tenant === null,
      `publish left a tenant id behind: ${JSON.stringify(row)}`);
    check(row.page_tenant === null, `asset_pages not moved: ${JSON.stringify(row.page_tenant)}`);

    // Reader data does not travel with the title.
    const notes = await admin.query('select tenant_id from annotations where asset_id = $1', [ASSET]);
    check(notes.rows[0].tenant_id === LIBEDGE,
      'publish moved the annotation to the global catalogue; reader notes must not follow a title');

    // publish must move exactly one work. The baseline is measured, not assumed:
    // the app-role check above inserted a work of its own into LIBEDGE, so the
    // count is not 13 by the time this runs.
    const remaining = await admin.query('select count(*)::int as n from works where tenant_id = $1', [LIBEDGE]);
    const tenantOwnedAfterPublish = Number(remaining.rows[0].n);
    check(tenantOwnedBeforePublish - tenantOwnedAfterPublish === 1,
      `publish moved ${tenantOwnedBeforePublish - tenantOwnedAfterPublish} works, expected exactly 1`);

    // Republishing raises instead of silently succeeding.
    await asTenant(catalog, LIBEDGE, async () => {
      await expectError('publish twice', () => catalog.query('select catalog_publish_work($1)', [WORK]), 'P0001');
      checks += 1;
    });

    // A work that is not in the staff tenant is refused.
    const demoWork = randomUUID();
    await admin.query(`insert into works (id, tenant_id, title, language) values ($1,$2,'Demo work','tr')`,
      [demoWork, DEMO]);
    await asTenant(catalog, DEMO, async () => {
      await expectError('publish a demo work', () => catalog.query('select catalog_publish_work($1)', [demoWork]), 'P0001');
      checks += 1;
    });

    // --- the app still reads the global catalogue ---------------------------------
    const readable = await asTenant(app, DEMO, () => app.query(
      'select count(*)::int n from works where id = $1', [WORK],
    ));
    check(readable.rows[0].n === 1, 'the published work is not readable from another tenant');

    console.log(`\n  021/022: ${checks} checks passed.`);
  } finally {
    await app.end().catch(() => {});
    await catalog.end().catch(() => {});
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


