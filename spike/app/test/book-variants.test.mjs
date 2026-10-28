import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { normalizeBookVariant, bookRequestId, offlineBookKey, groupBookVariants,
  variantLabel, locationMatchesBook, bookFromLocation, findOfflineVariant } from '../public/book-variants.mjs';
import { fetchDownloadBlob } from '../public/downloads.mjs';
import { createDownloadService } from '../download-tickets.mjs';

const english = { id: 'work-a', asset_id: 'asset-en', edition_id: 'edition-en', title: 'English title', language: 'en', format: 'pdf', publication_year: 2023 };
const turkish = { ...english, asset_id: 'asset-tr', edition_id: 'edition-tr', publication_year: 2022,
  metadata: { asset_variants: { 'asset-tr': { title: 'Türkçe başlık', language: 'tr', edition: '0.17.5' } } } };
const epub = { ...english, asset_id: 'asset-epub', format: 'epub' };

test('one work card groups assets without merging different works or mutating catalog rows', () => {
  const rows = [english, turkish, epub, { ...english, id: 'work-b', asset_id: 'asset-b' }];
  const before = JSON.stringify(rows);
  const groups = groupBookVariants(rows, 'tr');
  assert.equal(groups.length, 2);
  assert.equal(groups[0].variants.length, 3);
  assert.equal(groups[0].book.asset_id, 'asset-tr');
  assert.equal(groups[0].book.title, 'Türkçe başlık');
  assert.equal(groups[0].book.language, 'tr');
  assert.equal(groups[0].book.publication_year, 2022);
  assert.equal(groups[0].book.edition, '0.17.5');
  assert.equal(JSON.stringify(rows), before);
});

test('only supplied authorized assets become options; stale selections cannot add an asset', () => {
  const selected = new Map([['work-a', 'not-authorized']]);
  const [group] = groupBookVariants([english, english], 'tr', selected);
  assert.deepEqual(group.variants.map(bookRequestId), ['asset-en']);
  assert.equal(group.book.asset_id, 'asset-en');
  assert.equal(groupBookVariants([english, epub], 'tr', new Map([['work-a', 'asset-epub']]))[0].book.format, 'epub');
});

test('variant labels distinguish language, format and edition; storage keys stay asset-specific', () => {
  const book = normalizeBookVariant(turkish);
  assert.match(variantLabel(book), /PDF.*2022.*0.17.5/);
  assert.match(variantLabel(epub, 'en'), /English.*EPUB/);
  assert.notEqual(offlineBookKey(english), offlineBookKey(epub));
  assert.equal(bookRequestId({ id: 'legacy' }), 'legacy');
});

test('permalinks bind physical page/CFI to the selected asset and support legacy asset links', () => {
  const params = new URLSearchParams('book=work-a&asset=asset-epub&cfi=chapter-2');
  assert.equal(bookFromLocation([english, epub], params), epub);
  assert.equal(locationMatchesBook(params, english), false);
  assert.equal(bookFromLocation([english], params), null);
  assert.equal(bookFromLocation([english], new URLSearchParams('book=asset-en')), english);
  assert.equal(bookFromLocation([english], new URLSearchParams('book=work-a')), english);
});

test('legacy offline entries remain readable only for their recorded asset', async () => {
  const old = { id: 'work-a', book: english, blob: new Blob(['pdf']) };
  const entries = new Map([['work-a', old]]);
  assert.equal(await findOfflineVariant(english, async id => entries.get(id)), old);
  assert.equal(await findOfflineVariant(epub, async id => entries.get(id)), null);
  const next = { id: 'asset-epub', book: epub };
  entries.set('asset-epub', next);
  assert.equal(await findOfflineVariant(epub, async id => entries.get(id)), next);
});

test('saving two offline formats retains both files and the canonical work identity', async () => {
  const source = await readFile(new URL('../public/offline.mjs', import.meta.url), 'utf8');
  const code = source.slice(source.indexOf('export async function saveOfflineBook'), source.indexOf('export async function listOfflineBooks')).replace('export async', 'async');
  const entries = new Map();
  const context = vm.createContext({ offlineBookKey, BOOKS: 'books', write: async (_store, fn) => fn({ put: entry => entries.set(entry.id, entry) }) });
  vm.runInContext(code, context);
  await context.saveOfflineBook(english, new Blob(['pdf']));
  await context.saveOfflineBook(epub, new Blob(['epub']));
  assert.equal(entries.size, 2);
  assert.equal(entries.get('asset-en').book.id, 'work-a');
  assert.equal(await entries.get('asset-epub').blob.text(), 'epub');
});

test('ticket requests use the chosen asset endpoint and keep ticket values in POST bodies', async () => {
  const calls = [];
  const token = 'ab'.repeat(32);
  const blob = await fetchDownloadBlob(epub, { fetch: async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1
      ? new Response(JSON.stringify({ ticket: token }), { status: 201 })
      : new Response('selected EPUB', { headers: { 'content-type': 'application/epub+zip' } });
  } });
  assert.deepEqual(calls.map(call => call.url), ['/api/books/asset-epub/download-ticket', '/api/books/asset-epub/download']);
  assert(calls.every(call => call.options.method === 'POST' && !call.url.includes(token)));
  assert.equal(await blob.text(), 'selected EPUB');
});

function downloadHarness({ requested = epub, ticketAsset = epub.asset_id, denied = false, disabled = false } = {}) {
  const queries = [];
  const ticket = { id: 'ticket', asset_id: ticketAsset, grant_ids: [], unexpired: true, consumed_at: null, watermark_override: false };
  const client = { query: async (sql, values = []) => {
    queries.push({ sql, values });
    if (sql.includes('select *, expires_at')) return { rows: values[3] === 'work-a' ? [ticket] : [] };
    if (sql.includes('download_grants_required')) return { rows: [{ configured: denied }] };
    if (sql.includes('update download_tickets set consumed_at')) return { rowCount: 1 };
    return { rows: [], rowCount: 1 };
  } };
  const service = createDownloadService({ withTenant: fn => fn(client), tenantId: () => 'tenant', b2b: true,
    getBook: async id => id === requested.asset_id || id === requested.id ? { ...requested, allow_download: !disabled } : null,
    activeGrants: async () => [], grantAllows: () => false });
  return { service, queries, auth: { userId: 'user', tenantId: 'tenant' } };
}

test('asset aliases consume tickets by canonical work ID while retaining the asset binding', async () => {
  const h = downloadHarness();
  const result = await h.service.consume(epub.asset_id, h.auth, { ticket: 'ab'.repeat(32) });
  assert.equal(result.status, 200);
  assert.equal(result.book.asset_id, epub.asset_id);
  assert.equal(result.watermark, true);
  assert.equal(h.queries.find(q => q.sql.includes('select *, expires_at')).values[3], 'work-a');
});

for (const [label, options] of [['different asset', { ticketAsset: english.asset_id }], ['revoked grant', { denied: true }], ['disabled download', { disabled: true }]]) {
  test(`download variant rejects ${label} before consuming a ticket`, async () => {
    const h = downloadHarness(options);
    const result = await h.service.consume(epub.asset_id, h.auth, { ticket: 'ab'.repeat(32) });
    assert.equal(result.status, 403);
    assert.equal(h.queries.some(q => q.sql.includes('update download_tickets set consumed_at')), false);
  });
}
