import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_CSP } from '../security-headers.mjs';

function directive(policy, name) {
  const found = policy.split(';').map(part => part.trim()).find(part => part.startsWith(`${name} `) || part === name);
  return found ? found.split(/\s+/).slice(1) : null;
}

test('style-src allows blob: so the EPUB theme stylesheet is not blocked', () => {
  // epub.js writes its theme/font-size CSS to a blob: URL and links it from the
  // chapter iframe. That iframe is sandboxed with only allow-same-origin, so it
  // inherits this policy. Dropping blob: silently kills publisher CSS and theme.
  const sources = directive(APP_CSP, 'style-src');
  assert.ok(sources, 'style-src directive is missing');
  assert.ok(sources.includes('blob:'), `style-src must include blob:, got: ${sources.join(' ')}`);
  assert.ok(sources.includes("'self'"), 'style-src must still allow same-origin stylesheets');
});

test('script-src stays script-free of blob: and unsafe-eval', () => {
  // Chapter documents run with allow-same-origin only. Widening script-src would
  // let publisher content execute, which the reader deliberately prevents.
  const sources = directive(APP_CSP, 'script-src');
  assert.deepEqual(sources, ["'self'"]);
});

test('core hardening directives are unchanged', () => {
  assert.deepEqual(directive(APP_CSP, 'default-src'), ["'self'"]);
  assert.deepEqual(directive(APP_CSP, 'object-src'), ["'none'"]);
  assert.deepEqual(directive(APP_CSP, 'base-uri'), ["'self'"]);
  assert.deepEqual(directive(APP_CSP, 'frame-ancestors'), ["'none'"]);
  assert.deepEqual(directive(APP_CSP, 'form-action'), ["'self'"]);
  assert.deepEqual(directive(APP_CSP, 'connect-src'), ["'self'"]);
});
