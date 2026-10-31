import test from 'node:test';
import assert from 'node:assert/strict';
import { startDownloadMaintenance, createDownloadService } from '../download-tickets.mjs';

// A deny row is how an operator answers "which title cannot be downloaded?".
// The row is only useful if it names the book, so this drives the service with a
// fake client and reads the audit payload it writes.
function fakeClient() {
  const events = [];
  return {
    events,
    async query(sql, params) {
      if (/into audit_events/i.test(sql)) {
        events.push({ action: params[2], objectId: params[3], payload: JSON.parse(params[4]) });
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
}

function serviceOver(client, { access = async () => true } = {}) {
  return createDownloadService({
    withTenant: fn => fn(client),
    getBook: async () => null,
    // The authorization decision is the caller's; these tests are about auditing, so
    // it is granted unless a test says otherwise.
    access,
    grantedIds: async () => [],
    // The tenant is read per request, so it is a function here as well - a plain
    // string would silently reintroduce the fixed env tenant this change removes.
    tenantId: () => 'tenant-1',
    b2b: false,
  });
}

test('auditDenied records the book id and asset id when the caller holds them', async () => {
  const client = fakeClient();
  const service = serviceOver(client);
  const book = { id: 'book-1', asset_id: 'asset-1' };
  await service.auditDenied({ userId: 'user-1' }, 'delivery_failed', false, 403,
    { format: 'epub', error: 'mismatched XML closing tag' }, book);
  assert.equal(client.events.length, 1);
  const [event] = client.events;
  assert.equal(event.action, 'download.ticket.deny');
  assert.equal(event.objectId, 'asset-1');
  assert.equal(event.payload.book_id, 'book-1');
  assert.equal(event.payload.reason, 'delivery_failed');
  assert.equal(event.payload.format, 'epub');
});

test('auditDenied still records a bookless deny, without inventing an id', async () => {
  // csrf_invalid and post_required fire before the book is resolved. A null id is
  // the truthful value there; the important part is that it does not throw and
  // that no payload field is fabricated.
  const client = fakeClient();
  const service = serviceOver(client);
  await service.auditDenied({ userId: 'user-1' }, 'csrf_invalid');
  assert.equal(client.events.length, 1);
  assert.equal(client.events[0].objectId, null);
  assert.equal(client.events[0].payload.book_id, null);
  assert.equal(client.events[0].payload.reason, 'csrf_invalid');
});
