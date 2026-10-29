// The LibEdge bridge, part (a): the database side.
//
// Contract: docs/contracts/libedge-elibrary-v1.md @ b15f8b5, sections 2.5, 3.2, 3.3,
// 5.3, 5.4.
//
// Everything here takes a `pool` and opens its own transaction. Two reasons:
//
//   * The sync and the account/membership writes take per-identity advisory locks
//     (2.6). A lock only means anything inside one transaction, so the transaction
//     boundary has to be here, not left to the caller - a caller that ran two halves
//     on two connections would silently lose the lock.
//   * The bridge writes as `akademik_app`, which is subject to FORCE RLS. Which
//     tenant a statement runs in is decided by `app.tenant_id` on the connection, so
//     the connection that sets it must be the one that runs the statements.
//
// The shape is therefore: `withBridgeTenant` for tenant-scoped work and
// `withBridgeAdmin` for rows with no tenant of their own (tenants themselves,
// libedge_accounts, the subscription sync row, and lookups by (kind, ref)).

import { BridgeError, revisionDecision } from './libedge-bridge.mjs';

const notFound = (code, detail) => new BridgeError(404, code, detail);
const conflict = (code, detail) => new BridgeError(409, code, detail);
const unprocessable = (code, detail) => new BridgeError(422, code, detail);

// `set_config(..., false)` and not `set local`: the value must survive every statement
// in the callback and is cleared by the `reset` in the finally block. If the reset were
// skipped the next request to borrow this connection would run inside the previous
// request's tenant - the exact leak the tenant scheme exists to prevent - so it is in a
// finally, not after the happy path.
export async function withBridgeTenant(pool, tenantId, fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('app.tenant_id', $1, false)", [String(tenantId)]);
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    await client.query('reset app.tenant_id').catch(() => {});
    client.release();
  }
}

// No app.tenant_id is set here, and that is deliberate: these rows have no tenant
// policy, and setting one anyway would make a later mistake (reading a tenant table
// here) look like it worked.
export async function withBridgeAdmin(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// Section 2.6: one lock per LibEdge identity, so SSO, pre-provisioning, account and
// membership changes and subscription sync for the same person serialise instead of
// racing. `hashtext` runs on the server, which is what the contract specifies -
// hashing in node would produce a different number and so a different lock.
export async function lockLibedgeUser(client, libedgeUserId) {
  await client.query('select pg_advisory_xact_lock(hashtext($1))',
    [`libedge-user:${libedgeUserId}`]);
}

export async function lockSubscription(client, sourceId) {
  await client.query('select pg_advisory_xact_lock(hashtext($1))',
    [`libedge-sub:${sourceId}`]);
}

// Section 3.2: a context maps to exactly one tenant through (libedge_kind, libedge_ref),
// which 021 made unique. Resolved rather than assumed so the same code runs on a fresh
// database and on EC2, where the uuids differ.
//
// The plain query this used to be returns nothing, and that is not a data problem: the
// resolution happens before any tenant is bound, and `tenants_self` with nothing bound
// denies every row - `select count(*) from tenants` as akademik_app is 0 on a database
// with four tenants in it. 024 documents the same trap for the timers. app.libedge_tenant_by_ref
// (025) is the request-side answer, in the shape 018 already established for login.
//
// The return shape is kept as the row the rest of this file reads: `id`, `status` and the
// two context columns.
export async function resolveTenant(client, kind, ref) {
  const { rows } = await client.query(
    'select tenant_id as id, status from app.libedge_tenant_by_ref($1, $2)',
    [kind, String(ref)],
  );
  return rows[0] || null;
}

async function tenantOr404(client, kind, ref) {
  const tenant = await resolveTenant(client, kind, ref);
  if (!tenant) throw notFound('TENANT_NOT_FOUND', `no ${kind} tenant "${ref}"`);
  return tenant;
}

// ---------------------------------------------------------------------------
// PUT /tenants/{kind}/{ref}  (section 5.3)
// ---------------------------------------------------------------------------

// Creating a tenant is not tenant-scoped work: the row does not belong to anyone yet
// and the caller is LibEdge provisioning an institution. So this runs with no
// app.tenant_id.
//
// It cannot be an INSERT from here. `tenants` is FORCE ROW LEVEL SECURITY and
// `tenants_self` has no `with check`, so the INSERT is judged by `id = app.tenant_id` -
// and the id is what the insert is producing. Measured: akademik_app gets 42501 on the
// create path. app.libedge_upsert_tenant (025) is the deliberate exception, in the same
// shape as app.tenant_for_login (018) and app.maintenance_tenants (024): it owns the id,
// decides the slug clash under a lock, and refuses every kind but 'institution'.
//
// Because the function owns the decision, the slug clash is not checked here first. A
// check here and a check there would be two answers to one question, and the one that
// loses the race is the one that produces a 500.
export async function upsertTenant(pool, kind, ref, body) {
  return withBridgeAdmin(pool, async (client) => {
    if (kind !== 'institution') {
      // 025 raises the same refusal. Failing here as well keeps the answer a 400 with a
      // code instead of a 500 from a plpgsql exception, for a caller mistake that is
      // entirely checkable without a round trip.
      throw unprocessable('TENANT_KIND_NOT_PROVISIONABLE',
        `a ${kind} tenant is provisioned with the deployment, not through the bridge`);
    }

    let rows;
    try {
      ({ rows } = await client.query(
        `select tenant_id, name, slug, status, created
           from app.libedge_upsert_tenant($1, $2, $3, $4, $5)`,
        [kind, String(ref), body.name, body.slug, body.status],
      ));
    } catch (error) {
      // The two refusals the function makes that are the caller's to fix. Matched on the
      // message because 025 reports both as P0001: a single SQLSTATE has to cover every
      // `raise exception` in the file, so the state alone cannot tell them apart.
      if (error?.code === 'P0001' && /is already held by tenant/.test(error.message || '')) {
        throw conflict('TENANT_SLUG_TAKEN', `slug "${body.slug}" belongs to another tenant`);
      }
      if (error?.code === 'P0001' && /may not be provisioned/.test(error.message || '')) {
        throw unprocessable('TENANT_KIND_NOT_PROVISIONABLE', error.message);
      }
      throw error;
    }

    const row = rows[0];
    return {
      created: row.created,
      tenant: { id: row.tenant_id, name: row.name, slug: row.slug, status: row.status },
    };
  });
}

export async function readTenant(pool, kind, ref) {
  // Resolve first, then read the row with the tenant actually bound. This is the one place
  // where the two-step is not paranoia: tenants_self shows akademik_app its own row and
  // nothing else, so a GET that answered from the definer lookup could only ever return
  // the columns that lookup exposes - and widening it to name and slug would turn 025's
  // narrow resolver into a way to read any tenant's metadata by guessing a ref.
  const resolved = await withBridgeAdmin(pool, (client) => tenantOr404(client, kind, ref));
  return withBridgeTenant(pool, resolved.id, async (client) => {
    const { rows } = await client.query(
      'select id, name, slug, status from tenants where id = $1', [resolved.id]);
    // Not a redundant check: if the binding did not take, the row is invisible and this is
    // the assertion that says so, rather than a body full of undefineds.
    if (!rows.length) {
      throw new BridgeError(404, 'TENANT_NOT_FOUND',
        `tenant ${resolved.id} was resolved but is not readable under its own binding`);
    }
    return rows[0];
  });
}

// ---------------------------------------------------------------------------
// PUT /tenants/{kind}/{ref}/users/{uid}  (section 3.3)
// ---------------------------------------------------------------------------

// Pre-provisioning. Section 3.3 is explicit that this runs the same checks as SSO and
// that a disabled account or revoked membership means the row is NOT created: the point
// of pre-provisioning is to have the row ready, not to force it into existence past a
// revocation that arrived first.
export async function preProvisionUser(pool, kind, ref, libedgeUserId, body) {
  return withBridgeTenantFor(pool, kind, ref, async (client, tenant) => {
    await lockLibedgeUser(client, libedgeUserId);

    const account = await client.query(
      'select status from libedge_accounts where libedge_user_id = $1', [libedgeUserId]);
    if (account.rows[0]?.status === 'disabled') {
      throw conflict('ACCOUNT_DISABLED', 'the LibEdge account is disabled');
    }
    const membership = await client.query(
      'select status from libedge_memberships where tenant_id = $1 and libedge_user_id = $2',
      [tenant.id, libedgeUserId]);
    if (membership.rows[0]?.status === 'revoked') {
      throw conflict('MEMBERSHIP_REVOKED', 'the membership in this tenant is revoked');
    }

    const existing = await client.query(
      'select id from users where tenant_id = $1 and libedge_user_id = $2',
      [tenant.id, libedgeUserId]);
    if (existing.rows.length) {
      const { rows } = await client.query(
        `update users set email = $2, display_name = $3 where id = $1
         returning id, email, display_name, status`,
        [existing.rows[0].id, body.email, body.name]);
      return { created: false, user: rows[0] };
    }
    // A row for the same e-mail with no LibEdge id predates the bridge. Linking it
    // automatically would be an identity decision this endpoint has no standing to make
    // - the contract keys identity on (tenant, libedge_user_id), not e-mail - so it is
    // reported instead of guessed at.
    const byEmail = await client.query(
      'select id from users where tenant_id = $1 and email = $2 and libedge_user_id is null',
      [tenant.id, body.email]);
    if (byEmail.rows.length) {
      throw conflict('USER_EMAIL_TAKEN',
        'a pre-bridge user with this e-mail exists in the tenant and carries no LibEdge id');
    }
    const { rows } = await client.query(
      `insert into users (tenant_id, email, display_name, libedge_user_id, role)
       values ($1, $2, $3, $4, 'reader')
       returning id, email, display_name, status`,
      [tenant.id, body.email, body.name, libedgeUserId]);
    return { created: true, user: rows[0] };
  });
}

// Resolving the tenant needs to see every tenant, which is admin work; the tenant-bound
// work then needs app.tenant_id. Doing the lookup inside the same transaction would
// mean it ran with a setting bound, so the two are separate transactions and the gap
// is harmless: a tenant cannot be deleted out from under a bridge call (nothing here
// deletes tenants) and if it somehow were, the FK and the following statements fail
// loudly rather than granting in the wrong tenant.
async function withBridgeTenantFor(pool, kind, ref, fn) {
  const tenant = await withBridgeAdmin(pool, (client) => tenantOr404(client, kind, ref));
  return withBridgeTenant(pool, tenant.id, (client) => fn(client, tenant));
}

// ---------------------------------------------------------------------------
// PUT /accounts/{uid}  (section 2.5)
// ---------------------------------------------------------------------------

// A revocation has to outlive the user row, which is why this writes libedge_accounts
// rather than users.status: the account may be disabled before the person ever signs
// in, and a row that does not exist cannot be updated.
//
// The fingerprint is just the status - an account has no other content - so "same
// revision, same status" is the whole replay definition.
export async function applyAccountStatus(pool, libedgeUserId, parsed) {
  return withBridgeAdmin(pool, async (client) => {
    await lockLibedgeUser(client, libedgeUserId);
    const { rows } = await client.query(
      'select status, revision from libedge_accounts where libedge_user_id = $1',
      [libedgeUserId],
    );
    const current = rows[0] || null;
    const decision = revisionDecision(
      current ? { revision: Number(current.revision), payload_sha256: current.status } : null,
      { revision: parsed.revision, payload_sha256: parsed.status },
    );
    if (decision.replayed) {
      return {
        applied_revision: Number(current.revision), replayed: true, status: current.status,
      };
    }

    await client.query(
      `insert into libedge_accounts (libedge_user_id, status, revision, changed_at)
       values ($1, $2, $3, now())
       on conflict (libedge_user_id)
       do update set status = excluded.status, revision = excluded.revision, changed_at = now()`,
      [libedgeUserId, parsed.status, parsed.revision],
    );

    // Section 2.5: disabling drops the sessions of every user row for this LibEdge id,
    // in every tenant. One statement over users by libedge_user_id, so a person with
    // rows in two tenants does not keep a live session in the context this request was
    // not about. session_version is this project's own session mechanism.
    if (parsed.status === 'disabled') {
      await client.query(
        'update users set session_version = session_version + 1 where libedge_user_id = $1',
        [libedgeUserId],
      );
    }
    return { applied_revision: parsed.revision, replayed: false, status: parsed.status };
  });
}

// ---------------------------------------------------------------------------
// PUT /tenants/{kind}/{ref}/memberships/{uid}  (section 2.5)
// ---------------------------------------------------------------------------

// Tenant-scoped: the row names a tenant and 021 FORCEs RLS on it. `revoked` drops that
// user's sessions in this tenant only - the other contexts the person may be in are
// untouched, which is exactly what section 2.5 asks for.
export async function applyMembershipStatus(pool, kind, ref, libedgeUserId, parsed) {
  return withBridgeTenantFor(pool, kind, ref, async (client, tenant) => {
    await lockLibedgeUser(client, libedgeUserId);
    const { rows } = await client.query(
      'select status, revision from libedge_memberships where tenant_id = $1 and libedge_user_id = $2',
      [tenant.id, libedgeUserId],
    );
    const current = rows[0] || null;
    const decision = revisionDecision(
      current ? { revision: Number(current.revision), payload_sha256: current.status } : null,
      { revision: parsed.revision, payload_sha256: parsed.status },
    );
    if (decision.replayed) {
      return {
        applied_revision: Number(current.revision), replayed: true, status: current.status,
      };
    }

    await client.query(
      `insert into libedge_memberships (tenant_id, libedge_user_id, status, revision, changed_at)
       values ($1, $2, $3, $4, now())
       on conflict (tenant_id, libedge_user_id)
       do update set status = excluded.status, revision = excluded.revision, changed_at = now()`,
      [tenant.id, libedgeUserId, parsed.status, parsed.revision],
    );

    if (parsed.status === 'revoked') {
      await client.query(
        `update users set session_version = session_version + 1
          where tenant_id = $1 and libedge_user_id = $2`,
        [tenant.id, libedgeUserId],
      );
    }
    return { applied_revision: parsed.revision, replayed: false, status: parsed.status };
  });
}

// ---------------------------------------------------------------------------
// PUT /subscriptions/{source_id}  (section 5.4)
// ---------------------------------------------------------------------------
//
// The order below is the contract's step list, not an invention:
//
//   1. advisory lock on the subscription
//   2. fingerprint the payload (the caller's, because it is pure)
//   3. owner check - a source_id may not be repointed at another tenant or subject
//   4. revision decision
//   5. apply, on one of two paths
//   6. write the sync row and the audit
//
// The one thing worth stating twice: the closing path validates NOTHING beyond shape.
// A tenant may be inactive, the user may be disabled, revoked or never exist, and the
// scopes may name works that left the catalogue - none of that may stop access from
// closing. That asymmetry is deliberate: failing to grant is recoverable, failing to
// revoke is not.

const CLOSING_GRANT_STATUS = { suspended: 'pending', cancelled: 'revoked' };

export async function applySubscriptionSync(pool, sourceId, parsed, payloadSha256) {
  const tenant = await withBridgeAdmin(pool,
    (client) => tenantOr404(client, parsed.tenant.kind, parsed.tenant.ref));

  return withBridgeTenant(pool, tenant.id, async (client) => {
    await lockSubscription(client, sourceId);

    const { rows } = await client.query(
      `select source_id, tenant_id, subject_type, subject_user_id, revision,
              payload_sha256, status, lease_until
         from libedge_subscription_sync where source_id = $1`,
      [sourceId],
    );
    const existing = rows[0] || null;

    // Step 3 before step 4. If the owner moved, the revision numbers describe
    // different subscriptions and comparing them is meaningless - the contract says
    // OWNER_MISMATCH, not STALE_REVISION.
    if (existing) {
      const sameTenant = existing.tenant_id === tenant.id;
      const sameSubject = existing.subject_type === parsed.subject.type
        && (parsed.subject.type === 'tenant'
          ? true
          : existing.subject_user_id === parsed.subject.libedge_user_id);
      if (!sameTenant || !sameSubject) {
        throw conflict('OWNER_MISMATCH',
          'source_id is bound to another tenant or subject; cancel the old one and use a new source_id');
      }
    }

    const decision = revisionDecision(
      existing
        ? { revision: Number(existing.revision), payload_sha256: existing.payload_sha256 }
        : null,
      { revision: parsed.revision, payload_sha256: payloadSha256 },
    );

    if (decision.replayed) {
      // A replay may extend the lease and never shorten it. `greatest` against the
      // stored value is what makes that true even if the caller sends an older lease;
      // acceptance test 9 ("eski revision lease'i uzatmaz; replay lease'i geri
      // cekmez") is exactly these lines. A closing replay has no lease at all.
      let leaseUntil = existing.lease_until;
      if (parsed.status === 'active') {
        const updated = await client.query(
          `update libedge_subscription_sync set lease_until = greatest(lease_until, $2)
            where source_id = $1 and status = 'active' returning lease_until`,
          [sourceId, parsed.leaseUntil],
        );
        leaseUntil = updated.rows[0]?.lease_until ?? leaseUntil;
      }
      return {
        status: existing.status,
        applied_revision: Number(existing.revision),
        replayed: true,
        created: false,
        lease_until: leaseUntil,
        grants: await readGrants(client, tenant.id, sourceId),
      };
    }

    if (parsed.status === 'active') {
      await applyAccessOpen(client, tenant, sourceId, parsed, payloadSha256);
    } else {
      await applyAccessClose(client, tenant, sourceId, parsed, payloadSha256);
    }

    return {
      status: parsed.status,
      applied_revision: parsed.revision,
      replayed: false,
      created: !existing,
      lease_until: parsed.status === 'active' ? parsed.leaseUntil : null,
      grants: await readGrants(client, tenant.id, sourceId),
    };
  });
}

async function readGrants(client, tenantId, sourceId) {
  const { rows } = await client.query(
    `select id, scope_type, scope_id, status, valid_from, valid_to
       from grants where tenant_id = $1 and subscription_source_id = $2
      order by scope_type, scope_id`,
    [tenantId, sourceId],
  );
  return rows;
}

// --- opening access: every check, then the grants ---------------------------

async function applyAccessOpen(client, tenant, sourceId, parsed, payloadSha256) {
  // Section 5.4 step 5, first gate: a tenant that is not active grants nothing. This
  // lives in the opening path only, so a closing request can never be routed through it.
  if (tenant.status !== 'active') {
    throw conflict('TENANT_INACTIVE', 'the tenant is not active');
  }

  let userId = null;
  if (parsed.subject.type === 'user') {
    const libedgeUserId = parsed.subject.libedge_user_id;
    await lockLibedgeUser(client, libedgeUserId);

    const account = await client.query(
      'select status from libedge_accounts where libedge_user_id = $1', [libedgeUserId]);
    if (account.rows[0]?.status === 'disabled') {
      throw conflict('ACCOUNT_DISABLED', 'the LibEdge account is disabled');
    }
    const membership = await client.query(
      'select status from libedge_memberships where tenant_id = $1 and libedge_user_id = $2',
      [tenant.id, libedgeUserId]);
    if (membership.rows[0]?.status === 'revoked') {
      throw conflict('MEMBERSHIP_REVOKED', 'the membership in this tenant is revoked');
    }
    // Section 3.3: subscription sync does NOT create the user row. Creating it here
    // would let a sync grant access to someone who never completed SSO.
    const user = await client.query(
      'select id from users where tenant_id = $1 and libedge_user_id = $2',
      [tenant.id, libedgeUserId]);
    if (!user.rows.length) {
      throw notFound('USER_NOT_FOUND', 'pre-provision the user before opening access');
    }
    userId = user.rows[0].id;
  }

  const scopes = await validateScopes(client, parsed.scopes);

  // Create or update one grant per scope. subject_id is the user row for a user
  // subject and the tenant itself for a tenant subject: grants.subject_type
  // distinguishes the two, and subject_id is what the reader checks against. The
  // staff tenant's manual 'all' grant (020) carries no subscription_source_id, so
  // nothing below can match it.
  //
  // Written as update-then-insert rather than an upsert because `grants` has no unique
  // constraint to conflict on, and adding one would be a schema change this PR has no
  // business making. The advisory lock means no other writer is touching this
  // source_id, so the two statements cannot interleave.
  for (const scope of scopes) {
    const updated = await client.query(
      `update grants
          set status = 'active', valid_from = $3, valid_to = $4
        where tenant_id = $1 and subscription_source_id = $2
          and scope_type = $5 and scope_id = $6`,
      [tenant.id, sourceId, parsed.validFrom, parsed.validTo, scope.type, scope.id],
    );
    if (updated.rowCount === 0) {
      await client.query(
        `insert into grants (tenant_id, subject_type, subject_id, scope_type, scope_id,
                             valid_from, valid_to, source, status, subscription_source_id)
         values ($1, $2, $3, $4, $5, $6, $7, 'subscription', 'active', $8)`,
        [tenant.id, parsed.subject.type, userId ?? tenant.id, scope.type, scope.id,
          parsed.validFrom, parsed.validTo, sourceId],
      );
    }
  }

  // Scopes no longer in the request are revoked, not deleted: the row records what this
  // subscription once granted, and the reader filters on status.
  //
  // The condition names each wanted scope as a (type, id) PAIR. Comparing the type
  // lists and the id lists separately would be wrong: a collection scope and a title
  // scope would both survive because each one's type is wanted and each one's id is
  // wanted - just never together.
  await client.query(
    `update grants set status = 'revoked'
      where tenant_id = $1 and subscription_source_id = $2
        and not exists (
          select 1 from unnest($3::text[], $4::uuid[]) as w(scope_type, scope_id)
           where w.scope_type = grants.scope_type and w.scope_id = grants.scope_id
        )`,
    [tenant.id, sourceId, scopes.map((scope) => scope.type), scopes.map((scope) => scope.id)],
  );

  await writeSyncRow(client, tenant.id, sourceId, parsed, payloadSha256, scopes, userId);
  await writeAudit(client, tenant.id, sourceId, {
    action: 'update',
    status: parsed.status,
    revision: parsed.revision,
    scopes: scopes.map((scope) => `${scope.type}:${scope.id}`),
  });
}

// A scope must name something in the global catalogue. `tenant_id is null` is the
// global catalogue; a tenant-owned work is not shareable, so a scope naming one is
// UNKNOWN_SCOPE rather than a silent grant that never matches anything.
async function validateScopes(client, scopes) {
  if (!scopes.length) return [];
  const collectionIds = scopes.filter((s) => s.type === 'collection').map((s) => s.id);
  const titleIds = scopes.filter((s) => s.type === 'title').map((s) => s.id);

  const found = [];
  if (collectionIds.length) {
    const { rows } = await client.query(
      'select id from collections where tenant_id is null and id = any($1::uuid[])',
      [collectionIds]);
    found.push(...rows.map((row) => ({ type: 'collection', id: row.id })));
  }
  if (titleIds.length) {
    const { rows } = await client.query(
      'select id from works where tenant_id is null and id = any($1::uuid[])',
      [titleIds]);
    found.push(...rows.map((row) => ({ type: 'title', id: row.id })));
  }

  // Reported by id, so LibEdge can say which scope is the problem instead of "one of
  // them". Deduplicated on the way out: the same scope twice in one request is one
  // grant, not two.
  const foundKeys = new Set(found.map((scope) => `${scope.type}:${scope.id}`));
  const missing = scopes
    .map((scope) => `${scope.type}:${scope.id}`)
    .filter((key) => !foundKeys.has(key));
  if (missing.length) {
    throw unprocessable('UNKNOWN_SCOPE', `not in the global catalogue: ${missing.join(', ')}`);
  }
  return [...new Map(found.map((scope) => [`${scope.type}:${scope.id}`, scope])).values()];
}

// --- closing access: no check may stand in the way --------------------------

// Section 5.4 is emphatic that nothing here validates: not the tenant's status, not the
// user's existence or state, not whether the scopes are still in the catalogue. Every
// one of those is a way for a revocation to be refused, and a refused revocation is
// worse than a refused grant - the reader keeps access it should not have.
//
// This function therefore reads nothing to decide. It updates what carries this
// source_id, and writes the sync row.
async function applyAccessClose(client, tenant, sourceId, parsed, payloadSha256) {
  const target = CLOSING_GRANT_STATUS[parsed.status];
  await client.query(
    `update grants set status = $3
      where tenant_id = $1 and subscription_source_id = $2 and status <> $3`,
    [tenant.id, sourceId, target],
  );
  await writeSyncRow(client, tenant.id, sourceId, parsed, payloadSha256, [], null);
  await writeAudit(client, tenant.id, sourceId, {
    action: 'revoke',
    status: parsed.status,
    revision: parsed.revision,
    grant_status: target,
  });
}

// ---------------------------------------------------------------------------
// The two rows every sync writes
// ---------------------------------------------------------------------------

// libedge_subscription_sync is what makes the next request's revision decision
// meaningful, so it is written on both paths - including the first-ever request being a
// cancellation, which is acceptance test 25: the row exists with lease_until NULL and
// no grant, so a later, smaller-revision "active" is refused as stale.
//
// subject_user_id is the LibEdge id, not the local users.id: the local row may not
// exist (that is the point of 404 USER_NOT_FOUND), and the contract keys ownership on
// the LibEdge id.
async function writeSyncRow(client, tenantId, sourceId, parsed, payloadSha256, scopes, userId) {
  const requestSummary = {
    tenant: `${parsed.tenant.kind}:${parsed.tenant.ref}`,
    subject: parsed.subject.type === 'user'
      ? `user:${parsed.subject.libedge_user_id}`
      : 'tenant',
    status: parsed.status,
    revision: parsed.revision,
    scopes: scopes.map((scope) => `${scope.type}:${scope.id}`),
    local_user_id: userId,
  };
  await client.query(
    `insert into libedge_subscription_sync
       (source_id, tenant_id, subject_type, subject_user_id, revision, payload_sha256,
        status, lease_until, applied_at, request_summary)
     values ($1, $2, $3, $4, $5, $6, $7, $8, now(), $9)
     on conflict (source_id) do update
       set tenant_id = excluded.tenant_id,
           subject_type = excluded.subject_type,
           subject_user_id = excluded.subject_user_id,
           revision = excluded.revision,
           payload_sha256 = excluded.payload_sha256,
           status = excluded.status,
           lease_until = excluded.lease_until,
           applied_at = now(),
           request_summary = excluded.request_summary`,
    [sourceId, tenantId, parsed.subject.type,
      parsed.subject.type === 'user' ? parsed.subject.libedge_user_id : null,
      parsed.revision, payloadSha256, parsed.status,
      parsed.status === 'active' ? parsed.leaseUntil : null,
      JSON.stringify(requestSummary)],
  );
}

// Section 7.5: every bridge write is audited with actor, request_id and before/after.
// grant_audit already exists for grants and is used rather than a new table, so an
// operator looking for "who changed access" finds manual and LibEdge changes in one
// place. actor_user_id stays NULL because no local user is acting; the LibEdge actor is
// in detail.
async function writeAudit(client, tenantId, sourceId, detail) {
  await client.query(
    `insert into grant_audit (tenant_id, grant_id, action, actor_user_id, detail)
     values ($1, null, $2, null, $3)`,
    [tenantId, detail.action, JSON.stringify({ ...detail, source_id: sourceId, source: 'libedge' })],
  );
}

// ---------------------------------------------------------------------------
// GET /subscriptions/{source_id}
// ---------------------------------------------------------------------------

export async function readSubscription(pool, sourceId) {
  return withBridgeAdmin(pool, async (client) => {
    const { rows } = await client.query(
      `select source_id, tenant_id, subject_type, subject_user_id, revision, status,
              lease_until, applied_at
         from libedge_subscription_sync where source_id = $1`,
      [sourceId],
    );
    if (!rows.length) throw notFound('SUBSCRIPTION_NOT_FOUND', `no subscription "${sourceId}"`);
    return rows[0];
  });
}
