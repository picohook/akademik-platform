// The database half of the reader-side SSO callback (contract 2.3, steps 7-11).
//
// One function, one transaction. Everything in 2.3 that touches the database has to be
// atomic, because the interesting failure is not "the token is wrong" - that is decided
// before we get here - but "two requests with the same token arrived at once". Splitting
// this across transactions would let both of them pass the replay check and both mint a
// session, which is the one outcome the jti table exists to prevent.
//
// The order is the contract's, and the reasons are the contract's:
//
//   7  tenant      resolved from (ctx, inst) through app.libedge_tenant_by_ref
//   8  membership  account disabled / membership revoked / user disabled
//   9  jti         consumed here, and only when 7 and 8 passed
//   10 user row    JIT creation (3.3)
//   11 session     libedge_sessions row
//
// Step 9 after step 8 means a token belonging to a revoked membership is rejected without
// burning its jti. That is the right way round: the user did nothing wrong, and the token
// they hold may be the only one they get. Burning it would turn a policy refusal into a
// dead end, and a retry after the operator fixes the membership would fail with
// "replayed" instead of working.
//
// Nothing here reads a session by id without a bound tenant. That is why the callback
// takes the tenant from the resolved context and why readSsoSession takes it as an
// argument rather than looking it up: libedge_sessions is FORCE RLS, and a lookup that
// spans tenants would be exactly the hole the policy is there to close.

import { randomUUID } from 'node:crypto';

// A rejection from the callback: (audit reason, message for the operator's log). A class
// rather than a bare Error so server.mjs can tell a policy refusal - a 403 with a reason -
// from a bug, which is a 500.
export class SsoRejection extends Error {
  constructor(reason, detail) {
    super(detail || reason);
    this.name = 'SsoRejection';
    this.reason = reason;
  }
}

// Contract 3.2: a context maps to exactly one tenant through (libedge_kind, libedge_ref),
// and 3.2 names the ref for the two single-instance contexts: 'libedge' for staff and
// 'b2c' for individual. Resolved, not assumed, so the same code runs on a database whose
// uuids differ from the ones in the tests.
//
// Runs unbound on purpose: `tenants_self` denies every row before a tenant is bound
// (024/025 document the trap), which is why this goes through the definer function 025
// added rather than a plain select.
export async function resolveSsoTenant(client, claims) {
  const [kind, ref] = claims.ctx === 'institution'
    ? ['institution', claims.inst]
    : claims.ctx === 'individual' ? ['individual', 'b2c'] : ['staff', 'libedge'];
  const { rows } = await client.query(
    'select tenant_id as id, status from app.libedge_tenant_by_ref($1, $2)', [kind, ref]);
  const tenant = rows[0] || null;
  // 2.3/7: an unknown tenant and an inactive tenant are both refusals, and both are
  // audited. They are different reasons because they mean different things to an
  // operator: one is a provisioning gap, the other is a suspension.
  if (!tenant) throw new SsoRejection('unknown_tenant', `no ${kind} tenant "${ref}"`);
  if (tenant.status !== 'active') throw new SsoRejection('tenant_inactive', `tenant is ${tenant.status}`);
  return tenant;
}

// 3.4: LibEdge's role table mapped onto ours. A reader is a reader everywhere; only the
// staff context may carry a higher role, because that is where LibEdge operators sign in.
// An institution reader must not become a librarian here just because the identity
// provider said so - assigning that belongs to the tenant's own librarian.
//
// token.mjs has already refused any role that is not allowed in its context, so this is
// the mapping and not a second check.
function localRoleFor(claims) {
  return claims.ctx === 'staff' ? claims.role : 'reader';
}

// users.email is not null in schema.sql, so a row cannot simply omit the address. `email`
// is required by 2.2, so the token is expected to carry one; this refuses a token that
// does not rather than inventing an address that would be stored as identity and shown to
// the reader.
function emailFor(claims) {
  if (!claims.email) {
    throw new SsoRejection('bad_claims', 'token carries no email; 2.2 requires it');
  }
  return claims.email;
}

// ---------------------------------------------------------------------------
// Steps 8-11, in one transaction
// ---------------------------------------------------------------------------
//
// The caller resolves the tenant first (step 7), because that lookup needs an *unbound*
// connection and everything below needs a bound one; the two cannot share a transaction
// without the resolution running under the binding.
//
// `client` is already bound to tenant.id by the caller.
export async function signIn(client, tenant, claims, { sessionHours, now }) {
  // 8a: the account. 021 keeps this outside users.status because an account can be
  // disabled before the person has ever signed in, and a row that does not exist yet
  // cannot carry the refusal.
  const account = await client.query(
    'select status from libedge_accounts where libedge_user_id = $1', [claims.sub]);
  if (account.rows[0]?.status === 'disabled') {
    throw new SsoRejection('account_disabled', 'the LibEdge account is disabled');
  }

  // 8b: the membership in *this* tenant only. A membership in another tenant says nothing
  // about this one (2.4), which is why the tenant is in the where-clause and not a filter
  // applied afterwards in node.
  const membership = await client.query(
    'select status from libedge_memberships where tenant_id = $1 and libedge_user_id = $2',
    [tenant.id, claims.sub]);
  if (membership.rows[0]?.status === 'revoked') {
    throw new SsoRejection('membership_revoked', 'the membership in this tenant is revoked');
  }

  // 8c: a user row we disabled ourselves - a local decision such as conduct. It outlives
  // the LibEdge account status, so both are checked.
  const existing = await client.query(
    'select id, status from users where tenant_id = $1 and libedge_user_id = $2',
    [tenant.id, claims.sub]);
  if (existing.rows[0]?.status === 'disabled') {
    throw new SsoRejection('user_disabled', 'the local user row is disabled');
  }

  // 9: the replay guard. `on conflict do nothing` and then rowCount, rather than letting
  // the primary key raise: in postgres a unique violation aborts the whole transaction,
  // so the audit row written after a replay refusal would be lost with it. rowCount === 0
  // is the same fact - this jti was already consumed - with the transaction still usable.
  //
  // The jti is kept until the token would have expired anyway. Storing exp means the table
  // prunes itself, and a token replayed after exp fails the time check before it ever
  // reaches this statement.
  const consumed = await client.query(
    `insert into sso_consumed_jti (jti, expires_at)
     values ($1, to_timestamp($2))
     on conflict (jti) do nothing`,
    [claims.jti, claims.exp]);
  if (consumed.rowCount === 0) {
    throw new SsoRejection('replayed', 'the handoff token has already been used');
  }

  const role = localRoleFor(claims);
  const email = emailFor(claims);
  // The display name comes from the optional `name` claim and falls back to the address, so
  // the UI has something to show without inventing a person. It is display only: the row is
  // keyed on (tenant, libedge_user_id).
  const displayName = claims.name || email;

  // 10: JIT creation (3.3). The update path deliberately does not touch `status` or
  // `role`: a librarian who demoted this reader in our own admin keeps that decision, and
  // the identity provider must not promote them back on every sign-in.
  let userId;
  if (existing.rows.length) {
    userId = existing.rows[0].id;
    await client.query(
      `update users set email = $2, display_name = case
         when $3::text is null then display_name
         when display_name is null or display_name = email then $3
         else display_name end
       where id = $1`,
      [userId, email, claims.name]);
  } else {
    // A pre-bridge row with the same e-mail but no LibEdge id is not adopted silently:
    // identity is keyed on (tenant, libedge_user_id), and linking the two is a decision
    // this path has no standing to make. Same refusal as pre-provisioning (3.3).
    const byEmail = await client.query(
      'select id from users where tenant_id = $1 and email = $2 and libedge_user_id is null',
      [tenant.id, email]);
    if (byEmail.rows.length) {
      throw new SsoRejection('bad_claims',
        'a local user with this e-mail exists and carries no LibEdge id');
    }
    const { rows } = await client.query(
      `insert into users (tenant_id, email, display_name, libedge_user_id, role)
       values ($1, $2, $3, $4, $5)
       returning id`,
      [tenant.id, email, displayName, claims.sub, role]);
    userId = rows[0].id;
  }

  // 11: the session. 2.5: the end is absolute - sign-in time plus the configured window -
  // and is never extended by activity, which is what makes "12 hours" mean twelve hours
  // rather than "twelve hours after the last click".
  const sessionId = randomUUID();
  const { rows: sessionRows } = await client.query(
    `insert into libedge_sessions
       (session_id, tenant_id, user_id, libedge_user_id, ctx, inst, jti, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning session_id, expires_at`,
    [sessionId, tenant.id, userId, claims.sub, claims.ctx, claims.inst, claims.jti,
      new Date(now + sessionHours * 3600_000)]);

  return {
    sessionId: sessionRows[0].session_id,
    expiresAt: new Date(sessionRows[0].expires_at).getTime(),
    userId,
    role,
    email,
    tenantId: tenant.id,
  };
}
