// The handoff token, verified without a database (contract 2.2, 2.3 steps 1-6, 8.4).
//
// Everything here is a pure function of (token, keys, expectations, now). The database
// checks of 2.3 (7-11) live in callback.mjs, and that split is deliberate: this module is
// where the token format is decided, so it can be tested against the shared vectors in
// docs/contracts/vectors without a container, and the transaction can stay focused on the
// three things only it can see - tenant, membership, membership state.
//
// The order matters and follows the contract's numbering:
//
//   1-3  signature and header        -> ed25519.mjs
//   4    iss/aud                     -> this file
//   5    claim types                 -> this file
//   6    time window, jti            -> this file
//
// An unknown claim is a rejection, not something to ignore. The contract fixes the claim
// set; a token carrying something else is either a newer protocol than we implement (and
// must not be half-understood) or an attempt to smuggle data past us.

import { verifySignature } from './ed25519.mjs';

// 2.2: exp - iat is at most 60 seconds. A handoff token is a pointer to a fresh login,
// valid for the length of a redirect.
export const MAX_LIFETIME_SECONDS = 60;

// Clock tolerance, symmetric, per 2.2. The Worker and this server do not share a clock.
export const CLOCK_SKEW_SECONDS = 30;

// 2.2: jti is at least 128 bits of entropy, so at least 22 base64url characters.
export const MIN_JTI_LENGTH = 22;
export const MIN_JTI_BYTES = 16;

// The received-string half of 2.2's `jti` rule - the shortest string that can hold 128 bits.
// Entropy cannot be measured from a string, so this is deliberately only a floor; the
// producer's obligation (32 random bytes -> base64url) is fixed by the shared vector
// docs/contracts/vectors/sso-jti.json. base64url decoding is lenient, so a string that does
// not round-trip is refused: `"a".repeat(43)` is long enough and is not 128 random bits, but
// a 43-character hex string is not base64url at all, and accepting it would mean accepting a
// value whose decoded length nobody checked.
export function jtiEntropyIsSufficient(jti) {
  if (typeof jti !== 'string' || jti.length < MIN_JTI_LENGTH) return false;
  const bytes = Buffer.from(jti, 'base64url');
  return bytes.length >= MIN_JTI_BYTES && bytes.toString('base64url') === jti;
}

export const CONTEXTS = Object.freeze(['institution', 'individual', 'staff']);

// 3.4: LibEdge's role table, as the reader applies it. `individual + admin` is a LibEdge
// administrator, not one of our readers, and must not become one by signing in here; a
// personal reader is a reader and nothing else.
export const ALLOWED_LIBEDGE_ROLES = Object.freeze({
  individual: ['reader'],
  institution: ['reader', 'librarian', 'publisher'],
  staff: ['reader', 'librarian', 'publisher', 'admin'],
});

// The claim set of 2.2. Types are pinned because `"exp": "123"` sorts and compares as a
// string in JavaScript in ways that are easy to get wrong, and a numeric string in a
// signed claim is a bug on the Worker's side that should surface as a rejection.
const CLAIM_TYPES = Object.freeze({
  iss: 'string',
  aud: 'string',
  sub: 'string',
  ctx: 'string',
  role: 'string',
  jti: 'string',
  nonce: 'string',
  iat: 'integer',
  exp: 'integer',
  inst: 'string',
  email: 'string',
  // Optional display claims of 2.2: typed when present, and dropped when absent. Not
  // required, because a token without them is a valid token whose reader is shown their
  // e-mail instead of a name.
  name: 'string',
  lang: 'string',
});

// Required by 2.2 for every token. `inst` is conditional on `ctx`, and `email` is required
// but validated separately so its absence has one named reason; `name` and `lang` are
// optional display claims.
const REQUIRED = Object.freeze(['iss', 'aud', 'sub', 'ctx', 'role', 'jti', 'nonce', 'iat', 'exp']);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isInteger(value) {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

// `now` is milliseconds since the epoch, matching Date.now(), because that is what the
// server has. The token carries seconds, as 2.2 says.
export function nowSeconds(nowMs) {
  return Math.floor(nowMs / 1000);
}

// Returns `{ ok: true, claims, kid }` or `{ ok: false, reason }`. `reason` is an audit
// reason from contract 7.5 and is safe to log; the token and its claims are not returned
// on failure, so a caller cannot accidentally log a rejected token.
export function verifyToken(token, { keys, issuer, audience, now = Date.now() }) {
  // 1-3: signature, header, alg, kid.
  const signed = verifySignature(token, keys);
  if (!signed.ok) return refuse(signed.reason);

  const claims = signed.payload;

  // 4: issuer and audience, as exact strings. No prefix matching: an `aud` of
  // "elibrary.libedge.com.attacker" must not pass a startsWith check.
  if (claims.iss !== issuer) return refuse('bad_issuer');
  if (claims.aud !== audience) return refuse('bad_audience');

  // 5: the claim set. Unknown names and wrong types are both rejections (2.3/5).
  for (const name of Object.keys(claims)) {
    if (!(name in CLAIM_TYPES)) return refuse('bad_claims');
  }
  for (const name of REQUIRED) {
    if (claims[name] === undefined) return refuse('bad_claims');
  }
  for (const [name, value] of Object.entries(claims)) {
    const type = CLAIM_TYPES[name];
    if (type === 'integer' && !isInteger(value)) return refuse('bad_claims');
    if (type === 'string' && (typeof value !== 'string' || value.length === 0)) {
      return refuse('bad_claims');
    }
  }

  // 6: time window, then jti. Time comes before jti on purpose: a token that is expired
  // *and* a replay is reported as expired, which is the fact an operator needs first.
  //
  // 2.2/3 gives the tolerance symmetrically - `iat <= now + 30` and `now <= exp + 30` - and
  // the second half is the one that is easy to omit. A handoff token lives 60 seconds, a
  // redirect crosses two networks and a login form, and exp is stamped by the Worker's clock
  // while it is checked against ours. Without the grace a token minted on a Worker that is
  // a few seconds behind is refused as expired *while the reader is being sent back*, which
  // reaches the reader as a generic failure with no way to retry usefully. The grace is
  // bounded at 30 seconds and does not extend the session, which starts from `now` in
  // store.mjs - and the replay row is kept until exp + 30 too (2.3/9), so the window in
  // which a token is accepted is exactly the window in which its jti is remembered.
  const seconds = nowSeconds(now);
  const expiresAt = claims.exp + CLOCK_SKEW_SECONDS;
  if (seconds > expiresAt) return refuse('expired');
  if (claims.iat > seconds + CLOCK_SKEW_SECONDS) return refuse('not_yet_valid');
  if (claims.iat >= claims.exp) return refuse('bad_claims');
  if (claims.exp - claims.iat > MAX_LIFETIME_SECONDS) return refuse('bad_claims');

  // 2.2 / 3.1: a jti shorter than 128 bits is guessable, and the replay table is keyed by
  // it - two handoffs sharing a jti would collide into one consumed entry. The check is on
  // `jti` alone: the contract gives it a length, and `nonce` is matched against the cookie
  // rather than used as a key, so a shorter one is weak but not a protocol violation.
  //
  // The length is all a verifier can impose on a received string; it says nothing about
  // randomness. What the producer must do is fixed by the shared vector in
  // docs/contracts/vectors/sso-jti.json (32 bytes, base64url), and sso-jti.test.mjs checks
  // both halves: that the vector round-trips, and that 22 characters is its floor.
  if (!jtiEntropyIsSufficient(claims.jti)) return refuse('bad_claims');

  // `ctx` and `inst` are one decision, per 2.2: institutional tokens carry the tenant ref,
  // and only they do. A personal token with an `inst` is asking to be let into a tenant it
  // did not authenticate against, so it is not "ignored" but rejected.
  if (!CONTEXTS.includes(claims.ctx)) return refuse('bad_context');
  if (claims.ctx === 'institution' && claims.inst === undefined) return refuse('bad_context');
  if (claims.ctx !== 'institution' && claims.inst !== undefined) return refuse('bad_context');

  // 3.4: the role must be one this context may hold at all. The mapping onto our own
  // `users.role` happens in callback.mjs; here we only refuse what must never enter.
  const allowed = ALLOWED_LIBEDGE_ROLES[claims.ctx];
  if (!allowed || !allowed.includes(claims.role)) return refuse('bad_role');

  // `email` is required by 2.2, and is written to users.email (not null). When present it
  // must be a plausible address, because a malformed one breaks the row, not just the
  // display; when absent the token is refused rather than given an invented address.
  if (claims.email === undefined) return refuse('bad_claims');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(claims.email)) return refuse('bad_claims');

  // `sub` becomes a component of our user rows and the advisory lock key of 2.6, so its
  // shape is fixed rather than merely non-empty. The underscore is not decoration:
  // LibEdge's own ids look like `lu_7f3c1a9e4b2d`, and leaving `_` out refused every real
  // token while accepting every test one written without it.
  if (!/^[A-Za-z0-9_.:@-]{1,128}$/.test(claims.sub)) return refuse('bad_claims');

  return {
    ok: true,
    kid: signed.kid,
    claims: {
      iss: claims.iss,
      aud: claims.aud,
      sub: claims.sub,
      ctx: claims.ctx,
      role: claims.role,
      jti: claims.jti,
      nonce: claims.nonce,
      iat: claims.iat,
      exp: claims.exp,
      inst: claims.inst ?? null,
      email: claims.email ?? null,
      // Display only, never identity: 3.3 keys the row on (tenant, libedge_user_id).
      name: claims.name ?? null,
      lang: claims.lang ?? null,
    },
  };
}

function refuse(reason) {
  return { ok: false, reason };
}

// The role a LibEdge identity gets in our `users` table. 3.4 permits the four roles we
// have, and the context decides which of them may arrive: only the staff context carries
// an operator role, because that is where LibEdge staff sign in. An institution librarian
// is therefore recorded as a reader here - promoting them is the tenant's librarian's
// decision, made in the admin UI, not the identity provider's on every sign-in.
//
// Anything not permitted in its context has already been refused by token.mjs, so a
// non-null return is always a role this table accepts.
export function localRole(ctx, libedgeRole) {
  if (!ALLOWED_LIBEDGE_ROLES[ctx]?.includes(libedgeRole)) return null;
  return ctx === 'staff' ? libedgeRole : 'reader';
}
