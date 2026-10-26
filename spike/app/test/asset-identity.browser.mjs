import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');

// Synthetic local origin and a fresh browser profile; no external DB/service.
const server = createServer(async (req, res) => {
  if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<title>Asset identity test</title>'); return; }
  if (!['/offline.mjs', '/downloads.mjs'].includes(req.url)) { res.writeHead(404); res.end(); return; }
  const data = await readFile(new URL('../public' + req.url, import.meta.url));
  res.writeHead(200, { 'content-type': 'application/javascript' }); res.end(data);
});
let browser;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const result = await page.evaluate(async () => {
    const work = 'same-work', pdf = 'pdf-asset', epub = 'epub-asset';
    // Reproduce the existing v2 on-device schema, including an unsynced note.
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('akademik-offline', 2);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('books', { keyPath: 'id' });
        db.createObjectStore('annotations', { keyPath: 'id' }).createIndex('asset_id', 'asset_id');
        db.createObjectStore('annotation-ops', { keyPath: 'opId' });
      };
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(['books', 'annotations', 'annotation-ops'], 'readwrite');
        tx.objectStore('books').put({ id: work, book: { id: work, asset_id: pdf, format: 'pdf' }, blob: new Blob(['PDF-original']) });
        tx.objectStore('annotations').put({ id: 'note', asset_id: pdf, ownerId: 'test-owner', note: 'PDF-only note' });
        tx.objectStore('annotation-ops').put({ opId: 'pending', assetId: pdf, note: 'unsynced' });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });
    const offline = await import('/offline.mjs');
    const migrated = await offline.listOfflineBooks();
    await offline.saveOfflineBook({ id: work, asset_id: epub, format: 'epub', title: 'EPUB' }, new Blob(['EPUB-original']));
    const all = await offline.listOfflineBooks();
    const pdfBytes = await (await offline.getOfflineBook(pdf)).blob.text();
    const epubBytes = await (await offline.getOfflineBook(epub)).blob.text();
    const legacy = await offline.getOfflineBook(work);
    const notes = await offline.listLocalAnnotations(pdf, 'test-owner');
    const queued = await new Promise((resolve, reject) => {
      const request = indexedDB.open('akademik-offline', 3);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('annotation-ops');
        const rows = tx.objectStore('annotation-ops').getAll();
        rows.onsuccess = () => resolve(rows.result);
        tx.oncomplete = () => db.close();
      };
      request.onerror = () => reject(request.error);
    });
    const { fetchDownloadBlob } = await import('/downloads.mjs');
    const calls = [];
    for (const asset of [pdf, epub]) {
      await fetchDownloadBlob({ id: work, asset_id: asset, format: asset === pdf ? 'pdf' : 'epub' }, { fetch: async url => {
        calls.push(url);
        return url.endsWith('/download-ticket')
          ? Response.json({ ticket: 'ab'.repeat(32) })
          : new Response('download-bytes', { headers: { 'content-type': asset === pdf ? 'application/pdf' : 'application/epub+zip' } });
      } });
    }
    return { migrated, all, pdfBytes, epubBytes, legacy: legacy || null, notes, queued, calls };
  });
  assert.equal(result.migrated[0].id, 'pdf-asset');
  assert.equal(result.all.length, 2);
  assert.equal(result.pdfBytes, 'PDF-original'); assert.equal(result.epubBytes, 'EPUB-original');
  assert.equal(result.legacy, null);
  assert.equal(result.notes[0].asset_id, 'pdf-asset'); assert.equal(result.notes[0].note, 'PDF-only note');
  assert.equal(result.queued[0].assetId, 'pdf-asset');
  assert.deepEqual(result.calls, ['/api/books/pdf-asset/download-ticket', '/api/books/pdf-asset/download', '/api/books/epub-asset/download-ticket', '/api/books/epub-asset/download']);
  console.log('PASS Chromium: offline v2→v3 migration preserves blobs/notes/queued operations; PDF/EPUB of one work keep distinct storage and download identities.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
