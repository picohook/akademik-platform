import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(process.env.READER_APP_SOURCE || new URL('../public/app.js', import.meta.url), 'utf8');
const start = source.lastIndexOf('(async function init() {');
assert.notEqual(start, -1, 'application startup is present');
const startup = source.slice(start);

async function run({ signedIn = true, changeAccount = false, failBooks = false, offline = false } = {}) {
  const calls = [];
  const state = { authEpoch: 0 };
  const loginScreen = { hidden: false };
  const mode = { textContent: '', classList: { toggle() {} } };
  const user = { id: 'test-reader', role: 'reader' };
  let inert = true;
  const context = {
    state, loginScreen, mode, URLSearchParams,
    window: { location: { search: '' } },
    console: { error() {} },
    t: value => value,
    applyBrand() {}, applyFooter() {},
    fetch: async path => {
      if (path === '/api/config') return { ok: true, json: async () => ({ mode: 'db' }) };
      assert.equal(path, '/api/me');
      return { ok: signedIn, json: async () => {
        if (changeAccount) state.authEpoch += 1;
        return user;
      } };
    },
    setUser(value) { state.user = value; inert = !value; calls.push('user'); },
    showLogin() { loginScreen.hidden = false; inert = true; calls.push('login'); },
    async bootData() {
      calls.push('books');
      if (failBooks) throw new Error('catalogue unavailable');
      assert.equal(loginScreen.hidden, true, 'authenticated startup hides sign-in before loading books');
      assert.equal(inert, false, 'authenticated catalogue is interactive');
    },
    async syncOfflineAnnotations() { calls.push('sync'); },
    async listOfflineBooks() { return offline ? [{ id: 'offline-book' }] : []; },
    async showOfflineLibrary() { loginScreen.hidden = true; calls.push('offline'); },
  };
  await vm.runInNewContext(startup, context);
  return { calls, state, loginScreen, inert };
}

test('a restored cookie session enters the catalogue without submitting the login form', async () => {
  const result = await run();
  assert.equal(result.loginScreen.hidden, true);
  assert.equal(result.inert, false);
  assert.deepEqual(result.calls, ['user', 'books', 'sync']);
});
test('an anonymous visitor stays on the public sign-in page', async () => {
  const result = await run({ signedIn: false });
  assert.equal(result.loginScreen.hidden, false);
  assert.deepEqual(result.calls, ['login']);
});
test('an account change during session lookup cannot enter the catalogue', async () => {
  const result = await run({ changeAccount: true });
  assert.equal(result.loginScreen.hidden, false);
  assert.deepEqual(result.calls, ['login']);
});
test('a failed catalogue load returns to the sign-in screen', async () => {
  const result = await run({ failBooks: true });
  assert.equal(result.loginScreen.hidden, false);
  assert.equal(result.inert, true);
  assert.deepEqual(result.calls, ['user', 'books', 'login']);
});
test('cached offline books remain available when catalogue loading fails', async () => {
  const result = await run({ failBooks: true, offline: true });
  assert.equal(result.loginScreen.hidden, true);
  assert.deepEqual(result.calls, ['user', 'books', 'offline']);
});
