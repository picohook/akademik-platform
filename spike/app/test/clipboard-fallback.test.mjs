import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const fn = source.slice(source.indexOf('async function writeClipboard('), source.indexOf('\nasync function copyCitation'));
function setup({ native = false, success = true } = {}) {
  let handler, removed = false, restored = false, copied;
  const area = { style: {}, focus() {}, select() {}, remove() { removed = true; } };
  const document = {
    activeElement: { focus() { restored = true; } }, body: { appendChild() {} }, createElement() { return area; },
    addEventListener(type, cb, capture) { assert.equal(capture, true); handler = cb; },
    removeEventListener(type, cb, capture) { assert.equal(cb, handler); assert.equal(capture, true); handler = null; },
    execCommand() {
      const event = { clipboardData: { setData(type, text) { copied = text; } }, preventDefault() {}, stopImmediatePropagation() { event.stopped = true; } };
      handler(event); assert.equal(event.stopped, true); return success;
    },
  };
  const context = vm.createContext({ document, navigator: { clipboard: native ? { async writeText(text) { copied = text; } } : undefined } });
  vm.runInContext(fn, context);
  return { context, result: () => ({ copied, removed, restored, handler }) };
}
test('native clipboard preserves quote and citation', async () => {
  const env = setup({ native: true }); await env.context.writeClipboard('Alıntı\nGürsel, 2026, s. 12');
  assert.equal(env.result().copied, 'Alıntı\nGürsel, 2026, s. 12');
});
test('fallback captures exact text before PDF copy listeners and cleans up', async () => {
  const env = setup(); await env.context.writeClipboard('Alıntı\nAtıf: s. 12');
  assert.deepEqual(env.result(), { copied: 'Alıntı\nAtıf: s. 12', removed: true, restored: true, handler: null });
});
test('failed fallback reports failure and removes temporary listeners and field', async () => {
  const env = setup({ success: false }); await assert.rejects(env.context.writeClipboard('quote'), /copy failed/);
  assert.equal(env.result().handler, null); assert.equal(env.result().removed, true);
});
