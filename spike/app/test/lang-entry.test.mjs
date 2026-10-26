import assert from 'node:assert/strict';
import test from 'node:test';

function installDom(href, stored = {}) {
  const storage = new Map(Object.entries(stored));
  const replaced = [];
  let throwingStorage = false;
  globalThis.window = { location: { href } };
  globalThis.localStorage = {
    getItem(key) { if (throwingStorage) throw new Error('blocked'); return storage.get(key) ?? null; },
    setItem(key, value) { if (throwingStorage) throw new Error('blocked'); storage.set(key, value); },
  };
  globalThis.history = { replaceState(_state, _title, url) { replaced.push(url); } };
  globalThis.NodeFilter = { SHOW_TEXT: 4 };
  globalThis.document = {
    documentElement: { lang: '' },
    body: { querySelectorAll() { return []; } },
    title: '',
    querySelectorAll() { return []; },
    createTreeWalker() { return { nextNode() { return null; } }; },
  };
  return { storage, replaced, setStorageBlocked(value) { throwingStorage = value; } };
}

const module = await import('../public/i18n.mjs');
const { getLang, initializeLanguage } = module;

test('tr-TR entry language is normalized, saved, and removed from the URL', () => {
  const dom = installDom('https://elibrary.libedge.com/?lang=tr-TR&foo=1#section', { uiLang: 'en' });
  initializeLanguage();
  assert.equal(getLang(), 'tr');
  assert.equal(dom.storage.get('uiLang'), 'tr');
  assert.deepEqual(dom.replaced, ['/?foo=1#section']);
  assert.equal(globalThis.document.documentElement.lang, 'tr');
});

test('en entry overrides a saved Turkish preference and cleans the URL', () => {
  const dom = installDom('https://elibrary.libedge.com/?lang=en', { uiLang: 'tr' });
  initializeLanguage();
  assert.equal(getLang(), 'en');
  assert.equal(dom.storage.get('uiLang'), 'en');
  assert.deepEqual(dom.replaced, ['/']);
});

test('invalid entry language is removed while the saved preference stays', () => {
  const dom = installDom('https://elibrary.libedge.com/?lang=xx&keep=1', { uiLang: 'en' });
  initializeLanguage();
  assert.equal(getLang(), 'en');
  assert.deepEqual(dom.replaced, ['/?keep=1']);
});

test('entry language still applies when storage is unavailable', () => {
  const dom = installDom('https://elibrary.libedge.com/?lang=en', {});
  dom.setStorageBlocked(true);
  initializeLanguage();
  assert.equal(getLang(), 'en');
  assert.deepEqual(dom.replaced, ['/']);
});
