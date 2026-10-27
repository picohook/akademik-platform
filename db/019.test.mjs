import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, readFile, rm } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';

// 019 repairs one grants row whose subject_id disagrees with its tenant_id.
//
// The row is what production actually holds - tenant 5799f2a5-... (LibEdge,
// where the works are) with subject_id 11111111-... (the Demo tenant, which has
// no users) - so no user matches it and, under fail-closed, the admin sees an
// empty catalogue. The migration must fix that row and nothing else.
//
// Run by hand; it starts its own postgres and takes about a minute:
//   node db/019.test.mjs
//
// It is deliberately not part of the access suite: that suite builds its
// fixture by inserting the broken grant itself, and must keep doing so to prove
// fail-closed denies an ungranted reader.

const exec = promisify(execFile);
const dbDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(dbDir, '..');
const appDir = path.join(repoDir, 'spike/app');
const pg = createRequire(path.join(appDir, 'package.json'))('pg');

const LIBEDGE = '5799f2a5-3d90-41b1-90de-9da07d776052';
const DEMO = '11111111-1111-1111-1111-111111111111';
const COLLECTION = '88888888-8888-8888-8888-888888888888';
const SEED_GRANT = '77777777-7777-7777-7777-777777777777';
const OTHER_GRANT = '66666666-6666-6666-6666-666666666666';
const USER_GRANT = '55555555-5555-5555-5555-555555555555';
const WORK = 'a0000000-0000-4000-8000-000000000001';
const EDITION = 'b0000000-0000-4000-8000-000000000001';
const ASSET = 'c0000000-0000-4000-8000-000000000001';
const ADMIN_USER = '99999999-9999-4999-8999-999999999999';

const container = `grant-repair-${randomUUID()}`;
const password = randomBytes(18).toString('hex');
const appPassword = randomBytes(18).toString('hex');
let port;
let client;

async function docker(...args) {
  return (await exec('docker', args, { timeout: 90_000, maxBuffer: 1024 * 1024 })).stdout.trim();
}

async function freePort() {
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const value = socket.address().port;
  await new Promise((resolve, reject) => socket.close((error) => (error ? reject(error) : resolve())));
  return value;
}

async function runMigration() {
  await client.query(migrationSql());
}

let cachedSql;
function migrationSql() {
  return cachedSql;
}

async function grantRows() {
  const { rows } = await client.query(
    'select id, tenant_id, subject_type, subject_id, status from grants order by id',
  );
  return rows;
}

// Everything a grant needs to be meaningful: two tenants, the admin under
// LibEdge, one work with edition and asset, one collection.
async function seedShape() {
  await client.query(`drop schema public cascade; create schema public`);
  await client.query(await readFile(path.join(dbDir, 'schema.sql'), 'utf8'));
  await client.query(
    `insert into tenants (id, name, slug) values ($1, 'LibEdge', 'libedge'), ($2, 'Demo', 'demo')`,
    [LIBEDGE, DEMO],
  );
  await client.query(
    `insert into users (id, tenant_id, email, display_name, role, password_hash)
     values ($1, $2, 'admin@libedge.com', 'Admin', 'admin', 'x')`,
    [ADMIN_USER, LIBEDGE],
  );
  await client.query(
    `insert into works (id, tenant_id, title) values ($1, $2, 'One work')`,
    [WORK, LIBEDGE],
  );
  await client.query(
    `insert into editions (id, tenant_id, work_id) values ($1, $2, $3)`,
    [EDITION, LIBEDGE, WORK],
  );
  await client.query(
    `insert into assets (id, tenant_id, edition_id, format, storage_key)
     values ($1, $2, $3, 'pdf', 'works/one.pdf')`,
    [ASSET, LIBEDGE, EDITION],
  );
  await client.query(
    `insert into collections (id, tenant_id, title, slug) values ($1, $2, 'LibEdge collection', 'libedge')`,
    [COLLECTION, LIBEDGE],
  );
}

async function grantAllowsForAdmin() {
  // The same question grantAllows asks: is there an active tenant-level grant
  // for this user's own tenant whose scope reaches the work's collection?
  const { rows } = await client.query(
    `select count(*)::int as n
       from grants g
      where g.tenant_id = $1
        and g.status = 'active'
        and g.subject_type = 'tenant'
        and g.subject_id = $1
        and (g.scope_type = 'all' or (g.scope_type = 'collection' and g.scope_id = $2))`,
    [LIBEDGE, COLLECTION],
  );
  return rows[0].n > 0;
}

let failures = 0;
async function scenario(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}\n  ${error.message}`);
  }
}

async function main() {
  cachedSql = await readFile(path.join(dbDir, 'migrations/019-repair-seed-grant-subject.sql'), 'utf8');
  port = await freePort();
  await docker(
    'run', '-d', '--name', container,
    '-e', `POSTGRES_PASSWORD=${password}`,
    '-e', 'POSTGRES_DB=grant_test',
    '-p', `127.0.0.1:${port}:5432`,
    'postgres:16-alpine',
  );
  const url = `postgres://postgres:${password}@127.0.0.1:${port}/grant_test`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      client = new pg.Client({ connectionString: url });
      await client.connect();
      break;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  await scenario('the broken row is repaired and the admin can see the catalogue', async () => {
    await seedShape();
    await client.query(
      `insert into grants (id, tenant_id, subject_type, subject_id, scope_type, scope_id, status)
       values ($1, $2, 'tenant', $3, 'collection', $4, 'active')`,
      [SEED_GRANT, LIBEDGE, DEMO, COLLECTION],
    );

    assert.equal(await grantAllowsForAdmin(), false, 'the broken grant must not grant anything yet');

    await runMigration();

    const [row] = await grantRows();
    assert.equal(row.subject_id, LIBEDGE, 'subject_id should now be the tenant the grant belongs to');
    assert.equal(await grantAllowsForAdmin(), true, 'the admin should see the catalogue after the repair');
  });

  await scenario('a grant that is already correct is left alone', async () => {
    await seedShape();
    await client.query(
      `insert into grants (id, tenant_id, subject_type, subject_id, scope_type, scope_id, status)
       values ($1, $2, 'tenant', $2, 'collection', $3, 'active')`,
      [SEED_GRANT, LIBEDGE, COLLECTION],
    );

    await runMigration();
    const [row] = await grantRows();
    assert.equal(row.subject_id, LIBEDGE);
  });

  await scenario('the migration is safe to run twice', async () => {
    await seedShape();
    await client.query(
      `insert into grants (id, tenant_id, subject_type, subject_id, scope_type, scope_id, status)
       values ($1, $2, 'tenant', $3, 'collection', $4, 'active')`,
      [SEED_GRANT, LIBEDGE, DEMO, COLLECTION],
    );

    await runMigration();
    const before = await grantRows();
    await runMigration();
    const after = await grantRows();
    assert.deepEqual(after, before, 'a second run must change nothing');
    assert.equal(after.length, 1);
  });

  await scenario('a user-level grant on the demo tenant is not touched', async () => {
    // The condition has to be narrow: another tenant's grant rows, and grants
    // whose subject is a real user, must survive unchanged.
    await seedShape();
    await client.query(
      `insert into grants (id, tenant_id, subject_type, subject_id, scope_type, scope_id, status)
       values ($1, $2, 'tenant', $3, 'collection', $4, 'active'),
              ($5, $3, 'tenant', $3, 'collection', $4, 'active'),
              ($6, $2, 'user', $7, 'all', null, 'active')`,
      [SEED_GRANT, LIBEDGE, DEMO, COLLECTION, OTHER_GRANT, USER_GRANT, ADMIN_USER],
    );

    await runMigration();

    const byId = new Map((await grantRows()).map((row) => [row.id, row]));
    assert.equal(byId.get(SEED_GRANT).subject_id, LIBEDGE, 'the broken LibEdge grant is repaired');
    assert.equal(byId.get(OTHER_GRANT).subject_id, DEMO, "the Demo tenant's own grant is left alone");
    assert.equal(byId.get(USER_GRANT).subject_id, ADMIN_USER, 'a user grant keeps its subject');
    assert.equal(byId.get(USER_GRANT).subject_type, 'user');
  });

  await scenario('a database with no broken row is unchanged and the run succeeds', async () => {
    await seedShape();
    await runMigration();
    assert.deepEqual(await grantRows(), [], 'no grants is a valid state, not an error');
  });

  await scenario('run as the app role, it refuses instead of silently matching nothing', async () => {
    // FORCE RLS filters the app role, so the UPDATE would report success having
    // changed zero rows. What stops that is Postgres itself, not a check in the
    // file: `set local row_security = off` is validated against the caller and
    // `akademik_app` is not allowed to lift FORCE RLS, so the statement is
    // rejected before the update is ever reached.
    await seedShape();
    await client.query(
      `insert into grants (id, tenant_id, subject_type, subject_id, scope_type, scope_id, status)
       values ($1, $2, 'tenant', $3, 'collection', $4, 'active')`,
      [SEED_GRANT, LIBEDGE, DEMO, COLLECTION],
    );
    await client.query(`alter role akademik_app password '${appPassword}'`);
    const { rows: [col] } = await client.query(
      `select id from collections where id = $1`, [COLLECTION],
    );
    assert.ok(col, 'fixture sanity');

    const app = new pg.Client({
      connectionString: `postgres://akademik_app:${appPassword}@127.0.0.1:${port}/grant_test`,
    });
    await app.connect();
    try {
      // Either refusal is correct and safe: `set local row_security = off` is
      // itself denied to a non-owner, and if it were not, the guard below it
      // raises. What must not happen is a silent "0 rows".
      await assert.rejects(
        () => app.query(`select set_config('app.tenant_id', '${LIBEDGE}', false)`).then(
          () => app.query(migrationSql()),
        ),
        /row-level security/,
      );
    } finally {
      await app.end().catch(() => {});
    }

    const [row] = await grantRows();
    assert.equal(row.subject_id, DEMO, 'the row must be untouched after the refusal');
  });

  await client.end().catch(() => {});
  await docker('rm', '-f', container).catch(() => {});
  if (failures) {
    console.error(`\n${failures} scenario(s) failed`);
    process.exitCode = 1;
  } else {
    console.log('\nall scenarios passed');
  }
}

main().catch(async (error) => {
  console.error(`failed: ${error.message}`);
  await docker('rm', '-f', container).catch(() => {});
  process.exitCode = 1;
});
