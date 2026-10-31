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

import { handleBridgeRequest } from '../libedge-bridge-api.mjs';

// The LibEdge bridge end to end, against a real PostgreSQL 16 with 021, 022 and 024
// applied.
//
// Why a real database rather than a mock: the things most likely to be wrong here are
// the things a mock cannot be wrong about. RLS on libedge_memberships and
// libedge_subscription_sync is FORCEd, so the bridge's own writes are policed by the
// policies; the grants table is only reachable in the tenant the connection is bound to;
// advisory locks and `greatest(lease_until, ...)` are server behaviour. A stubbed client
// would agree with any of this.
//
// The bridge is driven through handleBridgeRequest - the same entry point server.mjs
// calls - so the token, scope, actor, body and error-shape decisions in front of the
// database are exercised too, not just the SQL.
//
// Run by hand, it starts its own postgres and takes a few seconds:
//   node test/libedge-bridge.integration.mjs

const exec = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');
const repoDir = path.resolve(appDir, '../..');
const dbDir = path.join(repoDir, 'db');
// `pg` belongs to spike/app; resolved from there the way db/migrate.mjs does.
const pg = createRequire(path.join(appDir, 'package.json'))('pg');

const ENTITLEMENTS_TOKEN = 'entitlements-token-for-the-integration-run';
const CATALOG_TOKEN = 'catalog-token-for-the-integration-run';
const ENV = {
  LIBEDGE_ENTITLEMENTS_TOKENS: ENTITLEMENTS_TOKEN,
  LIBEDGE_CATALOG_TOKENS: CATALOG_TOKEN,
  LIBEDGE_LEASE_MAX_HOURS: '72',
};

const NOW = new Date('2026-11-01T00:00:00Z');
const INSTITUTION = '42';
const SHARED_COLLECTION = '74149e93-39dd-50ba-b120-a75415d9b0ca';
const SHARED_TITLE = 'f4797188-83fd-5737-8185-fb957cfaf77c';

const container = `libedge-bridge-${randomUUID()}`;
const adminPassword = randomBytes(18).toString('hex');
const appPassword = randomBytes(18).toString('hex');
const catalogPassword = randomBytes(18).toString('hex');
let port;
let admin;
let pool;
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
// Fixture
// ---------------------------------------------------------------------------

async function setup() {
  await docker('version', '--format', '{{.Server.Version}}');
  port = await freePort();
  await docker('run', '--detach', '--rm', '--name', container,
    '--tmpfs', '/var/lib/postgresql/data',
    '--publish', `127.0.0.1:${port}:5432`,
    '--env', 'POSTGRES_USER=mig_admin',
    '--env', 'POSTGRES_DB=mig',
    '--env', `POSTGRES_PASSWORD=${adminPassword}`, 'postgres:16-alpine');

  // Readiness: a refused connection early is normal while the entrypoint runs its second
  // init phase, so it is retried with a fresh client each time.
  let lastError;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const candidate = new pg.Client({
      connectionString: `postgres://mig_admin:${adminPassword}@127.0.0.1:${port}/mig`,
    });
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

  // 021, 022, 024 and 025 in order: the bridge needs every one of them and a test against
  // a thinner schema would prove less than it claims. 025 matters most here - tenants_self
  // cannot admit the INSERT that produces the id, so without it no tenant can be created
  // at all and the create path would be untested for the wrong reason.
  for (const file of [
    '021-libedge-identity-and-subscriptions.sql',
    '022-global-catalogue-boundary.sql',
    '024-maintenance-tenants.sql',
    '025-libedge-tenant-provisioning.sql',
  ]) {
    await admin.query(await readFile(path.join(dbDir, 'migrations', file), 'utf8'));
  }

  await admin.query(`alter role akademik_app password '${appPassword}'`);
  // 022 creates the catalog role NOLOGIN and without a password, because a password in a
  // migration is a password in git. Setting one here is the deploy step db/README.md
  // describes.
  await admin.query(`alter role akademik_catalog login password '${catalogPassword}'`);

  // Two tenants with LibEdge contexts, and the staff tenant the publish path checks.
  // status is left at its default 'active' for the institution.
  const staff = '5799f2a5-3d90-41b1-90de-9da07d776052';
  const institution = '4a4a4a4a-4a4a-4a4a-8a4a-4a4a4a4a4a4a';
  const individual = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  await admin.query(
    `insert into tenants (id, name, slug, libedge_kind, libedge_ref) values
       ($1, 'LibEdge', 'libedge', 'staff', 'libedge'),
       ($2, 'Kurum 42', 'kurum-42', 'institution', $4),
       ($3, 'Bireysel', 'bireysel', 'individual', 'b2c')`,
    [staff, institution, individual, INSTITUTION],
  );

  // One global collection and one global work: the scopes a subscription may name.
  await admin.query(
    `insert into collections (id, tenant_id, title, slug) values ($1, null, 'Ortak', 'ortak')`,
    [SHARED_COLLECTION],
  );
  await admin.query(
    `insert into works (id, tenant_id, title) values ($1, null, 'Ortak Eser')`,
    [SHARED_TITLE],
  );

  pool = new pg.Pool({
    connectionString: `postgres://akademik_app:${appPassword}@127.0.0.1:${port}/mig`,
    max: 4,
  });
}

// The bridge, called the way server.mjs calls it.
async function call(method, pathname, { body, token, actor, env = ENV, now = NOW } = {}) {
  const headers = {};
  if (token !== null) headers.authorization = `Bearer ${token ?? ENTITLEMENTS_TOKEN}`;
  if (actor !== null) headers['x-libedge-actor'] = actor ?? 'system:integration-test';
  return handleBridgeRequest({
    env, pool, method, pathname, headers, body: body ?? {}, query: {}, requestId: 'req-1', now,
  });
}

// Shortcut that asserts the happy path, so a test that only cares about a later
// assertion is not also silently tolerating a 400 here.
async function ok(method, pathname, options) {
  const response = await call(method, pathname, options);
  check(response.status < 300,
    `${method} ${pathname} should have succeeded, got ${response.status} ${JSON.stringify(response.body)}`);
  return response;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

async function main() {
  await setup();
  try {
    await configuredSection();
    await authSection();
    await tenantSection();
    await provisioningSection();
    await firstSubscriptionSection();
  } finally {
    await pool?.end().catch(() => {});
    await admin?.end().catch(() => {});
    await stopContainer();
  }

  console.log(`\n  ok - ${checks} checks\n`);
}

// === A switched-off bridge answers 503 for EVERY endpoint =====================
//
// The user's requirement, checked across every route rather than on one: a bridge that
// answered 401 here would make LibEdge blame its own token while the real cause is that
// nobody configured one.
async function configuredSection() {
  for (const [method, pathname] of [
    ['GET', '/health'],
    ['PUT', `/tenants/institution/${INSTITUTION}`],
    ['GET', `/tenants/institution/${INSTITUTION}`],
    ['PUT', `/tenants/institution/${INSTITUTION}/users/u1`],
    ['PUT', `/tenants/institution/${INSTITUTION}/memberships/u1`],
    ['PUT', '/accounts/u1'],
    ['PUT', '/subscriptions/institution:7'],
    ['GET', '/subscriptions/institution:7'],
  ]) {
    const response = await call(method, pathname, { env: {}, body: {} });
    check(response.status === 503 && response.body.error === 'BRIDGE_NOT_CONFIGURED',
      `${method} ${pathname} with no tokens: expected 503 BRIDGE_NOT_CONFIGURED, got ${response.status} ${JSON.stringify(response.body)}`);
    check(response.body.request_id === 'req-1',
      `${method} ${pathname}: the error body must carry request_id`);
  }
}

// === Authentication and scope =================================================
async function authSection() {
  check((await call('GET', '/health', { token: null })).status === 200, 'health needs no token');
  check((await call('GET', '/health')).body.ok === true, 'health reports ok');

  const noToken = await call('PUT', `/tenants/institution/${INSTITUTION}`, { token: null });
  check(noToken.status === 401 && noToken.body.error === 'UNAUTHORIZED',
    `no token: expected 401 UNAUTHORIZED, got ${noToken.status}`);

  const wrongScope = await call('PUT', `/tenants/institution/${INSTITUTION}`,
    { token: CATALOG_TOKEN });
  check(wrongScope.status === 403 && wrongScope.body.error === 'TOKEN_SCOPE',
    `catalog token on an entitlements endpoint: expected 403 TOKEN_SCOPE, got ${wrongScope.status}`);

  // Scope is decided BEFORE the body, so an unwanted caller cannot use our error
  // messages to learn the validation rules.
  const badScopeBadBody = await call('PUT', `/tenants/institution/${INSTITUTION}`,
    { token: CATALOG_TOKEN, body: { nonsense: true } });
  check(badScopeBadBody.body.error === 'TOKEN_SCOPE',
    `a wrong-scope request with a bad body must answer TOKEN_SCOPE, got ${badScopeBadBody.body.error}`);

  const noActor = await call('PUT', `/tenants/institution/${INSTITUTION}`, { actor: null });
  check(noActor.status === 403 && noActor.body.error === 'ACTOR_REQUIRED',
    `no actor: expected 403 ACTOR_REQUIRED, got ${noActor.status}`);

  const unknownRoute = await call('GET', '/nothing/here');
  check(unknownRoute.status === 404 && unknownRoute.body.error === 'NOT_FOUND',
    'an unknown path must still answer in the bridge error shape');
}

// === Tenants ==================================================================
async function tenantSection() {
  const updated = await ok('PUT', '/tenants/institution/42',
    { body: { name: 'Kurum 42', slug: 'kurum-42' } });
  check(updated.status === 200 && updated.body.tenant.slug === 'kurum-42',
    `updating an existing tenant should be 200, got ${updated.status}`);

  // A new institution is created, and the context comes from the path, not the body.
  const created = await ok('PUT', '/tenants/institution/99',
    { body: { name: 'Kurum 99', slug: 'kurum-99' } });
  check(created.status === 201, `creating a tenant should be 201, got ${created.status}`);
  const { rows } = await admin.query(
    'select libedge_kind, libedge_ref from tenants where id = $1', [created.body.tenant.id]);
  check(rows[0].libedge_kind === 'institution' && rows[0].libedge_ref === '99',
    `the path, not the body, must set the context: ${JSON.stringify(rows[0])}`);

  // A slug that belongs to someone else is a 409 with a code, not a 500 from the unique
  // index. Tested on a ref that does not exist yet: on an existing tenant the slug is
  // never consulted (025 keeps it), so this has to be the create path.
  //
  // Deliberately after the read-back below: a failed provisioning rolls its transaction
  // back, and anything this section wrote in the same uncommitted state goes with it.
  const slugClash = await call('PUT', '/tenants/institution/77',
    { body: { name: 'Kurum 77', slug: 'kurum-42' } });
  check(slugClash.status === 409 && slugClash.body.error === 'TENANT_SLUG_TAKEN',
    `slug clash: expected 409 TENANT_SLUG_TAKEN, got ${slugClash.status} ${slugClash.body.error}`);
  const { rows: noGhost } = await admin.query(
    "select count(*)::int as n from tenants where libedge_ref = '77'");
  check(noGhost[0].n === 0, 'a refused slug clash must not have created a tenant');

  const unknownKind = await call('PUT', '/tenants/company/1', { body: { name: 'X', slug: 'x' } });
  check(unknownKind.status === 400 && unknownKind.body.error === 'INVALID_BODY',
    `an unknown tenant kind from the path must be 400, got ${unknownKind.status}`);

  // ---- 025: what the definer function must refuse --------------------------------
  //
  // The function can write `tenants` past tenants_self. These are the limits that keep it
  // from being a general write path, and each one is checked here rather than trusted.

  for (const kind of ['staff', 'individual']) {
    const refused = await call('PUT', `/tenants/${kind}/1`, { body: { name: 'X', slug: `x-${kind}` } });
    check(refused.status === 422 && refused.body.error === 'TENANT_KIND_NOT_PROVISIONABLE',
      `creating a ${kind} tenant: expected 422 TENANT_KIND_NOT_PROVISIONABLE, got ${refused.status} ${refused.body.error}`);
  }
  const { rows: kindRows } = await admin.query(
    "select count(*)::int as n from tenants where libedge_kind in ('staff', 'individual')");
  check(kindRows[0].n === 2,
    `the staff and individual tenants must still be the two the fixture made, found ${kindRows[0].n}`);

  // The function refuses the same kind even when called directly, so the API-level check
  // is a courtesy and not the boundary.
  let directKindRefused = false;
  try {
    await pool.query("select * from app.libedge_upsert_tenant('staff', '1', 'X', 'x-staff-direct', 'active')");
  } catch (error) {
    directKindRefused = error.code === 'P0001';
  }
  check(directKindRefused, '025 must refuse a staff tenant even when called directly');

  // A direct INSERT by the app role is still denied: the function is the one path, not a
  // door left open beside one. Run on the app pool, not the owner's connection - the owner
  // is a different principal even after `set role`, because `set role` does not switch to a
  // role the owner has no membership in, and the assertion would pass for the wrong reason.
  let directInsertDenied = false;
  let directInsertCode;
  try {
    await pool.query(
      "insert into tenants (name, slug, status, libedge_kind, libedge_ref) values ('Sizma', 'sizma', 'active', 'institution', '666')");
  } catch (error) {
    directInsertCode = error.code;
    directInsertDenied = error.code === '42501';
  }
  check(directInsertDenied,
    `akademik_app must not be able to insert into tenants directly - 025 is the only path, got ${directInsertCode}`);

  // An existing tenant keeps its id and its slug. Renaming in LibEdge must not move the
  // address a reader's bookmark and a stored session already point at.
  const slugBefore = (await admin.query('select slug from tenants where id = $1',
    [created.body.tenant.id])).rows[0].slug;
  const renamed = await ok('PUT', '/tenants/institution/99',
    { body: { name: 'Kurum 99 Yeni', slug: 'kurum-99-yeni' } });
  check(renamed.status === 200 && renamed.body.tenant.id === created.body.tenant.id,
    'provisioning the same ref again must update the same tenant');
  check(renamed.body.tenant.name === 'Kurum 99 Yeni', 'the name must follow the request');
  check(renamed.body.tenant.slug === slugBefore,
    `the slug must not change on an existing tenant: was ${slugBefore}, got ${renamed.body.tenant.slug}`);
  const { rows: slugRows } = await admin.query(
    'select slug from tenants where id = $1', [created.body.tenant.id]);
  check(slugRows[0].slug === slugBefore,
    'the stored slug must not change either, not just the response');

  const missing = await call('GET', '/tenants/institution/does-not-exist');
  check(missing.status === 404 && missing.body.error === 'TENANT_NOT_FOUND',
    `missing tenant: expected 404 TENANT_NOT_FOUND, got ${missing.status}`);

  const readBack = await call('GET', '/tenants/institution/42');
  check(readBack.status === 200,
    `GET /tenants/institution/42 should have succeeded, got ${readBack.status} ${JSON.stringify(readBack.body)}`);
  check(readBack.body.tenant.name === 'Kurum 42' && readBack.body.tenant.kind === 'institution',
    'the GET must report the tenant it was asked for');
  check(readBack.body.tenant.slug === 'kurum-42',
    `the GET must report the stored slug, got ${readBack.body.tenant.slug}`);
}

// === Pre-provisioning, membership and account (2.5, 3.3; acceptance 17/18) ===
async function provisioningSection() {
  const user = await ok('PUT', '/tenants/institution/42/users/1001',
    { body: { email: 'ayse@example.edu', name: 'Ayşe Yılmaz' } });
  check(user.status === 201, `pre-provisioning should be 201, got ${user.status}`);

  const again = await ok('PUT', '/tenants/institution/42/users/1001',
    { body: { email: 'ayse@example.edu', name: 'Ayşe Y.' } });
  check(again.status === 200 && again.body.user.id === user.body.user.id,
    'pre-provisioning twice must update the same row, not create a second');
  check(again.body.user.name === 'Ayşe Y.', 'the display name must follow the request');

  await ok('PUT', '/accounts/1001', { body: { revision: 1, status: 'active' } });
  await ok('PUT', '/tenants/institution/42/memberships/1001',
    { body: { revision: 1, status: 'active' } });

  const revoked = await ok('PUT', '/tenants/institution/42/memberships/1001',
    { body: { revision: 2, status: 'revoked' } });
  check(revoked.body.status === 'revoked' && revoked.body.replayed === false,
    'a newer revocation must be applied');

  const { rows: sessionRows } = await admin.query(
    'select session_version from users where id = $1', [user.body.user.id]);
  check(Number(sessionRows[0].session_version) === 1,
    `revoking a membership must drop that tenant's sessions, session_version = ${sessionRows[0].session_version}`);

  // A late "active" at the old revision is stale, and the row stays revoked.
  const late = await call('PUT', '/tenants/institution/42/memberships/1001',
    { body: { revision: 1, status: 'active' } });
  check(late.status === 409 && late.body.error === 'STALE_REVISION'
    && late.body.applied_revision === 2,
    `a late active must be 409 STALE_REVISION with applied_revision 2, got ${late.status} ${JSON.stringify(late.body)}`);
  const { rows: stillRevoked } = await admin.query(
    'select status from libedge_memberships where tenant_id = $1 and libedge_user_id = $2',
    ['4a4a4a4a-4a4a-4a4a-8a4a-4a4a4a4a4a4a', '1001']);
  check(stillRevoked[0].status === 'revoked',
    'the stale request must not have reopened the membership');

  const replay = await ok('PUT', '/tenants/institution/42/memberships/1001',
    { body: { revision: 2, status: 'revoked' } });
  check(replay.body.replayed === true, 'the same revision and status must be a replay');

  // 3.3: a revoked membership means a NEW user row is not created. The revocation has to
  // exist first - 1002 has no membership yet, and "absent" is not "revoked": the check is
  // for an explicit revocation, because a user who was never a member of this tenant is a
  // different answer (and one the contract leaves to SSO).
  await ok('PUT', '/tenants/institution/42/memberships/1002',
    { body: { revision: 1, status: 'revoked' } });
  const blocked = await call('PUT', '/tenants/institution/42/users/1002',
    { body: { email: 'mehmet@example.edu', name: 'Mehmet' } });
  check(blocked.status === 409 && blocked.body.error === 'MEMBERSHIP_REVOKED',
    `pre-provisioning inside a revoked membership: expected 409 MEMBERSHIP_REVOKED, got ${blocked.status} ${blocked.body.error}`);
  const { rows: notCreated } = await admin.query(
    "select count(*)::int as n from users where libedge_user_id = '1002'");
  check(notCreated[0].n === 0, 'a refused pre-provisioning must not have created a user row');
}

// === An active subscription opened for the first time (5.4, 3.3) =============
//
// This is the order regression, and it only shows up on a FIRST open, so it needs a
// source_id nothing has written before.
//
// 021 adds `grants.subscription_source_id text references
// libedge_subscription_sync(source_id)`. A foreign key is checked when the row is
// written, not at commit: the UPDATE/INSERT into `grants` therefore has to happen after
// the sync row exists. When the sync row was written at the end, every scope insert hit
// grants_subscription_source_id_fkey and the whole request failed with a 500 - on the
// first subscription a tenant ever received, and on every one after it, because
// `select ... from libedge_subscription_sync where source_id = $1` at the top of
// applySubscriptionSync also sees no row and takes the create path again.
//
// The database here is the real one: db/schema.sql and the real migration files, run as
// a superuser so RLS is bypassed for the fixture and enforced for the bridge pool. That
// is what makes this a test of the schema rather than of a mock agreeing with itself.
async function firstSubscriptionSection() {
  const source = `institution:${INSTITUTION}`;
  // A fresh source id per run: rows are per database, but the id is cheap and an
  // accidental reuse would hide the very path this test exists for.
  const sourceId = `${source}:first-${Date.now()}`;

  const { rows: before } = await admin.query(
    'select count(*)::int as n from libedge_subscription_sync where source_id = $1', [sourceId]);
  check(before[0].n === 0, 'the first-open fixture must start with no sync row for its source_id');

  const opened = await call('PUT', `/subscriptions/${sourceId}`, {
    body: {
      revision: 1,
      tenant: { kind: 'institution', ref: INSTITUTION },
      subject: { type: 'tenant' },
      status: 'active',
      valid_from: '2026-11-01T00:00:00Z',
      valid_to: '2027-11-01T00:00:00Z',
      lease_until: '2026-11-02T00:00:00Z',
      scopes: [{ type: 'collection', id: SHARED_COLLECTION }],
    },
  });
  check(opened.status === 201,
    `the first active subscription for a source_id must open with 201, got ${opened.status} `
    + `${JSON.stringify(opened.body)}`);
  check(opened.body.replayed === false, 'the first open must not be a replay');
  check(opened.body.applied_revision === 1, 'the first open must report revision 1');

  // Two rows prove the order and the transaction: the sync row the FK points at, and the
  // grant that points at it. Both in one commit, or neither.
  const { rows: syncRows } = await admin.query(
    'select revision, status, tenant_id from libedge_subscription_sync where source_id = $1',
    [sourceId]);
  check(syncRows.length === 1, `exactly one sync row must exist for a first open, saw ${syncRows.length}`);
  check(syncRows[0].status === 'active' && Number(syncRows[0].revision) === 1,
    'the sync row must record the applied revision and status');

  const { rows: grantRows } = await admin.query(
    `select status, subscription_source_id, scope_type, scope_id
       from grants where tenant_id = $1 and subscription_source_id = $2`,
    ['4a4a4a4a-4a4a-4a4a-8a4a-4a4a4a4a4a4a', sourceId]);
  check(grantRows.length === 1,
    `the first open must create exactly one grant, saw ${grantRows.length}`);
  check(grantRows[0].status === 'active' && grantRows[0].scope_id === SHARED_COLLECTION,
    'the grant must be active and name the requested collection');

  // The foreign key is what was violated, so assert it is the real one rather than trust
  // the file: a schema change that dropped it would make this test pass for no reason.
  const { rows: fkRows } = await admin.query(
    `select count(*)::int as n from pg_constraint
      where conname = 'grants_subscription_source_id_fkey' and contype = 'f'`);
  check(fkRows[0].n === 1,
    'grants_subscription_source_id_fkey must exist for this test to mean anything');

  // A second active revision over the same source_id takes the update path, and must also
  // succeed: the fix may not repair the insert while breaking the update. The 200 (rather
  // than 201) is what tells the two paths apart - the body carries no `created` field.
  const extended = await call('PUT', `/subscriptions/${sourceId}`, {
    body: {
      revision: 2,
      tenant: { kind: 'institution', ref: INSTITUTION },
      subject: { type: 'tenant' },
      status: 'active',
      valid_from: '2026-11-01T00:00:00Z',
      valid_to: '2028-11-01T00:00:00Z',
      lease_until: '2026-11-02T00:00:00Z',
      scopes: [{ type: 'collection', id: SHARED_COLLECTION }, { type: 'title', id: SHARED_TITLE }],
    },
  });
  check(extended.status === 200,
    `an updated active subscription must be 200, got ${extended.status} ${JSON.stringify(extended.body)}`);
  check(extended.body.replayed === false && extended.body.applied_revision === 2,
    'the second revision must be applied, not replayed');
  const { rows: afterGrants } = await admin.query(
    `select count(*)::int as n from grants
      where tenant_id = $1 and subscription_source_id = $2 and status = 'active'`,
    ['4a4a4a4a-4a4a-4a4a-8a4a-4a4a4a4a4a4a', sourceId]);
  check(afterGrants[0].n === 2,
    `the second revision must leave two active grants, saw ${afterGrants[0].n}`);
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(`\n  FAILED after ${checks} checks\n`);
  console.error(error);
  process.exit(1);
});
