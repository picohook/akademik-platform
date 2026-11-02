import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { PDFDocument, StandardFonts } from 'pdf-lib';

// "Sesli oku" in a real Chromium against the shipped server.mjs (demo mode).
//
// Chromium cannot make sound here, so `speechSynthesis` is replaced by a fake that records every
// utterance and finishes it after a few milliseconds. What this proves is everything around the
// voice: which text is handed to it, the sentence highlight, the automatic page and chapter
// turns, pause/resume, starting from a selection, speed and voice changes, and the player at phone
// width. It does NOT prove how a real device voice sounds.
//
//   PLAYWRIGHT_MODULE=<path to playwright> [SHOTS_DIR=<dir>] node test/read-aloud-ui.browser.mjs

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

// ---- fixtures -----------------------------------------------------------------------------
const PDF_PAGES = [
  ['The first page opens with this sentence.', 'It continues with a second sentence here.', 'A third sentence ends the first page.'],
  ['The second page begins with its own line.', 'Then one more sentence follows on page two.'],
  ['Short one. Then a sentence that wraps', 'onto the second line.'],
];
const PDF_SENTENCES = [...PDF_PAGES[0], ...PDF_PAGES[1], 'Short one.', 'Then a sentence that wraps onto the second line.'];
const inOrder = (haystack, needles) => { let at = 0; for (const word of needles) { at = haystack.indexOf(word, at); if (at < 0) return false; at += 1; } return true; };
const RUNNING_HEAD = 'Running Title of the Test Book';
const RUNNING_FOOT = 'Annual Review of Testing 2026';
async function makePdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  PDF_PAGES.forEach((sentences, index) => {
    const page = pdf.addPage([595, 842]);
    page.drawText(RUNNING_HEAD, { x: 50, y: 812, size: 9, font });
    if (index === 0) page.drawText('Opening Title.', { x: 50, y: 790, size: 12, font });
    sentences.forEach((line, i) => page.drawText(line, { x: 50, y: 700 - i * 40, size: 14, font }));
    page.drawText(RUNNING_FOOT, { x: 50, y: 34, size: 9, font });
    page.drawText(String(index + 1), { x: 290, y: 20, size: 10, font });
  });
  return Buffer.from(await pdf.save());
}

const EPUB_CH1 = Array.from({ length: 36 }, (_, i) => `Chapter one sentence number ${i + 1} fills the page with words so that the chapter spans several screens.`);
const EPUB_CH2 = ['Chapter two starts here with its first sentence.', 'It ends with a second sentence.'];
async function makeEpub() {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  zip.file('OEBPS/content.opf', '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">ra-test</dc:identifier><dc:title>Read aloud EPUB</dc:title><dc:language>en</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>');
  zip.file('OEBPS/nav.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="c1.xhtml">One</a></li><li><a href="c2.xhtml">Two</a></li></ol></nav></body></html>');
  zip.file('OEBPS/c1.xhtml', `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en"><head><title>One</title></head><body><header><h1>Chapter One Heading</h1></header>${EPUB_CH1.map((s, i) => `<p>${s}</p>${i === 2 ? '<span epub:type="pagebreak" role="doc-pagebreak" id="pb12">12</span>' : ''}`).join('')}<script>window.hidden='NEVER READ THIS SCRIPT'</script></body></html>`);
  zip.file('OEBPS/c2.xhtml', `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en"><head><title>Two</title></head><body><h1>Chapter Two Heading</h1>${EPUB_CH2.map((s) => `<p>${s}</p>`).join('')}<p>A reference<a epub:type="noteref" href="#fn1">7</a> sits in a sentence.</p><aside epub:type="footnote" id="fn1"><p>The footnote text must not be read.</p></aside></body></html>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

const FAKE_SPEECH = () => {
  const voices = [
    { name: 'Test Natural English', lang: 'en-US', voiceURI: 'en-natural', localService: false, default: true },
    { name: 'Test Plain English', lang: 'en-GB', voiceURI: 'en-plain', localService: true },
    { name: 'Test Türkçe', lang: 'tr-TR', voiceURI: 'tr-test', localService: true },
  ];
  window.__spoken = [];
  window.__speechMs = 60;
  let current = null;
  class Utterance { constructor(text) { this.text = text; this.lang = ''; this.rate = 1; this.voice = null; } }
  const synth = {
    getVoices: () => voices,
    speak(u) {
      window.__spoken.push({ text: u.text, lang: u.lang, rate: u.rate, voice: u.voice ? u.voice.voiceURI : null });
      current = u;
      setTimeout(() => {
        if (current !== u) return;
        u.onstart?.({});
        if (window.__boundaries !== false) {
          const words = [...u.text.matchAll(/[\p{L}\p{N}]+/gu)];
          words.forEach((word, i) => setTimeout(() => { if (current === u) u.onboundary?.({ name: 'word', charIndex: word.index, charLength: word[0].length }); }, (i / words.length) * window.__speechMs));
        }
        setTimeout(() => { if (current === u) { current = null; u.onend?.({}); } }, window.__speechMs);
      }, 5);
    },
    cancel() { if (current) { const u = current; current = null; u.onerror?.({ error: 'canceled' }); } },
    addEventListener() {}, removeEventListener() {},
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = Utterance;
};

// runs in every frame, the EPUB iframe included: remembers what each highlight was set to
const RECORD_HIGHLIGHTS = () => {
  window.__hl = [];
  const registry = window.CSS && window.CSS.highlights;
  if (!registry) return;
  const set = registry.set.bind(registry);
  registry.set = (name, highlight) => {
    try { window.__hl.push([name, [...highlight].map((range) => range.toString()).join('|')]); } catch { /* noop */ }
    return set(name, highlight);
  };
};

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

  async function open(context, kind, { width = 1280, height = 900, lang } = {}) {
    const page = await context.newPage();
    await page.setViewportSize({ width, height });
    await page.addInitScript(FAKE_SPEECH);
    await page.addInitScript(RECORD_HIGHLIGHTS);
    if (lang) await page.addInitScript((value) => { try { localStorage.setItem('akademikLang', value); } catch { /* noop */ } }, lang);
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    // the demo catalogue has one PDF; add an EPUB entry and serve our own files for both
    await page.route('**/api/books', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const response = await route.fetch();
      const books = await response.json();
      const epub = { ...books[0], id: '44444444-4444-4444-4444-444444444444', title: 'Read aloud EPUB', subtitle: '', format: 'epub', asset_id: '66666666-6666-6666-6666-666666666666', storage_key: 'seed/ra.epub', page_count: null, work_title: 'Read aloud EPUB' };
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
    const card = page.locator('.card', { hasText: kind === 'epub' ? 'Read aloud EPUB' : 'Demo PDF' }).first();
    await card.locator('button', { hasText: 'Oku' }).first().click();
    if (kind === 'pdf') await page.locator('#textLayer span').first().waitFor();
    else await page.locator('#epubView iframe').first().waitFor();
    return { page, errors };
  }
  const spoken = (page) => page.evaluate(() => window.__spoken.map((u) => u.text));
  const waitSpoken = (page, count, timeout = 15000) => page.waitForFunction((n) => window.__spoken.length >= n, count, { timeout });
  const waitText = (page, text, timeout = 15000) => page.waitForFunction((needle) => window.__spoken.some((u) => u.text.includes(needle)), text, { timeout });
  const status = (page) => page.locator('#raStatus').innerText();

  // =========================== PDF ===========================
  const ctx = await browser.newContext();
  const { page, errors } = await open(ctx, 'pdf');
  check(await page.locator('#raBtn').isVisible(), 'the "Sesli oku" button is shown when the browser can speak');
  same((await page.locator('#raBtn').innerText()).trim(), 'Sesli oku', 'button text (Turkish)');
  same(await page.locator('#raPlayer').isHidden(), true, 'the player is not shown until asked for');

  await page.evaluate(() => { window.__speechMs = 250; });
  await page.locator('#raBtn').click();
  await page.locator('#raPlayer').waitFor({ state: 'visible' });
  await waitSpoken(page, 1);
  same((await spoken(page))[0], 'Opening Title.', 'it starts with the title of the page: the running header above it is skipped');
  await waitSpoken(page, 2);
  same((await spoken(page))[1], PDF_PAGES[0][0], 'then the first sentence of the page, whole');
  const lastMark = (name) => page.evaluate((n) => { const hit = window.__hl.filter(([k]) => k === n); return hit.length ? hit[hit.length - 1][1] : null; }, name);
  await page.waitForFunction(() => window.__hl.some(([name, text]) => name === 'ra-sentence' && text.includes('first page opens')));
  same(await page.evaluate(() => CSS.highlights.has('ra-sentence')), true, 'the sentence being read is marked in the page');
  same(await page.locator('#textLayer .ra-active').count(), 0, 'the Highlight API is used, so no class was put on the PDF text layer');
  same(await page.locator('#raPlay').getAttribute('aria-label'), 'Duraklat', 'play button offers Pause while reading');
  same(await page.locator('#raBtn').getAttribute('aria-pressed'), 'true', 'toolbar button reflects the open player');
  await shoot(page, 'pdf-reading');

  // one sentence at a time is lit, the next one takes over
  await waitSpoken(page, 3);
  await shoot(page, 'pdf-word');
  await page.waitForFunction(() => window.__hl.some(([name, text]) => name === 'ra-sentence' && text.includes('second sentence')));
  const nowMarked = await lastMark('ra-sentence');
  check(nowMarked && nowMarked.includes('second sentence') && !nowMarked.includes('first page opens'), 'the mark moved on with the voice: ' + nowMarked);

  // pause / resume repeats the same sentence
  await page.locator('#raPlay').click();
  await page.waitForFunction(() => true);
  const pausedAt = (await spoken(page)).length;
  same(await status(page), 'Duraklatıldı', 'status says paused');
  await page.waitForTimeout(500);
  same((await spoken(page)).length, pausedAt, 'nothing is spoken while paused');
  await page.locator('#raPlay').click();
  await waitSpoken(page, pausedAt + 1);
  const afterResume = await spoken(page);
  same(afterResume[afterResume.length - 1], afterResume[pausedAt - 1], 'resume repeats the sentence that was interrupted');

  // speed change restarts the sentence at the new rate
  await page.selectOption('#raRate', '2');
  await page.waitForFunction(() => window.__spoken.at(-1).rate === 2);
  same(await page.evaluate(() => window.__spoken.at(-1).rate), 2, 'new rate reaches the voice');

  // voice choice: the best English voice is picked by default, a chosen one is used
  await page.locator('#raMoreLabel').click();
  same(await page.locator('#raVoice option').allInnerTexts(), ['Otomatik (en iyi ses)', 'Test Natural English', 'Test Plain English'], 'only voices of the book language are offered');
  await page.selectOption('#raVoice', 'en-plain');
  await page.waitForFunction(() => window.__spoken.at(-1).voice === 'en-plain');
  same(await page.evaluate(() => window.__spoken.at(-1).voice), 'en-plain', 'the chosen voice is used');
  await page.evaluate(() => { window.__speechMs = 40; });

  // it turns the page by itself and reads on, then finishes
  await waitText(page, PDF_PAGES[1][0]);
  await page.waitForFunction(() => document.querySelector('#pageInput').value === '2');
  same(await page.locator('#pageInput').inputValue(), '2', 'the reader turned to page 2 on its own');
  check(await page.locator('#raPlayer').isVisible(), 'the player stays open across the page turn');
  await waitText(page, 'Short one.');
  await page.waitForFunction(() => document.querySelector('#raStatus').textContent === 'Okuma bitti.', null, { timeout: 15000 });
  same(await page.locator('#pageInput').inputValue(), '3', 'it stopped on the last page');
  same(await page.evaluate(() => [CSS.highlights.has('ra-sentence'), CSS.highlights.has('ra-word')]), [false, false], 'no mark is left after the last sentence');
  const all = await spoken(page);
  for (const sentence of PDF_SENTENCES) check(all.includes(sentence), 'was read: ' + sentence);

  // sentence and word highlights, from what the page was told to mark
  const marks = await page.evaluate(() => window.__hl);
  const sentenceMarks = marks.filter(([name]) => name === 'ra-sentence').map(([, text]) => text);
  const wordMarks = marks.filter(([name]) => name === 'ra-word').map(([, text]) => text);
  // the two lines are separate boxes with no space between them in the page's own text (the space is added for the voice only)
  check(sentenceMarks.includes('Then a sentence that wrapsonto the second line.'), 'the sentence mark covers exactly the sentence, across two lines: ' + JSON.stringify(sentenceMarks.slice(-6)));
  check(!sentenceMarks.some((text) => text.includes('Short one.') && text.includes('Then a sentence')), 'the sentence before it on the same line is not swept in');
  check(sentenceMarks.every((text) => !/^\s|\s$/.test(text)), 'a sentence mark has no stray space at its ends');
  check(inOrder(wordMarks, ['Then', 'a', 'sentence', 'that', 'wraps', 'onto', 'the', 'second', 'line']), 'the words were followed one by one, onto the second line: ' + JSON.stringify(wordMarks.slice(-14)));
  check(inOrder(wordMarks, ['It', 'continues', 'with', 'a', 'second', 'sentence', 'here']), 'and on the first page too');
  check(wordMarks.every((text) => /^[\p{L}\p{N}'’-]+$/u.test(text)), 'every word mark is a single word: ' + JSON.stringify(wordMarks.filter((text) => !/^[\p{L}\p{N}'’-]+$/u.test(text))));

  // page furniture: a running header, a running footer and page numbers are left out; a title that
  // appears once in the top band is not; the switch brings them back
  const skipped = await spoken(page);
  check(!skipped.some((s) => s.includes(RUNNING_HEAD) || s.includes('Annual Review')), 'the running header and footer were not read');
  check(!skipped.some((s) => /^\s*\d+\s*$/.test(s)), 'page numbers were not read: ' + JSON.stringify(skipped.filter((s) => /^\s*\d+\s*$/.test(s))));
  check(skipped.includes('Opening Title.'), 'a title that appears only once in the top band is still read');
  await page.evaluate(() => { document.querySelector('.ra-more').open = true; });
  same(await page.locator('#raSkip').isChecked(), true, 'skipping is on by default');
  await page.locator('#raSkip').uncheck();
  await page.locator('#pageInput').fill('1');
  await page.locator('#pageInput').press('Enter');
  await page.waitForFunction(() => document.querySelector('#pageInput').value === '1');
  await page.evaluate(() => { window.__spoken.length = 0; window.__speechMs = 40; });
  await page.locator('#raPlay').click();
  await waitText(page, RUNNING_FOOT);
  const unskipped = await spoken(page);
  check(unskipped.some((s) => s.includes(RUNNING_HEAD)) && unskipped.some((s) => s.includes('Annual Review')) && unskipped.some((s) => /Annual Review of Testing 2026 1$/.test(s)), 'with the switch off the header, footer and page number are read: ' + JSON.stringify(unskipped.slice(0, 6)));
  await page.locator('#raSkip').check();
  await page.locator('#raPlay').click();

  // a voice that reports no word boundaries: the words are paced from the speed of speech instead
  await page.evaluate(() => { window.__boundaries = false; window.__speechMs = 2600; window.__hl.length = 0; });
  await page.locator('#raPlay').click();
  await page.waitForFunction(() => new Set(window.__hl.filter(([name]) => name === 'ra-word').map(([, text]) => text)).size >= 3, null, { timeout: 12000 });
  const paced = await page.evaluate(() => window.__hl.filter(([name]) => name === 'ra-word').map(([, text]) => text));
  check(new Set(paced).size >= 3, 'with no boundary events the words still advance: ' + JSON.stringify(paced));
  await page.locator('#raPlay').click();
  await page.evaluate(() => { window.__boundaries = true; window.__speechMs = 300; });

  // starting from a selection
  await page.locator('#pageInput').fill('1');
  await page.locator('#pageInput').press('Enter');
  await page.waitForFunction(() => document.querySelector('#pageInput').value === '1');
  await page.locator('#raClose').click();
  same(await page.locator('#raPlayer').isHidden(), true, 'closing hides the player');
  await page.evaluate(() => { window.__spoken.length = 0; window.__speechMs = 4000; });
  await page.evaluate(() => {
    const spans = [...document.querySelectorAll('#textLayer span')].filter((s) => s.textContent.includes('second sentence'));
    const range = document.createRange();
    range.selectNodeContents(spans[0]);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    spans[0].dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.locator('#hlBar').waitFor({ state: 'visible' });
  check(await page.locator('#hlListen').isVisible(), '"Dinle" is in the selection bar');
  await page.locator('#hlListen').click();
  await waitSpoken(page, 1);
  same((await spoken(page))[0], PDF_PAGES[0][1], 'reading starts at the selected sentence, not at the top of the page');
  same(await page.locator('#hlBar').isHidden(), true, 'the selection bar closes');

  // the player is a thin strip on the bottom edge of the reading area, just above the page controls; the page
  // area leaves room for it, and it stays visible while it reads
  const dock = await page.evaluate(() => {
    const p = document.querySelector('#raPlayer').getBoundingClientRect();
    const a = document.querySelector('#pageArea').getBoundingClientRect();
    const f = document.querySelector('#readerFooter').getBoundingClientRect();
    return { playerTop: p.top, playerBottom: p.bottom, areaBottom: a.bottom, footerTop: f.top, height: p.height, opacity: getComputedStyle(document.querySelector('#raPlayer')).opacity, position: getComputedStyle(document.querySelector('#raPlayer')).position, pad: getComputedStyle(document.querySelector('#pageArea')).paddingBottom };
  });
  check(Math.abs(dock.playerBottom - dock.areaBottom) <= 1 && dock.playerBottom <= dock.footerTop + 1, 'the player sits on the bottom edge of the reading area, above the page controls: ' + JSON.stringify(dock));
  check(dock.height < 100 && dock.opacity === '1' && dock.position === 'absolute' && parseFloat(dock.pad) >= dock.height, 'a thin strip that stays visible, with room left for the last lines');
  await shoot(page, 'pdf-reading-docked');

  // turning the page yourself pauses the reading (it must not talk over you); the page moves the reader made
  // itself while starting are not the reader's own, so let those settle first
  await page.waitForTimeout(4500);
  await page.locator('#nextPage').click();
  await page.waitForFunction(() => document.querySelector('#raStatus').textContent === 'Duraklatıldı');
  same(await status(page), 'Duraklatıldı', 'a page turn by the reader pauses the voice');
  const before = (await spoken(page)).length;
  await page.waitForTimeout(600);
  same((await spoken(page)).length, before, 'and it stays quiet');

  // keyboard shortcut and leaving the book
  await page.locator('#raClose').click();
  await page.keyboard.press('Alt+Shift+L');
  await page.locator('#raPlayer').waitFor({ state: 'visible' });
  await page.locator('#closeReader').click();
  await page.locator('#raPlayer').waitFor({ state: 'hidden' });
  const afterClose = (await spoken(page)).length;
  await page.waitForTimeout(500);
  same((await spoken(page)).length, afterClose, 'closing the book stops the reading for good');
  same(errors, [], 'no page errors on the PDF path');
  await ctx.close();

  // =========================== EPUB ===========================
  const ectx = await browser.newContext();
  const epub = await open(ectx, 'epub');
  const ep = epub.page;
  await ep.evaluate(() => { window.__speechMs = 50; });
  await ep.locator('#raBtn').click();
  await waitSpoken(ep, 3);
  const first = await spoken(ep);
  same(first[0], 'Chapter One Heading', 'the EPUB heading is its own sentence, read first');
  same(first[1], EPUB_CH1[0], 'then the first paragraph');
  check(!first.some((s) => s.includes('NEVER READ')), 'script content is never read');
  await ep.waitForFunction(() => document.querySelector('#epubView iframe') && true);
  const epubLit = await Promise.all(ep.frames().map((frame) => frame.evaluate(() => (window.CSS && CSS.highlights && CSS.highlights.has('ra-sentence')) || false).catch(() => false)));
  check(epubLit.some(Boolean), 'the sentence being read is highlighted in the EPUB');
  await shoot(ep, 'epub-reading');

  // every chapter is a new iframe, so what was marked is read while chapter 1 is still the one on screen
  await waitText(ep, 'sentence number 5');
  const early = (await Promise.all(ep.frames().map((frame) => frame.evaluate(() => window.__hl || []).catch(() => [])))).flat();
  const epubSentenceMarks = early.filter(([name]) => name === 'ra-sentence').map(([, text]) => text);
  const epubWordMarks = early.filter(([name]) => name === 'ra-word').map(([, text]) => text);
  check(epubSentenceMarks.includes(EPUB_CH1[1]) && epubSentenceMarks.includes(EPUB_CH1[2]), 'the EPUB sentence mark is exactly the sentence: ' + JSON.stringify(epubSentenceMarks.slice(0, 4)));
  check(inOrder(epubWordMarks, ['Chapter', 'one', 'sentence', 'number', '2', 'fills', 'the', 'page']), 'EPUB words were followed one by one: ' + JSON.stringify(epubWordMarks.slice(0, 12)));
  same((await ep.locator('g.ra-sentence').count()), 0, 'no page-overlay highlight is used when the Highlight API is there');
  const labelAtStart = await ep.locator('#pageLabel').innerText();
  await waitText(ep, 'sentence number 30', 30000);
  const labelLater = await ep.locator('#pageLabel').innerText();
  check(labelLater !== labelAtStart, `it turned EPUB pages while reading (${labelAtStart} -> ${labelLater})`);
  check((await Promise.all(ep.frames().map((frame) => frame.evaluate(() => (window.CSS && CSS.highlights && CSS.highlights.has('ra-sentence')) || false).catch(() => false)))).some(Boolean), 'the highlight follows onto the new page');

  await waitText(ep, EPUB_CH2[0], 40000);
  const body = await ep.locator('#epubView iframe').first().contentFrame().locator('body').innerText();
  check(body.includes('Chapter Two'), 'it moved on to chapter two by itself');
  await ep.waitForFunction(() => document.querySelector('#raStatus').textContent === 'Okuma bitti.', null, { timeout: 20000 });
  const epubAll = await spoken(ep);
  check(epubAll.includes(EPUB_CH2[1]) && epubAll.includes('Chapter Two Heading'), 'the last chapter was read to its end');
  same((await Promise.all(ep.frames().map((frame) => frame.evaluate(() => (window.CSS && CSS.highlights && CSS.highlights.has('ra-sentence')) || false).catch(() => false)))).some(Boolean), false, 'no EPUB highlight is left at the end');
  check(!epubAll.some((s) => s.includes('footnote text')), 'the footnote was not read');
  check(!epubAll.some((s) => s.trim() === '12' || s.trim() === '7'), 'the page-break marker and the note reference were not read');
  check(epubAll.includes('A reference sits in a sentence.'), 'the sentence around the note reference reads cleanly');
  check(epubAll.includes('Chapter One Heading'), 'a chapter title in a plain <header> is still read');
  await ep.locator('#raMoreLabel').click();
  await ep.locator('#raSkip').uncheck();
  await ep.evaluate(() => { window.__spoken.length = 0; });
  await ep.locator('#raPlay').click();
  await waitText(ep, 'footnote text', 20000);
  check((await spoken(ep)).some((s) => s.includes('The footnote text must not be read.')), 'with the switch off the footnote is read');
  same(epub.errors, [], 'no page errors on the EPUB path');
  await ectx.close();

  // =========================== phone width, English UI ===========================
  const pctx = await browser.newContext();
  const phone = await open(pctx, 'pdf', { width: 390, height: 800 });
  await phone.page.evaluate(() => { window.__speechMs = 400; });
  await phone.page.locator('#raBtn').click();
  await phone.page.locator('#raPlayer').waitFor({ state: 'visible' });
  const box = await phone.page.locator('#raPlayer').boundingBox();
  check(box.x >= 0 && box.x + box.width <= 390 + 1, 'the player fits inside a 390px screen');
  same(await phone.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no sideways page scroll with the player open');
  await shoot(phone.page, 'phone-player');
  await pctx.close();

  console.log(JSON.stringify({ passed: true, checks }));
} catch (error) {
  console.error(error);
  console.error(serverLog.split('\n').slice(-8).join('\n'));
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
