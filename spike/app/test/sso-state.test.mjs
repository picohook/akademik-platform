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

test('the nonce comparison is exact, including for empty values', () => {
  assert.equal(nonceMatches(stateFile.matchingNonce, stateFile.matchingNonce), true);
  assert.equal(nonceMatches(stateFile.state, stateFile.otherNonce), false);
  // Both missing must not count as a match.
  assert.equal(nonceMatches(null, null), false);
  assert.equal(nonceMatches('', ''), false);
  assert.equal(nonceMatches(stateFile.state, ''), false);
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
