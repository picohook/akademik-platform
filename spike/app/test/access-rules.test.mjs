import assert from 'node:assert/strict';
import test from 'node:test';
import { diagnoseAccess, grantAllows, grantMatchesBook, grantState } from '../access-rules.mjs';

const NOW = new Date('2026-11-03T12:00:00Z');
const hours = (n) => new Date(NOW.getTime() + n * 3600_000).toISOString();
const book = { id: 'w1', publisher: 'Elsevier', subjects: ['Biology', 'Genetics'], collection_ids: ['c1', 'c2'] };
const grant = (over = {}) => ({
  id: 'g1', subject_type: 'tenant', scope_type: 'title', scope_id: 'w1', scope_key: null, valid_from: hours(-1), valid_to: null,
  source: 'subscription', status: 'active', subscription_source_id: null, ...over,
});
const tenant = { id: 't1', status: 'active' };
const run = (over = {}) => diagnoseAccess({
  now: NOW, tenant, account: null, membership: null, readerUser: { id: 'u1', role: 'reader' }, grants: [grant()], sync: [], work: book, workAsked: true, ...over,
});

test('every scope type matches the way the reader has always matched it', () => {
  assert.equal(grantMatchesBook({ scope_type: 'all' }, book), true);
  assert.equal(grantMatchesBook({ scope_type: 'title', scope_id: 'w1' }, book), true);
  assert.equal(grantMatchesBook({ scope_type: 'title', scope_id: 'w2' }, book), false);
  assert.equal(grantMatchesBook({ scope_type: 'publisher', scope_key: 'elsevier' }, book), true);
  assert.equal(grantMatchesBook({ scope_type: 'publisher', scope_key: 'Springer' }, book), false);
  assert.equal(grantMatchesBook({ scope_type: 'subject', scope_key: 'genetics' }, book), true);
  assert.equal(grantMatchesBook({ scope_type: 'subject', scope_key: 'chemistry' }, book), false);
  assert.equal(grantMatchesBook({ scope_type: 'collection', scope_id: 'c2' }, book), true);
  assert.equal(grantMatchesBook({ scope_type: 'collection', scope_id: 'c9' }, book), false);
  assert.equal(grantMatchesBook({ scope_type: 'unknown' }, book), false);
});

test('publisher and subject scope matching is independent of the process locale', () => {
  for (const scopeKey of ['ELSEVIER', 'Elsevier', 'elsevier']) {
    assert.equal(grantMatchesBook({ scope_type: 'publisher', scope_key: scopeKey }, book), true, scopeKey);
  }

  const istanbulBook = { ...book, publisher: 'İstanbul' };
  assert.equal(grantMatchesBook({ scope_type: 'publisher', scope_key: 'İSTANBUL' }, istanbulBook), true);
  assert.equal(grantMatchesBook({ scope_type: 'publisher', scope_key: 'İstanbul' }, istanbulBook), true);
  assert.equal(grantMatchesBook({ scope_type: 'subject', scope_key: 'ELSEVIER' }, {
    ...book, subjects: ['Elsevier'],
  }), true);
});

test('no grant, no access (fail closed)', () => {
  assert.equal(grantAllows(book, []), false);
  assert.equal(grantAllows(book, null), false);
  assert.equal(grantAllows(book, [grant()]), true);
});

test('a grant is judged at the given time', () => {
  assert.equal(grantState(grant(), NOW), 'active');
  assert.equal(grantState(grant({ valid_from: hours(2) }), NOW), 'not_started');
  assert.equal(grantState(grant({ valid_to: hours(-1) }), NOW), 'ended');
  assert.equal(grantState(grant({ valid_to: NOW.toISOString() }), NOW), 'ended');
  assert.equal(grantState(grant({ status: 'revoked' }), NOW), 'revoked');
});

test('an active grant that covers the book opens it', () => {
  const { decision, grants } = run();
  assert.deepEqual([decision.can_open, decision.reason, decision.via_grant_id], [true, 'OK', 'g1']);
  assert.equal(grants[0].covers_work, true);
});

test('the first thing that closes access is the reason, in the order the reader enforces', () => {
  assert.equal(run({ account: { status: 'disabled' }, membership: { status: 'revoked' }, tenant: { id: 't1', status: 'inactive' } }).decision.reason, 'ACCOUNT_DISABLED');
  assert.equal(run({ membership: { status: 'revoked' }, tenant: { id: 't1', status: 'inactive' } }).decision.reason, 'MEMBERSHIP_REVOKED');
  assert.equal(run({ tenant: { id: 't1', status: 'inactive' } }).decision.reason, 'TENANT_INACTIVE');
  assert.equal(run({ account: { status: 'active' }, membership: { status: 'active' } }).decision.reason, 'OK');
});

test('a book that does not exist, one that is not covered, one covered only by a grant that is over', () => {
  assert.equal(run({ work: null }).decision.reason, 'WORK_NOT_FOUND');
  assert.equal(run({ grants: [grant({ scope_id: 'w9' })] }).decision.reason, 'NO_MATCHING_GRANT');
  assert.equal(run({ grants: [] }).decision.reason, 'NO_MATCHING_GRANT');
  assert.equal(run({ grants: [grant({ valid_to: hours(-5) })] }).decision.reason, 'GRANT_NOT_ACTIVE');
  assert.equal(run({ grants: [grant({ status: 'revoked' })] }).decision.reason, 'GRANT_NOT_ACTIVE');
  // another grant that is still open wins over one that has ended
  const both = run({ grants: [grant({ id: 'old', valid_to: hours(-5) }), grant({ id: 'new' })] });
  assert.deepEqual([both.decision.reason, both.decision.via_grant_id], ['OK', 'new']);
});

test('with no book asked, any active grant is enough', () => {
  assert.equal(diagnoseAccess({ now: NOW, tenant, account: null, membership: null, readerUser: null, grants: [grant({ scope_id: 'x' })], sync: [], work: null, workAsked: false }).decision.reason, 'OK');
  assert.equal(diagnoseAccess({ now: NOW, tenant, account: null, membership: null, readerUser: null, grants: [], sync: [], work: null, workAsked: false }).decision.reason, 'NO_ACTIVE_GRANT');
});

test('hints: never signed in, and a grant that outlived its subscription lease', () => {
  assert.deepEqual(run({ readerUser: null }).decision.hints, ['NEVER_SIGNED_IN']);
  const expired = run({
    grants: [grant({ subscription_source_id: 'institution:42' })],
    sync: [{ source_id: 'institution:42', status: 'active', lease_until: hours(-1) }],
  });
  assert.deepEqual(expired.decision.hints, ['LEASE_EXPIRED_GRANT_STILL_OPEN']);
  assert.equal(expired.grants[0].lease_expired, true);
  assert.equal(expired.decision.can_open, true, 'the diagnosis reports what the reader does today, and flags the lease');
});
