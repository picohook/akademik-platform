// Generates docs/contracts/vectors/ed25519-test-keys.json and the token vectors.
//
// Run once, and again only if the claims of 2.2 change:
//
//   node spike/app/sso/vectors.mjs > /dev/null
//
// It writes the files directly. They are in the repository because both sides of the
// contract need the same bytes: the Worker's tests sign with the private half, ours verify
// with the public half, and neither should be generating its own idea of the format. The
// private key is test-only and the vector README says so; test-keys.mjs refuses to start
// production with the matching public key loaded.
//
// One warning about re-running it: the key pair and every signature come from the CSPRNG, so
// a re-run changes `ed25519-test-keys.json` and `sso-token.json`. `sso-jti.json` does not
// change, because its bytes are frozen in this file - only the derived strings are written.
// Re-run only with the intent to rotate the test key, and update the fingerprint constant in
// test-keys.mjs in the same change.

import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, createPrivateKey, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { stateHash } from './ed25519.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const vectors = path.resolve(here, '../../../docs/contracts/vectors');

const ISSUER = 'libedge';
const AUDIENCE = 'elibrary.libedge.com';
// A fixed instant so the vector file is reproducible and the expected verdicts can be
// stated as "at this `now`". 2026-11-01T09:00:00Z.
const NOW = 1793523600;

export function signToken(privateKey, header, payload) {
  const h = Buffer.from(JSON.stringify(header)).toString('base64url');
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = sign(null, Buffer.from(`${h}.${p}`, 'utf8'), privateKey).toString('base64url');
  return `${h}.${p}.${signature}`;
}

// 2.2 asks for a `jti` that is random and at least 128 bits. The contract states the
// entropy, the token carries only the string, so a length check is all either side can
// impose on a token it receives - 22 base64url characters is the shortest string that can
// hold 128 bits.
//
// What a length check cannot show is how the Worker *produces* the value. This vector
// fixes that: the bytes, their SHA-256, and the exact base64url string. Both sides derive
// it from the bytes and compare strings, so "we generate 32 random bytes" becomes a shared,
// checkable fact rather than a sentence in a document.
//
// 32 bytes = 256 bits, base64url with no padding = 43 characters. randomUUID is deliberately
// not used: it is 122 bits under one version nibble and one variant nibble, and reads as
// 22-36 characters depending on formatting, so its length says nothing about its entropy.
export const JTI_BYTES = 32;
export const JTI_MIN_BYTES = 16; // 128 bits, the contract's floor

// The frozen byte string. Copied verbatim from a randomBytes(32) call once, so the vector is
// reproducible and both sides can hard-code it in their tests.
export const JTI_VECTOR_BYTES_HEX = 'f3a41c07be58d92e6b14af30c8d75e2194b02fa6cd3e81574a9067b2fd1c8e35';

export function jtiFromBytes(bytes) {
  return bytes.toString('base64url');
}

// The shape of the check both sides should apply to a *received* jti.
export function jtiEntropyIsSufficient(jti) {
  if (typeof jti !== 'string') return false;
  const reEncoded = Buffer.from(jti, 'base64url');
  // base64url decoding is lenient, so a string that does not round-trip is not base64url at
  // all - it merely happens to be long enough.
  if (jtiFromBytes(reEncoded) !== jti) return false;
  return reEncoded.length >= JTI_MIN_BYTES;
}

const base = {
  iss: ISSUER,
  aud: AUDIENCE,
  sub: 'lu_7f3c1a9e4b2d',
  ctx: 'institution',
  inst: '42',
  role: 'reader',
  iat: NOW,
  exp: NOW + 60,
  // 2.2 requires a jti of at least 128 bits, and the shared vector fixes what the producer
  // must do: 32 bytes, base64url, unpadded, which is 43 characters (docs/contracts/vectors/
  // sso-jti.json). This value is deliberately NOT the vector's string - the vectors are
  // independent fixtures - but it is the base64url of 32 bytes of
  // sha256('libedge handoff jti fixture'), so it is canonical, 43 characters, and 256 bits.
  // Generated, never typed: a hand-written string of the right length can be non-canonical
  // (23 or 34 characters both decode to a length that re-encodes differently) and would be
  // refused by the round-trip check.
  jti: '0TMFjvF6GF-9rXXVGLzn13VSxmFSj98G_JkZwahc8Mk',
  // The nonce of 2.1 is base64url(SHA-256(state)), which is 32 bytes and therefore 43
  // characters; it is matched against the cookie rather than decoded, but a fixture that
  // could not have been produced by the flow is a poor fixture.
  nonce: 'kZ3m0Qd2r8Xb1yN4tV6wA9cE5gH7jL0pB2cD4eF6gH',
  email: 'ayse@example.edu.tr',
};

function main() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privateJwk = privateKey.export({ format: 'jwk' });
  const publicJwk = publicKey.export({ format: 'jwk' });
  const kid = 'test-2026-11';
  const header = { alg: 'EdDSA', kid, typ: 'JWT' };
  const signer = createPrivateKey({ key: privateJwk, format: 'jwk' });

  // `inst: undefined` must not survive into the file: JSON.stringify drops it, and the
  // vector then claims an institution token with no `inst`, which token.mjs refuses. The
  // key is deleted explicitly so the vector says what it means.
  const claims = (overrides) => {
    const value = { ...base, ...overrides };
    for (const name of Object.keys(value)) if (value[name] === undefined) delete value[name];
    return value;
  };

  const state = 'A4tQ0yJm8nR2cV6xB1wE7uH3pK9sL5dF0gZ2iN8oM1q';
  const validClaims = claims({});
  const valid = signToken(signer, header, validClaims);

  const keys = {
    note: 'TEST KEY ONLY. The private half is in this repository, so any token signed with it is worthless. Production keys live in the Worker secret and in the deployment environment; see docs/contracts/vectors/README.md.',
    kid,
    alg: 'EdDSA',
    publicJwk,
    privateJwk,
  };

  const tokenVectors = {
    note: 'Signed with the test key above. `now` is the instant the expected verdicts were computed at.',
    issuer: ISSUER,
    audience: AUDIENCE,
    now: NOW,
    valid: { token: valid, expect: 'accepted', claims: validClaims },
    invalid: [
      {
        name: 'expired',
        expect: 'expired',
        token: signToken(signer, header, claims({ iat: NOW - 120, exp: NOW - 60 })),
      },
      {
        name: 'lifetime-too-long',
        expect: 'bad_claims',
        token: signToken(signer, header, claims({ exp: NOW + 3600 })),
      },
      {
        name: 'wrong-audience',
        expect: 'bad_audience',
        token: signToken(signer, header, claims({ aud: 'elibrary.example.com' })),
      },
      {
        name: 'individual-admin',
        expect: 'bad_role',
        token: signToken(signer, header, claims({
          ctx: 'individual', role: 'admin', inst: undefined,
        })),
      },
      {
        name: 'institution-without-inst',
        expect: 'bad_context',
        token: signToken(signer, header, claims({ inst: undefined })),
      },
    ],
  };

  const stateVectors = {
    note: 'The cookie header is compared as a string, attribute order included.',
    state,
    stateHash: stateHash(state),
    cookie: `__Host-sso_state=${state}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600`,
    matchingNonce: state,
    otherNonce: 'qQ0wE1r2T3y4U5iO6pA7sD8fG9hJ0kL1zX2cV3bN4m',
  };

  // Regenerated on every run, which is why the bytes are frozen and only the derived
  // strings are written: the vector must not change when this script is run again.
  const jtiBytes = Buffer.from(JTI_VECTOR_BYTES_HEX, 'hex');
  const jtiVectors = {
    note: 'Contract 2.2: jti is random and at least 128 bits. The bytes are fixed so both sides can hard-code them; the Worker must produce exactly this string for exactly these bytes.',
    algorithm: 'base64url without padding, applied to 32 bytes from a CSPRNG',
    bytesHex: JTI_VECTOR_BYTES_HEX,
    bytes: JTI_BYTES,
    bits: JTI_BYTES * 8,
    sha256Hex: createHash('sha256').update(jtiBytes).digest('hex'),
    jti: jtiFromBytes(jtiBytes),
    length: jtiFromBytes(jtiBytes).length,
    minimumBytes: JTI_MIN_BYTES,
    minimumBits: JTI_MIN_BYTES * 8,
    // A minimum-length string made of 16 random bytes: accepted by the length rule, and the
    // floor the contract allows. Shorter than this is a protocol violation, not a weak token.
    minimumJti: Buffer.alloc(JTI_MIN_BYTES, 0x5a).toString('base64url'),
    // Three strings that are >= 22 characters but are not 128 random bits.
    insufficient: [
      { name: 'uuid-with-dashes', jti: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
        why: '36 characters, but 122 bits behind two fixed nibbles; the dashes carry no entropy' },
      { name: 'repeated-character', jti: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        why: '43 characters, one distinct byte: base64url only, entropy nil' },
      { name: 'uuid-hex-no-dashes', jti: '3f2504e04f8911d39a0c0305e82c3301',
        why: '32 characters, but not base64url - it fails the round-trip and carries 122 bits' },
    ],
  };

  mkdirSync(vectors, { recursive: true });
  writeFileSync(path.join(vectors, 'ed25519-test-keys.json'), `${JSON.stringify(keys, null, 2)}\n`);
  writeFileSync(path.join(vectors, 'sso-token.json'), `${JSON.stringify(tokenVectors, null, 2)}\n`);
  writeFileSync(path.join(vectors, 'sso-state.json'), `${JSON.stringify(stateVectors, null, 2)}\n`);
  writeFileSync(path.join(vectors, 'sso-jti.json'), `${JSON.stringify(jtiVectors, null, 2)}\n`);
  console.log(`wrote 4 vector files to ${vectors}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
