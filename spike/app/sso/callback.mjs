// The callback, end to end (contract 2.1/4-5, 2.3, 7.5).
//
// This module is the orchestration and the audit; the work itself lives in token.mjs
// (pure verification), store.mjs (the transaction) and session.mjs (the cookie). It exists
// so that server.mjs keeps one route handler calling one function, and so the whole
// sequence can be exercised without an HTTP server.
//
// Every exit writes exactly one audit row (7.5). That includes the early ones - a bad
// signature has no tenant and no user, and still has to be counted, or an operator cannot
// tell a broken Worker from a quiet week. It also includes the successful one: `sso.login`
// with the session id is what makes "who signed in when" answerable without storing the
// token.
//
// The audit write is best-effort and never changes the outcome. Losing an audit row is bad;
// turning a rejected sign-in into a 500 because the audit table was full would be worse.

import { stateHash } from './ed25519.mjs';
import { normaliseContextHint, nonceMatches } from './state.mjs';
import { SsoRejection, resolveSsoTenant, signIn } from './store.mjs';
import { verifyToken } from './token.mjs';

// One message for every rejection (2.3, 7.5). Telling the browser which check failed
// tells an attacker which check to work on, and the user can do nothing with the
// difference. The reason goes to the audit table, not to the response.
export const REJECTION_MESSAGE =
  'LibEdge oturumu doğrulanamadı. LibEdge\'e dönüp yeniden giriş yapın.';

// 2.1/4: the callback is a form POST carrying `token`. Nothing else.
//
// An earlier version also required a `nonce` field in the form. That is not what the
// contract says, and it is not implementable by an honest Worker: the browser holds the
// state in an HttpOnly cookie, and the only place the hash of it exists is inside the
// signed token. Requiring the form to repeat it turned a valid handoff into
// `missing or oversized nonce`. The nonce is now read from the signed claims and compared
// against the hash of the cookie (2.3/4), which is both narrower and true to the contract.
//
// A `nonce` field, if a client sends one anyway, is ignored rather than rejected: it is not
// part of the protocol, so it carries no authority, and refusing it would break nothing an
// attacker cares about while breaking a Worker that helpfully echoes it back.
export function readCallbackForm(body) {
  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  // The token is capped before it is parsed: 2.2's claim set is small, and a 1 MB "token"
  // is not a token. This also bounds the work one request can cause.
  if (!token || token.length > 4096) {
    throw new SsoRejection('bad_claims', 'missing or oversized token');
  }
  return { token };
}

// The start URL (2.1/2): the hash of the state, never the state. A hint outside the three
// contexts is dropped rather than forwarded - the token's `ctx` is the only source of
// truth, and a disagreeing hint would only produce a mismatch later.
export function startUrl({ handoffBase, state, ctxHint }) {
  const url = new URL(handoffBase);
  url.searchParams.set('state_hash', stateHash(state));
  const hint = normaliseContextHint(ctxHint);
  if (hint) url.searchParams.set('ctx', hint);
  return url.toString();
}

// The whole flow. Returns
//   { ok: true,  session: { sessionId, expiresAt, userId, role, email, tenantId } }
//   { ok: false, reason }
// and never throws for an expected refusal.
//
// `withSession(client => fn(client))` must run `fn` inside ONE transaction and hand it that
// connection. That is not a convenience: 2.3 says steps 5-11 are one transaction, and the
// advisory lock of 2.6 is `pg_advisory_xact_lock` - it is held only for the life of a
// transaction. Wrapped in something that merely binds the tenant and commits per statement,
// the lock is released between the lookup and the insert, `sso_consumed_jti` cannot be
// rolled back with a later failure, and two racing handoffs both see an empty replay table.
//
// `withAdmin` is used for exactly one thing - 2.3/7, the tenant lookup - because
// `tenants_self` denies every row before a tenant is bound. It commits before the session
// transaction starts; nothing is written on that side.
//
// Order (2.3): signature and claims -> state -> tenant -> [5-11 in one transaction].
// The state check sits *after* the signature on purpose: a token that does not verify has
// no trustworthy nonce, and comparing an attacker-supplied string against a cookie is work
// an unauthenticated caller should not be able to ask for.
export async function handleCallback({
  token, cookieState, pool, withSession, withAdmin, keys, issuer, audience,
  sessionHours, now = Date.now(), ip, audit,
}) {
  let claims = null;
  const write = audit ?? logAudit(pool);

  const fail = async (reason, detail) => {
    // The tenant and user are unknown for most refusals; when they are known they are
    // written, because "who keeps trying" is the question the table exists to answer.
    await write({ outcome: 'reject', reason, ctx: claims?.ctx ?? null,
      libedgeUserId: claims?.sub ?? null, ip, detail });
    return { ok: false, reason };
  };

  try {
    // 1-6: signature, header, iss/aud, claim types, time window.
    const verified = verifyToken(token, { keys, issuer, audience, now });
    if (!verified.ok) return await fail(verified.reason);
    claims = verified.claims;

    // 2.3/4: the signed nonce must be base64url(SHA-256(__Host-sso_state)). `nonceMatches`
    // hashes the cookie itself - the nonce is never compared with the raw state. Without
    // this check anyone who can make a browser POST here can deliver a token they obtained
    // elsewhere: login CSRF, where the victim ends up signed in as the attacker.
    if (!nonceMatches(cookieState, claims.nonce)) return await fail('state_mismatch');

    // 2.3/7, unbound: `tenants_self` denies every row before a tenant is bound, so this one
    // lookup runs on the admin path. The tenant is decided here and passed down; steps 5-11
    // never read it from a request context, and never guess.
    const tenant = await withAdmin((client) => resolveSsoTenant(client, claims));

    // 2.3/5-11 in ONE transaction: identity lock, account status, membership, jti, user,
    // session. The binding helper takes the tenant as its first argument, so the transaction
    // cannot run bound to a tenant nobody verified the token against.
    const session = await withSession(tenant.id, (client) =>
      signIn(client, tenant, claims, { sessionHours, now }));

    await write({ outcome: 'login', ctx: claims.ctx, libedgeUserId: claims.sub,
      sessionId: session.sessionId, ip });
    return { ok: true, session };
  } catch (error) {
    if (error instanceof SsoRejection) return await fail(error.reason, error.message);
    // 7.5: a database failure during sign-in is still an authentication event, so it is
    // recorded as one - and then rethrown. The caller must see a 500 rather than a 403:
    // the difference is "your token is bad" versus "we are broken", and only one of those
    // is the user's to act on.
    await write({ outcome: 'reject', reason: 'session_store_unavailable',
      ctx: claims?.ctx ?? null, libedgeUserId: claims?.sub ?? null, ip,
      detail: error?.message });
    throw error;
  }
}

// The default audit sink: one insert, no tenant binding (the table has no tenant column
// and no policy - see 027), and a swallowed error so auditing can never decide a sign-in.
export function logAudit(pool) {
  return async (event) => {
    try {
      await pool.query(
        `insert into sso_auth_events (outcome, reason, ctx, libedge_user_id, session_id, ip)
         values ($1, $2, $3, $4, $5, $6)`,
        [event.outcome, event.reason ?? null, event.ctx ?? null,
          event.libedgeUserId ?? null, event.sessionId ?? null, event.ip ?? null]);
    } catch (error) {
      // A 42P01 here means 027 has not been applied. That is a deployment error which
      // must not turn into a failed sign-in, but it should not be silent either.
      console.error('sso: could not write sso_auth_events:', error?.message);
    }
  };
}
