import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { PDFDocument, StandardFonts } from 'pdf-lib';

// The bar that opens when text is selected: the selected passage is shown in it, above the note field, and the
// note is written under it and saved from there.
//
// Real mouse selections (a triple click) in a real Chromium, on a PDF and on an EPUB, against server.mjs in demo mode:
//   * the bar shows the selected text, between the action row and the note field, and the text is what was selected;
//   * a long passage does not make the bar grow without limit (the quote scrolls);
//   * Enter in the note field saves, Shift+Enter starts a new line, Escape cancels and saves nothing;
//   * the saved note appears in the notes panel with its passage;
//   * the bar fits a 390px screen.
//
//   PLAYWRIGHT_MODULE=<path to playwright> [SHOTS_DIR=<dir>] node test/selection-note.browser.mjs

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const appDir = fileURLToPath(new URL('../', import.meta.url));
const shotsDir = process.env.SHOTS_DIR || '';
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

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, PORT: String(port), NODE_ENV: 'development', APP_ENV: 'development' };
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
  const shoot = async (page, name) => {
    if (!shotsDir) return;
    await mkdir(shotsDir, { recursive: true });
    await page.screenshot({ path: path.join(shotsDir, `${name}.png`) });
  };

  async function open(kind, { width = 1280, height = 900 } = {}) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.route('**/api/books', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const response = await route.fetch();
      const books = await response.json();
      const epub = { ...books[0], id: '44444444-4444-4444-4444-444444444444', title: 'Selection note EPUB', subtitle: '', format: 'epub', asset_id: '66666666-6666-6666-6666-666666666666', storage_key: 'seed/sn.epub', page_count: null, work_title: 'Selection note EPUB' };
      return route.fulfill({ response, json: [books[0], epub] });
    });
    await page.route(/\/api\/books\/55555555-5555-5555-5555-555555555555\/file/, (route) => route.fulfill({ status: 200, contentType: 'application/pdf', body: pdfBytes }));
    await page.route(/\/api\/books\/66666666-6666-6666-6666-666666666666\/book\.epub/, (route) => route.fulfill({ status: 200, contentType: 'application/epub+zip', body: epubBytes }));
    await page.goto(base);
    await page.locator('#adminLogin > summary').click();
    await page.fill('#loginEmail', 'librarian@example.edu.tr');
    await page.fill('#loginPassword', 'demo1234');
    await page.locator('#adminLogin button[type=submit]').click();
    await page.locator('#loginScreen').waitFor({ state: 'hidden' });
    const card = page.locator('.card', { hasText: kind === 'epub' ? 'Selection note EPUB' : 'Demo PDF' }).first();
    await card.locator('button', { hasText: 'Oku' }).first().click();
    if (kind === 'pdf') await page.locator('#textLayer span').first().waitFor();
    else await page.locator('#epubView iframe').first().waitFor();
    return { page, errors, context };
  }

  // the bar's geometry, whatever the book type
  const geometry = (page) => page.evaluate(() => {
    const box = (selector) => { const r = document.querySelector(selector).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height }; };
    return { bar: box('#hlBar'), row: box('#hlBar .hl-row'), quote: box('#hlQuote'), note: box('#hlNote'), save: box('#hlSave'), width: window.innerWidth, height: window.innerHeight };
  });
  const quoteOf = (page) => page.locator('#hlQuote').innerText();
  // The bar must never cover the words it was opened for: its box and the selected words' box must not overlap.
  // `frame` is the EPUB frame the selection lives in (its box is offset by the frame's place on the page).
  const coversSelection = (page, frame) => page.evaluate(({ inFrame }) => {
    const host = inFrame ? document.querySelector('#epubView iframe') : null;
    const win = host ? host.contentWindow : window;
    const range = win.getSelection().getRangeAt(0).getBoundingClientRect();
    const off = host ? host.getBoundingClientRect() : { left: 0, top: 0 };
    const sel = { l: range.left + off.left, r: range.right + off.left, t: range.top + off.top, b: range.bottom + off.top };
    const bar = document.querySelector('#hlBar').getBoundingClientRect();
    const overlap = bar.left < sel.r && bar.right > sel.l && bar.top < sel.b && bar.bottom > sel.t;
    return { overlap, sel, bar: { l: bar.left, r: bar.right, t: bar.top, b: bar.bottom } };
  }, { inFrame: Boolean(frame) });
  // the notes panel is open by default on a PDF and closed on an EPUB: open it only if it is shut
  const notesText = async (page, needle) => {
    if (await page.locator('#notesPanel').isHidden()) await page.locator('#toggleNotes').click();
    await page.locator('#notesList').waitFor({ state: 'visible' });
    if (needle) await page.waitForFunction((text) => document.querySelector('#notesList').innerText.includes(text), needle, { timeout: 8000 });
    return page.locator('#notesList').innerText();
  };
  const norm = (text) => text.replace(/\s+/g, ' ').trim();

  // =============================== PDF ===============================
  {
    const { page, errors, context } = await open('pdf');
    const line = page.locator('#textLayer span', { hasText: SHORT }).first();
    await line.click({ clickCount: 3, delay: 80 });
    await page.locator('#hlBar').waitFor({ state: 'visible' });
    const selected = norm(await page.evaluate(() => window.getSelection().toString()));
    check(selected.includes('short passage'), 'a real triple click selected the line: ' + selected);
    same(norm(await quoteOf(page)), selected, 'the bar shows exactly what was selected');
    const cover = await coversSelection(page, false);
    same(cover.overlap, false, 'the bar does not cover the selected words: ' + JSON.stringify(cover));
    same(await page.locator('#hlComposer').isHidden(), true, 'the note editor starts shut');
    const compact = await page.locator('#hlBar').boundingBox();
    check(compact.width <= 440 && compact.height < 135, `the bar is compact when it opens: ${compact.width} x ${compact.height}`);
    // the bar can be moved: drag the grip, and it stays there while the note editor opens
    const barBefore = await page.locator('#hlBar').boundingBox();
    const grip = await page.locator('#hlGrip').boundingBox();
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.width / 2 + 90, grip.y + grip.height / 2 + 140, { steps: 6 });
    await page.mouse.up();
    const moved = await page.locator('#hlBar').boundingBox();
    check(Math.abs(moved.x - barBefore.x - 90) <= 2 && Math.abs(moved.y - barBefore.y - 140) <= 2, `dragging the grip moves the bar: ${barBefore.x},${barBefore.y} -> ${moved.x},${moved.y}`);
    await page.locator('#hlAddNote').click();
    const grown = await page.locator('#hlBar').boundingBox();
    check(Math.abs(grown.x - moved.x) <= 2 && Math.abs(grown.y - moved.y) <= 2, 'opening the note editor leaves the moved bar where it was');
    await page.locator('#hlDiscardNote').click();
    const clamp = await page.evaluate(() => { const r = document.getElementById('hlBar').getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; });
    check(clamp, 'a moved bar stays on screen');
    same(await page.locator('#hlColors').isHidden(), true, 'the colour palette starts shut');
    check((await page.locator('#hlPageLabel').innerText()).trim().length > 0, 'the real page is named with the passage');
    await page.locator('#hlColorToggle').click();
    same(await page.locator('#hlColors').isVisible(), true, 'the colour toggle opens the palette');
    await page.locator('#hlColors .hl-color.green').click();
    same(await page.locator('#hlBar').getAttribute('data-color'), 'green', 'a colour pick is shown on the highlight button');
    same(await page.locator('#hlColors').isHidden(), true, 'and shuts the palette');
    await page.locator('#hlAddNote').click();
    same(await page.evaluate(() => document.activeElement.id), 'hlNote', 'the note button opens the editor and focuses the field');
    same(norm(await quoteOf(page)), selected, 'the passage is still shown with the editor open');
    const g = await geometry(page);
    check(g.row.bottom <= g.quote.top + 1 && g.quote.bottom <= g.note.top + 1, 'the passage sits between the action row and the note field');
    check(g.bar.left >= 0 && g.bar.right <= g.width && g.bar.top >= 0 && g.bar.bottom <= g.height, 'the whole bar is on screen');
    same(await page.locator('#hlNote').evaluate((el) => el.tagName), 'TEXTAREA', 'the note field is a text area');
    // the passage must be readable: the first version used light text on a light bar and passed every other check
    const contrast = await page.evaluate(() => {
      // colours come back in any CSS syntax (color-mix gives color(srgb ...)): let a canvas turn them into pixels
      const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
      const pixel = (css) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data]; };
      const lum = ([r, g, b]) => { const f = [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
      const solidBackground = (el) => { for (let e = el; e; e = e.parentElement) { const px = pixel(getComputedStyle(e).backgroundColor); if (px[3] > 240) return px; } return [255, 255, 255, 255]; };
      return ['hlQuote', 'hlNote'].map((id) => {
        const el = document.getElementById(id);
        const a = lum(pixel(getComputedStyle(el).color));
        const b = lum(solidBackground(el));
        return { id, ratio: Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100, color: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor };
      });
    });
    check(contrast.every((c) => c.ratio >= 4.5), 'the passage and the note text are readable: ' + JSON.stringify(contrast));
    await shoot(page, 'selection-bar-pdf');

    // write the note under the passage and save it from there
    await page.locator('#hlNote').fill('Why this matters for the thesis');
    // Vazgeç folds the editor and keeps the draft for this passage
    await page.locator('#hlDiscardNote').click();
    same(await page.locator('#hlComposer').isHidden(), true, 'Vazgeç folds the editor away');
    same(await page.locator('#hlBar').isVisible(), true, 'and keeps the bar');
    await page.locator('#hlAddNote').click();
    same(await page.locator('#hlNote').inputValue(), 'Why this matters for the thesis', 'the draft is still there when the editor opens again');
    // a write that fails keeps the bar, the passage and the draft; a second try works and writes once
    await page.evaluate(() => { const open = IDBFactory.prototype.open; window.__restoreIdb = () => { IDBFactory.prototype.open = open; }; IDBFactory.prototype.open = function () { throw new Error('idb down'); }; });
    await page.locator('#hlSaveNote').click();
    await page.waitForFunction(() => !document.getElementById('hlSaveNote').disabled);
    same(await page.locator('#hlBar').isVisible(), true, 'a failed write leaves the bar open');
    same(await page.locator('#hlNote').inputValue(), 'Why this matters for the thesis', 'with the draft');
    same(norm(await quoteOf(page)), selected, 'and the passage');
    await page.evaluate(() => window.__restoreIdb());
    await page.locator('#hlSaveNote').dblclick();
    await page.locator('#hlBar').waitFor({ state: 'hidden' });
    same(await page.evaluate(() => document.activeElement.id), 'pageArea', 'after the save the reading area has the focus');
    const notes = await notesText(page, 'Why this matters for the thesis');
    check(notes.includes('Why this matters for the thesis'), 'the note was saved and is listed: ' + notes.slice(0, 160));
    check(notes.toLowerCase().includes('short passage'), 'with its passage');
    same(notes.split('Why this matters for the thesis').length - 1, 1, 'a double click on save wrote one note');

    // Enter saves; Shift+Enter is a new line
    await page.locator('#textLayer span', { hasText: 'second passage' }).first().click({ clickCount: 3, delay: 80 });
    await page.locator('#hlBar').waitFor({ state: 'visible' });
    await page.locator('#hlAddNote').click();
    await page.keyboard.type('first line');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('second line');
    same(await page.locator('#hlNote').inputValue(), 'first line\nsecond line', 'Shift+Enter starts a new line in the note');
    same(await page.locator('#hlBar').isVisible(), true, 'and does not save');
    await page.keyboard.press('Enter');
    await page.locator('#hlBar').waitFor({ state: 'hidden' });
    const after = await notesText(page, 'second line');
    check(after.includes('first line') && after.includes('second line'), 'Enter saved the two-line note: ' + after.slice(0, 200));

    // Escape cancels, nothing is saved
    const before = (await page.locator('#notesList .note-item, #notesList > *').count());
    await line.click({ clickCount: 3, delay: 80 });
    await page.locator('#hlBar').waitFor({ state: 'visible' });
    await page.locator('#hlAddNote').click();
    await page.locator('#hlNote').fill('should not be kept');
    await page.keyboard.press('Escape');
    await page.locator('#hlBar').waitFor({ state: 'hidden' });
    same(await page.evaluate(() => document.activeElement.id), 'pageArea', 'Escape returns the focus to the reading area');
    // the same passage again: the session draft is back, the editor opens with it
    await line.click({ clickCount: 3, delay: 80 });
    await page.locator('#hlBar').waitFor({ state: 'visible' });
    same(await page.locator('#hlNote').inputValue(), 'should not be kept', 'the draft of the same passage survives Escape for this session');
    await page.keyboard.press('Escape');
    await page.locator('#hlBar').waitFor({ state: 'hidden' });
    check(!(await notesText(page)).includes('should not be kept'), 'Escape cancelled: the note was not saved');
    same(await page.locator('#notesList .note-item, #notesList > *').count(), before, 'and no new entry appeared');
    same(errors, [], 'no page errors on the PDF path');
    await context.close();
  }

  // =============================== EPUB ===============================
  {
    const { page, errors, context } = await open('epub');
    const frame = page.locator('#epubView iframe').first().contentFrame();
    await frame.locator('#short').waitFor();
    await frame.locator('#short').click({ clickCount: 3, delay: 80 });
    await page.locator('#hlBar').waitFor({ state: 'visible' });
    const inFrame = norm(await frame.locator('body').evaluate(() => window.getSelection().toString()));
    same(norm(await quoteOf(page)), inFrame, 'the bar shows exactly what was selected in the book: ' + inFrame);
    check(inFrame.includes('short passage'), 'it is the passage that was clicked');
    const epubCover = await coversSelection(page, true);
    same(epubCover.overlap, false, 'the bar does not cover the selected words in the book either: ' + JSON.stringify(epubCover));
    check((await page.locator('#hlPageLabel').innerText()).trim().length > 0, 'the chapter is named with the passage');
    await page.locator('#hlAddNote').click();
    const g = await geometry(page);
    check(g.row.bottom <= g.quote.top + 1 && g.quote.bottom <= g.note.top + 1, 'the passage sits between the action row and the note field');
    check(g.bar.left >= 0 && g.bar.right <= g.width && g.bar.top >= 0 && g.bar.bottom <= g.height, 'the whole bar is on screen');
    await page.locator('#hlNote').fill('A note on an EPUB passage');
    await page.keyboard.press('Enter');
    await page.locator('#hlBar').waitFor({ state: 'hidden' });
    const notes = await notesText(page, 'A note on an EPUB passage');
    check(notes.includes('A note on an EPUB passage') && notes.toLowerCase().includes('short passage'), 'the EPUB note is saved with its passage: ' + notes.slice(0, 200));

    // a long passage: the quote scrolls instead of growing the bar
    await frame.locator('#long').click({ clickCount: 3, delay: 80 });
    await page.locator('#hlBar').waitFor({ state: 'visible' });
    const long = await page.locator('#hlQuote').evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight, text: el.innerText.length }));
    check(long.text > 600, 'the whole long passage is in the quote (' + long.text + ' characters)');
    check(long.scroll > long.client && long.client < 60, `the quote starts as two lines (${long.client}px visible of ${long.scroll}px)`);
    await page.locator('#hlExpandQuote').click();
    const wide = await page.locator('#hlQuote').evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
    check(wide.client > long.client && wide.scroll > wide.client && wide.client < 130, `the whole passage can be shown, and still scrolls (${wide.client}px of ${wide.scroll}px)`);
    const lg = await geometry(page);
    check(lg.bar.bottom <= lg.height && lg.bar.top >= 0, 'a long passage still leaves the whole bar on screen');
    await shoot(page, 'selection-bar-epub-long');
    await page.keyboard.press('Escape');
    same(errors, [], 'no page errors on the EPUB path');
    await context.close();
  }

  // =============================== phone ===============================
  {
    const { page, context } = await open('epub', { width: 390, height: 800 });
    const frame = page.locator('#epubView iframe').first().contentFrame();
    await frame.locator('#short').waitFor();
    await frame.locator('#long').click({ clickCount: 3, delay: 80 });
    await page.locator('#hlBar').waitFor({ state: 'visible' });
    await page.locator('#hlAddNote').click();
    const g = await geometry(page);
    check(g.bar.left >= 0 && g.bar.right <= g.width, 'the bar fits a 390px screen sideways');
    check(g.bar.top >= 0 && g.bar.bottom <= g.height, 'and top to bottom, with a long passage selected');
    same(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no sideways page scroll with the bar open');
    check(g.note.height >= 30, 'the note field is usable on a phone');
    await shoot(page, 'selection-bar-phone');
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
}
