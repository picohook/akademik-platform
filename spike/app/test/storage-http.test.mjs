import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';

const appDir = fileURLToPath(new URL('..', import.meta.url));
test('application regression: login, CSRF, PDF upload/read/range/delete and protected static paths', async t => {
  const net = await import('node:net');
  const reservation = net.createServer(); await new Promise(r => reservation.listen(0, '127.0.0.1', r));
  const port = reservation.address().port; await new Promise(r => reservation.close(r));
  const server = spawn(process.execPath, ['server.mjs'], { cwd: appDir, env: { ...process.env, DATABASE_URL: '', STORAGE_DRIVER: 'local', PORT: String(port), SESSION_SECRET: 'storage-test-secret-not-production' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; server.stdout.on('data', c => { logs += c; }); server.stderr.on('data', c => { logs += c; });
  t.after(async () => { server.kill(); if (server.exitCode === null) await once(server, 'exit'); });
  const base = `http://127.0.0.1:${port}`;
  for (let n = 0; n < 100; n++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 30)); }
  const unauthorized = await fetch(base + '/api/books/missing/file'); assert.equal(unauthorized.status, 401, logs); await unauthorized.text();
  const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'librarian@example.edu.tr', password: 'demo1234' }) });
  assert.equal(login.status, 200, logs);
  const cookies = login.headers.getSetCookie().map(c => c.split(';')[0]);
  const cookie = cookies.join('; '); const csrf = decodeURIComponent(cookies.find(c => c.startsWith('akademik_csrf=')).split('=')[1]);
  const headers = { cookie, 'x-csrf-token': csrf };
  const pdf = await PDFDocument.create(); pdf.addPage(); const bytes = await pdf.save();
  const form = new FormData(); form.set('file', new Blob([bytes], { type: 'application/pdf' }), 'storage-test.pdf'); form.set('title', 'Storage regression');
  const upload = await fetch(base + '/api/upload', { method: 'POST', headers, body: form }); const book = await upload.json();
  assert.equal(upload.status, 201, JSON.stringify(book));
  t.after(() => unlink(path.join(appDir, 'public', book.storage_key)).catch(() => {}));
  const read = await fetch(base + `/api/books/${book.id}/file`, { headers: { cookie } });
  assert.equal(read.status, 200); assert.deepEqual(Buffer.from(await read.arrayBuffer()), Buffer.from(bytes));
  const unauthorizedAsset = await fetch(base + `/api/books/${book.asset_id}/file`);
  assert.equal(unauthorizedAsset.status, 401); await unauthorizedAsset.text();
  const selectedAsset = await fetch(base + `/api/books/${book.asset_id}/file`, { headers: { cookie, range: 'bytes=0-9' } });
  assert.equal(selectedAsset.status, 206);
  assert.deepEqual(Buffer.from(await selectedAsset.arrayBuffer()), Buffer.from(bytes).subarray(0, 10));
  const range = await fetch(base + `/api/books/${book.id}/file`, { headers: { cookie, range: 'bytes=-5' } });
  assert.equal(range.status, 206); assert.deepEqual(Buffer.from(await range.arrayBuffer()), Buffer.from(bytes).subarray(-5));
  const staticRead = await fetch(base + '/' + book.storage_key); assert.equal(staticRead.status, 404); await staticRead.text();

  // Browsers request /favicon.ico unprompted when a page declares no icon, so a
  // 404 here is a request made on every first visit, not an edge case. It was
  // served as a JSON 404 before; the file and its allowlist entry are the fix.
  const favicon = await fetch(base + '/favicon.ico');
  assert.equal(favicon.status, 200, 'favicon.ico must not 404');
  assert.equal(favicon.headers.get('content-type'), 'image/x-icon');
  const faviconBytes = Buffer.from(await favicon.arrayBuffer());
  assert.equal(faviconBytes.readUInt16LE(0), 0, 'ICO reserved field');
  assert.equal(faviconBytes.readUInt16LE(2), 1, 'ICO type must be 1 (icon)');
  const imageCount = faviconBytes.readUInt16LE(4);
  assert.ok(imageCount >= 2, `expected multiple icon sizes, got ${imageCount}`);
  for (let index = 0; index < imageCount; index++) {
    const at = 6 + index * 16;
    const size = faviconBytes.readUInt32LE(at + 8);
    const offset = faviconBytes.readUInt32LE(at + 12);
    assert.ok(offset + size <= faviconBytes.length, `icon ${index} payload is out of bounds`);
    // PNG signature: every entry must be a real PNG, not a truncated slice.
    assert.equal(faviconBytes.subarray(offset, offset + 8).toString('hex'), '89504e470d0a1a0a', `icon ${index} is not a PNG`);
  }

  const home = await fetch(base + '/');
  assert.equal(home.status, 200);
  const html = await home.text();
  // Without an explicit icon link the 404 above is guaranteed to repeat.
  assert.match(html, /<link rel="icon" href="\/favicon\.ico"/, 'index.html must declare favicon.ico');
  assert.match(html, /<link rel="icon" href="\/icons\/icon-192\.png"[^>]*type="image\/png"/, 'index.html must declare a PNG icon');
  // mobile-web-app-capable is the standard spelling; apple-mobile-web-app-capable
  // alone is ignored by Chrome/Samsung Internet and deprecated.
  assert.match(html, /<meta name="mobile-web-app-capable" content="yes"/, 'index.html must declare mobile-web-app-capable');
  assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes"/, 'index.html must keep the Apple variant');
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest"/, 'manifest must stay linked');

  // The declared icons must actually resolve, or the fix only moves the 404.
  for (const icon of ['/favicon.ico', '/icons/icon-192.png']) {
    const response = await fetch(base + icon);
    assert.equal(response.status, 200, `${icon} declared in <head> must be served`);
    await response.text();
  }

  const denied = await fetch(base + `/api/books/${book.id}`, { method: 'DELETE', headers: { cookie } }); assert.equal(denied.status, 403); await denied.text();
  const deleted = await fetch(base + `/api/books/${book.id}`, { method: 'DELETE', headers }); assert.equal(deleted.status, 200); await deleted.text();
  const gone = await fetch(base + `/api/books/${book.id}/file`, { headers: { cookie } }); assert.equal(gone.status, 404); await gone.text();
});
