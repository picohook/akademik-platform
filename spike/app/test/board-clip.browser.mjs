import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { PDFDocument, StandardFonts } from 'pdf-lib';

// "Panoya al": a passage selected in the reader goes to the research board's inbox.
//
// A real Chromium, a real mouse selection, server.mjs in demo mode, and a stand-in inbox on another port
// (so the cross-origin call, its preflight and the page's CSP are all exercised):
//   * the button is there only when the server names an inbox, and the page may connect to exactly that origin;
//   * a PDF passage is sent as a quote with the book, the author, the page and a link that reopens that page;
//   * an EPUB passage carries its chapter and a CFI link instead of a page;
//   * the inbox's answers (signed out, full, broken, unreachable) each say so, and the button is usable again;
//   * a book that may not be copied cannot be sent;
//   * only the board's own pages may read the book list across origins, and nothing else is opened up.
//
//   PLAYWRIGHT_MODULE=<path to playwright> node test/board-clip.browser.mjs

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

const SHORT = 'A short passage that is easy to select.';
const LONG = Array.from({ length: 14 }, (_, i) => `Long passage sentence number ${i + 1} keeps going so the quote has to scroll.`).join(' ');
async function makePdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([595, 842]);
  page.drawText(SHORT, { x: 50, y: 700, size: 14, font });
  page.drawText('A second passage on another line.', { x: 50, y: 660, size: 14, font });
  return Buffer.from(await pdf.save());
}
async function makeEpub() {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  zip.file('OEBPS/content.opf', '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">sel-note</dc:identifier><dc:title>Selection note EPUB</dc:title><dc:language>en</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>');
  zip.file('OEBPS/nav.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="c1.xhtml">One</a></li></ol></nav></body></html>');
  zip.file('OEBPS/c1.xhtml', `<html xmlns="http://www.w3.org/1999/xhtml" lang="en"><head><title>One</title></head><body><p id="short">${SHORT}</p><p id="long">${LONG}</p></body></html>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}


// The stand-in inbox: records what it is sent, answers with whatever status the test sets.
const received = [];
let answer = 201;
const inboxServer = http.createServer((req, res) => {
  const origin = req.headers.origin || '';
  res.setHeader('access-control-allow-origin', origin);
  res.setHeader('access-control-allow-credentials', 'true');
  res.setHeader('access-control-allow-headers', 'content-type');
  res.setHeader('access-control-allow-methods', 'POST');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; });
  req.on('end', () => {
    received.push({ method: req.method, url: req.url, origin, body: raw ? JSON.parse(raw) : null });
    res.writeHead(answer, { 'content-type': 'application/json' });
    res.end(JSON.stringify(answer === 201 ? { id: 'x' } : { error: 'no' }));
  });
});
await new Promise((resolve) => inboxServer.listen(0, '127.0.0.1', resolve));
const inboxUrl = `http://127.0.0.1:${inboxServer.address().port}/api/inbox`;

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, PORT: String(port), NODE_ENV: 'development', APP_ENV: 'development', LIBEDGE_BOARD_INBOX_URL: process.env.TEST_INBOX_OFF ? '' : inboxUrl };
delete env.DATABASE_URL;
const server = spawn(process.execPath, ['server.mjs'], { cwd: appDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (chunk) => { serverLog += chunk; });
server.stderr.on('data', (chunk) => { serverLog += chunk; });

let browser;
try {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (attempt === 99) throw new Error(`server did not start:\n${serverLog}`);
  }
  const pdfBytes = await makePdf();
  const epubBytes = await makeEpub();
  browser = await chromium.launch();

  let saved = null;
  async function open(kind, { width = 1280, height = 900, copy = true } = {}) {
    const context = await browser.newContext({ viewport: { width, height }, ...(saved ? { storageState: saved } : {}) });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.route('**/api/books', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const response = await route.fetch();
      const books = await response.json();
      const epub = { ...books[0], id: '44444444-4444-4444-4444-444444444444', title: 'Selection note EPUB', subtitle: '', format: 'epub', asset_id: '66666666-6666-6666-6666-666666666666', storage_key: 'seed/sn.epub', page_count: null, work_title: 'Selection note EPUB' };
      return route.fulfill({ response, json: [{ ...books[0], allow_copy: copy, metadata: { authors: [{ family: 'Goldberg', given: 'Yoav' }], cover: { version: 7, ratio: 0.7 } }, publication_year: 2017, subjects: ['NLP'] }, { ...epub, allow_copy: copy, metadata: { authors: [{ family: 'Vaswani', given: 'Ashish' }] } }] });
    });
    await page.route(/\/api\/books\/55555555-5555-5555-5555-555555555555\/file/, (route) => route.fulfill({ status: 200, contentType: 'application/pdf', body: pdfBytes }));
    await page.route(/\/api\/books\/66666666-6666-6666-6666-666666666666\/book\.epub/, (route) => route.fulfill({ status: 200, contentType: 'application/epub+zip', body: epubBytes }));
    await page.goto(base);
    if (!saved) {
      await page.locator('#adminLogin > summary').click();
      await page.fill('#loginEmail', 'librarian@example.edu.tr');
      await page.fill('#loginPassword', 'demo1234');
      await page.locator('#adminLogin button[type=submit]').click();
      await page.locator('#loginScreen').waitFor({ state: 'hidden' });
      saved = await context.storageState();
    } else await page.locator('#loginScreen').waitFor({ state: 'hidden' });
    const card = page.locator('.card', { hasText: kind === 'epub' ? 'Selection note EPUB' : 'Demo PDF' }).first();
    await card.locator('button', { hasText: 'Oku' }).first().click();
    if (kind === 'pdf') await page.locator('#textLayer span').first().waitFor();
    else await page.locator('#epubView iframe').first().waitFor();
    return { page, errors, context };
  }

  const norm = (text) => text.replace(/\s+/g, ' ').trim();
  const bookIds = (page) => page.evaluate(() => ({ id: window.__bookId }));
  const toastText = async (page) => { await page.locator('#toast').waitFor({ state: 'visible' }); return norm(await page.locator('#toast').innerText()); };
  const settle = async (page) => { await page.waitForFunction(() => !document.querySelector('#hlBoard').disabled); };

  // ----- the server's side: config, CSP, CORS -----
  {
    const config = await (await fetch(base + '/api/config')).json();
    same(config.boardInbox, inboxUrl, 'the config names the inbox');
    const page = await fetch(base + '/');
    const csp = page.headers.get('content-security-policy');
    check(csp.includes("connect-src 'self' " + new URL(inboxUrl).origin + ';'), 'the page may connect to the inbox origin and nowhere new: ' + csp);
    for (const [origin, allowed] of [['https://libedge.com', true], ['https://www.libedge.com', true], ['https://evil.example', false], ['https://libedge.com.evil.example', false]]) {
      const response = await fetch(base + '/api/books', { headers: { origin } });
      same(response.headers.get('access-control-allow-origin'), allowed ? origin : null, 'book list CORS for ' + origin);
      same(response.headers.get('access-control-allow-credentials'), allowed ? 'true' : null, 'credentials flag for ' + origin);
      check((response.headers.get('vary') || '').toLowerCase().includes('origin'), 'the answer varies by Origin for ' + origin);
    }
    for (const path of ['/api/me', '/api/progress', '/api/grants']) {
      const response = await fetch(base + path, { headers: { origin: 'https://libedge.com' } });
      same(response.headers.get('access-control-allow-origin'), null, 'no cross-origin reading of ' + path);
    }
  }

  // =============================== PDF ===============================
  {
    const { page, errors, context } = await open('pdf');
    await page.locator('#textLayer span', { hasText: SHORT }).first().click({ clickCount: 3, delay: 80 });
    await page.locator('#hlBar').waitFor({ state: 'visible' });
    const button = page.locator('#hlBoard');
    same(await button.isVisible(), true, 'the button is on the selection bar');
    same(await button.isEnabled(), true, 'and usable');
    received.length = 0; answer = 201;
    await button.click();
    check((await toastText(page)).includes('Alıntı panoya alındı'), 'a done message');
    same(received.length, 1, 'one request reached the inbox (preflight excluded)');
    const { body: sent, origin, method } = received[0];
    same(method, 'POST', 'it is a POST');
    same(origin, base, 'it comes from the reader page');
    same(sent.kind, 'quote', 'it is a quote');
    const q = sent.payload;
    same(q.source, 'elibrary', 'source');
    same(q.title, 'Demo PDF — Dummy PDF file', 'the book title: ' + q.title);
    same(q.authors, ['Yoav Goldberg'], 'authors are written given-name first');
    same(q.year, 2017, 'year');
    same(q.subjects, ['NLP'], 'subjects');
    check(q.text.includes('short passage'), 'the selected text: ' + q.text);
    same(q.page, 1, 'the page');
    const link = new URL(q.reader_url);
    same(link.origin, base, 'the link reopens this reader');
    same(link.searchParams.get('book'), q.work_id, 'the link names the book');
    same(link.searchParams.get('page'), '1', 'and the page');
    check(/^[0-9a-f-]{36}$/.test(q.asset_id) && link.searchParams.get('asset') === q.asset_id, 'and the file');
    same(q.cover_url, base + '/api/books/' + q.work_id + '/cover?v=7', 'the cover path');
    same(Object.keys(q).filter((key) => !['source', 'work_id', 'asset_id', 'title', 'authors', 'year', 'publisher', 'language', 'subjects', 'cover_url', 'reader_url', 'text', 'page', 'locator'].includes(key)), [], 'nothing outside the board\'s fields');
    await settle(page);

    // each answer of the inbox says what happened, and the button comes back
    for (const [status, words] of [[401, 'oturum açın'], [409, 'Gelen kutusu dolu'], [500, 'Panoya alınamadı']]) {
      answer = status;
      await page.locator('#toast').evaluate((node) => { node.hidden = true; node.textContent = ''; });
      await button.click();
      await page.waitForFunction((text) => document.querySelector('#toast')?.textContent.includes(text), words);
      await settle(page);
      same(await button.isEnabled(), true, 'usable again after ' + status);
    }
    answer = 201;
    same(errors, [], 'no page errors');
    await context.close();
  }

  // an inbox that cannot be reached
  {
    const { page, context } = await open('pdf');
    await page.locator('#textLayer span', { hasText: SHORT }).first().click({ clickCount: 3, delay: 80 });
    await page.locator('#hlBar').waitFor({ state: 'visible' });
    await page.route(inboxUrl, (route) => route.abort());
    await page.locator('#hlBoard').click();
    await page.waitForFunction(() => document.querySelector('#toast')?.textContent.includes('Panoya alınamadı'));
    await settle(page);
    await context.close();
  }

  // =============================== EPUB ===============================
  {
    const { page, errors, context } = await open('epub');
    const frame = page.locator('#epubView iframe').first().contentFrame();
    await frame.locator('#short').waitFor();
    await frame.locator('#short').click({ clickCount: 3, delay: 80 });
    await page.locator('#hlBar').waitFor({ state: 'visible' });
    received.length = 0; answer = 201;
    await page.locator('#hlBoard').click();
    await page.waitForFunction(() => document.querySelector('#toast')?.textContent.includes('Alıntı panoya alındı'));
    const q = received[0].body.payload;
    same(q.title, 'Selection note EPUB', 'the EPUB title');
    same(q.authors, ['Ashish Vaswani'], 'the EPUB author');
    check(q.text.includes('short passage'), 'the EPUB passage');
    check(!('page' in q), 'no page for an EPUB');
    const link = new URL(q.reader_url);
    check((link.searchParams.get('cfi') || '').startsWith('epubcfi('), 'the link carries a CFI: ' + link.search);
    check(link.searchParams.get('page') === null, 'and no page');
    check(q.locator.length > 0 && q.locator.length <= 300, 'the chapter is named: ' + q.locator);
    same(errors, [], 'no page errors');
    await context.close();
  }

  // =============================== copy not allowed ===============================
  {
    const { page, context } = await open('pdf', { copy: false });
    await page.locator('#textLayer span', { hasText: SHORT }).first().click({ clickCount: 3, delay: 80 });
    await page.locator('#hlBar').waitFor({ state: 'visible' });
    received.length = 0;
    same(await page.locator('#hlBoard').isDisabled(), true, 'a book that may not be copied cannot be sent');
    await page.locator('#hlBoard').click({ force: true, timeout: 2000 }).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 400));
    same(received.length, 0, 'nothing was sent');
    await context.close();
  }

  console.log(JSON.stringify({ passed: true, checks }));
} catch (error) {
  console.error(error);
  console.error(serverLog.split('\n').slice(-8).join('\n'));
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
  inboxServer.close();
}
