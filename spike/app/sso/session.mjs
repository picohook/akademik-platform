// The reader's session cookie and the read path that goes with it (contract 2.5, 2.6).
//
// The cookie is the same HMAC-signed shape server.mjs already issues for password login
// (`signSession`), extended with three things the SSO session needs:
//
//   * `sid` is the libedge_sessions.session_id, so the database - not the cookie - decides
//     whether the session is still alive. A revocation deletes the row and every
//     outstanding cookie stops working at once.
//   * `exp` is the absolute end from that row (2.5), not `now + ttl`, so refreshing the
//     cookie cannot extend a session past its 12 hours.
//   * `tenant` is in the signed payload. This is what makes the RLS read possible at all:
//     libedge_sessions is FORCE RLS, so a lookup by session_id alone returns zero rows
//     unless a tenant is bound first. The tenant has to come from somewhere the client
//     cannot choose - the signature - and be bound *before* the read.
//
// Why the tenant cannot simply be looked up from the session id: that lookup is exactly
// the cross-tenant read the policy forbids. A SECURITY DEFINER function returning "the
// row with this id, whichever tenant" would reintroduce it in one line. So the tenant
// travels in the signed cookie, is bound, and only then is the session read - and a
// cookie whose tenant does not match the row's tenant reads nothing, because the policy
// filters it out rather than trusting the cookie.
//
// What the cookie is NOT trusted for: identity, role and expiry are re-read from the row
// on every request. The cookie only carries what the lookup needs, plus the display
// fields the existing UI renders. A stolen cookie cannot promote itself, and a tampered
// one fails the HMAC.

import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'akademik_session';

// Contract 1 and 10/6: 12 hours, overridable by env for tests and for a deployment that
// negotiates something else. Bounded to 1-72 hours: 0 would mint a session that is already
// expired, and anything past three days is a rollout of "stay signed in forever" that
// nobody asked for.
export const DEFAULT_SESSION_HOURS = 12;
export const MIN_SESSION_HOURS = 1;
export const MAX_SESSION_HOURS = 72;

export function sessionHoursFrom(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return DEFAULT_SESSION_HOURS;
  }
  const hours = Number(value);
  if (!Number.isInteger(hours) || hours < MIN_SESSION_HOURS || hours > MAX_SESSION_HOURS) {
    throw new Error(
      `LIBEDGE_SSO_SESSION_HOURS must be an integer in ${MIN_SESSION_HOURS}..${MAX_SESSION_HOURS}, ` +
      `got ${value}`);
  }
  return hours;
}

function hmac(secret, body) {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

// The payload server.mjs's `currentUser` already expects (sub, tenant, email, name, role,
// ver, sid, csrf, exp), so nothing downstream has to branch on how the session was made.
export function signSsoSession({ secret, session, user, csrf, now }) {
  const payload = {
    sub: session.userId,
    tenant: session.tenantId,
    email: user.email,
    name: user.display_name || user.email,
    role: session.role,
    ver: Number(user.session_version || 0),
    sid: session.sessionId,
    csrf,
    // Marks the cookie as an SSO session, so the read path knows to look in
    // libedge_sessions rather than user_sessions. Without it the two session kinds would
    // be indistinguishable once a cookie is signed, and one of them would 401 forever.
    sso: true,
    // Milliseconds, like `signSession`. The value comes from the database row and is
    // never recomputed from `now`, which is the whole point (2.5).
    exp: session.expiresAt,
    // Not read by anything that matters; kept so an operator reading a cookie can see when
    // it was issued.
    iat: now ?? Date.now(),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${hmac(secret, body)}`;
}

// Verified the same way `readSession` verifies its cookies, including the
// length-check-before-compare that timingSafeEqual requires.
export function readCookieToken(token, secret) {
  if (!token) return null;
  const [body, signature] = String(token).split('.');
  if (!body || !signature) return null;
  const expected = hmac(secret, body);
  if (signature.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.sub || !payload.tenant || !payload.sid || !payload.exp) return null;
    // The cookie's own exp is checked here so an expired cookie is refused without a
    // query; the row's expires_at is checked in the read below, because the cookie could
    // be older than a row that was extended - or newer than one that was revoked.
    if (Number(payload.exp) < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// The read side, and the reason the tenant is in the cookie.
//
// `withTenant` is the caller's binding helper (server.mjs's own), passed in rather than
// imported so this module stays free of the pool. The order inside is fixed: verify the
// cookie, take its tenant, bind it, then select with `session_id = $1` and *nothing
// else*. The tenant is not in the where-clause as a second filter - the RLS policy
// supplies it, and has to, because that is the mechanism being relied on. If the policy
// were ever dropped, this query would start returning another tenant's rows, which is why
// there is an integration test that asserts a foreign sid reads zero.
//
// Returns null for every kind of "no usable session": bad signature, expired row, revoked
// row, missing row, row in another tenant. The caller cannot distinguish them and does not
// need to.
export async function readSsoSession(payload, { withTenant: bound }) {
  return bound(payload.tenant, async (client) => {
    const { rows } = await client.query(
      `select session_id, tenant_id, user_id, ctx, inst, started_at, expires_at, revoked_at
         from libedge_sessions
        where session_id = $1`,
      [payload.sid]);
    const row = rows[0];
    if (!row) return null;
    if (row.revoked_at) return null;
    // The database is the clock that counts (2.5): a cookie whose exp was extended by a
    // client - impossible without the HMAC, but the row is the authority anyway - cannot
    // outlive the row.
    if (new Date(row.expires_at).getTime() <= Date.now()) return null;
    // Touch for the operator's benefit only: the end is absolute, so this never extends
    // the session, it only records that the session was in use when something went wrong.
    await client.query(
      'update libedge_sessions set last_seen_at = now() where session_id = $1', [row.session_id]);
    return {
      sessionId: row.session_id,
      tenantId: row.tenant_id,
      userId: row.user_id,
      ctx: row.ctx,
      inst: row.inst,
      expiresAt: new Date(row.expires_at).getTime(),
    };
  });
}

// Sign-out and revocation (2.5): delete the row, so no outstanding cookie for it works
// again. Scoped by tenant through the policy like every other write here.
export async function deleteSsoSession(payload, { withTenant: bound }) {
  return bound(payload.tenant, async (client) => {
    const { rowCount } = await client.query(
      'delete from libedge_sessions where session_id = $1', [payload.sid]);
    return rowCount > 0;
  });
}

// The cookie itself. Same attributes as the password-login cookie already issued by
// `setSessionCookie` in server.mjs - Lax so a top-level navigation from the e-library
// carries it, HttpOnly so scripts cannot read it, and no Max-Age past the row's end.
export function sessionCookieHeader(token, expiresAt, { secure = true } = {}) {
  const maxAge = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  const parts = [`${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax',
    `Max-Age=${maxAge}`];
  // `Secure` is dropped only when the request is not over TLS, which in practice is a
  // local run against http://localhost. The production path never reaches that branch.
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookieHeader() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

// The retention sweep (027). 90 days, per the contract's 7.5 and the note in 027's header:
// sso_auth_events holds an IP, which is personal data, so it is not kept indefinitely.
//
// Same pattern as the other maintenance timers: it needs a definer function because the
// app role deliberately cannot delete audit rows, and it runs outside any request so it
// must not list tenants. Failures are logged and never thrown into the server loop - a
// failed sweep runs again tomorrow, and a crashed process runs nothing.
export const SSO_AUDIT_RETENTION = '90 days';

export function startSsoMaintenance(pool, { intervalMs = 24 * 60 * 60 * 1000, log = console } = {}) {
  const sweep = async () => {
    try {
      const { rows } = await pool.query(
        'select app.sso_auth_events_purge($1::interval) as removed', [SSO_AUDIT_RETENTION]);
      if (rows[0]?.removed) log.log(`[sso] purged ${rows[0].removed} audit row(s)`);
    } catch (error) {
      // 42883 means 027 is not applied yet; that is reported once per run, not per request.
      log.warn('[sso] audit purge failed:', error.message);
    }
  };
  const timer = setInterval(sweep, intervalMs);
  timer.unref();
  // One sweep at startup so a server that restarts nightly still prunes.
  void sweep();
  return () => clearInterval(timer);
}
