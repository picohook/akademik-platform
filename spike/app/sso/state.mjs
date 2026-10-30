// The `__Host-sso_state` cookie (contract 2.1, step 2) and the SameSite question.
//
// Why `__Host-`: the prefix is enforced by the browser, not by us. A cookie named
// `__Host-*` is only stored if it was set with `Secure`, `Path=/` and *no* `Domain`
// attribute, and it can only be overwritten from the exact host that set it. That rules
// out the two ways a state cookie is normally stolen: a sibling subdomain setting a
// Domain-wide cookie of the same name (cookie tossing), and an insecure origin setting
// it at all. We still write every attribute - the browser rejects a violation instead of
// silently dropping it, which turns a mistake here into a failed sign-in rather than an
// unprotected one - but the prefix is the guarantee, not our diligence.
//
// Why `SameSite=Lax`, and why this file does not "fix" it:
//
//   The callback is a cross-*origin* POST, from libedge.com to elibrary.libedge.com, but
//   SameSite is computed on the *registrable domain* (eTLD+1), not on the origin. Both
//   hosts sit under `libedge.com`, so the POST is same-site, and a Lax cookie is sent on
//   it. Lax would only suppress the cookie on a genuinely cross-site POST - a
//   *.pages.dev preview, an attacker's page - which is exactly the case that must fail.
//   Tightening this to `Strict` would also work for the same-site POST and be marginally
//   stricter on top-level GET navigation, but it is not what the contract says and it buys
//   nothing the origin check below does not already cover. `None` would be wrong: it
//   would send the state on genuinely cross-site POSTs too, which is the attack.
//
//   This reasoning has NOT been measured with a real browser in this change: the probe
//   that would have done it (Playwright, mapped hosts, a form POST) stopped one step short,
//   because `Secure` is not stored on an http origin and there is no certificate tooling on
//   the machine that wrote this. docs/contracts/vectors/README.md records the attempt, the
//   blocker and what would finish it. Until then the claim is the specification's, not a
//   measurement's - worth knowing before anyone builds on it.

import { randomBytes } from 'node:crypto';
import { newState, safeEqual, stateHash } from './ed25519.mjs';

export const STATE_COOKIE = '__Host-sso_state';

// Ten minutes to complete a handoff. Long enough for a login form and an MFA prompt on a
// bad connection, short enough that an abandoned start does not leave a usable nonce.
export const STATE_MAX_AGE_SECONDS = 600;

// Every attribute the browser needs in order for `__Host-` to be accepted, in a fixed
// order so the tests can compare the whole header as a string.
export function stateCookieHeader(value, { maxAge = STATE_MAX_AGE_SECONDS } = {}) {
  return `${STATE_COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

// Cleared with the same attributes: a Set-Cookie without Path=/ would create a second,
// differently-scoped cookie and leave the original in place.
export function clearStateCookieHeader() {
  return `${STATE_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function newStateValue() {
  return newState(randomBytes);
}

export function hashOf(state) {
  return stateHash(state);
}

// Contract 2.1/4: the browser (or the Worker, 2.1/3) posts `nonce` back. The check is
// constant-time and requires both sides, so a missing cookie and an empty nonce both
// fail the same way rather than matching each other.
export function nonceMatches(stateFromCookie, nonceFromToken) {
  if (!stateFromCookie || !nonceFromToken) return false;
  return safeEqual(stateFromCookie, nonceFromToken);
}

// The `ctx` hint on the start URL (2.1/2). Anything else is ignored: the token's `ctx`
// claim is the only source of truth, and a hint that disagrees with it is a mismatch
// caught later, not an instruction followed earlier.
export const CONTEXT_HINTS = Object.freeze(['institution', 'individual', 'staff']);

export function normaliseContextHint(value) {
  const hint = String(value ?? '').trim().toLowerCase();
  return CONTEXT_HINTS.includes(hint) ? hint : null;
}
