import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';

// 023, measured through the real server.
//
// db/023.test.mjs answers "did the SQL move the right rows" by querying the tables.
// This file answers the question that decides whether the change is usable: can an
// individual reader at a second institution actually reach the OA collection through
// spike/app, and is everything else refused - catalogue, file, ticket and download,
// not a count over `works`.
//
// It runs the shipped server (spike/app/server.mjs) in a sandbox against a throwaway
// PostgreSQL, logs in as a reader of the individual tenant 023 creates, and only then
// asks. The fixture carries the look-alikes the SQL test cannot express, because every
// work in it is a collection member:
//
//   OUTSIDE_WORK     staff-owned, never a collection member
//   GLOBAL_OUTSIDE   tenant-free (work, edition, asset, own publisher) but not a collection
//                    member - the global title the collection grant must NOT open
//   OTHER_WORK       another institution's work, which measures the RLS boundary
//
// "It did not appear" is not enough on its own: for GLOBAL_OUTSIDE the reader can see the
// row through RLS and only the grant decides. So the refusals are measured twice - with
// the grant 023 wrote, and with that same grant rewritten to scope 'all'. The outsider is
// refused in the first pass and served (catalogue, file, ticket, download) in the second,
// which is what proves the collection is the reason. A green first pass alone would prove
// nothing, because a server that refuses everything looks the same.
//
// A sabotaged 023 is caught where a reader would feel it: the first catalogue request
// comes back with thirteen works instead of the twelve in the collection.
//
// One limit, on the record: the individual tenant is created by 023 and holds exactly one
// grant, so with the real grant its reader sees the global catalogue - every global work
// that is also a member of the collection, which in this fixture is the twelve. A
// collection-scoped grant that narrowed the *listing* instead of licensing the collection
// is 023's next question, not this file's claim. What the bridge publishes is measured
// separately: it lists global works (the thirteen), which is not the same question as
// what a grant licenses.
//
// Run by hand, it starts its own postgres and takes a couple of minutes:
//   node db/023-app.test.mjs
//
// Two switches exist for reviewing that claim rather than taking it:
//   LIBEDGE_023_SQL=<path>             read 023 from another file (a PR checkout)
//   LIBEDGE_023_SABOTAGE_COLLECTION=1  apply 023 with the grant's scope set to 'all'
//                                      instead of 'collection' - the run that must fail
// The sabotage run fails on purpose; a green run with it set would mean this file is not
// measuring the collection grant at all.
//
// Writing the failure as an in-process assertion would be the easy version and the wrong
// one: "grant.scope_type === 'all'" is a check on the migration's own text, not on access.
// The sabotage therefore lands in the server, and the run stays green until the reader's
// first catalogue request returns thirteen works. A red run that names the HTTP pass is
// the evidence; a red run that names a scope_type row is not.

const exec = promisify(execFile);
// A child that hangs would hang this test with it: every docker call and every
// `db/migrate.mjs` run gets a deadline, and so does the server start below.
const childTimeout = 240_000;
const dbDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(dbDir, '..');
const appDir = path.join(repoDir, 'spike/app');
const pg = createRequire(path.join(appDir, 'package.json'))('pg');

const STAFF = '5799f2a5-3d90-41b1-90de-9da07d776052';
const OTHER = '22222222-2222-4222-8222-222222222222';
const OA_COLLECTION = '74149e93-39dd-50ba-b120-a75415d9b0ca';
const DEMO_WORK = '33333333-3333-3333-3333-333333333333';
const INDIVIDUAL = 'b2c00000-0000-4000-8000-000000000001';
const INDIVIDUAL_USER = 'b2c00000-0000-4000-8000-000000000003';
const INDIVIDUAL_GRANT = 'b2c00000-0000-4000-8000-000000000002';
const INDIVIDUAL_EMAIL = 'reader@libedge-individual.test';
// Staff-owned, and deliberately NOT a member of the OA collection. 023 moves the twelve
// members and nothing else, so this is the one work that separates "the collection grant"
// from "everything global": it must not appear in the bridge catalogue, which 023's own
// fixture (all twelve members) cannot detect.
const OUTSIDE_WORK = 'a0000000-0000-4000-8000-0000000000c1';
const OTHER_WORK = 'a0000000-0000-4000-8000-0000000000aa';
// Global - work, edition and asset all with tenant_id null - and deliberately not a
// member of the OA collection: a licensed title that happens to live in the global
// catalogue. The reader's own RLS lets it through (tenant_id is null), so a grant is the
// only thing left to refuse it: 'collection' must, 'all' must not.
const GLOBAL_OUTSIDE = 'a0000000-0000-4000-8000-0000000000b7';
const GLOBAL_OUTSIDE_EDITION = 'a0000000-0000-4000-8000-0000000000b8';
const GLOBAL_OUTSIDE_ASSET = 'a0000000-0000-4000-8000-0000000000b9';
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
const editionId = index => `b0000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const assetId = index => `c0000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

const BRIDGE_TOKEN = 'libedge-023-app-test-token-0123456789';
const USER_PASSWORD = randomBytes(12).toString('hex');

const container = `libedge-023-app-${randomUUID()}`;
const adminPassword = randomBytes(18).toString('hex');
const appPassword = randomBytes(18).toString('hex');
const catalogPassword = randomBytes(18).toString('hex');
let port;
let admin;
let sandbox;
let checks = 0;
// The grant row 023 wrote, as it stood when the fixture was finished. main() restores it
// after its passes, so every refusal is measured against what the migration did, not
// against a leftover from the previous pass.
let grantsAtStart = null;

const check = (condition, message) => { assert.ok(condition, message); checks += 1; };

async function docker(...args) {
  return (await exec('docker', args, { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 })).stdout.trim();
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
  await new Promise((resolve, reject) => socket.close(error => (error ? reject(error) : resolve())));
  return value;
}

// The app is copied into a temp directory and started from there, so nothing this test
// writes (storage, temp uploads) can land in the repository, and the server's static
// root is the copy rather than the working tree. Only modules are copied - the import
// graph of server.mjs, walked the way spike/app/test/helpers/server-files.mjs walks it -
// plus an empty node_modules whose entries are junctions to spike/app's packages.
async function copyApp() {
  const root = await mkdtemp(path.join(tmpdir(), 'libedge-023-app-'));
  const queue = ['server.mjs'];
  const seen = new Set();
  const relativeModules = (code) => {
    const found = [];
    for (const pattern of [/\bfrom\s+['"](\.[^'"]+)['"]/g, /\bimport\s+['"](\.[^'"]+)['"]/g,
      /\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g]) {
      for (const match of code.matchAll(pattern)) found.push(match[1]);
    }
    return found;
  };
  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    const target = path.join(root, name);
    await mkdir(path.dirname(target), { recursive: true });
    const code = await readFile(path.join(appDir, name), 'utf8');
    await writeFile(target, code);
    for (const specifier of relativeModules(code)) {
      const bare = specifier.split('?')[0];
      const resolved = path.resolve(path.dirname(path.join(appDir, name)), bare);
      // Only existing files are followed; a missing one is the app's error to report,
      // not this copier's. The target path is kept relative to the app root, because a
      // module in sso/ imports its siblings with ./ relative to its own directory.
      const relative = path.relative(appDir, resolved).split(path.sep).join('/');
      try { await readFile(resolved); queue.push(relative); } catch { /* not a file */ }
    }
  }
  // The sandbox gets a package.json and a node_modules directory of links, so module
  // resolution inside it finds the same packages the app resolves from spike/app. A
  // single directory junction (not one per package) keeps it cheap and copy-free.
  await mkdir(path.join(root, 'node_modules'), { recursive: true });
  for (const name of await readdir(path.join(appDir, 'node_modules'))) {
    if (name.startsWith('.')) continue;
    await symlink(path.join(appDir, 'node_modules', name), path.join(root, 'node_modules', name), 'junction')
      .catch((error) => { if (error.code !== 'EEXIST') throw error; });
  }
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'libedge-023-app-sandbox', type: 'module', private: true }));
  await mkdir(path.join(root, 'public', 'oa'), { recursive: true });
  await mkdir(path.join(root, 'public', 'staff'), { recursive: true });
  return root;
}

async function startApp(env) {
  const appPort = await freePort();
  const child = spawnNode(env, appPort, sandbox);
  const base = `http://127.0.0.1:${appPort}`;
  let error = null;
  child.once('error', (failure) => { error = failure; });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (error) throw error;
    if (child.exitCode !== null) throw new Error(`server exited: ${child.log().slice(-2000)}`);
    try {
      const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2000) });
      const body = await response.json();
      if (response.ok && body.mode === 'db') return { base, child };
    } catch { /* not listening yet */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`server did not become ready: ${child.log().slice(-2000)}`);
}

function spawnNode(env, appPort, cwd) {
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd,
    env: { ...process.env, ...env, PORT: String(appPort) },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let log = '';
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => { log = (log + chunk).slice(-20_000); });
  }
  child.log = () => log;
  return child;
}

async function stopApp(entry) {
  entry.child.kill();
  await Promise.race([once(entry.child, 'exit'), new Promise(resolve => setTimeout(resolve, 10_000))]);
}

async function request(base, route, session = null, { method = 'GET', body } = {}) {
  const headers = {};
  if (session) {
    headers.cookie = session.cookie;
    headers['x-csrf-token'] = session.csrf;
  }
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(base + route, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual', signal: AbortSignal.timeout(30_000),
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  let data;
  try { data = JSON.parse(bytes.toString('utf8')); } catch { /* file or XML */ }
  const cookies = response.headers.getSetCookie().map(cookie => cookie.split(';')[0]);
  return { status: response.status, headers: response.headers, bytes, data, cookies };
}

function status(result, expected, label) {
  assert.equal(result.status, expected, `${label}: ${result.bytes.toString('utf8').slice(0, 300)}`);
  checks += 1;
  return result;
}

async function login(base) {
  const result = status(await request(base, '/api/login', null, {
    method: 'POST', body: { email: INDIVIDUAL_EMAIL, password: USER_PASSWORD },
  }), 200, 'individual login');
  const csrf = result.cookies.find(cookie => cookie.startsWith('akademik_csrf='));
  check(Boolean(csrf), 'login must set the CSRF cookie');
  return { cookie: result.cookies.join('; '), csrf: decodeURIComponent(csrf.slice('akademik_csrf='.length)) };
}

// Ticket requests are budgeted per user and per 60-second window
// (download_tickets.mjs: DOWNLOAD_ISSUE_LIMIT). The passes in main() plus the
// withdrawal ask for more than ten, so the window is opened afresh before a pass that
// must reach the grant decision instead of the rate limiter. Nothing else is reset: the
// counters are the server's own table, and waiting them out is what a real reader does.
async function freshWindow(userId) {
  const { rowCount } = await admin.query(
    `delete from download_ticket_limits where tenant_id = $1 and user_id = $2 and kind = 'issue'`,
    [INDIVIDUAL, userId]);
  return rowCount;
}

// Put the grant back the way 023 left it. The passes in main() rewrite it on purpose, and
// a sabotaged 023 may have written something else entirely, so the columns are set from
// the row recorded at the end of setup() rather than hard-coded to 'collection'.
async function restoreGrant() {
  if (!grantsAtStart) return null;
  const { rowCount } = await admin.query(
    `update grants set scope_type = $3::text, scope_id = $4::uuid, status = $5::text
      where id = $1 and tenant_id = $2`,
    [INDIVIDUAL_GRANT, INDIVIDUAL, grantsAtStart.scope_type, grantsAtStart.scope_id, grantsAtStart.status]);
  return rowCount;
}

// The fixture 023 expects to find, created by the admin connection: the staff tenant
// owns the OA collection and its 12 works, another institution owns a private work, and
// one staff work sits deliberately OUTSIDE the collection - the look-alike the SQL test
// cannot express, because every fixture work in it is a collection member.
async function seedFixture() {
  await admin.query(`alter role akademik_catalog login password '${catalogPassword}'`);
  for (const [id, slug] of [[STAFF, 'libedge'], [OTHER, 'other']]) {
    await admin.query(`insert into tenants (id, name, slug) values ($1::uuid, $1, $2)`, [id, slug]);
  }
  // The staff tenant holds an ordinary, tenant-wide 'all' grant of its own, exactly as
  // migration 020 installs one in production. Without it the sabotaged run below would
  // be indistinguishable from the real one: the reader's own grant decides what this
  // file measures.
  await admin.query(
    `insert into grants (id, tenant_id, subject_type, subject_id, scope_type, source, status, valid_from, valid_to)
     values ('b2c00000-0000-4000-8000-000000000009', $1, 'tenant', $1, 'all', 'subscription', 'active', now(), null)
     on conflict (id) do nothing`, [STAFF]);
  await admin.query(
    `insert into collections (id, tenant_id, title, slug, description) values
       ($1, $2, 'LibEdge Open Academic Collection', 'libedge-open-academic', 'OA')`,
    [OA_COLLECTION, STAFF]);
  await admin.query(
    `insert into works (id, tenant_id, title, language) values
       ($1::uuid, $2::uuid, 'Other private work', 'en'),
       ($3::uuid, $2::uuid, 'Staff-only title', 'en')`,
    [OTHER_WORK, STAFF, OUTSIDE_WORK]);
  for (const [index, work] of WORKS.entries()) {
    await admin.query(`insert into works (id, tenant_id, title, language) values ($1, $2, $3, 'en')`,
      [work, STAFF, `OA Article ${index + 1}`]);
    await admin.query(`insert into editions (id, tenant_id, work_id, publisher) values ($1, $2, $3, 'OA Publisher')`,
      [editionId(index + 1), STAFF, work]);
    await admin.query(
      `insert into assets (id, tenant_id, edition_id, format, storage_key, page_count)
       values ($1, $2, $3, 'pdf', $4, 1)`,
      [assetId(index + 1), STAFF, editionId(index + 1), `oa/${work}.pdf`]);
    await admin.query(`insert into collection_items (collection_id, work_id, position) values ($1, $2, $3)`,
      [OA_COLLECTION, work, index + 1]);
  }
  await admin.query(`insert into editions (id, tenant_id, work_id, publisher) values ($1, $2, $3, 'Staff Publisher')`,
    [editionId(97), STAFF, OUTSIDE_WORK]);
  await admin.query(
    `insert into assets (id, tenant_id, edition_id, format, storage_key, page_count)
     values ($1, $2, $3, 'pdf', $4, 1)`,
    [assetId(97), STAFF, editionId(97), `staff/${OUTSIDE_WORK}.pdf`]);

  // The thirteenth title, and it must reach the reader through 023's grant and nothing
  // else: a global work that is not a collection member. It is created here rather than by
  // 023, so the migration meets a global title it did not put there and leaves it alone.
  // Edition and asset are global too, so nothing about it is tenant-owned, and it carries
  // its own publisher so a publisher-scoped grant cannot be what refuses it either.
  await admin.query(`insert into works (id, tenant_id, title, language) values ($1, null, $2, 'en')`,
    [GLOBAL_OUTSIDE, 'Global title outside the OA collection']);
  await admin.query(`insert into editions (id, tenant_id, work_id, publisher) values ($1, null, $2, 'Global Publisher')`,
    [GLOBAL_OUTSIDE_EDITION, GLOBAL_OUTSIDE]);
  await admin.query(
    `insert into assets (id, tenant_id, edition_id, format, storage_key, page_count)
     values ($1, null, $2, 'pdf', $3, 1)`,
    [GLOBAL_OUTSIDE_ASSET, GLOBAL_OUTSIDE_EDITION, `global/${GLOBAL_OUTSIDE}.pdf`]);
    // The catalog role's one publishing function refuses a work that is already global
    // ('catalog_publish_work: work is already global'), so that - not the collection - is
    // what would stop a bridge publish of the outsider. Recorded, not re-raised here.
    const publishable = await admin.query(
      `select p.prosecdef as security_definer from pg_proc p where p.proname = 'catalog_publish_work'`);
    check(publishable.rows[0]?.security_definer === true,
      'the thirteenth title can only be published through catalog_publish_work, which must exist');
}

// A real reader of the individual tenant 023 creates. The password hash is the format
// server.mjs verifies (scrypt$<salt>$<hex>), produced here rather than copied from a
// fixture, so the login exercises the shipping code path.
async function seedIndividualUser(salt) {
  const hash = `scrypt$${salt}$${scryptSync(USER_PASSWORD, salt, 64).toString('hex')}`;
  await admin.query(
    `insert into users (id, tenant_id, email, display_name, role, password_hash)
     values ($1, $2, $3, 'Individual Reader', 'reader', $4)`,
    [INDIVIDUAL_USER, INDIVIDUAL, INDIVIDUAL_EMAIL, hash]);
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

  // The shipped schema, seed and chain through the runner: the demo tenant, its reader
  // and its work are the "demo" case, so they come from db/seed.sql rather than being
  // retyped here. 018 is what puts app.tenant_for_login in place, and the server cannot
  // log anybody in without it.
  await admin.query(await readFile(path.join(repoDir, 'db/schema.sql'), 'utf8'));
  await admin.query(await readFile(path.join(repoDir, 'db/seed.sql'), 'utf8'));
  await admin.query(`alter role akademik_app password '${appPassword}'`);
  const runnerEnv = { ...process.env, DATABASE_URL: `postgres://mig_admin:${adminPassword}@127.0.0.1:${port}/mig` };
  await exec(process.execPath, ['db/migrate.mjs', '--baseline'], { cwd: repoDir, env: runnerEnv, timeout: 120_000 });
  const runnerList = async () => {
    const { rows } = await admin.query('select filename from schema_migrations');
    return new Set(rows.map(row => row.filename));
  };
  const applied = await runnerList();
  assert.ok(!applied.has('023-oa-global-catalog.sql'),
    'this test applies 023 itself; a database that already has it would measure the second run, not the first');
  // Hold 023 back from the generic run: it needs the fixture, which comes next.
  const migrationPath = process.env.LIBEDGE_023_SQL
    || path.join(dbDir, 'migrations', '023-oa-global-catalog.sql');
  const originalPath = `${migrationPath}.sabotage-original`;
  const sabotage = process.env.LIBEDGE_023_SABOTAGE_COLLECTION === '1';
  // The runner only reads *.sql, so 023 does not have to move out of the way: it is
  // marked applied for the duration of the generic run and unmarked straight after,
  // which is the same exclusion without a file operation that can fail half-way.
  await admin.query(
    `insert into schema_migrations (filename, checksum, duration_ms)
     select $1, 'held-back-by-023-app-test', 0
      where not exists (select 1 from schema_migrations where filename = $1)`,
    ['023-oa-global-catalog.sql']);
  try {
    await exec(process.execPath, ['db/migrate.mjs', '--allow-modified'],
      { cwd: repoDir, env: runnerEnv, timeout: childTimeout });
  } finally {
    await admin.query(`delete from schema_migrations where filename = $1 and checksum = 'held-back-by-023-app-test'`,
      ['023-oa-global-catalog.sql']);
  }
  const noGlobal = await admin.query(
    `select count(*)::int as n from pg_policies where policyname like '%no%global%'`);
  check(noGlobal.rows[0].n === 18,
    `022 must have been applied by the runner before 023 is measured, found ${noGlobal.rows[0].n} policies`);

  await seedFixture();
  // The sabotage switch exists so this file can be shown to fail: it rewrites the one
  // line that decides the grant's scope, and 023's own "did I write an all grant" guard
  // with it, so the defect reaches the server. The failure it must produce is the HTTP
  // one in main() - a thirteen-work catalogue for a collection grant - not an assertion
  // here, which only records what the migration left behind.
  try {
    if (sabotage) {
      const source = await readFile(migrationPath, 'utf8');
      const sabotaged = source
        .replace("'collection', oa_collection", "'all', null")
        .replace("where tenant_id = individual_tenant and scope_type = 'all'", 'where false');
      if (sabotaged === source) throw new Error('sabotage: 023 no longer contains the strings it replaces');
      await rename(migrationPath, originalPath);
      await writeFile(migrationPath, sabotaged);
    }
    await admin.query((await readFile(migrationPath)).toString('utf8'));
  } finally {
    if (sabotage) await rename(originalPath, migrationPath);
  }
  // Recorded the way the runner records it, so the database is in the state the next
  // `db/migrate.mjs` would leave it in rather than one with an unrecorded file.
  await admin.query(
    `insert into schema_migrations (filename, checksum, duration_ms) values ($1, $2, 0)
     on conflict (filename) do update set checksum = excluded.checksum`,
    ['023-oa-global-catalog.sql', 'applied-in-test-process']);
  const global = await admin.query(`select count(*)::int as n from works where tenant_id is null`);
  const unpublished = await admin.query(
    `select (select count(*)::int from works where id = $1 and tenant_id is null) as works,
            (select count(*)::int from editions where id = $2 and tenant_id is null) as editions,
            (select count(*)::int from assets where id = $3 and tenant_id is null) as assets,
            (select count(*)::int from collection_items where work_id = $1) as items`,
    [GLOBAL_OUTSIDE, GLOBAL_OUTSIDE_EDITION, GLOBAL_OUTSIDE_ASSET]);
  check(unpublished.rows[0].works === 1 && unpublished.rows[0].editions === 1 && unpublished.rows[0].assets === 1,
    `the thirteenth title must stay global in place, got ${JSON.stringify(unpublished.rows[0])}`);
  check(unpublished.rows[0].items === 0, 'the thirteenth title must not be a collection member');
  // 12 published by 023 plus the one global title it was never asked about. The count the
  // migration's own guard sees (the twelve) is what db/023.test.mjs measures; here the
  // extra global row is the point, so it is added rather than confused with them.
  check(global.rows[0].n === WORKS.length + 1,
    `023 must publish its ${WORKS.length} works and leave the global outsider alone, found ${global.rows[0].n} global works`);

  // What the fixture's grants are before the server starts, recorded for the record only:
  // the assertions that matter are made over HTTP below. A sabotaged 023 that writes an
  // 'all' grant must NOT be stopped here, because this file has to demonstrate that the
  // HTTP checks - not this row - are what turn red.
  const seededGrant = await admin.query(
    `select scope_type, scope_id, status from grants where tenant_id = $1 and id = $2`,
    [INDIVIDUAL, INDIVIDUAL_GRANT]);
  grantsAtStart = seededGrant.rows.length === 1 ? seededGrant.rows[0] : null;

  sandbox = await copyApp();
  const pdf = await readFile(path.join(appDir, 'test/fixtures/page-labels.pdf'));
  for (const work of WORKS) {
    await writeFile(path.join(sandbox, 'public', 'oa', `${work}.pdf`), pdf);
  }
  await writeFile(path.join(sandbox, 'public', 'staff', `${OUTSIDE_WORK}.pdf`), pdf);
  await mkdir(path.join(sandbox, 'public', 'global'), { recursive: true });
  await writeFile(path.join(sandbox, 'public', 'global', `${GLOBAL_OUTSIDE}.pdf`), pdf);
  await seedIndividualUser(randomBytes(16).toString('hex'));
}

async function main() {
  await setup();
  let reader = null;
  let bridge = null;
  try {
    // 1. Catalogue, file and download for a reader of the OA collection.
    reader = await startApp({
      DATABASE_URL: `postgres://akademik_app:${appPassword}@127.0.0.1:${port}/mig`,
      DEMO_TENANT_ID: STAFF,
      DEMO_USER_ID: INDIVIDUAL_USER,
      SESSION_SECRET: randomBytes(24).toString('hex'),
      APP_VERSION: 'v137',
    });
    const session = await login(reader.base);

    const catalogue = status(await request(reader.base, '/api/books', session), 200, 'catalogue');
    check(Array.isArray(catalogue.data), `catalogue must be a list, got ${JSON.stringify(catalogue.data).slice(0, 120)}`);
    const listed = Array.isArray(catalogue.data) ? catalogue.data.map(book => book.id).sort() : [];
    check(JSON.stringify(listed) === JSON.stringify([...WORKS].sort()),
      `catalogue must be exactly the OA collection, got ${listed.length} works`);
    check(!listed.includes(OUTSIDE_WORK), 'a staff work outside this tenant must not be listed');
    check(!listed.includes(DEMO_WORK), 'the demo work must not be listed');
    check(!listed.includes(OTHER_WORK), "another institution's work must not be listed");

    const allowed = WORKS[0];
    const file = status(await request(reader.base, `/api/books/${allowed}/file`, session), 200, 'OA file');
    check(file.headers.get('content-type') === 'application/pdf', 'the OA file must be served as a PDF');
    check(file.bytes.subarray(0, 5).toString() === '%PDF-', 'the OA file must be the stored bytes');

    const issued = status(await request(reader.base, `/api/books/${allowed}/download-ticket`, session,
      { method: 'POST', body: {} }), 201, 'OA ticket');
    check(typeof issued.data.ticket === 'string' && /^[0-9a-f]{64}$/.test(issued.data.ticket),
      'a ticket is a 64-hex token');
    const downloaded = status(await request(reader.base, `/api/books/${allowed}/download`, session,
      { method: 'POST', body: { ticket: issued.data.ticket } }), 200, 'OA download');
    check(downloaded.headers.get('content-type') === 'application/pdf', 'the download must be a PDF');
    check(downloaded.bytes.subarray(0, 5).toString() === '%PDF-', 'the download must carry the book bytes');
    status(await request(reader.base, `/api/books/${allowed}/download`, session,
      { method: 'POST', body: { ticket: issued.data.ticket } }), 403, 'replayed ticket');

    // 2. The titles the collection must not open: a global work outside the collection,
    //    a staff work outside it, the demo work, and another institution's work. Absent
    //    from the catalogue, no file, no ticket, no download.
    //
    //    The global one is the only refusal that is decided by the grant - the reader's
    //    RLS lets a tenant-free row through - so the whole pass runs twice: once with the
    //    grant as 023 writes it, once with it rewritten to scope 'all'. Only the second
    //    pass can tell "the collection refused it" from "something else refused it", and
    //    a green run over both would mean these checks measure nothing about the grant.
    const REFUSED = [
      ['global, outside the collection', GLOBAL_OUTSIDE],
      ['staff work outside the collection', OUTSIDE_WORK],
      ['demo', DEMO_WORK],
      ["another institution's", OTHER_WORK],
    ];
    const refused = async (label) => {
      const listed = await status(await request(reader.base, '/api/books', session), 200, `${label} catalogue`);
      const ids = Array.isArray(listed.data) ? listed.data.map(book => book.id) : [];
      check(!ids.includes(GLOBAL_OUTSIDE), `${label}: a global work outside the collection must not be listed`);
      for (const [name, id] of REFUSED) {
        check(!ids.includes(id), `${label}: ${name} must not be listed`);
        const denied = status(await request(reader.base, `/api/books/${id}/download-ticket`, session,
          { method: 'POST', body: {} }), 403, `${label}: ${name} ticket`);
        check(denied.data.error === 'download ticket rejected', `${label}: ${name} ticket must say why`);
        status(await request(reader.base, `/api/books/${id}/file`, session), 404, `${label}: ${name} file`);
        status(await request(reader.base, `/api/books/${id}/download`, session,
          { method: 'POST', body: { ticket: 'a'.repeat(64) } }), 403, `${label}: ${name} download`);
      }
    };
    await freshWindow(INDIVIDUAL_USER);
    await refused('collection grant');

    // The sabotage pass: same reader, same server, one grant row rewritten to 'all'.
    // This is the control the first pass cannot provide. Refusing the global title with a
    // collection grant proves nothing if the server would refuse it with an 'all' grant
    // too; serving it here proves the grant is the reason, and only then does the
    // collection-scoped pass above mean what it says.
    const widen = async (scopeType, scopeId) => {
      await admin.query(
        `update grants set scope_type = $3::text, scope_id = $2::uuid where id = $1 and tenant_id = $4`,
        [INDIVIDUAL_GRANT, scopeId, scopeType, INDIVIDUAL]);
      const { rows } = await admin.query(`select scope_type from grants where id = $1 and tenant_id = $2`,
        [INDIVIDUAL_GRANT, INDIVIDUAL]);
      check(rows.length === 1 && rows[0].scope_type === scopeType,
        `the grant must be '${scopeType}' before this pass measures anything, got ${JSON.stringify(rows)}`);
    };
    const served = async (label, id) => {
      const listed = status(await request(reader.base, '/api/books', session), 200, `${label} catalogue`);
      const ids = Array.isArray(listed.data) ? listed.data.map(book => book.id) : [];
      check(ids.includes(id), `${label}: ${id} must be served while the grant is 'all', got ${ids.length} works`);
      const file = status(await request(reader.base, `/api/books/${id}/file`, session), 200, `${label} file`);
      check(file.bytes.subarray(0, 5).toString() === '%PDF-', `${label}: the file must carry the bytes`);
      const issued = status(await request(reader.base, `/api/books/${id}/download-ticket`, session,
        { method: 'POST', body: {} }), 201, `${label} ticket`);
      status(await request(reader.base, `/api/books/${id}/download`, session,
        { method: 'POST', body: { ticket: issued.data.ticket } }), 200, `${label} download`);
    };
    await freshWindow(INDIVIDUAL_USER);
    await widen('all', null);
    await served("all grant: the global work outside the collection", GLOBAL_OUTSIDE);
    await restoreGrant();

    // And back where 023 left it: the same title is refused again, so the refusal above
    // cannot have been the first pass reading a widened grant by accident.
    await freshWindow(INDIVIDUAL_USER);
    await refused('collection grant, after the all-grant pass');

    // The collection grant is the *only* reason this reader sees the collection: the same
    // server, the same books, with the grant withdrawn. The global outsider was already
    // refused and must stay refused - withdrawing a grant cannot be how it is admitted.
    const withdraw = await admin.query(
      `update grants set status = 'revoked' where id = $1 and tenant_id = $2`,
      [INDIVIDUAL_GRANT, INDIVIDUAL]);
    check(withdraw.rowCount === 1, 'the collection grant exists before it is withdrawn');
    const afterRevoke = status(await request(reader.base, '/api/books', session), 200, 'catalogue without grant');
    check(Array.isArray(afterRevoke.data) && afterRevoke.data.length === 0,
      `without the collection grant the catalogue must be empty, got ${afterRevoke.data?.length} works`);
    status(await request(reader.base, `/api/books/${allowed}/download-ticket`, session,
      { method: 'POST', body: {} }), 403, 'ticket without grant');
    status(await request(reader.base, `/api/books/${allowed}/file`, session), 404, 'file without grant');
    status(await request(reader.base, `/api/books/${GLOBAL_OUTSIDE}/file`, session), 404,
      'the global outsider is still refused without a grant');
    await admin.query(`update grants set status = 'active' where id = $1 and tenant_id = $2`,
      [INDIVIDUAL_GRANT, INDIVIDUAL]);

    // And the grant that matters is the one 023 wrote: over HTTP, a reader holding it is
    // given the collection and refused the global title outside it. This is the assertion
    // that makes a sabotaged 023 red, and it is made where a reader would feel it.
    const finalCatalogue = status(await request(reader.base, '/api/books', session), 200, 'catalogue after the passes');
    const finalIds = Array.isArray(finalCatalogue.data) ? finalCatalogue.data.map(book => book.id).sort() : [];
    check(JSON.stringify(finalIds) === JSON.stringify([...WORKS].sort()),
      `the grant 023 wrote must license exactly the collection, got ${finalIds.length} works`);
    check(grantsAtStart?.scope_type === 'collection' && grantsAtStart?.scope_id === OA_COLLECTION,
      `the individual tenant must hold one collection grant on the OA collection, got ${JSON.stringify(grantsAtStart)}`);
    const outsiderStillRefused = status(await request(reader.base, `/api/books/${GLOBAL_OUTSIDE}/file`, session), 404,
      'the global outsider is refused by the collection grant');
    check(outsiderStillRefused.data?.error === 'book not found', 'the refusal must not disclose the title');

    // The refusals are recorded, not swallowed: a 403 an operator cannot see is a 403
    // nobody can explain later. The row lands in the reader's tenant, not the env one.
    //
    // Every reason here is a real branch of the server, and the two that read like a
    // bug are the interesting ones: `book_unavailable` means getBook() found nothing in
    // the reader's tenant (the demo work, the other institution's work, the staff work),
    // while `grant_denied` is the global title - visible, and refused by the collection
    // grant. A future `all` grant turning that into a 200 is exactly what the pass above
    // measures; nothing here asserts an 'all' grant is impossible.
    const deny = await admin.query(
      `select payload->>'reason' as reason, count(*)::int as n
         from audit_events
        where tenant_id = $1 and action = 'download.ticket.deny'
        group by 1`, [INDIVIDUAL]);
    check(deny.rows.every(row => ['book_unavailable', 'grant_denied', 'invalid_ticket'].includes(row.reason)),
      `refusals must be recorded against the individual tenant, got ${JSON.stringify(deny.rows)}`);
    const reasons = new Set(deny.rows.map(row => row.reason));
    check(reasons.has('grant_denied'),
      `the global title outside the collection must be refused by the grant, got ${JSON.stringify(deny.rows)}`);
    check(reasons.has('book_unavailable'),
      `a row outside the reader's tenant must not even be found, got ${JSON.stringify(deny.rows)}`);
    const denied = deny.rows.reduce((total, row) => total + row.n, 0);
    check(denied >= 8, `every refused ticket must leave a deny row, found ${denied}`);

    // 3. The LibEdge catalogue - read through the bridge, with the read-only catalog role
    //    022 created, which is the path the e-library uses.
    bridge = await startApp({
      DATABASE_URL: `postgres://akademik_app:${appPassword}@127.0.0.1:${port}/mig`,
      DATABASE_CATALOG_URL: `postgres://akademik_catalog:${catalogPassword}@127.0.0.1:${port}/mig`,
      DEMO_TENANT_ID: STAFF,
      SESSION_SECRET: randomBytes(24).toString('hex'),
      LIBEDGE_ENTITLEMENTS_TOKENS: BRIDGE_TOKEN,
    });
    const headers = {
      authorization: `Bearer ${BRIDGE_TOKEN}`,
      'x-libedge-actor': 'system:023-app-test',
    };
    const page = await fetch(`${bridge.base}/api/libedge/v1/catalog?limit=100`, { headers });
    const pageBody = await page.json();
    check(page.status === 200, `bridge catalogue: ${JSON.stringify(pageBody).slice(0, 200)}`);
    const bridged = pageBody.works.map(work => work.id).sort();
    // The bridge publishes global works, so it lists the outsider too: that is the
    // difference between what the bridge shows and what a collection grant licenses. What
    // the bridge must not do is publish a work that never reached the global catalogue -
    // OUTSIDE_WORK is still staff-owned, and it is the one 023 could have moved by mistake.
    check(JSON.stringify(bridged) === JSON.stringify([...WORKS, GLOBAL_OUTSIDE].sort()),
      `the bridge must list the global catalogue - the twelve and the outsider - got ${bridged.length} works`);
    check(!bridged.includes(OUTSIDE_WORK), 'a staff work outside the OA collection is not in the bridge catalogue');
    check(pageBody.has_more === false, 'thirteen works fit on one page');
    const outsider = await fetch(`${bridge.base}/api/libedge/v1/catalog/works/${GLOBAL_OUTSIDE}`, { headers });
    check(outsider.status === 200, 'the bridge publishes a global work whether or not it is in the collection');
    const missing = await fetch(`${bridge.base}/api/libedge/v1/catalog/works/${OUTSIDE_WORK}`, { headers });
    check(missing.status === 404, 'a work outside the OA collection is not in the bridge catalogue');
    const anonymous = await fetch(`${bridge.base}/api/libedge/v1/catalog`);
    check(anonymous.status === 401, 'the bridge refuses an unauthenticated catalogue read');

    process.stdout.write(JSON.stringify({
      passed: true,
      catalogue: listed.length,
      bridgeCatalogue: bridged.length,
      globalOutside: 'not listed, 403 ticket, 404 file, grant_denied with the collection grant; served with all',
      outsideCollection: 'not listed, 403 ticket, 404 file',
      demo: 'not listed, 403 ticket, 404 file',
      otherTenant: 'not listed, 403 ticket, 404 file',
      denyRows: denied,
      checks,
    }));
  } finally {
    if (reader) await stopApp(reader);
    if (bridge) await stopApp(bridge);
    await admin?.end().catch(() => {});
    await stopContainer();
    if (sandbox) await rm(sandbox, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });


