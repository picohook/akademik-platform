import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { PDFDocument, StandardFonts } from 'pdf-lib';

// The reader's settings and tools, against server.mjs in demo mode in a real Chromium:
//   * EPUB: typeface, line spacing, text size and text width change the book's own document and are kept for the
//     next book; "Aa" opens them; a PDF shows none of them;
//   * the left rail opens contents / search / bookmarks / pages on their own tab; the bookmark list jumps back;
//   * Kitap bilgileri and Dışa aktar open as dialogs, return the focus on Escape, and the bookmark export holds the
//     bookmarks only;
//   * nothing overflows sideways at 390 and 320 px with the menus open.
//
//   PLAYWRIGHT_MODULE=<path to playwright> node test/reader-appearance.browser.mjs

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const appDir = fileURLToPath(new URL('../', import.meta.url));
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks += 1; };
const same = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks += 1; };
const freePort = () => new Promise((resolve, reject) => { const probe = net.createServer(); probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); }); probe.on('error', reject); });

async function makePdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 3; i += 1) pdf.addPage([595, 842]).drawText(`Page ${i} of the demo`, { x: 50, y: 700, size: 14, font });
  return Buffer.from(await pdf.save());
}
async function makeEpub() {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  zip.file('OEBPS/content.opf', '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">appearance</dc:identifier><dc:title>Appearance EPUB</dc:title><dc:language>en</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>');
  zip.file('OEBPS/nav.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="c1.xhtml">One</a></li></ol></nav></body></html>');
  zip.file('OEBPS/c1.xhtml', `<html xmlns="http://www.w3.org/1999/xhtml" lang="en"><head><title>One</title><style>p { font-family: "Times New Roman", serif; line-height: 1.1; }</style></head><body><h1>One</h1><p id="first">${'A paragraph of the book that is long enough to wrap onto several lines of the page. '.repeat(30)}</p></body></html>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, PORT: String(port), NODE_ENV: 'development', APP_ENV: 'development' };
delete env.DATABASE_URL;
const server = spawn(process.execPath, ['server.mjs'], { cwd: appDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (c) => { serverLog += c; });
server.stderr.on('data', (c) => { serverLog += c; });
let browser;
try {
  for (let i = 0; i < 100; i += 1) {
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 100));
    if (i === 99) throw new Error(`server did not start:\n${serverLog}`);
  }
  const pdfBytes = await makePdf();
  const epubBytes = await makeEpub();
  browser = await chromium.launch();

  // one sign-in for the whole run: later contexts start from its session (the sign-in is rate limited)
  let authState = null;
  const newContext = (width = 1280, height = 900) => browser.newContext({ viewport: { width, height }, acceptDownloads: true, ...(authState ? { storageState: authState } : {}) });
  async function open(kind, { width = 1280, height = 900, context } = {}) {
    const ctx = context || await newContext(width, height);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.route('**/api/books', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const response = await route.fetch();
      const books = await response.json();
      const epub = { ...books[0], id: '44444444-4444-4444-4444-444444444444', title: 'Appearance EPUB', subtitle: '', format: 'epub', asset_id: '66666666-6666-6666-6666-666666666666', storage_key: 'seed/ap.epub', page_count: null, work_title: 'Appearance EPUB' };
      return route.fulfill({ response, json: [books[0], epub] });
    });
    await page.route(/\/api\/books\/55555555-5555-5555-5555-555555555555\/file/, (r) => r.fulfill({ status: 200, contentType: 'application/pdf', body: pdfBytes }));
    await page.route(/\/api\/books\/66666666-6666-6666-6666-666666666666\/book\.epub/, (r) => r.fulfill({ status: 200, contentType: 'application/epub+zip', body: epubBytes }));
    await page.goto(base);
    if (!authState) {
      await page.locator('#adminLogin > summary').click();
      await page.fill('#loginEmail', 'librarian@example.edu.tr');
      await page.fill('#loginPassword', 'demo1234');
      await page.locator('#adminLogin button[type=submit]').click();
    }
    await page.locator('#loginScreen').waitFor({ state: 'hidden' });
    authState ||= await ctx.storageState();
    await page.locator('.card', { hasText: kind === 'epub' ? 'Appearance EPUB' : 'Demo PDF' }).first().locator('button', { hasText: 'Oku' }).first().click();
    if (kind === 'pdf') await page.locator('#textLayer span').first().waitFor(); else await page.locator('#epubView iframe').first().waitFor();
    await page.waitForTimeout(500);
    return { page, ctx, errors };
  }
  const bodyStyle = (page) => page.locator('#epubView iframe').first().contentFrame().locator('#first').evaluate((el) => { const s = getComputedStyle(el); return { family: s.fontFamily, line: s.lineHeight, size: parseFloat(s.fontSize) }; });
  const noSidewaysScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

  // =============================== EPUB: the settings change the book ===============================
  {
    const { page, errors, ctx } = await open('epub');
    const before = await bodyStyle(page);
    check(/Times/.test(before.family), 'the publisher\'s own style is left alone by default: ' + before.family);
    await page.locator('#themeBtn').click();
    check(await page.locator('#epubType').isVisible(), 'the text settings are in the Görünüm menu of an EPUB');
    await page.selectOption('#epubFont', 'sans');
    await page.selectOption('#epubLine', '2');
    await page.waitForTimeout(500);
    const sans = await bodyStyle(page);
    check(/Arial|system-ui|Segoe/.test(sans.family) && !/Times/.test(sans.family), 'the typeface changed inside the book: ' + sans.family);
    check(Math.abs(parseFloat(sans.line) - sans.size * 2) < 1.5, `the line spacing is double: ${sans.line} for ${sans.size}px`);
    const label = await page.evaluate(() => { const r = document.querySelector('#epubSize'); r.value = '140'; r.dispatchEvent(new Event('input', { bubbles: true })); return document.querySelector('#zoomLabel').textContent; });
    same(label, '140%', 'the size slider and the page controls agree');
    await page.waitForTimeout(400);
    check((await bodyStyle(page)).size > sans.size * 1.3, 'the text got bigger');
    const wide = await page.locator('#epubView').evaluate((el) => el.getBoundingClientRect().width);
    await page.selectOption('#epubWidth', 'narrow');
    await page.waitForTimeout(500);
    const narrow = await page.locator('#epubView').evaluate((el) => el.getBoundingClientRect().width);
    check(narrow <= 580 && narrow < wide, `the text column is narrower: ${wide} -> ${narrow}`);
    same(errors, [], 'no page errors');
    await ctx.close();
  }

  // =============================== EPUB: kept for the next book, "Aa", reset ===============================
  {
    const ctx = await newContext();
    const { page } = await open('epub', { context: ctx });
    await page.locator('#themeBtn').click();
    await page.selectOption('#epubFont', 'serif');
    await page.selectOption('#epubLine', '1.75');
    await page.locator('#closeReader').click();
    await page.locator('.card', { hasText: 'Appearance EPUB' }).first().locator('button', { hasText: 'Oku' }).first().click();
    await page.locator('#epubView iframe').first().waitFor();
    await page.waitForTimeout(700);
    const again = await bodyStyle(page);
    check(/Georgia/.test(again.family) && Math.abs(parseFloat(again.line) - again.size * 1.75) < 1.5, 'the next time a book opens it has the reader\'s settings: ' + JSON.stringify(again));
    same(await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('readerEpubType:'))) || 'null')?.font), 'serif', 'stored per account');
    await page.locator('#themeBtn').click(); // fold the menu that was used above
    await page.locator('#footerAppearance').click();
    check(await page.locator('#epubFont').isVisible(), '"Aa" opens the text settings');
    same(await page.evaluate(() => document.activeElement.id), 'epubFont', 'and puts the focus on the first one');
    await page.locator('#epubTypeReset').click();
    await page.waitForTimeout(500);
    const reset = await bodyStyle(page);
    check(/Times/.test(reset.family), 'reset gives the book its own style back: ' + reset.family);
    same(await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('readerEpubType:'))), false, 'and forgets the choice');
    await ctx.close();
  }

  // =============================== PDF: rail, bookmarks, dialogs ===============================
  {
    const { page, errors, ctx } = await open('pdf');
    await page.locator('#themeBtn').click();
    same(await page.locator('#epubType').isHidden(), true, 'a PDF has no text settings in the menu');
    same(await page.locator('#footerAppearance').isHidden(), true, 'and no "Aa"');
    await page.locator('#themeBtn').click();

    await page.locator('#bookmarkBtn').click();
    await page.locator('#nextPage').click();
    await page.locator('#nextPage').click();
    await page.waitForFunction(() => document.querySelector('#pageInput').value === '3');
    await page.locator('#bookmarkBtn').click();
    await page.locator('#railBookmarks').click();
    same(await page.locator('#tocPanel').isVisible(), true, 'the rail opens the navigation panel');
    same(await page.locator('#tabBookmarks').getAttribute('aria-selected'), 'true', 'on the bookmarks tab');
    same(await page.locator('#railBookmarks').getAttribute('aria-expanded'), 'true', 'and the rail button says so');
    await page.waitForFunction(() => document.querySelectorAll('#bookmarkList .bookmark-row').length === 2);
    await page.locator('#bookmarkList .bookmark-open').first().click();
    await page.waitForFunction(() => document.querySelector('#pageInput').value === '1');
    check(true, 'a bookmark takes the reader back to its page');
    await page.locator('#railBookmarks').click();
    same(await page.locator('#tocPanel').isHidden(), true, 'the same rail button folds the panel again');
    await page.locator('#railSearch').click();
    same(await page.locator('#tabSearch').getAttribute('aria-selected'), 'true', 'the search button opens the search tab');
    await page.locator('#railPages').click();
    same(await page.locator('#tabPages').getAttribute('aria-selected'), 'true', 'and the pages button the page index');
    await page.locator('#closeToc').click();

    await page.locator('#moreMenuBtn').click();
    await page.locator('#bookInfoBtn').click();
    await page.locator('#bookInfoModal').waitFor({ state: 'visible' });
    check((await page.locator('#bookInfoTitle').innerText()).includes('Demo PDF'), 'the book information names the book');
    check((await page.locator('#bookInfoList').innerText()).includes('PDF'), 'and its format');
    await page.keyboard.press('Escape');
    await page.locator('#bookInfoModal').waitFor({ state: 'hidden' });
    same(await page.evaluate(() => document.activeElement.id), 'moreMenuBtn', 'Escape returns the focus to the menu button');

    await page.locator('#moreMenuBtn').click();
    await page.locator('#exportBtn').click();
    await page.locator('#exportModal').waitFor({ state: 'visible' });
    same(await page.locator('#exportBookmarkCount').innerText(), '2', 'the export dialog counts the bookmarks');
    same(await page.locator('#exportNotesMd').isDisabled(), true, 'and does not offer an empty notes file');
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#exportBookmarksMd').click()]);
    check(/yer-imleri\.md$/.test(download.suggestedFilename()), 'the bookmarks file is named for what it holds: ' + download.suggestedFilename());
    const text = await readFile(await download.path(), 'utf8');
    check(text.includes('Demo PDF') && (text.match(/^- /gm) || []).length === 2, 'and lists both bookmarks: ' + text.replace(/\n/g, ' | '));
    await page.keyboard.press('Escape');
    await page.locator('#exportModal').waitFor({ state: 'hidden' });
    same(errors, [], 'no page errors on the PDF path');
    await ctx.close();
  }

  // =============================== phones ===============================
  for (const width of [390, 320]) {
    const { page, ctx } = await open('epub', { width, height: 700 });
    await page.locator('#themeBtn').click();
    const panel = await page.locator('.reader-menu[open] .reader-menu-panel').boundingBox();
    check(panel.x >= 0 && panel.x + panel.width <= width + 1 && panel.y + panel.height <= 700 + 1, `the Görünüm menu fits a ${width}px screen: ${JSON.stringify(panel)}`);
    same(await noSidewaysScroll(page), true, `no sideways scroll at ${width}px with the menu open`);
    await page.locator('#themeBtn').click();
    await page.locator('#moreMenuBtn').click();
    await page.locator('#exportBtn').click();
    const modal = await page.locator('#exportModal .modal-card').boundingBox();
    check(modal.x >= 0 && modal.x + modal.width <= width + 1, `the export dialog fits ${width}px`);
    same(await noSidewaysScroll(page), true, `and does not scroll sideways at ${width}px`);
    await ctx.close();
  }
  console.log(JSON.stringify({ passed: true, checks }));
} catch (error) {
  console.error(error);
  console.error(serverLog.split('\n').slice(-8).join('\n'));
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
