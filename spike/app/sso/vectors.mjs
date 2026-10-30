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

import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';
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

const base = {
  iss: ISSUER,
  aud: AUDIENCE,
  sub: 'lu_7f3c1a9e4b2d',
  ctx: 'institution',
  inst: '42',
  role: 'reader',
  iat: NOW,
  exp: NOW + 60,
  // 2.2 requires a jti of at least 128 bits; 27 base64url characters is ~162 bits, which
  // is the shape the Worker produces (randomUUID's 22 characters would be too short).
  jti: 'j7Yb3Qm0XvT9wZ2cR5nL8pK1sD4fG6hA0',
  nonce: 'kZ3m0Qd2r8Xb1yN4tV6wA9cE5gH7jL0p',
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

  mkdirSync(vectors, { recursive: true });
  writeFileSync(path.join(vectors, 'ed25519-test-keys.json'), `${JSON.stringify(keys, null, 2)}\n`);
  writeFileSync(path.join(vectors, 'sso-token.json'), `${JSON.stringify(tokenVectors, null, 2)}\n`);
  writeFileSync(path.join(vectors, 'sso-state.json'), `${JSON.stringify(stateVectors, null, 2)}\n`);
  console.log(`wrote 3 vector files to ${vectors}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
