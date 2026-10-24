import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mutateAnnotation, purgeAnnotationReceipts } from '../annotation-sync.mjs';

const TENANT = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';
const ASSET = '33333333-3333-3333-3333-333333333333';
const OPERATION = '44444444-4444-4444-4444-444444444444';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

test('retention moves full receipts to content-free tombstones', async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('insert into annotation_operation_tombstones')) return { rowCount: 2 };
      if (sql.includes('delete from annotation_operations')) return { rowCount: 2 };
      if (sql.includes('delete from annotation_operation_tombstones')) return { rowCount: 1 };
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  const result = await purgeAnnotationReceipts(client, {
    tenantId: TENANT, retentionDays: 90, tombstoneDays: 365, limit: 500,
  });
  assert.deepEqual(result, {
    receiptsMoved: 2, receiptsDeleted: 2, tombstonesDeleted: 1,
    retentionDays: 90, tombstoneDays: 365,
  });
  assert.equal(calls.length, 3);
  assert.match(calls[0].sql, /for update skip locked/);
  assert.equal(calls[0].params[1], 90);
  assert.equal(calls[0].params[2], 500);
});

test('a purged operation returns 410 without mutating annotations', async () => {
  const body = {
    operationId: OPERATION,
    assetId: ASSET,
    anchor: { type: 'pdf', page: 1 },
    color: 'yellow',
    note: 'old draft',
  };
  const data = {
    assetId: ASSET,
    anchor: body.anchor,
    color: 'yellow',
    note: 'old draft',
    selectedText: null,
    tags: [],
  };
  const hash = createHash('sha256')
    .update(JSON.stringify(canonical({ method: 'POST', id: null, data })))
    .digest('hex');
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push(sql);
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };
      if (sql.includes('from annotation_operations')) return { rows: [] };
      if (sql.includes('from annotation_operation_tombstones')) return { rows: [{ request_hash: hash }] };
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  const result = await mutateAnnotation(client, {
    method: 'POST', id: null, body, tenantId: TENANT, userId: USER,
  });
  assert.equal(result.status, 410);
  assert.equal(result.body.error, 'operation_expired');
  assert.equal(calls.some(sql => /insert into annotations/i.test(sql)), false);
});
