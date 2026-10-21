import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSnippet,
  catalogMatches,
  editDistance,
  findSnippetAnchor,
  findWholeWord,
  foldSearch,
  normalizeSearch,
} from '../public/search.mjs';

test('folds Turkish diacritics and dotted/dotless i', () => {
  assert.equal(foldSearch('İşıklar'), 'isiklar');
  assert.equal(foldSearch('IŞIK'), 'isik');
  assert.equal(foldSearch('ÇĞİÖŞÜ'), 'cgiosu');
  assert.equal(foldSearch('  Çok   Kitap  '), 'cok kitap');
});

test('normalizes case and whitespace without folding', () => {
  assert.equal(normalizeSearch('  IŞIK   Testi '), 'ışık testi');
  assert.equal(normalizeSearch('İĞNE'), 'iğne');
});

test('finds whole words only', () => {
  assert.equal(findWholeWord('kitap kitaplar', 'kitap'), 0);
  assert.equal(findWholeWord('kitaplar', 'kitap'), -1);
  assert.equal(findWholeWord('bir kitap', 'kitap'), 4);
  assert.equal(findWholeWord('kitap, kitap!', 'kitap', 5), 7);
});

test('builds a snippet around the match', () => {
  const text = `${'a'.repeat(60)} kitap ${'b'.repeat(60)}`;
  const snippet = buildSnippet(text, 61, 5);
  assert.ok(snippet.startsWith('…'));
  assert.ok(snippet.includes('kitap'));
  assert.ok(snippet.endsWith('…'));
});

test('anchors snippets for exact, stemmed and fuzzy matches', () => {
  assert.deepEqual(findSnippetAnchor('the kitap test', 'kitap'), { index: 4, length: 5 });
  // "kitabı" stems to "kitap"; the shared prefix locates the snippet.
  const stemmed = findSnippetAnchor('bir kitabı okudum', 'kitap');
  assert.ok(stemmed.index >= 4 && stemmed.index < 10);
  const fuzzy = findSnippetAnchor('implant tedavisi', 'implnat');
  assert.equal(fuzzy.index, 0);
});

test('edit distance tolerates a single typo', () => {
  assert.equal(editDistance('kitap', 'kitap'), 0);
  assert.equal(editDistance('kitap', 'kitab'), 1);
  assert.equal(editDistance('implantoloji', 'implantoloj'), 1);
  assert.equal(editDistance('kitap', 'kalem'), 4);
});

test('catalog matching folds diacritics and tolerates typos', () => {
  assert.ok(catalogMatches(['Işık Fiziği'], 'isik'));
  assert.ok(catalogMatches(['Diş Hekimliğinde İmplant Komplikasyonları'], 'dis hekimligi'));
  assert.ok(catalogMatches(['Oral Radiology'], 'oral radiolgy'));
  assert.ok(catalogMatches(['Nursing Research'], 'nursing researc'));
  assert.ok(!catalogMatches(['Oral Radiology'], 'dentistry'));
});
