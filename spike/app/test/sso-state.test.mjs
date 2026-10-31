// The state cookie (contract 2.1/2-4): the `__Host-` rules, and the vectors that the
// Worker's side is expected to agree with.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { fingerprintOf, TEST_KEY_FINGERPRINTS } from '../sso/test-keys.mjs';
import {
  STATE_COOKIE,
  STATE_MAX_AGE_SECONDS,
  clearStateCookieHeader,
  hashOf,
  newStateValue,
  nonceMatches,
  normaliseContextHint,
  stateCookieHeader,
} from '../sso/state.mjs';

const vectorsDir = path.resolve(
  fileURLToPath(new URL('.', import.meta.url)), '../../../docs/contracts/vectors');
const stateFile = JSON.parse(readFileSync(path.join(vectorsDir, 'sso-state.json'), 'utf8'));
const keyFile = JSON.parse(readFileSync(path.join(vectorsDir, 'ed25519-test-keys.json'), 'utf8'));

test('the cookie header matches the shared vector exactly', () => {
  assert.equal(stateCookieHeader(stateFile.state), stateFile.cookie);
});

test('the header satisfies every `__Host-` requirement', () => {
  const header = stateCookieHeader('abc');
  assert.equal(STATE_COOKIE, '__Host-sso_state');
  assert.match(header, /; Secure(;|$)/);
  assert.match(header, /; Path=\/(;|$)/);
  // A Domain attribute would make the browser refuse the whole cookie, and would also let
  // a sibling subdomain set one of the same name. Its absence is the guarantee.
  assert.doesNotMatch(header, /Domain/i);
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Lax/);
  assert.equal(STATE_MAX_AGE_SECONDS, 600);
});

test('clearing uses the same attributes', () => {
  const cleared = clearStateCookieHeader();
  assert.match(cleared, /Path=\//);
  assert.match(cleared, /Max-Age=0/);
  assert.match(cleared, /Secure/);
  assert.doesNotMatch(cleared, /Domain/i);
});

test('a new state is 256 bits of base64url, and never repeats', () => {
  const a = newStateValue();
  const b = newStateValue();
  assert.equal(a.length, 43);
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
});

test('the nonce is the hash of the cookie, not the cookie (2.3/4)', () => {
  // The vector's `matchingNonce` is base64url(SHA-256(state)), which is also what 2.1/2
  // sends to the Worker as `state_hash`. This is the assertion that was wrong the first
  // time: comparing raw state meant an honest Worker's token could never pass.
  assert.equal(stateFile.matchingNonce, stateFile.stateHash);
  assert.equal(hashOf(stateFile.state), stateFile.stateHash);
  assert.equal(nonceMatches(stateFile.state, stateFile.matchingNonce), true);
  // The raw state is NOT a valid nonce, on either side of the comparison.
  assert.notEqual(stateFile.matchingNonce, stateFile.state);
  assert.equal(nonceMatches(stateFile.state, stateFile.state), false);
  assert.equal(nonceMatches(stateFile.stateHash, stateFile.stateHash), false);
  // A hash of the wrong cookie is a mismatch, and so is an unrelated value.
  assert.equal(nonceMatches(stateFile.otherNonce, stateFile.matchingNonce), false);
  assert.equal(nonceMatches(stateFile.state, stateFile.otherNonce), false);
  // Both missing must not count as a match.
  assert.equal(nonceMatches(null, null), false);
  assert.equal(nonceMatches('', ''), false);
  assert.equal(nonceMatches(stateFile.state, ''), false);
  assert.equal(nonceMatches(null, stateFile.matchingNonce), false);
});

test('a ctx hint outside the three contexts is dropped, not forwarded', () => {
  assert.equal(normaliseContextHint('INSTITUTION'), 'institution');
  assert.equal(normaliseContextHint('staff'), 'staff');
  for (const value of ['admin', 'root', '', null, undefined, 'institution;']) {
    assert.equal(normaliseContextHint(value), null, String(value));
  }
});

// The fingerprint constant in test-keys.mjs is what production is gated on. If the vector
// file is regenerated, the constant must change with it - otherwise production would keep
// refusing a key nobody uses, or worse, stop refusing the one in the repository.
test('the test key fingerprint matches the committed vector file', () => {
  assert.equal(fingerprintOf(keyFile.publicJwk), TEST_KEY_FINGERPRINTS[0]);
});
