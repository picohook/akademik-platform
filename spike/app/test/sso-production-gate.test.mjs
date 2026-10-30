// The production gate on the repository's test key (see sso/test-keys.mjs).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  TEST_KEY_FINGERPRINTS,
  TestKeyInProductionError,
  assertNotTestKeyInProduction,
  loadPublicKeys,
} from '../sso/test-keys.mjs';

const vectorsDir = path.resolve(
  fileURLToPath(new URL('.', import.meta.url)), '../../../docs/contracts/vectors');
const keyFile = JSON.parse(readFileSync(path.join(vectorsDir, 'ed25519-test-keys.json'), 'utf8'));
const testKeyEnv = JSON.stringify([{ kid: keyFile.kid, ...keyFile.publicJwk }]);

// A key that is nobody's test vector: generated for this file, thrown away.
const otherKeyEnv = JSON.stringify([{
  kid: 'production-2026-11',
  kty: 'OKP',
  crv: 'Ed25519',
  x: 'k6Hn5s0cQ4bW1dV3zJ8mR2pL9tY7eF4gA1uX6oI0yNs',
}]);

test('production refuses to start with the test vector key loaded', () => {
  assert.throws(
    () => loadPublicKeys(testKeyEnv, { env: { NODE_ENV: 'production' } }),
    (error) => error instanceof TestKeyInProductionError && /kid test-2026-11/.test(error.message));
});

test('production starts with its own key', () => {
  const keys = loadPublicKeys(otherKeyEnv, { env: { NODE_ENV: 'production' } });
  assert.equal(keys.size, 1);
});

test('outside production the test key loads, because that is what the tests use', () => {
  for (const nodeEnv of ['development', 'test', undefined]) {
    const keys = loadPublicKeys(testKeyEnv, { env: { NODE_ENV: nodeEnv } });
    assert.equal(keys.size, 1);
  }
});

test('the gate keys on the fingerprint, not on the kid', () => {
  // The same key under a different name is still the same key.
  const renamed = JSON.stringify([{ kid: 'looks-production', ...keyFile.publicJwk }]);
  assert.throws(() => loadPublicKeys(renamed, { env: { NODE_ENV: 'production' } }),
    TestKeyInProductionError);
  // And the same name over a different key is not punished.
  const reusedName = JSON.stringify([{ kid: keyFile.kid, ...JSON.parse(otherKeyEnv)[0] }]);
  assert.equal(loadPublicKeys(reusedName, { env: { NODE_ENV: 'production' } }).size, 1);
});

test('the fingerprint list is what the vector file produces', () => {
  assert.equal(TEST_KEY_FINGERPRINTS.length, 1);
  // assertNotTestKeyInProduction gates on NODE_ENV, which is why the env is explicit.
  assert.throws(() => assertNotTestKeyInProduction(
    [{ kid: keyFile.kid, ...keyFile.publicJwk }],
    { env: { NODE_ENV: 'production' }, fingerprints: TEST_KEY_FINGERPRINTS }),
  TestKeyInProductionError);
  // In development the same call is a no-op, because the tests use this key on purpose.
  assert.doesNotThrow(() => assertNotTestKeyInProduction(
    [{ kid: keyFile.kid, ...keyFile.publicJwk }],
    { env: { NODE_ENV: 'development' }, fingerprints: TEST_KEY_FINGERPRINTS }));
});
