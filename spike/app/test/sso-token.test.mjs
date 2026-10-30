// Contract 2.2 and 2.3/1-6 against the shared vectors in docs/contracts/vectors.
//
// No database and no container: the token module is a pure function of (token, keys,
// expectations, now), so the whole claim table can be exercised here. What this file
// deliberately does NOT test is 2.3/7-11 - tenant, membership, jti, user, session - which
// needs PostgreSQL and lives in sso-negative-controls.test.mjs.
//
// The vectors are the point. They are also the file the Worker's side tests against, so a
// green run here means both implementations agree on the bytes, not merely on the prose.

import assert from 'node:assert/strict';
import { createPrivateKey, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { KeyConfigError, parsePublicKeys, verifySignature } from '../sso/ed25519.mjs';
import { localRole, verifyToken } from '../sso/token.mjs';
import { signToken } from '../sso/vectors.mjs';

const vectorsDir = path.resolve(
  fileURLToPath(new URL('.', import.meta.url)), '../../../docs/contracts/vectors');
const keyFile = JSON.parse(readFileSync(path.join(vectorsDir, 'ed25519-test-keys.json'), 'utf8'));
const tokenFile = JSON.parse(readFileSync(path.join(vectorsDir, 'sso-token.json'), 'utf8'));

const publicJwk = { kid: keyFile.kid, ...keyFile.publicJwk };
const keys = () => parsePublicKeys(JSON.stringify([publicJwk]));
const signer = () => createPrivateKey({ key: keyFile.privateJwk, format: 'jwk' });
const header = { alg: 'EdDSA', kid: keyFile.kid };

// A signed token with the given claim overrides. A value of `undefined` *removes* the
// claim rather than being dropped by JSON.stringify, so "institution without inst" and
// "individual with inst" are both expressible.
function mint(overrides = {}) {
  const claims = { ...tokenFile.valid.claims };
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) delete claims[name];
    else claims[name] = value;
  }
  return signToken(signer(), header, claims);
}

const verify = (token, now = tokenFile.now * 1000) => verifyToken(token, {
  keys: keys(), issuer: tokenFile.issuer, audience: tokenFile.audience, now,
});

test('the shared valid vector is accepted and yields the claims the contract names', () => {
  const result = verify(tokenFile.valid.token);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.claims.ctx, 'institution');
  assert.equal(result.claims.inst, '42');
  assert.equal(result.claims.role, 'reader');
  assert.equal(result.claims.jti, tokenFile.valid.claims.jti);
});

test('every vector marked invalid is rejected with its stated reason', () => {
  for (const vector of tokenFile.invalid) {
    const result = verify(vector.token);
    assert.equal(result.ok, false, `${vector.name} should have been rejected`);
    assert.equal(result.reason, vector.expect, `${vector.name}: ${result.reason}`);
  }
});

test('a token is accepted until exp + 30 and refused one second later (2.2/3)', () => {
  const { iat, exp } = tokenFile.valid.claims;
  assert.equal(verify(tokenFile.valid.token, (exp - 1) * 1000).ok, true);
  // The tolerance is symmetric, and this is the half that is easy to omit: a Worker whose
  // clock is behind mints a token that is "expired" the moment it arrives.
  assert.equal(verify(tokenFile.valid.token, exp * 1000).ok, true);
  assert.equal(verify(tokenFile.valid.token, (exp + 30) * 1000).ok, true);
  assert.equal(verify(tokenFile.valid.token, (exp + 31) * 1000).reason, 'expired');
  assert.ok(iat < exp);
});

test('iat in the future is refused beyond the 30 second skew, allowed inside it', () => {
  const { iat } = tokenFile.valid.claims;
  assert.equal(verify(tokenFile.valid.token, (iat + 20) * 1000).ok, true);
  assert.equal(verify(tokenFile.valid.token, (iat - 31) * 1000).reason, 'not_yet_valid');
});

test('a token whose lifetime is 60 seconds passes and 61 does not', () => {
  assert.equal(verify(mint({ iat: tokenFile.now, exp: tokenFile.now + 60 })).ok, true);
  assert.equal(verify(mint({ iat: tokenFile.now, exp: tokenFile.now + 61 })).reason,
    'bad_claims');
});

test('a claim outside the contract\'s set is a rejection, not an ignored extra', () => {
  assert.equal(verify(mint({ scope: 'admin' })).reason, 'bad_claims');
});

test('an unknown kid, a foreign signature and a tampered payload are all refused', () => {
  const claims = tokenFile.valid.claims;
  assert.equal(
    verify(signToken(signer(), { alg: 'EdDSA', kid: 'not-ours' }, claims)).reason, 'unknown_kid');

  // A well-formed token from someone else's key: the same kid, a different signature.
  const { privateKey } = generateKeyPairSync('ed25519');
  assert.equal(verify(signToken(privateKey, header, claims)).reason, 'invalid_signature');

  // ...and a swapped payload under a real signature.
  const [headerSegment, , signatureSegment] = tokenFile.valid.token.split('.');
  const swapped = Buffer.from(JSON.stringify({ ...claims, sub: 'lu_someone_else' }))
    .toString('base64url');
  assert.equal(verify(`${headerSegment}.${swapped}.${signatureSegment}`).reason, 'invalid_signature');
});

test('alg is pinned: none, HS256 and RS256 are refused before any key is consulted', () => {
  const payload = Buffer.from(JSON.stringify(tokenFile.valid.claims)).toString('base64url');
  const signature = Buffer.alloc(64, 1).toString('base64url');
  for (const alg of ['none', 'HS256', 'RS256']) {
    const headerSegment = Buffer.from(JSON.stringify({ alg, kid: keyFile.kid })).toString('base64url');
    const result = verifySignature(`${headerSegment}.${payload}.${signature}`, keys());
    assert.equal(result.reason, 'bad_algorithm', alg);
  }
  // An alg of "none" with no signature at all is malformed before it is an algorithm.
  const headerSegment = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  assert.equal(verifySignature(`${headerSegment}.${payload}.`, keys()).reason, 'malformed');
});

test('ctx=institution without inst, and a non-institution token with inst, are both bad_context', () => {
  assert.equal(verify(mint({ inst: undefined })).reason, 'bad_context');
  assert.equal(verify(mint({ ctx: 'individual', inst: '42' })).reason, 'bad_context');
  assert.equal(verify(mint({ ctx: 'staff', inst: 'libedge' })).reason, 'bad_context');
  assert.equal(verify(mint({ ctx: 'admin', inst: '42' })).reason, 'bad_context');
});

test('the role table of 3.4 is enforced per context', () => {
  const withRole = (ctx, role) => mint({
    ctx, role, inst: ctx === 'institution' ? '42' : undefined,
  });
  assert.equal(verify(withRole('individual', 'admin')).reason, 'bad_role');
  assert.equal(verify(withRole('individual', 'librarian')).reason, 'bad_role');
  assert.equal(verify(withRole('institution', 'admin')).reason, 'bad_role');
  assert.equal(verify(withRole('institution', 'librarian')).ok, true);
  assert.equal(verify(withRole('staff', 'admin')).ok, true);
  assert.equal(verify(withRole('staff', 'reader')).ok, true);
  // Only the staff context may hold a role above reader; store.mjs does the mapping.
  assert.equal(localRole('institution', 'librarian'), 'reader');
  assert.equal(localRole('individual', 'reader'), 'reader');
  assert.equal(localRole('staff', 'admin'), 'admin');
  assert.equal(localRole('staff', 'librarian'), 'librarian');
  assert.equal(localRole('institution', 'admin'), null);
});

test('a short jti is refused: the replay table is keyed by it', () => {
  assert.equal(verify(mint({ jti: 'abc' })).reason, 'bad_claims');
});

test('email is required by 2.2: present and well formed passes, absent or malformed is refused', () => {
  // 2.2 marks `email` as required (it is the row's human-readable identity and what the UI
  // shows). The refusal is a claim refusal, not a database error, so the callback never gets
  // a tenant or a jti row for a token that could not become a user.
  assert.equal(verify(mint({ email: undefined })).reason, 'bad_claims');
  assert.equal(verify(mint({ email: '' })).reason, 'bad_claims');
  assert.equal(verify(mint({ email: 'not-an-address' })).reason, 'bad_claims');
  assert.equal(verify(mint({ email: 'a@b' })).reason, 'bad_claims');
  // Positive control: the shared valid vector's own address.
  const accepted = verify(mint({ email: 'reader@example.edu.tr' }));
  assert.equal(accepted.ok, true, JSON.stringify(accepted));
  assert.equal(accepted.claims.email, 'reader@example.edu.tr');
});

test('name and lang are optional display claims: typed when present, null when absent', () => {
  // 2.2 marks them "-" (not required). They reach the UI but are never identity: the user row
  // is keyed on (tenant, libedge_user_id).
  const withDisplay = verify(mint({ name: 'Ayşe Yılmaz', lang: 'tr' }));
  assert.equal(withDisplay.ok, true, JSON.stringify(withDisplay));
  assert.equal(withDisplay.claims.name, 'Ayşe Yılmaz');
  assert.equal(withDisplay.claims.lang, 'tr');

  const withoutDisplay = verify(mint({ name: undefined, lang: undefined }));
  assert.equal(withoutDisplay.ok, true, JSON.stringify(withoutDisplay));
  assert.equal(withoutDisplay.claims.name, null);
  assert.equal(withoutDisplay.claims.lang, null);

  // Typed when present: a number would be half-understood, so it is refused, as 2.2/2 says of
  // the claim table.
  assert.equal(verify(mint({ name: 42 })).reason, 'bad_claims');
  assert.equal(verify(mint({ lang: ['tr'] })).reason, 'bad_claims');
});

test('key configuration is validated once, and a private key is refused', () => {
  assert.throws(() => parsePublicKeys(''), KeyConfigError);
  assert.throws(() => parsePublicKeys('[]'), KeyConfigError);
  assert.throws(() => parsePublicKeys('{'), KeyConfigError);
  assert.throws(() => parsePublicKeys(JSON.stringify([{ kty: 'OKP', crv: 'Ed25519', x: 'AA' }])),
    /every key needs a kid/);
  assert.throws(
    () => parsePublicKeys(JSON.stringify([{ ...publicJwk, d: 'x' }])), /private component/);
  assert.throws(() => parsePublicKeys(JSON.stringify([
    { kid: 'a', ...keyFile.publicJwk },
    { kid: 'b', ...keyFile.publicJwk },
    { kid: 'c', ...keyFile.publicJwk },
  ])), /at most 2/);
  assert.equal(parsePublicKeys(JSON.stringify([{ kid: 'a', ...keyFile.publicJwk }])).size, 1);
});
