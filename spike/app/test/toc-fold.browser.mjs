import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

// The contents list of an EPUB with nested headings: a heading that has sub-headings can be folded.
//
//   * every heading shows at first; only a heading with sub-headings has a fold control, and it says whether it is open;
//   * folding hides exactly its sub-headings (and theirs), the others stay; unfolding shows them again;
//   * a heading inside a folded heading stays hidden when the heading in between is unfolded;
//   * filtering shows the flat matches, whatever is folded;
//   * clicking a heading still goes to the chapter.
//
//   PLAYWRIGHT_MODULE=<path to playwright> node test/toc-fold.browser.mjs

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

// Part One
//   Chapter 1.1
//     Section 1.1.1
//   Chapter 1.2
// Part Two
//   Chapter 2.1
async function makeEpub() {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  const files = ['p1', 'c11', 's111', 'c12', 'p2', 'c21'];
  zip.file('OEBPS/content.opf', `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">toc</dc:identifier><dc:title>Nested contents</dc:title><dc:language>en</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${files.map((f) => `<item id="${f}" href="${f}.xhtml" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine>${files.map((f) => `<itemref idref="${f}"/>`).join('')}</spine></package>`);
  zip.file('OEBPS/nav.xhtml', `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol>
    <li><a href="p1.xhtml">Part One</a><ol><li><a href="c11.xhtml">Chapter 1.1</a><ol><li><a href="s111.xhtml">Section 1.1.1</a></li></ol></li><li><a href="c12.xhtml">Chapter 1.2</a></li></ol></li>
    <li><a href="p2.xhtml">Part Two</a><ol><li><a href="c21.xhtml">Chapter 2.1</a></li></ol></li></ol></nav></body></html>`);
  for (const f of files) zip.file(`OEBPS/${f}.xhtml`, `<html xmlns="http://www.w3.org/1999/xhtml" lang="en"><head><title>${f}</title></head><body><h1 id="${f}">${f}</h1><p>Text of ${f}.</p></body></html>`);
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
  const epubBytes = await makeEpub();
  browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.route('**/api/books', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const books = await response.json();
    const epub = { ...books[0], id: '44444444-4444-4444-4444-444444444444', title: 'Nested contents', subtitle: '', format: 'epub', asset_id: '66666666-6666-6666-6666-666666666666', storage_key: 'seed/toc.epub', page_count: null, work_title: 'Nested contents' };
    return route.fulfill({ response, json: [books[0], epub] });
  });
  await page.route(/\/api\/books\/66666666-6666-6666-6666-666666666666\/book\.epub/, (route) => route.fulfill({ status: 200, contentType: 'application/epub+zip', body: epubBytes }));
  await page.goto(base);
  await page.locator('#adminLogin > summary').click();
  await page.fill('#loginEmail', 'librarian@example.edu.tr');
  await page.fill('#loginPassword', 'demo1234');
  await page.locator('#adminLogin button[type=submit]').click();
  await page.locator('#loginScreen').waitFor({ state: 'hidden' });
  await page.locator('.card', { hasText: 'Nested contents' }).first().locator('button', { hasText: 'Oku' }).first().click();
  await page.locator('#epubView iframe').first().waitFor();
  await page.locator('#toggleToc').click();
  await page.locator('#tocList .toc-item').first().waitFor();

  const shown = () => page.evaluate(() => [...document.querySelectorAll('#tocList .toc-row')].filter((row) => !row.hidden).map((row) => row.querySelector('.toc-item').textContent.trim()));
  const folds = () => page.evaluate(() => [...document.querySelectorAll('#tocList .toc-row')].map((row) => [row.querySelector('.toc-item').textContent.trim(), row.querySelector('.toc-fold')?.getAttribute('aria-expanded') ?? null]));

  same(await shown(), ['Part One', 'Chapter 1.1', 'Section 1.1.1', 'Chapter 1.2', 'Part Two', 'Chapter 2.1'], 'every heading shows at first');
  same(await folds(), [['Part One', 'true'], ['Chapter 1.1', 'true'], ['Section 1.1.1', null], ['Chapter 1.2', null], ['Part Two', 'true'], ['Chapter 2.1', null]],
    'only a heading with sub-headings has a fold control, and it says it is open');

  const foldOf = (title) => page.locator('#tocList .toc-row', { has: page.locator('.toc-item', { hasText: title }) }).locator('.toc-fold');
  await foldOf('Part One').click();
  same(await shown(), ['Part One', 'Part Two', 'Chapter 2.1'], 'folding a part hides its chapters and their sections, and only those');
  same((await folds())[0], ['Part One', 'false'], 'and the control says it is folded');
  await foldOf('Part One').click();
  same((await shown()).length, 6, 'unfolding shows them again');

  await foldOf('Chapter 1.1').click();
  await foldOf('Part One').click();
  await foldOf('Part One').click();
  same(await shown(), ['Part One', 'Chapter 1.1', 'Chapter 1.2', 'Part Two', 'Chapter 2.1'], 'a heading folded inside a part stays folded when the part is unfolded');

  // a filter is flat
  await page.fill('#tocFilter', 'section');
  same(await shown(), ['Section 1.1.1'], 'a filter lists the matches, whatever is folded');
  check((await page.locator('#tocList .toc-fold').count()) === 0, 'and has no fold controls');
  await page.fill('#tocFilter', '');
  same(await shown(), ['Part One', 'Chapter 1.1', 'Chapter 1.2', 'Part Two', 'Chapter 2.1'], 'clearing the filter brings the folds back as they were');

  // a heading still opens its chapter
  await page.locator('#tocList .toc-item', { hasText: 'Chapter 2.1' }).click();
  await page.waitForFunction(() => document.querySelector('#epubView iframe')?.contentDocument?.body?.textContent.includes('Text of c21'));
  check(true, 'clicking a heading goes to its chapter');

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
