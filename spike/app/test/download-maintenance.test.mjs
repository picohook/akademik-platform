import test from 'node:test';
import assert from 'node:assert/strict';
import { createDownloadService, startDownloadMaintenance } from '../download-tickets.mjs';

test('cleanup starts immediately, repeats each minute without overlap and stops on close', async () => {
  let tick, cleared = 0, unref = 0, calls = 0, finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const timer = { unref: () => { unref++; } };
  const stop = startDownloadMaintenance({ async maintenance() { calls++; await pending; } }, {
    setIntervalFn(fn, delay) { tick = fn; assert.equal(delay, 60_000); return timer; },
    clearIntervalFn(value) { assert.equal(value, timer); cleared++; },
  });
  assert.equal(calls, 1);
  assert.equal(unref, 1);
  await tick();
  assert.equal(calls, 1, 'a slow cleanup must not overlap the next tick');
  finish();
  await new Promise(resolve => setImmediate(resolve));
  await tick();
  assert.equal(calls, 2);
  stop();
  assert.equal(cleared, 1);
  await tick();
  assert.equal(calls, 2, 'a captured callback cannot restart cleanup after close');
});

test('a cleanup without a tenant is refused instead of guessing one', async () => {
  // The sweeper runs from a timer with no request and no bound tenant. Defaulting
  // to the env tenant here would put the bug back where it is hardest to see, so a
  // missing tenant must throw rather than quietly pick one.
  let connected = 0;
  const service = createDownloadService({
    withTenant: async () => { connected += 1; },
    tenantId: () => { throw new Error('no tenant bound to this request'); },
  });
  for (const argument of [undefined, null, '']) {
    // assert.rejects() needs a promise; service.maintenance() throws synchronously,
    // so the call is wrapped - otherwise the throw escapes the assertion entirely
    // and the test fails for the wrong reason.
    assert.throws(() => service.maintenance(argument), /requires an explicit tenant id/);
  }
  assert.equal(connected, 0, 'a rejected cleanup must not open a connection or run a statement');
});

test('ticket statements take the tenant from the request, not from a fixed value', async () => {
  // The service is constructed once, at startup, so a value captured then is the
  // env tenant forever. Here the same service answers two requests in two tenants
  // and every statement must carry the tenant that ran, not the first one seen.
  // The observable is the first SQL parameter of each statement - the tenant column
  // in all of them - because that is exactly what the request binding decides.
  let bound = null;
  const seen = [];
  const client = {
    async query(sql, params) {
      seen.push({ sql: sql.trim().split(/\s+/).slice(0, 3).join(' '), tenant: params?.[0] });
      if (/insert into download_ticket_limits/.test(sql)) {
        return { rows: [{ request_count: 1, notified: false, retry_after: 60 }] };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  const service = createDownloadService({
    withTenant: async (fn) => fn(client),
    getBook: async () => null,
    activeGrants: async () => [],
    grantAllows: () => true,
    tenantId: () => {
      if (!bound) throw new Error('no tenant bound to this request');
      return bound;
    },
    b2b: true,
  });
  await assert.rejects(() => service.checkRequest({ userId: 'u1' }), /no tenant bound to this request/,
    'a request with no tenant must fail instead of writing under a default');
  assert.deepEqual(seen.filter(entry => entry.tenant !== undefined), [],
    'no tenant-scoped statement may run before the tenant is known');

  bound = '5799f2a5-3d90-41b1-90de-9da07d776052';
  await service.checkRequest({ userId: 'u1' });
  await service.auditDenied({ userId: 'u1', tenantId: bound }, 'book_unavailable');
  const first = seen.length;
  bound = '22222222-2222-4222-8222-222222222222';
  await service.checkRequest({ userId: 'u2' });
  await service.auditDenied({ userId: 'u2', tenantId: bound }, 'book_unavailable');

  assert.ok(first > 0, 'the first tenant issued statements');
  const scoped = seen.filter(entry => entry.tenant !== undefined);
  const tenants = [...new Set(scoped.map(entry => entry.tenant))];
  assert.deepEqual(tenants, ['5799f2a5-3d90-41b1-90de-9da07d776052', '22222222-2222-4222-8222-222222222222'],
    `statements must follow the request tenant; saw ${JSON.stringify(seen)}`);
  assert.equal(scoped.filter(entry => entry.tenant === '22222222-2222-4222-8222-222222222222').length,
    scoped.filter(entry => entry.tenant === '5799f2a5-3d90-41b1-90de-9da07d776052').length,
    'the second tenant ran the same number of statements under its own tenant');
});

test('a failed cleanup is reported and does not disable subsequent ticks', async () => {
  let tick, calls = 0;
  const errors = [];
  const failure = new Error('isolated maintenance failure');
  const stop = startDownloadMaintenance({ async maintenance() { if (++calls === 1) throw failure; } }, {
    setIntervalFn(fn) { tick = fn; return {}; }, clearIntervalFn() {}, onError(error) { errors.push(error); },
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(errors, [failure]);
  await tick();
  assert.equal(calls, 2);
  stop();
});
