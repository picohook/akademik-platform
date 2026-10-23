import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchDownloadBlob, saveOfflineDownload, MAX_OFFLINE_BYTES } from '../public/downloads.mjs';

const ticket = 'ab'.repeat(32);
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const book = (format = 'pdf') => ({ id: 'book-123', title: 'Academic title', format, allow_download: true });

function dependencies(format = 'pdf', { issue, delivery, estimate, save } = {}) {
  const calls = [];
  const saved = [];
  return {
    calls, saved,
    fetch: async (url, options) => {
      calls.push({ url, ...options });
      // Fail the test immediately if any original-file GET/probe is introduced.
      assert.equal(options.method, 'POST');
      assert.equal(url.includes('?'), false);
      assert.equal(options.cache, 'no-store');
      assert.equal(options.referrerPolicy, 'no-referrer');
      if (url.endsWith('/download-ticket')) {
        assert.deepEqual(JSON.parse(options.body), {});
        return issue ? issue() : json({ ticket, expiresIn: 60 }, 201);
      }
      assert.equal(url, '/api/books/book-123/download');
      assert.deepEqual(JSON.parse(options.body), { ticket });
      return delivery ? delivery() : new Response(`STAMPED-${format}`, { headers: { 'content-type': format === 'epub' ? 'application/epub+zip' : 'application/pdf' } });
    },
    storageEstimate: async () => estimate || { usage: 0, quota: 1000000 },
    saveOfflineBook: async (...args) => {
      saved.push(args);
      return save ? save(...args) : { id: args[0].id, size: args[1].size, ...args[2] };
    },
  };
}

for (const format of ['pdf', 'epub']) {
  test(`offline ${format} persists only ticket response bytes and provenance`, async () => {
    const deps = dependencies(format);
    const entry = await saveOfflineDownload(book(format), deps);
    assert.equal(deps.calls.length, 2);
    assert.equal(deps.saved.length, 1);
    assert.equal(await deps.saved[0][1].text(), `STAMPED-${format}`);
    assert.deepEqual(deps.saved[0][2], { downloadProvenance: 'ticketed-download-v1' });
    assert.equal(entry.downloadProvenance, 'ticketed-download-v1');
    assert.equal(JSON.stringify(entry).includes(ticket), false);
  });
}

test('normal downloads use the same two POSTs and return delivery bytes', async () => {
  const deps = dependencies();
  const blob = await fetchDownloadBlob(book(), deps);
  assert.equal(await blob.text(), 'STAMPED-pdf');
  assert.equal(deps.saved.length, 0);
  assert.equal(deps.calls.length, 2);
});

for (const [phase, status] of [['issue', 403], ['delivery', 403], ['delivery', 409]]) {
  test(`${phase} denial ${status} never persists or falls back to source`, async () => {
    const deps = dependencies('pdf', { [phase]: () => json({ error: 'denied' }, status) });
    await assert.rejects(saveOfflineDownload(book(), deps), /denied/);
    assert.equal(deps.saved.length, 0);
    assert.equal(deps.calls.length, phase === 'issue' ? 1 : 2);
  });
}

test('invalid ticket response stops before delivery and persistence', async () => {
  const deps = dependencies('pdf', { issue: () => json({ ticket: 'invalid' }, 201) });
  await assert.rejects(saveOfflineDownload(book(), deps), /invalid download ticket/);
  assert.equal(deps.calls.length, 1);
  assert.equal(deps.saved.length, 0);
});

test('network failure never persists an offline book', async () => {
  const deps = dependencies('pdf', { delivery: () => { throw new TypeError('network failed'); } });
  await assert.rejects(saveOfflineDownload(book(), deps), /network failed/);
  assert.equal(deps.saved.length, 0);
});

test('declared size above offline cap cancels response before persistence', async () => {
  let cancelled = false;
  const deps = dependencies('pdf', { delivery: () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-type': 'application/pdf', 'content-length': String(MAX_OFFLINE_BYTES + 1) } }) });
  await assert.rejects(saveOfflineDownload(book(), deps), { code: 'DOWNLOAD_TOO_LARGE' });
  assert.equal(cancelled, true);
  assert.equal(deps.saved.length, 0);
});

test('actual streamed bytes enforce cap even with understated content length', async () => {
  let cancelled = false;
  const deps = dependencies('pdf', { delivery: () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(6)); controller.enqueue(new Uint8Array(6)); }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'application/pdf', 'content-length': '1' } }) });
  await assert.rejects(saveOfflineDownload(book(), { ...deps, maxBytes: 10 }), { code: 'DOWNLOAD_TOO_LARGE' });
  assert.equal(cancelled, true);
  assert.equal(deps.saved.length, 0);
});

test('storage quota failure never writes to IndexedDB', async () => {
  const deps = dependencies('pdf', { estimate: { usage: 94, quota: 100 } });
  await assert.rejects(saveOfflineDownload(book(), deps), { code: 'OFFLINE_QUOTA' });
  assert.equal(deps.saved.length, 0);
});

test('unexpected successful HTML response never becomes an offline book', async () => {
  const deps = dependencies('pdf', { delivery: () => new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } }) });
  await assert.rejects(saveOfflineDownload(book(), deps), /unexpected download content type/);
  assert.equal(deps.saved.length, 0);
});

test('disabled download does not request a ticket or save bytes', async () => {
  const deps = dependencies();
  await assert.rejects(saveOfflineDownload({ ...book(), allow_download: false }, deps), { code: 'DOWNLOAD_DISABLED' });
  assert.equal(deps.calls.length, 0);
  assert.equal(deps.saved.length, 0);
});

for (const phase of ['issue', 'delivery']) {
  test(`${phase} rate limit exposes wait time and never persists`, async () => {
    const deps = dependencies('pdf', { [phase]: () => json({ error: 'too many download requests', retryAfter: 37 }, 429) });
    await assert.rejects(saveOfflineDownload(book(), deps), { status: 429, retryAfter: 37 });
    assert.equal(deps.saved.length, 0);
    assert.equal(deps.calls.length, phase === 'issue' ? 1 : 2);
  });
}
