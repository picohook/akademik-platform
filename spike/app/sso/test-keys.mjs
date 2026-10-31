// Production must not trust the test key (the reason this file exists).
//
// docs/contracts/vectors/ed25519-test-keys.json carries a private key, in the repository,
// so that both sides of the contract can be tested against the same vectors. A public key
// derived from it is therefore public knowledge: anyone who has read the repo can mint a
// handoff token that verifies. That is fine in a test and fatal in production.
//
// The check is on the *fingerprint*, not on the kid or the file path: a deployment that
// copied the test key into its own secret under a new kid would still be refused, and a
// deployment that merely happens to reuse the kid name with its own key is not punished.
// Failing closed at startup is deliberate - a server that boots with a known private key
// in play is worse than one that does not boot.
//
// NODE_ENV=production is the gate. It is the same signal the rest of the deployment uses;
// if a deployment does not set it, this protection does not exist, which is stated here
// rather than assumed.

import { createPublicKey, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parsePublicKeys } from './ed25519.mjs';

// base64url(SHA-256(SPKI DER)) for the test key. Short enough to eyeball in a diff, long
// enough that a collision is not a concern.
export const TEST_KEY_FINGERPRINTS = Object.freeze([
  // Derived from docs/contracts/vectors/ed25519-test-keys.json at generation time; the
  // vector README repeats it, and vectors.test.mjs fails if the file's key stops matching
  // this constant - so the fingerprint cannot silently drift away from the file.
  '9ARGAc3O0tF_RLGuHrWeJYdEmSqo8M1rUrgZMaVF--k',
]);

export function fingerprintOf(jwk) {
  const key = createPublicKey({ key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x }, format: 'jwk' });
  const der = key.export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(der).digest('base64url');
}

export class TestKeyInProductionError extends Error {
  constructor(kid) {
    super(`LIBEDGE_SSO_PUBLIC_KEYS contains the test vector key (kid ${kid}) ` +
      'while NODE_ENV=production; refusing to start');
    this.name = 'TestKeyInProductionError';
  }
}

// Called from parsePublicKeys once the entries are known-good, so the fingerprint is
// computed over a key that already imported.
//
// `env` defaults to a *non*-production object, not to process.env: a caller that passes
// only `fingerprints` must not accidentally inherit the real environment and silently
// refuse to start. loadPublicKeys always passes its own env explicitly.
export function assertNotTestKeyInProduction(entries, { env = {}, fingerprints } = {}) {
  if (env.NODE_ENV !== 'production') return;
  const known = fingerprints || TEST_KEY_FINGERPRINTS;
  for (const entry of entries) {
    if (known.includes(fingerprintOf(entry))) {
      throw new TestKeyInProductionError(entry.kid);
    }
  }
}

// Exported for the vector test, which re-derives the fingerprint from the JSON file so a
// regenerated key cannot leave a stale constant behind.
export function readVectorKeys(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

// The production gate, wired into the one place keys are parsed. Kept out of ed25519.mjs
// so that module stays a pure format check with no knowledge of the repository layout,
// and so that a deployment which never calls this function is visible as a missing call
// rather than a missing condition inside a validator.
export function loadPublicKeys(rawValue, { env = process.env } = {}) {
  const keys = parsePublicKeys(rawValue);
  if (env.NODE_ENV === 'production') {
    const entries = JSON.parse(typeof rawValue === 'string' ? rawValue : JSON.stringify(rawValue));
    // The env is threaded through explicitly: assertNotTestKeyInProduction defaults to
    // process.env, and passing only the fingerprints would make it consult the real one.
    assertNotTestKeyInProduction(entries, { env, fingerprints: TEST_KEY_FINGERPRINTS });
  }
  return keys;
}
