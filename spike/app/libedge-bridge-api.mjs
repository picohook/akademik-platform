// The LibEdge bridge, part (a): routing.
//
// Contract: sections 5.1-5.3. One function maps a method and a path to a handler and
// one place turns whatever happened into the contract's error shape. server.mjs calls
// this and writes the result; nothing here touches `res`.
//
// Order of checks is the contract's and it matters:
//
//   configured -> token -> scope -> actor -> body
//
// configured first, so a switched-off bridge answers 503 for every path rather than
// 401, which is what lets LibEdge tell its own misconfiguration from a bad secret.
// scope before actor and body, so an unwanted caller learns nothing about validation.

import {
  BridgeError, isConfigured, tokenScope, parseActor, parseTenantPut, parseUserPut,
  parseStatusPut, parseSubscriptionPut, parseSourceId, subscriptionPayloadSha256,
  assertLeaseWithinCeiling, slugProblem, parseLimit,
} from './libedge-bridge.mjs';
import {
  upsertTenant, readTenant, preProvisionUser, applyAccountStatus, applyMembershipStatus,
  applySubscriptionSync, readSubscription, resolveTenant, withBridgeAdmin,
  readCatalogPage, readCatalogWork,
} from './libedge-bridge-db.mjs';

const ACCOUNT_STATUSES = ['active', 'disabled'];
const MEMBERSHIP_STATUSES = ['active', 'revoked'];
const TENANT_KINDS = ['institution', 'individual', 'staff'];

// The routes as patterns rather than a regex zoo: each path segment is either a
// literal or a capture, and the table is read top to bottom.
//
// `scope` is the token kind the contract requires for that endpoint (5.3). null means
// no token at all, which in v1 is health only.
const ROUTES = [
  { method: 'GET', pattern: '/health', scope: null, handler: health },
  { method: 'PUT', pattern: '/tenants/:kind/:ref', scope: 'entitlements', handler: putTenant },
  { method: 'GET', pattern: '/tenants/:kind/:ref', scope: 'entitlements', handler: getTenant },
  { method: 'PUT', pattern: '/tenants/:kind/:ref/users/:uid', scope: 'entitlements', handler: putUser },
  {
    method: 'PUT',
    pattern: '/tenants/:kind/:ref/memberships/:uid',
    scope: 'entitlements',
    handler: putMembership,
  },
  { method: 'PUT', pattern: '/accounts/:uid', scope: 'entitlements', handler: putAccount },
  { method: 'PUT', pattern: '/subscriptions/:sourceId', scope: 'entitlements', handler: putSubscription },
  { method: 'GET', pattern: '/subscriptions/:sourceId', scope: 'entitlements', handler: getSubscription },
  // The catalogue half. These run on the catalog pool (§4.3), and the difference is
  // not cosmetic: the reader-facing reads below are entitlements and run as
  // `akademik_app`, while publishing and curating run as `akademik_catalog`. A route
  // in the wrong half would be rejected by the policies in 022 rather than here, which
  // is a 500 instead of a 403 - so the scope is stated per route, once.
  { method: 'GET', pattern: '/catalog', scope: 'entitlements', handler: listCatalogWorks },
  { method: 'GET', pattern: '/catalog/works/:id', scope: 'entitlements', handler: getCatalogWork },
];

function matchRoute(method, pathname) {
  // The path is split on the RAW separators and each segment is decoded once, here. Decoding
  // the whole pathname first (which this used to do one level up) silently widens it: a ref
  // of `a%2Fb` became two segments, so `/tenants/institution/a%2Fb` was read as a different
  // route instead of being rejected. And decoding twice (`%2541` - a caller's literal
  // `%41`) turned into `A`, which is neither what the caller meant nor what they stored.
  const decoded = decodeSegments(pathname);

  for (const route of ROUTES) {
    if (route.method !== method) continue;
    const parts = route.pattern.split('/');
    if (parts.length !== decoded.length) continue;
    const params = {};
    let ok = true;
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      if (part.startsWith(':')) {
        // An empty segment is not a value: `/tenants/institution/` must not match with
        // ref = ''.
        if (!decoded[index]) { ok = false; break; }
        params[part.slice(1)] = decoded[index];
      } else if (part !== decoded[index]) {
        ok = false;
        break;
      }
    }
    if (ok) return { route, params };
  }
  return null;
}

// One decode per segment, and a segment that decodes to something containing a separator is
// refused rather than accepted. `/` inside a ref would make the id ambiguous between
// `/tenants/:kind/:ref` and `/tenants/:kind/:ref/users/:uid`: the request would address a
// path the caller did not write. The bridge answers 400 INVALID_PATH, the same shape as any
// other bad request, so LibEdge does not have to special-case it.
function decodeSegments(pathname) {
  const raw = String(pathname).split('/');
  return raw.map((segment) => {
    let value;
    try {
      value = decodeURIComponent(segment);
    } catch {
      // A stray `%` (e.g. `100%`) is malformed percent-encoding, not text.
      throw new BridgeError(400, 'INVALID_PATH', 'malformed percent-encoding in the path');
    }
    if (value.includes('/')) {
      throw new BridgeError(400, 'INVALID_PATH', 'an encoded "/" is not allowed in a path segment');
    }
    return value;
  });
}

// The bridge answers in its own error shape for everything, including "no such path" -
// a 404 with a plain-text body would be a parse error on the LibEdge side.
function failure(error, requestId) {
  const body = { error: error.code, request_id: requestId };
  if (error.detail) body.detail = error.detail;
  if (error.appliedRevision !== undefined) body.applied_revision = error.appliedRevision;
  return { status: error.status, body };
}


// What a handler returns is the body; the status is 200 unless it says otherwise.
// Written as { status, body } so a 201 (a tenant or sync row was created) is explicit
// at the handler rather than inferred here from the shape of the payload.
export async function handleBridgeRequest({
  env, pool, catalogPool, method, pathname, headers, body, query = {}, requestId, now,
}) {
  // `now` is an argument so a test can place the clock; production passes new Date().
  const clock = now || new Date();
  try {
    if (!isConfigured(env)) {
      throw new BridgeError(503, 'BRIDGE_NOT_CONFIGURED', 'no bridge token is configured');
    }

    const match = matchRoute(method, pathname);
    if (!match) {
      // Unknown path under /api/libedge/v1. Not in the contract's table, because a
      // correct caller never produces it; 404 NOT_FOUND is the honest answer and it
      // still carries the standard body.
      throw new BridgeError(404, 'NOT_FOUND', `no route for ${method} ${pathname}`);
    }

    const { route, params } = match;
    if (route.scope) {
      const scope = tokenScope(env, headers.authorization);
      if (!scope) throw new BridgeError(401, 'UNAUTHORIZED', 'token missing or not recognised');
      if (scope !== route.scope) {
        throw new BridgeError(403, 'TOKEN_SCOPE', `this endpoint needs the ${route.scope} token`);
      }
    }
    // health takes no actor: it is the one endpoint a monitoring probe calls.
    const actor = route.scope ? parseActor(headers) : null;

    // Which connection pool the handler runs on is decided here, from the route's
    // scope, and nowhere else. It is not a second authorisation step - the token was
    // checked above - it is the contract's separation of roles made real: a catalog
    // request runs as `akademik_catalog` and can touch global rows, an entitlements
    // request runs as `akademik_app` and cannot. A handler that reached for the wrong
    // pool would be writing with a role the policy does not expect, so the choice
    // lives next to the route table rather than inside each handler.
    const routePool = route.scope === 'catalog' ? catalogPool : pool;
    if (!routePool) {
      // Configured but not connected: an operator error, and distinct from a bad
      // request so it does not send LibEdge retrying a body that was fine. The
      // catalog message names the variable, because the fix is in the environment
      // rather than in the code, and the two pools are configured separately.
      throw new BridgeError(503, 'DATABASE_UNAVAILABLE', route.scope === 'catalog'
        ? 'DATABASE_CATALOG_URL is not set: the catalog path needs its own pool'
        : 'no database pool');
    }

    const result = await route.handler({
      env, pool: routePool, params, body, query, actor, requestId, now: clock,
    });
    return { status: result?.status || 200, body: result?.body || {} };
  } catch (error) {
    if (error instanceof BridgeError) return failure(error, requestId);
    // A database error that is not a BridgeError is still the caller's to retry, not a
    // 500 they cannot act on. 42703/42P01/3F000 mean the schema is older than this code
    // - which is what a bridge deployed before 021/022/024 looks like - so it is
    // reported as unavailable rather than as a server fault.
    if (error?.code === '42703' || error?.code === '42P01' || error?.code === '3F000') {
      return failure(new BridgeError(503, 'DATABASE_UNAVAILABLE',
        `schema is not the expected version (${error.code})`), requestId);
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function health({ pool }) {
  // A real query, as the contract asks: a health check that only proves the process
  // is alive is the one signal that never fails when it should.
  //
  // What it may count is limited by the policy it runs under. `withBridgeAdmin` binds no
  // tenant, and `tenants_self` shows akademik_app nothing without one - measured on a
  // database with four tenants, `select count(*) from tenants` returns 0. Counting
  // tenants here would therefore report 0 forever and look like a healthy, empty
  // installation. What is counted instead is what is genuinely visible with no binding:
  // the global catalogue, which has no tenant policy at all.
  const rows = await withBridgeAdmin(pool, async (client) => {
    const { rows: inner } = await client.query(
      `select (select count(*)::int from works where tenant_id is null) as global_works,
              (select count(*)::int from collections where tenant_id is null) as global_collections`,
    );
    return inner;
  });
  // `schema` is the version marker the bridge needs: without 021/022/025 the counts
  // above throw and the caller gets DATABASE_UNAVAILABLE, so reaching this line at all
  // is the assertion that the schema is at least as new as this code.
  return { body: { ok: true, schema: 'libedge-v1', ...rows[0] } };
}

async function putTenant({ pool, params, body }) {
  // The path segment goes through the same rules as a body field, because `kind` from
  // a URL is just as untrusted as `kind` in JSON.
  if (!TENANT_KINDS.includes(params.kind)) {
    throw new BridgeError(400, 'INVALID_BODY',
      'tenant kind must be institution, individual or staff');
  }
  const parsed = parseTenantPut(body);
  const problem = slugProblem(parsed.slug);
  if (problem) throw new BridgeError(400, 'INVALID_BODY', problem);
  // Only institution is provisionable, which 025 enforces too. Checking here means the
  // caller gets the code and the contract's error shape rather than a plpgsql exception.
  if (params.kind !== 'institution') {
    throw new BridgeError(422, 'TENANT_KIND_NOT_PROVISIONABLE',
      `a ${params.kind} tenant is provisioned with the deployment, not through the bridge`);
  }
  const result = await upsertTenant(pool, params.kind, params.ref, parsed);
  return {
    status: result.created ? 201 : 200,
    body: {
      tenant: {
        id: result.tenant.id,
        name: result.tenant.name,
        // Not parsed.slug: on an existing tenant the stored slug is what comes back,
        // because 025 does not rewrite it. Echoing the request would be a lie the
        // caller could not detect - it would send a new slug, get 200, and find the
        // old one still in every URL.
        slug: result.tenant.slug,
        status: result.tenant.status,
        kind: params.kind,
        ref: params.ref,
      },
    },
  };
}

async function getTenant({ pool, params }) {
  const row = await readTenant(pool, params.kind, params.ref);
  return {
    body: {
      tenant: {
        id: row.id, name: row.name, slug: row.slug, status: row.status,
        kind: params.kind, ref: params.ref,
      },
    },
  };
}

async function putUser({ pool, params, body }) {
  const parsed = parseUserPut(body);
  const result = await preProvisionUser(pool, params.kind, params.ref, params.uid, parsed);
  return {
    status: result.created ? 201 : 200,
    body: {
      user: { id: result.user.id, email: result.user.email, name: result.user.display_name },
    },
  };
}

async function putAccount({ pool, params, body }) {
  const parsed = parseStatusPut(body, 'status', ACCOUNT_STATUSES);
  return { body: await applyAccountStatus(pool, params.uid, parsed) };
}

async function putMembership({ pool, params, body }) {
  const parsed = parseStatusPut(body, 'status', MEMBERSHIP_STATUSES);
  return { body: await applyMembershipStatus(pool, params.kind, params.ref, params.uid, parsed) };
}

async function putSubscription({ pool, params, body, env, now, requestId }) {
  parseSourceId(params.sourceId);
  const parsed = parseSubscriptionPut(body);
  const payloadSha256 = subscriptionPayloadSha256(parsed);

  // The lease ceiling is checked on opening requests only. It is a validation, and
  // section 5.4 says a closing request is not validated - the ceiling could not prevent
  // a revocation anyway, since a closing request carries no lease.
  if (parsed.status === 'active') assertLeaseWithinCeiling(parsed.leaseUntil, now, env);

  const result = await applySubscriptionSync(pool, params.sourceId, parsed, payloadSha256);
  return {
    status: result.created ? 201 : 200,
    body: {
      source_id: params.sourceId,
      applied_revision: result.applied_revision,
      replayed: result.replayed,
      status: result.status,
      lease_until: result.lease_until ? new Date(result.lease_until).toISOString() : null,
      grants: result.grants.map((grant) => ({
        id: grant.id,
        scope_type: grant.scope_type,
        scope_id: grant.scope_id,
        status: grant.status,
        valid_from: new Date(grant.valid_from).toISOString(),
        valid_to: grant.valid_to ? new Date(grant.valid_to).toISOString() : null,
      })),
      request_id: requestId,
    },
  };
}

async function getSubscription({ pool, params, now }) {
  const row = await readSubscription(pool, params.sourceId);
  // Section 6.3: access also closes by lease expiry, so the answer reports BOTH the
  // stored lease and whether it has run out as of now. A caller that only looked at
  // `lease_until` would believe a lapsed subscription is still active.
  const leaseExpired = row.status === 'active'
    && row.lease_until !== null
    && new Date(row.lease_until).getTime() <= now.getTime();
  return {
    body: {
      source_id: row.source_id,
      applied_revision: Number(row.revision),
      status: row.status,
      lease_until: row.lease_until ? new Date(row.lease_until).toISOString() : null,
      lease_expired: leaseExpired,
      subject: row.subject_type === 'user'
        ? { type: 'user', libedge_user_id: row.subject_user_id }
        : { type: 'tenant' },
      applied_at: new Date(row.applied_at).toISOString(),
    },
  };
}


// ---------------------------------------------------------------------------
// GET /catalog and GET /catalog/works/{id}  (section 5.5)
// ---------------------------------------------------------------------------

// `limit` goes through the same parser as every other page size, so the bound and the
// error text are the contract's in one place. `offset` is not in the contract, which
// means an unexpected value must be refused rather than passed to SQL: a negative or
// non-numeric offset would be either an error the caller cannot read or a silently
// different page.
function parseOffset(raw) {
  if (raw === undefined || raw === null || raw === '') return 0;
  if (!/^\d+$/.test(String(raw))) throw new BridgeError(400, 'INVALID_BODY', 'offset must be an integer');
  return Number(raw);
}

async function listCatalogWorks({ pool, query }) {
  const limit = parseLimit(query.limit);
  const offset = parseOffset(query.offset);
  const page = await readCatalogPage(pool, { limit, offset });
  return { body: page };
}

async function getCatalogWork({ pool, params }) {
  // The id reaches SQL as a parameter, but a malformed one would surface as a
  // Postgres 22P02 ("invalid input syntax for type uuid") and be thrown on as a 500.
  // A caller that mistypes an id should get the contract's 404, not a server fault.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.id)) {
    throw new BridgeError(404, 'WORK_NOT_FOUND', `no global work "${params.id}"`);
  }
  return { body: { work: await readCatalogWork(pool, params.id) } };
}

