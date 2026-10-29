import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BridgeError, isConfigured, tokenScope, parseActor, parseTenantPut, parseUserPut,
  parseStatusPut, parseSubscriptionPut, parseSourceId, subscriptionPayloadSha256,
  revisionDecision, assertLeaseWithinCeiling, parseLimit, leaseMaxHours, slugProblem,
} from '../libedge-bridge.mjs';

// The pure half of the LibEdge bridge: no database, no socket.
//
// These tests pin the contract's shape rules, which is where a bridge drifts without
// anyone noticing - a field renamed, a code changed, an unknown field silently accepted.
// Section numbers refer to docs/contracts/libedge-elibrary-v1.md @ b15f8b5.

const TOKEN = 'entitlements-token-value-1';
const CATALOG = 'catalog-token-value-1-xx';
const ENV = {
  LIBEDGE_ENTITLEMENTS_TOKENS: TOKEN,
  LIBEDGE_CATALOG_TOKENS: CATALOG,
};

const NOW = new Date('2026-11-01T00:00:00Z');

// A complete, valid opening request. Each test starts from this and breaks exactly one
// thing, so a failure points at the thing that was broken rather than at the fixture.
const openBody = () => ({
  revision: 7,
  tenant: { kind: 'institution', ref: '42' },
  subject: { type: 'tenant' },
  status: 'active',
  valid_from: '2026-11-01T00:00:00Z',
  valid_to: '2027-10-31T23:59:59Z',
  lease_until: '2026-11-04T00:00:00Z',
  scopes: [
    { type: 'collection', id: '74149e93-39dd-50ba-b120-a75415d9b0ca' },
    { type: 'title', id: 'f4797188-83fd-5737-8185-fb957cfaf77c' },
  ],
});

function throwsCode(fn, code, status) {
  let caught = null;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  if (!caught) throw new Error(`expected ${code}, but nothing was thrown`);
  // The assertions are outside the try: inside it, a failing assert would be caught by
  // this same block and re-thrown as "not a BridgeError", hiding which expectation
  // actually failed.
  assert.ok(caught instanceof BridgeError, `expected BridgeError, got ${caught?.constructor?.name}: ${caught?.message}`);
  assert.equal(caught.code, code);
  if (status !== undefined) assert.equal(caught.status, status);
}

// --- configuration and tokens (5.1) -----------------------------------------

test('a bridge with no token at all is not configured', () => {
  assert.equal(isConfigured({}), false);
  assert.equal(isConfigured({ LIBEDGE_ENTITLEMENTS_TOKENS: '' }), false);
  assert.equal(isConfigured({ LIBEDGE_ENTITLEMENTS_TOKENS: ' , ' }), false);
});

test('one usable token is enough to count as configured', () => {
  // Only the catalog token present: the bridge is on, and entitlements endpoints answer
  // 401. That difference matters - 503 says "nobody can call me", 401 says "you cannot".
  assert.equal(isConfigured({ LIBEDGE_CATALOG_TOKENS: TOKEN }), true);
});

test('a bearer token resolves to its scope', () => {
  assert.equal(tokenScope(ENV, `Bearer ${TOKEN}`), 'entitlements');
  assert.equal(tokenScope(ENV, `Bearer ${CATALOG}`), 'catalog');
  // Header casing is not part of the wire format's meaning.
  assert.equal(tokenScope(ENV, `bearer ${TOKEN}`), 'entitlements');
});

test('a wrong, missing or too-short token resolves to nothing', () => {
  assert.equal(tokenScope(ENV, 'Bearer wrong-token-value-xxxxxxxx'), null);
  assert.equal(tokenScope(ENV, ''), null);
  assert.equal(tokenScope(ENV, TOKEN), null, 'a bare token with no scheme must not pass');
  // Short secrets are refused rather than compared. A 4-character token in the env is a
  // misconfiguration, and honouring it would make the bridge look configured and safe.
  assert.equal(tokenScope({ LIBEDGE_ENTITLEMENTS_TOKENS: 'abcd' }, 'Bearer abcd'), null);
});


// --- bodies (5.1: unknown field -> 400) -------------------------------------

test('an unknown field is rejected rather than ignored', () => {
  // The contract is explicit, and it is the cheap way to catch a caller that thinks it
  // is setting something we never implemented.
  throwsCode(() => parseTenantPut({ name: 'A', slug: 'a', colour: 'red' }), 'INVALID_BODY', 400);
  throwsCode(() => parseUserPut({ email: 'a@b.c', name: 'A', role: 'admin' }), 'INVALID_BODY', 400);
});

test('tenant bodies validate name, slug and status', () => {
  assert.deepEqual(parseTenantPut({ name: 'Kurum', slug: 'kurum' }),
    { name: 'Kurum', slug: 'kurum', status: 'active' });
  throwsCode(() => parseTenantPut({ name: 'Kurum', slug: 'kurum', status: 'deleted' }),
    'INVALID_BODY', 400);
  throwsCode(() => parseTenantPut({ slug: 'kurum' }), 'INVALID_BODY', 400);
});

test('slugs that would reach a URL badly are refused by shape', () => {
  assert.equal(slugProblem('kurum-one'), null);
  for (const bad of ['Kurum', 'kurum one', 'kurum--one', '-kurum', 'kurum-']) {
    assert.ok(slugProblem(bad), `${bad} should be refused`);
  }
});

test('account and membership status bodies are revision-tagged', () => {
  assert.deepEqual(
    parseStatusPut({ revision: 3, status: 'disabled' }, 'status', ['active', 'disabled']),
    { revision: 3, status: 'disabled' },
  );
  // A numeric string is the wrong type, not a number to coerce.
  throwsCode(
    () => parseStatusPut({ revision: '3', status: 'disabled' }, 'status', ['active', 'disabled']),
    'INVALID_BODY', 400,
  );
  throwsCode(
    () => parseStatusPut({ revision: 1.5, status: 'disabled' }, 'status', ['active', 'disabled']),
    'INVALID_BODY', 400,
  );
});

// --- subscriptions (5.4) ----------------------------------------------------

test('source_id carries the tenant kind', () => {
  assert.deepEqual(parseSourceId('institution:123'), { kind: 'institution', ref: '123' });
  assert.deepEqual(parseSourceId('individual:456'), { kind: 'individual', ref: '456' });
  throwsCode(() => parseSourceId('institution'), 'INVALID_BODY', 400);
  throwsCode(() => parseSourceId('tenant:123'), 'INVALID_BODY', 400);
});

test('a complete opening request parses', () => {
  const parsed = parseSubscriptionPut(openBody());
  assert.equal(parsed.closing, false);
  assert.equal(parsed.revision, 7);
  assert.equal(parsed.leaseUntil.toISOString(), '2026-11-04T00:00:00.000Z');
  assert.equal(parsed.scopes.length, 2);
});

test('valid_to may be null: an open-ended subscription is legal', () => {
  const body = openBody();
  body.valid_to = null;
  assert.equal(parseSubscriptionPut(body).validTo, null);
  delete body.valid_to;
  assert.equal(parseSubscriptionPut(body).validTo, null);
});

test('a closing request needs only the four fields and drops the rest', () => {
  // Section 5.4: dates, lease and scopes are "gonderilmez; gelirse yok sayilir,
  // dogrulanmaz". Dropped, not validated - a full template body must still close.
  const parsed = parseSubscriptionPut({
    revision: 9,
    tenant: { kind: 'institution', ref: '42' },
    subject: { type: 'tenant' },
    status: 'cancelled',
    valid_from: 'not a date at all',
    lease_until: 'far beyond any ceiling',
    scopes: 'not even an array',
  });
  assert.equal(parsed.closing, true);
  assert.equal(parsed.validFrom, undefined);
  assert.equal(parsed.scopes, undefined);
});

test('tenant kind and subject type must agree, on closing requests too', () => {
  const individual = openBody();
  individual.tenant = { kind: 'individual', ref: 'b2c' };
  throwsCode(() => parseSubscriptionPut(individual), 'SUBJECT_NOT_ALLOWED', 422);

  const institution = openBody();
  institution.subject = { type: 'user', libedge_user_id: '456' };
  throwsCode(() => parseSubscriptionPut(institution), 'SUBJECT_NOT_ALLOWED', 422);

  // The same mismatch on a cancellation is still a shape error: closing does not make an
  // incoherent body coherent.
  const closing = {
    revision: 2,
    tenant: { kind: 'institution', ref: '42' },
    subject: { type: 'user', libedge_user_id: '456' },
    status: 'cancelled',
  };
  throwsCode(() => parseSubscriptionPut(closing), 'SUBJECT_NOT_ALLOWED', 422);
});

// --- the fingerprint (5.4 step 2) -------------------------------------------

test('the fingerprint ignores caller scope order', () => {
  const a = openBody();
  const b = openBody();
  b.scopes = [a.scopes[1], a.scopes[0]];
  assert.equal(
    subscriptionPayloadSha256(parseSubscriptionPut(a)),
    subscriptionPayloadSha256(parseSubscriptionPut(b)),
    'reordering the same scopes must not look like different content',
  );
});

test('the fingerprint ignores the lease', () => {
  // lease_until is excluded on purpose: a replay that extends the lease must not read as
  // new content, or an honest retry would come back as REVISION_CONFLICT.
  const a = openBody();
  const b = openBody();
  b.lease_until = '2026-11-03T00:00:00Z';
  assert.equal(
    subscriptionPayloadSha256(parseSubscriptionPut(a)),
    subscriptionPayloadSha256(parseSubscriptionPut(b)),
  );
});

test('the fingerprint changes with content that matters', () => {
  const base = subscriptionPayloadSha256(parseSubscriptionPut(openBody()));
  const changed = openBody();
  changed.scopes = changed.scopes.slice(0, 1);
  assert.notEqual(subscriptionPayloadSha256(parseSubscriptionPut(changed)), base);
  const retimed = openBody();
  retimed.valid_to = '2028-01-01T00:00:00Z';
  assert.notEqual(subscriptionPayloadSha256(parseSubscriptionPut(retimed)), base);
});

test('a closing request fingerprints the same whatever the template contained', () => {
  const bare = {
    revision: 9,
    tenant: { kind: 'institution', ref: '42' },
    subject: { type: 'tenant' },
    status: 'cancelled',
  };
  const padded = {
    ...bare,
    valid_from: '2026-01-01T00:00:00Z',
    scopes: [{ type: 'title', id: 'x' }],
  };
  assert.equal(
    subscriptionPayloadSha256(parseSubscriptionPut(bare)),
    subscriptionPayloadSha256(parseSubscriptionPut(padded)),
  );
});

// --- the revision rule (2.5, 5.4 step 4, acceptance 5/9/18) -----------------

test('a new or higher revision is applied', () => {
  assert.deepEqual(revisionDecision(null, { revision: 1, payload_sha256: 'a' }),
    { action: 'apply', replayed: false });
  assert.deepEqual(
    revisionDecision({ revision: 1, payload_sha256: 'a' }, { revision: 2, payload_sha256: 'b' }),
    { action: 'apply', replayed: false },
  );
});

test('same revision and same content is a replay', () => {
  assert.deepEqual(
    revisionDecision({ revision: 7, payload_sha256: 'a' }, { revision: 7, payload_sha256: 'a' }),
    { action: 'replay', replayed: true },
  );
});

test('same revision and different content is a conflict', () => {
  throwsCode(
    () => revisionDecision({ revision: 7, payload_sha256: 'a' }, { revision: 7, payload_sha256: 'b' }),
    'REVISION_CONFLICT', 409,
  );
});

test('a lower revision is stale and reports what was applied', () => {
  // Acceptance test 18: a late "active" (rev 4) must not reopen an account closed at
  // rev 5. The applied revision is in the answer so LibEdge can see why.
  try {
    revisionDecision({ revision: 5, payload_sha256: 'b' }, { revision: 4, payload_sha256: 'a' });
    throw new Error('expected STALE_REVISION');
  } catch (error) {
    assert.equal(error.code, 'STALE_REVISION');
    assert.equal(error.status, 409);
    assert.equal(error.appliedRevision, 5);
  }
});

// --- the lease ceiling (5.4) ------------------------------------------------

test('the lease must be in the future and within the ceiling', () => {
  assert.doesNotThrow(() => assertLeaseWithinCeiling(new Date('2026-11-02T00:00:00Z'), NOW, {}));
  // Exactly now is already expired: the contract says now < lease_until.
  throwsCode(() => assertLeaseWithinCeiling(new Date(NOW), NOW, {}), 'LEASE_TOO_LONG', 422);
  throwsCode(() => assertLeaseWithinCeiling(new Date('2026-10-01T00:00:00Z'), NOW, {}),
    'LEASE_TOO_LONG', 422);
});

test('the ceiling is the configured hours plus five minutes', () => {
  // Default 72h + 5min. One second past must fail and exactly at the limit must pass -
  // the boundary is the whole point of a ceiling.
  const atLimit = new Date(NOW.getTime() + (72 * 60 + 5) * 60 * 1000);
  assert.doesNotThrow(() => assertLeaseWithinCeiling(atLimit, NOW, {}));
  throwsCode(() => assertLeaseWithinCeiling(new Date(atLimit.getTime() + 1000), NOW, {}),
    'LEASE_TOO_LONG', 422);
});

test('the ceiling follows LIBEDGE_LEASE_MAX_HOURS and ignores nonsense', () => {
  assert.equal(leaseMaxHours({}), 72);
  assert.equal(leaseMaxHours({ LIBEDGE_LEASE_MAX_HOURS: '24' }), 24);
  // A garbage value falls back to the default rather than to zero, which would reject
  // every lease including a one-minute one.
  assert.equal(leaseMaxHours({ LIBEDGE_LEASE_MAX_HOURS: 'soon' }), 72);
  assert.equal(leaseMaxHours({ LIBEDGE_LEASE_MAX_HOURS: '-5' }), 72);
  throwsCode(
    () => assertLeaseWithinCeiling(
      new Date(NOW.getTime() + 3 * 60 * 60 * 1000), NOW, { LIBEDGE_LEASE_MAX_HOURS: '2' }),
    'LEASE_TOO_LONG', 422,
  );
});

// --- pagination (5.1) -------------------------------------------------------

test('limit defaults to 50 and is bounded to 1..100', () => {
  assert.equal(parseLimit(undefined), 50);
  assert.equal(parseLimit(''), 50);
  assert.equal(parseLimit('1'), 1);
  assert.equal(parseLimit('100'), 100);
  throwsCode(() => parseLimit('0'), 'INVALID_BODY', 400);
  throwsCode(() => parseLimit('101'), 'INVALID_BODY', 400);
  // Neither of these is what a caller meant by a page size.
  throwsCode(() => parseLimit('1e3'), 'INVALID_BODY', 400);
  throwsCode(() => parseLimit('-5'), 'INVALID_BODY', 400);
  throwsCode(() => parseLimit('5.5'), 'INVALID_BODY', 400);
});

