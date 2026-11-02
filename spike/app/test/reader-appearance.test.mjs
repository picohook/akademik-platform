import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TYPOGRAPHY, normalizeTypography, isDefaultTypography, typographyRules, loadTypography, saveTypography, bookmarksExport,
} from '../public/reader-appearance.mjs';

const memory = () => {
  const data = new Map();
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k), data };
};

test('the defaults keep the publisher\'s style: no rules at all', () => {
  assert.deepEqual(typographyRules(DEFAULT_TYPOGRAPHY), {});
  assert.equal(isDefaultTypography(undefined), true);
});

test('unknown or hostile values fall back one key at a time', () => {
  assert.deepEqual(normalizeTypography({ font: 'comic', line: '9', measure: 'wide' }), { font: 'default', line: 'default', measure: 'wide' });
  assert.deepEqual(normalizeTypography('<script>'), DEFAULT_TYPOGRAPHY);
  assert.deepEqual(normalizeTypography(null), DEFAULT_TYPOGRAPHY);
  assert.deepEqual(normalizeTypography({ font: { toString: () => 'serif' } }), DEFAULT_TYPOGRAPHY, 'an object is not a font name');
});

test('a chosen font and line spacing become important rules for the text elements', () => {
  const rules = typographyRules({ font: 'sans', line: '1.75', measure: 'narrow' });
  const [selector] = Object.keys(rules);
  assert.match(selector, /\bp\b/);
  assert.match(rules[selector]['font-family'], /sans|Arial/i);
  assert.match(rules[selector]['font-family'], /!important$/);
  assert.equal(rules[selector]['line-height'], '1.75 !important');
  assert.equal(Object.keys(typographyRules({ font: 'serif' })[selector] || typographyRules({ font: 'serif' })[Object.keys(typographyRules({ font: 'serif' }))[0]]).join(), 'font-family', 'only what was chosen');
});

test('storage: the default removes the key, a choice is kept, a broken value is ignored', () => {
  const storage = memory();
  saveTypography(storage, 'k', { font: 'serif', line: '2', measure: 'wide' });
  assert.deepEqual(loadTypography(storage, 'k'), { font: 'serif', line: '2', measure: 'wide' });
  saveTypography(storage, 'k', DEFAULT_TYPOGRAPHY);
  assert.equal(storage.data.has('k'), false);
  storage.setItem('k', '{not json');
  assert.deepEqual(loadTypography(storage, 'k'), DEFAULT_TYPOGRAPHY);
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  assert.deepEqual(loadTypography(blocked, 'k'), DEFAULT_TYPOGRAPHY);
  assert.doesNotThrow(() => saveTypography(blocked, 'k', { font: 'serif' }));
});

test('the bookmarks export holds the book, only bookmarks, and where each one is', () => {
  const book = { id: 'b1', title: 'A Book', publisher: 'Press', publication_year: 2020, asset_id: 'a1' };
  const items = [
    { id: '1', color: 'bookmark', anchor: { type: 'epub', cfi: 'epubcfi(/6/2)' } },
    { id: '2', color: 'yellow', selected_text: 'private note text', note: 'secret', anchor: { type: 'epub', cfi: 'epubcfi(/6/4)' } },
    { id: '3', color: 'bookmark', anchor: { type: 'pdf', page: 7 } },
  ];
  const place = (item) => (item.anchor.type === 'pdf' ? `Sayfa ${item.anchor.page}` : 'Bölüm 1');
  const md = bookmarksExport(book, items, 'md', { place });
  assert.match(md.body, /# A Book/);
  assert.match(md.body, /- Bölüm 1/);
  assert.match(md.body, /- Sayfa 7/);
  assert.doesNotMatch(md.body, /private note text|secret/);
  const json = JSON.parse(bookmarksExport(book, items, 'json', { place, now: new Date('2026-01-01T00:00:00Z') }).body);
  assert.equal(json.bookmarks.length, 2);
  assert.equal(json.book.asset_id, 'a1');
  assert.equal(json.exported_at, '2026-01-01T00:00:00.000Z');
  assert.ok(json.bookmarks.every((entry) => entry.anchor && entry.place));
  assert.equal(JSON.stringify(json).includes('secret'), false);
});
