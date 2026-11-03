import assert from 'node:assert/strict';
import test from 'node:test';
import { boardQuotePayload, boardQuoteText } from '../public/board-clip.mjs';

const ORIGIN = 'https://elibrary.libedge.com';
const WORK = '10000000-0000-4000-8000-000000000001';
const ASSET = '20000000-0000-4000-8000-000000000002';
const book = (over = {}) => ({
  id: WORK, asset_id: ASSET, title: 'Deep Learning for NLP', publisher: 'Morgan & Claypool', language: 'en', publication_year: 2017,
  subjects: ['NLP', 'Deep Learning'], metadata: { authors: [{ family: 'Goldberg', given: 'Yoav' }], cover: { version: 3, ratio: 0.7 } }, ...over,
});

test('a PDF passage becomes a quote with a link back to its page', () => {
  const q = boardQuotePayload(book(), { text: '  Dynamically   focus on\n different parts.  ', page: 87 }, { origin: ORIGIN, assetId: ASSET });
  assert.deepEqual(q, {
    source: 'elibrary', work_id: WORK, asset_id: ASSET, title: 'Deep Learning for NLP', authors: ['Yoav Goldberg'], subjects: ['NLP', 'Deep Learning'],
    publisher: 'Morgan & Claypool', language: 'en', cover_url: `${ORIGIN}/api/books/${WORK}/cover?v=3`,
    reader_url: `${ORIGIN}/?book=${WORK}&asset=${ASSET}&page=87`, text: 'Dynamically focus on different parts.', locator: '', year: 2017, page: 87,
  });
});

test('an EPUB passage carries a CFI and its chapter, never a page', () => {
  const cfi = 'epubcfi(/6/4[c1]!/4/2/1:0,/1:20)';
  // when both exist the page wins: a link has one place to open, not two
  const both = boardQuotePayload(book(), { text: 'Words', cfiRange: cfi, chapter: 'Chapter One', page: 12 }, { origin: ORIGIN, assetId: ASSET });
  assert.equal(new URL(both.reader_url).searchParams.get('page'), '12');
  assert.equal(new URL(both.reader_url).searchParams.get('cfi'), null);
  const epub = boardQuotePayload(book(), { text: 'Words', cfiRange: cfi, chapter: 'Chapter One' }, { origin: ORIGIN, assetId: ASSET });
  assert.equal(new URL(epub.reader_url).searchParams.get('cfi'), cfi);
  assert.equal(new URL(epub.reader_url).searchParams.get('page'), null);
  assert.equal(epub.locator, 'Chapter One');
  assert.equal('page' in epub, false);
});

test('limits match what the board accepts', () => {
  const long = boardQuotePayload(book(), { text: 'word '.repeat(1000), page: 1 }, { origin: ORIGIN, assetId: ASSET });
  assert.ok(long.text.length <= 2000 && long.text.endsWith('…'));
  const heavy = boardQuotePayload(book({
    title: 'T'.repeat(900), subjects: Array.from({ length: 12 }, (_, i) => 'S' + i), publisher: 'P'.repeat(400),
    metadata: { authors: Array.from({ length: 30 }, (_, i) => ({ family: 'A' + i })) },
  }), { text: 'x', page: 1, chapter: 'C'.repeat(500) }, { origin: ORIGIN, assetId: ASSET });
  assert.equal(heavy.title.length, 500);
  assert.equal(heavy.subjects.length, 8);
  assert.equal(heavy.publisher.length, 200);
  assert.equal(heavy.authors.length, 20);
  assert.equal(heavy.locator.length, 300);
});

test('a CFI that is too long is left out instead of breaking the card', () => {
  const q = boardQuotePayload(book(), { text: 'x', cfiRange: 'epubcfi(' + 'a'.repeat(400) + ')' }, { origin: ORIGIN, assetId: ASSET });
  assert.equal(new URL(q.reader_url).searchParams.get('cfi'), null);
});

test('missing optional data is omitted, an empty passage is refused', () => {
  const q = boardQuotePayload({ id: WORK, title: '' }, { text: 'x', page: 1 }, { origin: ORIGIN });
  assert.equal(q.title, 'Başlıksız kaynak');
  assert.deepEqual(q.authors, []);
  assert.equal(q.cover_url, null);
  assert.equal('year' in q, false);
  assert.equal('asset_id' in q, false);
  assert.equal(new URL(q.reader_url).searchParams.get('asset'), null);
  assert.equal(boardQuotePayload(book(), { text: '  \n ' }, { origin: ORIGIN }), null);
  assert.equal(boardQuotePayload(null, { text: 'x' }, { origin: ORIGIN }), null);
  assert.equal(boardQuoteText(undefined), '');
});

test('a cover version that is not a number is not turned into a link', () => {
  const q = boardQuotePayload(book({ metadata: { cover: { version: '1;drop' } } }), { text: 'x', page: 1 }, { origin: ORIGIN, assetId: ASSET });
  assert.equal(q.cover_url, null);
});

test('the page policy only opens the inbox origin, and nothing when there is no inbox', async () => {
  const { APP_CSP, appCsp } = await import('../security-headers.mjs');
  assert.equal(appCsp(), APP_CSP);
  assert.equal(appCsp([]), APP_CSP);
  assert.ok(appCsp(['https://libedge.com']).includes("connect-src 'self' https://libedge.com;"));
  assert.ok(APP_CSP.includes("connect-src 'self';"));
});
