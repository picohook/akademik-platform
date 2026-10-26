import test from 'node:test';
import assert from 'node:assert/strict';
import { groupCatalog, effectiveGrantStatus, validateGrant, validateMetadata } from '../libedge-admin.mjs';
import { grantAllows } from '../grant-policy.mjs';

const collection = '66666666-6666-6666-6666-666666666666';
test('groups explicit work variants and editions without merging asset identities or matching titles heuristically', () => {
  const rows = [
    { work_id: 'one', title: 'Same', language: 'tr', metadata: { variant_group: 'shared' }, edition_id: 'e1', asset_id: 'pdf1', format: 'pdf' },
    { work_id: 'one', title: 'Same', language: 'tr', metadata: { variant_group: 'shared' }, edition_id: 'e1', asset_id: 'epub1', format: 'epub' },
    { work_id: 'two', title: 'Same', language: 'en', metadata: { variant_group: 'shared' }, edition_id: 'e2', asset_id: 'pdf2', format: 'pdf' },
    { work_id: 'three', title: 'Same', language: 'en', metadata: {}, edition_id: 'e3', asset_id: 'pdf3', format: 'pdf' },
  ];
  const result = groupCatalog(rows);
  assert.equal(result.length, 2); assert.equal(result[0].variants.length, 2);
  assert.deepEqual(result[0].variants[0].editions[0].assets.map(a => a.id), ['pdf1', 'epub1']);
  assert.equal(result[0].variants[1].editions[0].assets[0].id, 'pdf2');
});
test('expiry and future activation are computed without rewriting source grant status', () => {
  const now = Date.parse('2026-10-26T00:00:00Z');
  assert.equal(effectiveGrantStatus({ status: 'active', valid_from: '2026-01-01', valid_to: '2026-10-26' }, now), 'expired');
  assert.equal(effectiveGrantStatus({ status: 'active', valid_from: '2026-10-27', valid_to: null }, now), 'pending');
  assert.equal(effectiveGrantStatus({ status: 'revoked', valid_from: '2026-01-01', valid_to: null }, now), 'revoked');
});
test('empty active grants fail closed unless the tenant is explicitly unconfigured', () => {
  assert.equal(grantAllows({ id: 'book' }, []), false);
  const unconfigured = []; unconfigured.accessRequired = false;
  assert.equal(grantAllows({ id: 'book' }, unconfigured), true);
  assert.equal(grantAllows({ collection_ids: [collection] }, [{ scope_type: 'collection', scope_id: collection }]), true);
  assert.equal(grantAllows({ collection_ids: [] }, [{ scope_type: 'collection', scope_id: collection }]), false);
});
test('grant and metadata validation reject malformed dates, identity changes, unsafe covers, or edition-wide edits', () => {
  const valid = { collection_id: collection, status: 'active', valid_from: '2026-10-26T00:00:00Z', valid_to: null };
  assert.equal(validateGrant(valid).valid_to, null);
  for (const invalid of [{ ...valid, valid_to: 'bad' }, { ...valid, valid_to: '2026-01-01' }, { ...valid, status: 'anything' }, { ...valid, tenant_id: collection }]) {
    assert.throws(() => validateGrant(invalid));
  }
  for (const invalid of [{ asset_id: collection }, { publisher: 'All editions' }, { cover_url: 'javascript:alert(1)' }, { cover_url: 'https://name:secret@example.test/x' }, { publication_year: 2.5, edition_id: collection }]) {
    assert.throws(() => validateMetadata(invalid));
  }
  assert.deepEqual(validateMetadata({ publisher: 'Only this edition', edition_id: collection }), { publisher: 'Only this edition', edition_id: collection });
});
