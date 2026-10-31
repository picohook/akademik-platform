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

const exec = promisify(execFile);
const dbDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(dbDir, '..');
const pg = createRequire(path.join(repoDir, 'spike/app/package.json'))('pg');

const STAFF = '5799f2a5-3d90-41b1-90de-9da07d776052';
const OTHER = '22222222-2222-4222-8222-222222222222';
const DEMO = '11111111-1111-1111-1111-111111111111';
const OA_COLLECTION = '74149e93-39dd-50ba-b120-a75415d9b0ca';
const DEMO_COLLECTION = '66666666-6666-6666-6666-666666666666';
const DEMO_WORK = '33333333-3333-3333-3333-333333333333';
const INDIVIDUAL = 'b2c00000-0000-4000-8000-000000000001';
const WORKS = [
  '0de0fa03-a7ba-5500-87a2-c5010ec90c8f',
  'ade89757-a148-5875-90b5-3f7f88e3e39b',
  'ccfbdb6f-631c-51a5-bd04-c6f4657ee438',
  'b778e968-77cc-5400-bd90-3adc0de7a4bb',
  '5a60cea2-1fa1-5b53-9184-f6a2497e4aff',
  '1a599a2b-51c8-5a2e-91cf-9d3ce76684f2',
  '7253cf24-606a-5fa2-8da1-2b565574d7f6',
  '0e2bade7-25e3-519f-82e7-e807d84d2b11',
  'f4797188-83fd-5737-8185-fb957cfaf77c',
  '583e6756-d3b0-52e7-8017-07f85fa5f0f5',
  'c94c49ac-6c24-40eb-8f3d-2dd88774ba54',
  '63c7ec83-e77c-5dde-b805-14c0840d6cb2',
];

const container = `libedge-023-${randomUUID()}`;
const adminPassword = randomBytes(18).toString('hex');
const appPassword = randomBytes(18).toString('hex');
let port;
let admin;

async function docker(...args) {
  return (await exec('docker', args, { timeout: 90_000, maxBuffer: 1024 * 1024 })).stdout.trim();
}
async function freePort() {
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const value = socket.address().port;
  await new Promise((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  return value;
}
async function connect(role, password) {
  const client = new pg.Client({ connectionString: `postgres://${role}:${password}@127.0.0.1:${port}/mig` });
  await client.connect();
  return client;
}
async function asTenant(client, tenantId, fn) {
  await client.query("select set_config('app.tenant_id', $1, false)", [tenantId]);
  return fn();
}
async function expectError(fn, code) {
  try {
    await fn();
  } catch (error) {
    assert.equal(error.code, code, `expected SQLSTATE ${code}, got ${error.code}: ${error.message}`);
    return;
  }
  throw new Error('expected an error');
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
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  if (!admin) throw new Error(`postgres not reachable: ${lastError?.message}`);

  await admin.query(await readFile(path.join(repoDir, 'db/schema.sql'), 'utf8'));
  await admin.query(`alter role akademik_app password '${appPassword}'`);
  await admin.query(await readFile(path.join(dbDir, 'migrations/021-libedge-identity-and-subscriptions.sql'), 'utf8'));
  await admin.query(await readFile(path.join(dbDir, 'migrations/022-global-catalogue-boundary.sql'), 'utf8'));

  await admin.query(
    `insert into tenants (id, name, slug) values
      ($1,'LibEdge','libedge'), ($2,'Demo','demo'), ($3,'Other','other')`,
    [STAFF, DEMO, OTHER],
  );
  await admin.query(
    `insert into users (id, tenant_id, email, display_name, role)
     values ('99999999-9999-4999-8999-999999999999',$1,'staff@libedge.test','Staff','admin')`,
    [STAFF],
  );
  await admin.query(
    `insert into collections (id, tenant_id, title, slug, description)
     values ($1,$2,'LibEdge Open Academic Collection','libedge-open-academic','OA')`,
    [OA_COLLECTION, STAFF],
  );
  await admin.query(
    `insert into collections (id, tenant_id, title, slug) values ($1,$2,'Demo','demo')`,
    [DEMO_COLLECTION, STAFF],
  );
  await admin.query(
    `insert into works (id, tenant_id, title, language) values ($1,$2,'Demo PDF','en')`,
    [DEMO_WORK, STAFF],
  );
  await admin.query(
    `insert into works (id, tenant_id, title, language) values ($1,$2,'Other private work','en')`,
    ['a0000000-0000-4000-8000-0000000000aa', OTHER],
  );
  await admin.query(`insert into collection_items (collection_id, work_id, position) values ($1,$2,0)`, [DEMO_COLLECTION, DEMO_WORK]);

  for (const [index, work] of WORKS.entries()) {
    const edition = `b0000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
    const asset = `c0000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
    await admin.query(`insert into works (id, tenant_id, title, language) values ($1,$2,$3,'en')`,
      [work, STAFF, `OA Article ${index + 1}`]);
    await admin.query(`insert into editions (id, tenant_id, work_id, publisher) values ($1,$2,$3,'OA Publisher')`,
      [edition, STAFF, work]);
    await admin.query(`insert into assets (id, tenant_id, edition_id, format, storage_key, page_count) values ($1,$2,$3,'pdf','oa/book.pdf',1)`,
      [asset, STAFF, edition]);
    await admin.query(`insert into collection_items (collection_id, work_id, position) values ($1,$2,$3)`,
      [OA_COLLECTION, work, index + 1]);
  }

  await admin.query(
    `insert into annotations (id, tenant_id, user_id, asset_id, anchor)
     values (gen_random_uuid(),$1,'99999999-9999-4999-8999-999999999999',$2,'{}'::jsonb)`,
    [STAFF, 'c0000000-0000-4000-8000-000000000001'],
  );
}

async function apply023() {
  await admin.query(await readFile(path.join(dbDir, 'migrations/023-oa-global-catalog.sql'), 'utf8'));
}

async function main() {
  await setup();
  try {
    await admin.query('begin');
    await apply023();

    const tenants = await admin.query(`select id, libedge_kind, libedge_ref, status from tenants order by id`);
    const staff = tenants.rows.find(row => row.id === STAFF);
    const individual = tenants.rows.find(row => row.id === INDIVIDUAL);
    assert.deepEqual(staff, { id: STAFF, libedge_kind: 'staff', libedge_ref: 'libedge', status: 'active' });
    assert.deepEqual(individual, { id: INDIVIDUAL, libedge_kind: 'individual', libedge_ref: 'b2c', status: 'active' });
    assert.equal(tenants.rows.filter(row => row.libedge_kind === 'staff').length, 1);
    assert.equal(tenants.rows.filter(row => row.libedge_kind === 'individual').length, 1);

    const global = await admin.query(`select id from works where tenant_id is null order by id`);
    assert.deepEqual(global.rows.map(row => row.id), [...WORKS].sort());
    const demo = await admin.query(`select tenant_id from works where id = $1`, [DEMO_WORK]);
    assert.equal(demo.rows[0].tenant_id, STAFF);
    const outside = await admin.query(`select tenant_id from works where id = $1`, ['a0000000-0000-4000-8000-0000000000aa']);
    assert.equal(outside.rows[0].tenant_id, OTHER);

    const collection = await admin.query(`select tenant_id from collections where id = $1`, [OA_COLLECTION]);
    assert.equal(collection.rows[0].tenant_id, null);
    const items = await admin.query(`select count(*)::int as n from collection_items where collection_id = $1 and tenant_id is null`, [OA_COLLECTION]);
    assert.equal(items.rows[0].n, 12);
    const demoCollection = await admin.query(`select tenant_id from collections where id = $1`, [DEMO_COLLECTION]);
    assert.equal(demoCollection.rows[0].tenant_id, STAFF);

    const grant = await admin.query(`select tenant_id, subject_type, subject_id, scope_type, scope_id, status from grants where tenant_id = $1`, [INDIVIDUAL]);
    assert.equal(grant.rows.length, 1);
    assert.deepEqual(grant.rows[0], {
      tenant_id: INDIVIDUAL, subject_type: 'tenant', subject_id: INDIVIDUAL,
      scope_type: 'collection', scope_id: OA_COLLECTION, status: 'active',
    });
    const allGrant = await admin.query(`select 1 from grants where tenant_id = $1 and scope_type = 'all'`, [INDIVIDUAL]);
    assert.equal(allGrant.rows.length, 0);

    const annotations = await admin.query(`select count(*)::int as n from annotations where tenant_id = $1`, [STAFF]);
    assert.equal(annotations.rows[0].n, 1);
    const assets = await admin.query(`select count(*)::int as n from assets where tenant_id is null`);
    assert.equal(assets.rows[0].n, 12);
    const editions = await admin.query(`select count(*)::int as n from editions where tenant_id is null`);
    assert.equal(editions.rows[0].n, 12);

    await admin.query('set local row_security = on');
    await admin.query('set local role akademik_app');
    await asTenant(admin, INDIVIDUAL, async () => {
      const visible = await admin.query(`select count(*)::int as n from works where tenant_id is null`);
      assert.equal(visible.rows[0].n, 12);
      const readableAssets = await admin.query(`select count(*)::int as n from assets where tenant_id is null`);
      assert.equal(readableAssets.rows[0].n, 12);
      const demoVisible = await admin.query(`select 1 from works where id = $1`, [DEMO_WORK]);
      assert.equal(demoVisible.rows.length, 0);
      const outsideVisible = await admin.query(`select 1 from works where id = $1`, ['a0000000-0000-4000-8000-0000000000aa']);
      assert.equal(outsideVisible.rows.length, 0);
      await admin.query('savepoint app_write_guard');
      await expectError(() => admin.query(
        `insert into works (id, tenant_id, title, language) values (gen_random_uuid(), null, 'forbidden', 'en')`,
      ), '42501');
      await admin.query('rollback to savepoint app_write_guard');
    });
    await admin.query('reset role');

    await admin.query('rollback');

    // A wrong ownership must stop before any mutation.
    await admin.query('begin');
    await admin.query(`update works set tenant_id = $1 where id = $2`, [OTHER, WORKS[0]]);
    await admin.query('savepoint bad_owner');
    await expectError(apply023, 'P0001');
    await admin.query('rollback to savepoint bad_owner');
    const noIndividual = await admin.query(`select 1 from tenants where id = $1`, [INDIVIDUAL]);
    assert.equal(noIndividual.rows.length, 0);
    await admin.query('rollback');

    // A missing collection member must stop before any mutation.
    await admin.query('begin');
    await admin.query(`delete from collection_items where collection_id = $1 and work_id = $2`, [OA_COLLECTION, WORKS[11]]);
    await admin.query('savepoint missing_member');
    await expectError(apply023, 'P0001');
    await admin.query('rollback to savepoint missing_member');
    const noIndividualAfterMissing = await admin.query(`select 1 from tenants where id = $1`, [INDIVIDUAL]);
    assert.equal(noIndividualAfterMissing.rows.length, 0);
    const noGrantAfterMissing = await admin.query(`select 1 from grants where tenant_id = $1`, [INDIVIDUAL]);
    assert.equal(noGrantAfterMissing.rows.length, 0);
    await admin.query('rollback');

    console.log(JSON.stringify({ passed: true, globalWorks: 12, collectionItems: 12, individualGrant: 1, demoClosed: true, outsideClosed: true }));
  } finally {
    await admin.end().catch(() => {});
    await docker('stop', container).catch(() => {});
    await docker('rm', '--force', container).catch(() => {});
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });



