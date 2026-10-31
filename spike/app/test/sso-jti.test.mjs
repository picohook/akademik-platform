// Contract 2.2's `jti` rule and the shared vector in docs/contracts/vectors/sso-jti.json.
//
// The point of this file is that a length check alone cannot show that a `jti` is random.
// The vector fixes the producer's side - 32 random bytes to one exact base64url string - and
// this test holds both halves to it: the vector must round-trip from its own bytes, and the
// verifier's rule must be exactly the 128-bit floor the contract states.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parsePublicKeys } from '../sso/ed25519.mjs';
import { jtiEntropyIsSufficient, MIN_JTI_BYTES, MIN_JTI_LENGTH, verifyToken } from '../sso/token.mjs';
import { jtiFromBytes } from '../sso/vectors.mjs';

const vectorsDir = path.resolve(
  fileURLToPath(new URL('.', import.meta.url)), '../../../docs/contracts/vectors');
const vector = JSON.parse(readFileSync(path.join(vectorsDir, 'sso-jti.json'), 'utf8'));
const keyFile = JSON.parse(readFileSync(path.join(vectorsDir, 'ed25519-test-keys.json'), 'utf8'));
const tokenFile = JSON.parse(readFileSync(path.join(vectorsDir, 'sso-token.json'), 'utf8'));

// The claim set of a signed vector, without verifying it: the payload half of the JWS.
function decodeClaims(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
}

// Base64url strings of an exact length that decode back to themselves. Only lengths of 0, 2
// and 3 modulo 4 are canonical; 22 and 43 are, and 23 is the trap: it cannot exist
// canonically, so a hand-written fixture of 23 characters always fails the round-trip.
function canonical(length) {
  for (let index = 0; index < 2000; index += 1) {
    const candidate = createHash('sha256').update(`jti-${length}-${index}`).digest('base64url');
    const slice = candidate.slice(0, length);
    if (Buffer.from(slice, 'base64url').toString('base64url') === slice) return slice;
  }
  throw new Error(`no canonical base64url string of length ${length}`);
}

test('32 random bytes produce exactly the vector string', () => {
  const bytes = Buffer.from(vector.bytesHex, 'hex');
  assert.equal(bytes.length, 32);
  assert.equal(bytes.length, vector.bytes);
  assert.equal(vector.bits, 256);
  assert.equal(jtiFromBytes(bytes), vector.jti);
  assert.equal(vector.jti.length, vector.length);
  assert.equal(vector.length, 43, '32 bytes is 43 base64url characters without padding');
  // The digest is the input's fingerprint: a mismatch names the bytes, not only the string.
  assert.equal(createHash('sha256').update(bytes).digest('hex'), vector.sha256Hex);
});

test('the vector string meets the 2.2 floor and decodes back to the vector bytes', () => {
  assert.equal(jtiEntropyIsSufficient(vector.jti), true);
  assert.deepEqual(Buffer.from(vector.jti, 'base64url'), Buffer.from(vector.bytesHex, 'hex'));
});

test('the floor is exactly 128 bits: 16 bytes passes, 15 fails', () => {
  assert.equal(vector.minimumBits, 128);
  assert.equal(MIN_JTI_BYTES, 16);
  assert.equal(MIN_JTI_LENGTH, 22);
  assert.equal(vector.minimumBytes, 16);
  assert.equal(vector.minimumJti, Buffer.alloc(16, 0x5a).toString('base64url'));
  assert.equal(jtiEntropyIsSufficient(vector.minimumJti), true);
  const short = Buffer.alloc(15, 0x5a).toString('base64url');
  assert.equal(short.length, 20);
  assert.equal(jtiEntropyIsSufficient(short), false);
});

test('a 36-character UUID passes the length floor: the vector says so instead of hiding it', () => {
  const uuid = vector.insufficient.find((entry) => entry.name === 'uuid-with-dashes');
  // The honest statement of the rule's limit. A verifier cannot see that a UUID's version and
  // variant nibbles are fixed, so a UUID satisfies any length floor. That is exactly why the
  // producer's obligation is the vector, and why the vector file lists this case with its
  // reason rather than pretending a length check covers it.
  assert.equal(jtiEntropyIsSufficient(uuid.jti), true);
  assert.ok(Buffer.from(uuid.jti, 'base64url').length >= MIN_JTI_BYTES);
  // randomUUID() without dashes is 32 characters and also passes. Length alone decides
  // nothing about randomness, which is the whole point of having the vector.
  const hyphenless = uuid.jti.replaceAll('-', '');
  assert.equal(hyphenless.length, 32);
  assert.equal(jtiEntropyIsSufficient(hyphenless), true);
});

test('a value that is not unpadded base64url is refused even when it is long enough', () => {
  // Node's base64url decoding is lenient, so these would otherwise pass on length alone.
  // `~`, `!`, `+` and `/` are not in the base64url alphabet; padding is not in the vector.
  for (const value of [`${'a'.repeat(21)}~`, `${'a'.repeat(21)}!`, `${'a'.repeat(21)}+`,
    `${'a'.repeat(21)}/`, `${'a'.repeat(22)}=`]) {
    assert.ok(value.length >= MIN_JTI_LENGTH);
    assert.equal(jtiEntropyIsSufficient(value), false, value);
  }
  // Positive control for the loop: the vector's own string is accepted.
  assert.equal(jtiEntropyIsSufficient(vector.jti), true);
});


test('22 is a floor, not a shape: any canonical length from 22 up is accepted', () => {
  assert.equal(canonical(MIN_JTI_LENGTH).length, 22);
  assert.equal(jtiEntropyIsSufficient(canonical(MIN_JTI_LENGTH)), true);
  assert.equal(jtiEntropyIsSufficient(canonical(43)), true);
  // 21 characters cannot be canonical, so the length test alone refuses it.
  const twentyOne = canonical(43).slice(0, 21);
  assert.equal(twentyOne.length, 21);
  assert.equal(jtiEntropyIsSufficient(twentyOne), false);
  // 23 characters also cannot be canonical, so a string of that length that survives the
  // length test is refused by the round-trip. This is the trap a hand-written fixture falls
  // into, and the reason the vectors are generated rather than typed.
  const twentyThree = canonical(43).slice(0, 23);
  assert.equal(twentyThree.length, 23);
  assert.equal(jtiEntropyIsSufficient(twentyThree), false);
});

test('an empty, non-string or non-canonical jti is refused', () => {
  assert.equal(jtiEntropyIsSufficient(''), false);
  assert.equal(jtiEntropyIsSufficient(undefined), false);
  assert.equal(jtiEntropyIsSufficient(123456789012345678901234567890), false);
  assert.equal(jtiEntropyIsSufficient('a'.repeat(MIN_JTI_LENGTH - 1)), false);
  // 22 `a` characters decode to the 16-byte floor but re-encode with a different tail, so the
  // round-trip refuses them. This is the documented limit of a received-string check: a
  // canonical 22-character string *is* accepted, and randomness is the producer's rule.
  assert.equal(Buffer.from('a'.repeat(MIN_JTI_LENGTH), 'base64url').length, 16);
  assert.equal(jtiEntropyIsSufficient('a'.repeat(MIN_JTI_LENGTH)), false);
});

test('every signed token vector carries a jti that passes the rule, and the valid one verifies', () => {
  const cases = [['valid', tokenFile.valid.claims.jti],
    ...tokenFile.invalid.map((entry) => [entry.name, decodeClaims(entry.token).jti])];
  for (const [label, jti] of cases) {
    assert.equal(jtiEntropyIsSufficient(jti), true, `${label}: ${jti}`);
  }
  const result = verifyToken(tokenFile.valid.token, {
    keys: parsePublicKeys(JSON.stringify([{ kid: keyFile.kid, ...keyFile.publicJwk }])),
    issuer: tokenFile.issuer,
    audience: tokenFile.audience,
    now: tokenFile.now * 1000,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
});


