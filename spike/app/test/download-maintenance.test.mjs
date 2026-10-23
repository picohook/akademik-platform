import test from 'node:test';
import assert from 'node:assert/strict';
import { startDownloadMaintenance } from '../download-tickets.mjs';

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
