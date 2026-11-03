import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

// The public demo (/demo/): the real reader with its API answered in the browser (public/demo/shim.js).
//
//   * no sign-in, two NASA books with covers; the real catalogue, the real reader;
//   * the only /api/ requests that reach the server are the two fixed public book files;
//   * a note written on the EPUB stays in this browser, survives a reload, and shows in the notes panel;
//   * "Reset demo" removes the demo's notes and leaves everything else (another user's rows, other keys) alone;
//   * the PDF opens with its 11 pages and its text;
//   * on the server, the demo route is public and read-only, the two files support ranges, and every other book and
//     API path still needs a session.
//
//   PLAYWRIGHT_MODULE=<path to playwright> node test/public-demo.browser.mjs

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const appDir = fileURLToPath(new URL('../', import.meta.url));
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks += 1; };
const same = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks += 1; };

const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  probe.on('error', reject);
});

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, PORT: String(port), NODE_ENV: 'development', APP_ENV: 'development' };
delete env.DATABASE_URL;
const server = spawn(process.execPath, ['server.mjs'], { cwd: appDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (chunk) => { serverLog += chunk; });
server.stderr.on('data', (chunk) => { serverLog += chunk; });
for (let i = 0; i < 100; i += 1) {
  try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* starting */ }
  await new Promise((resolve) => setTimeout(resolve, 100));
}

const NIGHT = 'de000000-0000-4000-8000-00000000b001/book.epub';
const ART = 'de000000-0000-4000-8000-00000000b002/file';
let browser;
try {
  // ---- the server side ------------------------------------------------------------------------------------------------
  const page0 = await fetch(base + '/demo/');
  const html = await page0.text();
  same(page0.status, 200, '/demo/ is public');
  check(html.includes('<head><script src="/demo/shim.js"></script><script src="/demo/guide.js" defer></script>'), 'the shim is the first script of the page, then the guide');
  same((await fetch(base + '/demo/guide.js')).status, 200, 'the guide script is served');
  same((await fetch(base + '/demo', { redirect: 'manual' })).status, 301, '/demo goes to /demo/');
  same((await fetch(base + '/demo/', { method: 'POST' })).status, 405, 'the demo route is read-only');
  same((await fetch(base + '/demo/server.mjs')).status, 404, 'only the listed demo files are served');
  same((await fetch(base + '/api/books/' + NIGHT)).status, 200, 'the demo EPUB is public');
  same((await fetch(base + '/covers/demo-earth-at-night.jpg')).headers.get('content-type'), 'image/jpeg', 'a .jpg cover is served as image/jpeg');
  const ranged = await fetch(base + '/api/books/' + ART, { headers: { range: 'bytes=0-9' } });
  same([ranged.status, (await ranged.arrayBuffer()).byteLength], [206, 10], 'the demo PDF answers a range');
  same((await fetch(base + '/api/books/33333333-3333-3333-3333-333333333333/file')).status, 401, 'any other book file still needs a session');
  same((await fetch(base + '/api/books')).status, 401, 'the catalogue API still needs a session');
  same((await fetch(base + '/api/me')).status, 401, 'and so does /api/me (the demo user exists only in the page)');

  // ---- the reader ---------------------------------------------------------------------------------------------------------
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  const reached = new Set();
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('request', (request) => { const u = new URL(request.url()); if (u.pathname.startsWith('/api/')) reached.add(u.pathname.slice('/api/books/'.length)); });
  await page.goto(base + '/demo/');
  await page.locator('.card').first().waitFor();
  await page.locator('dialog.demo-guide[open]').waitFor();
  same(await page.locator('dialog.demo-guide li button').count() >= 4, true, 'the guide opens on the first visit, with three steps and the tools');
  await page.keyboard.press('Escape');
  same(await page.locator('#loginScreen').isHidden(), true, 'no sign-in');
  same(await page.locator('#grid .card .card-title').allInnerTexts(), ['Earth at Night', 'Earth as Art'], 'two books');
  check(await page.locator('#grid .card .cover-img').count() === 2, 'both have their cover');
  check(await page.locator('#openUpload, #logoutBtn, #passwordBtn').evaluateAll((list) => list.every((el) => getComputedStyle(el).display === 'none')), 'upload, password and sign-out are not offered');
  check(await page.locator('.demo-pill').isVisible(), 'the demo notice is shown');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  same(overflow, false, 'no sideways scroll in the library');

  // the EPUB: the photo is on the first screen
  await page.locator('#grid .card', { hasText: 'Earth at Night' }).locator('.open-btn').click();
  const frame = page.locator('#epubView iframe').first().contentFrame();
  await frame.locator('img').first().waitFor();
  await page.waitForFunction(() => {
    const f = document.querySelector('#epubView iframe');
    const img = f?.contentDocument?.images?.[0];
    return img && img.complete && img.naturalWidth > 0;
  });
  const photo = await page.evaluate(() => {
    const f = document.querySelector('#epubView iframe');
    const box = f.contentDocument.images[0].getBoundingClientRect();
    const view = document.querySelector('#epubView').getBoundingClientRect();
    return { left: box.left, width: box.width, height: box.height, viewWidth: view.width, viewHeight: view.height };
  });
  check(photo.left >= 0 && photo.left + photo.width <= photo.viewWidth + 1 && photo.height <= photo.viewHeight, 'the opening photo is on the first screen: ' + JSON.stringify(photo));

  // a note: written on a real selection, kept in this browser
  const paragraph = frame.locator('p', { hasText: 'City lights clearly delineate' }).first();
  await paragraph.click({ clickCount: 3, delay: 80 });
  await page.locator('#hlBar').waitFor({ state: 'visible' });
  await page.locator('#hlAddNote').click();
  await page.locator('#hlNote').fill('Rome and Naples from orbit');
  await page.locator('#hlSaveNote').click();
  await page.waitForFunction(() => document.querySelector('#toggleNotes')?.textContent.includes('1'));
  check((await page.locator('#notesList').innerText()).includes('Rome and Naples from orbit'), 'the note is listed');
  await page.waitForTimeout(500);

  // survives a reload
  // the reader opens the book it was on again
  await page.reload();
  await frame.locator('img').first().waitFor();
  await page.waitForFunction(() => document.querySelector('#toggleNotes')?.textContent.includes('1'));
  check((await page.locator('#notesList').innerText()).includes('Rome and Naples from orbit'), 'the note is still there after a reload');

  // the PDF
  await page.locator('#closeReader').click();
  await page.locator('#grid .card', { hasText: 'Earth as Art' }).locator('.open-btn').click();
  await page.waitForFunction(() => document.querySelector('#textLayer')?.textContent.includes('Akpatok'));
  same((await page.locator('#pageTotal').innerText()).replace(/\s/g, ''), '/11', 'the PDF has its 11 pages');
  check((await page.locator('#textLayer').textContent()).includes('Akpatok'), 'its text is real, selectable text');
  await page.locator('#closeReader').click();

  // nothing but the two files reached the server
  same([...reached].sort(), [ART, NIGHT].sort(), 'the only /api/ requests that reached the server are the two public book files: ' + JSON.stringify([...reached]));

  // reset removes the demo's rows and nothing else
  await page.evaluate(async () => {
    localStorage.setItem('someone-elses-setting', 'keep');
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('akademik-offline'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('annotations', 'readwrite');
      tx.objectStore('annotations').put({ id: 'other-owner-note', asset_id: 'x', ownerId: 'another-user', note: 'not mine' });
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  page.once('dialog', (dialog) => dialog.accept());
  await Promise.all([page.waitForEvent('load'), page.locator('.demo-pill button:not(.demo-guide-open)').click()]);
  await page.locator('#grid .card').first().waitFor();
  await page.locator('dialog.demo-guide[open]').waitFor();
  check(true, 'after the reset the guide is offered again');
  await page.keyboard.press('Escape');
  const after = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('akademik-offline'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const rows = await new Promise((resolve) => { const request = db.transaction('annotations').objectStore('annotations').getAll(); request.onsuccess = () => resolve(request.result); });
    db.close();
    return { owners: rows.map((row) => row.ownerId), other: localStorage.getItem('someone-elses-setting'), demoKeys: Object.keys(localStorage).filter((key) => key.startsWith('libread-public-demo:v1:')), guide: JSON.parse(localStorage.getItem('libread-public-demo:v1:guide') || 'null') };
  });
  same(after.owners, ['another-user'], 'reset removed the demo user\'s notes and kept another user\'s');
  same(after.other, 'keep', 'and other settings');
  same(after.demoKeys, ['libread-public-demo:v1:guide'], 'and the demo\'s own state is gone: only the guide has written its fresh start (the reader writes its defaults again on the next start)');
  same(after.guide, { welcomed: true, open: false, note: false, look: false }, 'with nothing ticked');
  await page.goto(base + '/demo/');
  await page.locator('#grid .card', { hasText: 'Earth at Night' }).locator('.open-btn').click();
  await frame.locator('img').first().waitFor();
  same((await page.locator('#toggleNotes').innerText()).replace(/\D/g, ''), '0', 'the note is gone after the reset');

  // the guide: each step does the real thing in the real reader and is ticked when the visitor really does it
  const fresh = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const g = await fresh.newPage();
  await g.goto(base + '/demo/');
  await g.locator('dialog.demo-guide[open]').waitFor();
  same(await g.locator('.demo-pill .demo-guide-open').innerText(), 'Rehber 0/3', 'nothing is ticked yet');
  await g.locator('dialog.demo-guide button[data-step="open"]').click();
  await g.locator('#epubView iframe').first().waitFor();
  await g.waitForFunction(() => document.querySelector('.demo-pill .demo-guide-open')?.textContent === 'Rehber 1/3');
  check(true, 'opening a book ticks step 1');
  await g.locator('.demo-pill .demo-guide-open').click();
  check((await g.locator('dialog.demo-guide li.done').count()) === 1, 'the dialog shows the ticked step');
  await g.locator('dialog.demo-guide button[data-step="note"]').click();
  await g.locator('#hlBar').waitFor({ state: 'visible' });
  check((await g.locator('#hlQuote').innerText()).trim().length > 20, 'the guide selected a real sentence and the bar shows it');
  check((await g.locator('.demo-toast').innerText()).length > 10, 'and says what to do next');
  await g.locator('#hlAddNote').click();
  await g.locator('#hlNote').fill('my first note');
  await g.locator('#hlSaveNote').click();
  await g.waitForFunction(() => document.querySelector('.demo-pill .demo-guide-open')?.textContent === 'Rehber 2/3');
  check(true, 'keeping the sentence ticks step 2');
  await g.locator('.demo-pill .demo-guide-open').click();
  await g.locator('dialog.demo-guide button[data-step="look"]').click();
  await g.waitForFunction(() => document.querySelector('#themeBtn')?.closest('details')?.open === true);
  check(true, 'the guide opens the Appearance menu');
  // the theme and the surround are chosen from swatches; the (hidden) selects follow
  same(await g.locator('#themeSwatches [role="radio"][aria-checked="true"]').getAttribute('data-theme-choice'), 'light', 'the current theme is the marked swatch');
  await g.locator('#themeSwatches [data-theme-choice="dark"]').click();
  same(await g.locator('#reader').getAttribute('data-theme'), 'dark', 'a theme swatch changes the theme');
  same(await g.locator('#readerTheme').inputValue(), 'dark', 'and the select it stands for');
  same(await g.locator('#themeSwatches [data-theme-choice="dark"]').getAttribute('aria-checked'), 'true', 'the chosen swatch is marked');
  await g.keyboard.press('ArrowLeft');
  same(await g.locator('#reader').getAttribute('data-theme'), 'sepia', 'the arrow keys move between swatches');
  await g.locator('#workspaceSwatches [data-workspace-choice="slate"]').click();
  same(await g.locator('#reader').getAttribute('data-workspace'), 'slate', 'a surround swatch changes the surround');
  same(await g.locator('#workspaceSwatches [data-workspace-choice="slate"]').getAttribute('aria-checked'), 'true', 'and is marked');
  await g.locator('#themeSwatches [data-theme-choice="dark"]').click();
  await g.waitForFunction(() => document.querySelector('.demo-pill .demo-guide-open')?.textContent === 'Rehber 3/3');
  check(true, 'changing the look ticks step 3');
  await g.locator('.demo-pill .demo-guide-open').click();
  check((await g.locator('dialog.demo-guide li.done').count()) === 3, 'all three are ticked');
  await g.keyboard.press('Escape');
  await g.reload();
  await g.locator('#epubView iframe').first().waitFor();
  same(await g.locator('.demo-pill .demo-guide-open').innerText(), 'Rehber 3/3', 'the progress is kept');
  same(await g.locator('dialog.demo-guide[open]').count(), 0, 'and the guide does not open again by itself');
  await fresh.close();

  // a phone
  const phone = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const small = await phone.newPage();
  await small.goto(base + '/demo/');
  await small.locator('.card').first().waitFor();
  same(await small.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no sideways scroll on a 390px screen');
  await phone.close();

  same(errors, [], 'no page errors');
  console.log(JSON.stringify({ passed: true, checks }));
} catch (error) {
  console.error(error);
  console.error(serverLog.split('\n').slice(-8).join('\n'));
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
