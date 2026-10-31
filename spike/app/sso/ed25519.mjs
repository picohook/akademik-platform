// Ed25519 verification for the LibEdge handoff token (contract 2.3, steps 1-3).
//
// The handoff token is a compact JWS signed by the Worker with EdDSA. This module does
// the asymmetric part and nothing else: it turns LIBEDGE_SSO_PUBLIC_KEYS into KeyObjects,
// checks the base64url segments, and verifies one signature. Claim semantics live in
// token.mjs, because they are testable without a key and this is not.
//
// node:crypto only. Ed25519 is a built-in curve, so there is no dependency to add and no
// verification code of our own to get wrong - the one thing this file must never do is
// compare signatures itself.

import { createHash, createPublicKey, timingSafeEqual, verify } from 'node:crypto';

// Contract 2.3/1: at most two keys, so a rotation can overlap. A longer list is not a
// rotation, it is a set of keys nobody is tracking.
export const MAX_KEYS = 2;

// The only allowed algorithm. `alg` is read from the token, so it is compared against
// this allowlist and never used to select a verifier - "none" and HS256/RSA confusion
// are impossible if the algorithm is pinned rather than negotiated.
export const ALLOWED_ALG = 'EdDSA';

export class KeyConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'KeyConfigError';
  }
}

// A base64url segment as JSON. Returns null rather than throwing: every caller is on a
// hostile path, and "this segment is not JSON" is an ordinary rejection, not a crash.
export function parseSegment(segment) {
  if (typeof segment !== 'string' || !/^[A-Za-z0-9_-]+$/.test(segment)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// LIBEDGE_SSO_PUBLIC_KEYS is a JSON array of JWKs:
//
//   [{ "kid": "2026-10", "kty": "OKP", "crv": "Ed25519", "x": "..." }]
//
// Validation is strict and happens once, at startup: a key that cannot be used should
// stop the process, not fail every sign-in with a generic rejection.
export function parsePublicKeys(value) {
  let parsed;
  if (typeof value === 'string' && value.trim()) {
    try {
      parsed = JSON.parse(value);
    } catch (error) {
      throw new KeyConfigError(`LIBEDGE_SSO_PUBLIC_KEYS is not valid JSON: ${error.message}`);
    }
  } else if (Array.isArray(value)) {
    parsed = value;
  } else {
    throw new KeyConfigError('LIBEDGE_SSO_PUBLIC_KEYS is not set');
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new KeyConfigError('LIBEDGE_SSO_PUBLIC_KEYS must be a non-empty JSON array');
  }
  if (parsed.length > MAX_KEYS) {
    throw new KeyConfigError(
      `LIBEDGE_SSO_PUBLIC_KEYS holds ${parsed.length} keys; contract 2.3/1 allows at most ${MAX_KEYS}`,
    );
  }
  const keys = new Map();
  for (const entry of parsed) {
    keys.set(validateKey(entry, keys), keyObjectFor(entry));
  }
  return keys;
}

function validateKey(entry, keys) {
  if (!entry || typeof entry !== 'object') {
    throw new KeyConfigError('every entry in LIBEDGE_SSO_PUBLIC_KEYS must be an object');
  }
  const kid = typeof entry.kid === 'string' ? entry.kid.trim() : '';
  if (!kid) throw new KeyConfigError('every key needs a kid');
  if (keys.has(kid)) throw new KeyConfigError(`duplicate kid ${kid}`);
  if (entry.kty !== 'OKP' || entry.crv !== 'Ed25519') {
    throw new KeyConfigError(`key ${kid} must be kty=OKP crv=Ed25519, got ${entry.kty}/${entry.crv}`);
  }
  if (typeof entry.x !== 'string' || !entry.x) {
    throw new KeyConfigError(`key ${kid} has no x`);
  }
  // A private key reaching the server is a signing key in the wrong place. Refuse it
  // loudly rather than half-importing an OKP JWK that happens to carry `d`.
  if (entry.d !== undefined) {
    throw new KeyConfigError(`key ${kid} carries a private component (d); only public keys belong here`);
  }
  return kid;
}

function keyObjectFor(entry) {
  try {
    return createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: entry.x }, format: 'jwk' });
  } catch (error) {
    throw new KeyConfigError(`key ${entry.kid} is not a usable Ed25519 public key: ${error.message}`);
  }
}

// Verification, split so the caller can log *why* it failed without logging the token.
//
// Returns { ok: true, kid, header, payload } or { ok: false, reason }, where reason is one
// of 'malformed', 'bad_algorithm', 'unknown_kid', 'invalid_signature'. Callers map these
// onto the audit reasons of contract 7.5; the token itself never reaches a log line.
export function verifySignature(token, keys, { alg = ALLOWED_ALG } = {}) {
  if (typeof token !== 'string') return { ok: false, reason: 'malformed' };
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    return { ok: false, reason: 'malformed' };
  }
  const [headerSegment, payloadSegment, signatureSegment] = parts;
  const header = parseSegment(headerSegment);
  if (!header) return { ok: false, reason: 'malformed' };
  // Checked before the key lookup: an attacker-chosen alg must not decide which code
  // path runs, and 'none' must be rejected as an algorithm error, not as a missing key.
  if (header.alg !== alg) return { ok: false, reason: 'bad_algorithm' };
  const kid = typeof header.kid === 'string' ? header.kid : '';
  if (!kid) return { ok: false, reason: 'unknown_kid' };
  const key = keys.get(kid);
  if (!key) return { ok: false, reason: 'unknown_kid' };

  const signature = Buffer.from(signatureSegment, 'base64url');
  // Ed25519 signatures are exactly 64 bytes. A different length is not a near miss; it
  // is a different algorithm, or a truncated token.
  if (signature.length !== 64) return { ok: false, reason: 'invalid_signature' };

  const signed = Buffer.from(`${headerSegment}.${payloadSegment}`, 'utf8');
  let valid = false;
  try {
    // `null` as the algorithm: for Ed25519 the hash is part of the algorithm and node
    // rejects anything else. This is the call that must never be replaced by an HMAC.
    valid = verify(null, signed, key, signature);
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: 'invalid_signature' };
  // A verified signature over a payload that is not a JSON object is still unusable.
  const payload = parseSegment(payloadSegment);
  if (!payload) return { ok: false, reason: 'malformed' };
  return { ok: true, kid, header, payload };
}

// Contract 2.1/2: state_hash = base64url(SHA-256(state)). The Worker receives the hash,
// not the state, so a leaked handoff URL does not carry the cookie value.
export function stateHash(state) {
  return createHash('sha256').update(String(state), 'utf8').digest('base64url');
}

// Constant-time comparison for the state/nonce pair and for anything else secret.
// Length is compared first because timingSafeEqual throws on a length mismatch; the
// length of a base64url nonce is fixed by the generator, so it is not a secret.
export function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? ''), 'utf8');
  const right = Buffer.from(String(b ?? ''), 'utf8');
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

// A 256-bit state, per 2.1/2. 32 bytes base64url is 43 characters, no padding.
export function newState(randomBytes) {
  return randomBytes(32).toString('base64url');
}
