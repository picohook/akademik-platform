import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Run from the repository root; the retained copy is executable there as well.
const root = process.cwd();
const { getDocument, version: pdfjsVersion } = await import(pathToFileURL(path.join(root, 'spike/app/node_modules/pdfjs-dist/legacy/build/pdf.mjs')));
const { watermarkDownload } = await import(pathToFileURL(path.join(root, 'spike/app/social-watermark.mjs')));
const require = createRequire(path.join(root, 'spike/app/package.json'));
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { createCanvas } = require('@napi-rs/canvas');
const out = path.join(root, 'docs/reader-evidence/v118-predeploy-2026-10-23/visual');
const modulePath = path.join(root, 'spike/app/social-watermark.mjs');
const sha = data => createHash('sha256').update(data).digest('hex');
const sourceHash = sha(await readFile(modulePath));
const auth = {
  userId: '12345678-1234-4234-8234-123456789abc',
  tenantId: '87654321-4321-4321-8321-cba987654321',
  email: 'visual.reader@example.org',
};
await mkdir(out, { recursive: true });

async function makeTextPdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([595, 842]);
  page.drawText('ACADEMIC FIXTURE - CONTROLLED TEST CONTENT', { x: 30, y: 807, size: 15, font: bold });
  page.drawText('Dense text and original footer: no real customer content', { x: 30, y: 787, size: 10, font });
  for (let index = 0; index < 48; index++) {
    page.drawText(`${String(index + 1).padStart(2, '0')}. Original academic text: methods, evidence, citations and reproducible results.`, { x: 30, y: 755 - index * 13, size: 10, font });
  }
  page.drawText('References / original bottom content', { x: 18, y: 110, size: 11, font: bold });
  for (let index = 0; index < 9; index++) {
    page.drawText(`REF-${index + 1}: Original bottom line must remain readable: 0123456789 ABCDEFGHIJKLMNOP.`, { x: 18, y: 95 - index * 10, size: 8, font });
  }
  return Buffer.from(await pdf.save());
}

async function render(buffer, scale = 2) {
  const document = await getDocument({
    data: new Uint8Array(buffer), useSystemFonts: false,
    standardFontDataUrl: path.resolve(root, 'spike/app/node_modules/pdfjs-dist/standard_fonts').replaceAll('\\', '/') + '/',
  }).promise;
  try {
    const page = await document.getPage(1);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext('2d');
    await page.render({ canvasContext: context, viewport, background: '#ffffff' }).promise;
    return { canvas, viewport, text: (await page.getTextContent()).items.map(item => item.str).join(' ') };
  } finally { await document.destroy(); }
}

function comparison(before, after, name, footer = true) {
  const width = before.canvas.width;
  const height = footer ? Math.min(380, before.canvas.height) : before.canvas.height;
  const canvas = createCanvas(width * 2 + 24, height + 50);
  const context = canvas.getContext('2d');
  context.fillStyle = '#e8ecef'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#000'; context.font = '20px Arial';
  context.fillText(`${name}: ORIGINAL`, 12, 29);
  context.fillText(`${name}: STAMPED (text alpha 0.28)`, width + 36, 29);
  const sourceY = footer ? before.canvas.height - height : 0;
  context.drawImage(before.canvas, 0, sourceY, width, height, 0, 50, width, height);
  context.drawImage(after.canvas, 0, sourceY, width, height, width + 24, 50, width, height);
  return canvas;
}

function originalDarkPixels(before, after) {
  const width = before.canvas.width, height = before.canvas.height;
  const a = before.canvas.getContext('2d').getImageData(0, 0, width, height).data;
  const b = after.canvas.getContext('2d').getImageData(0, 0, width, height).data;
  let originalDark = 0, lightenedAbove130 = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.max(a[i], a[i + 1], a[i + 2]) > 80) continue;
    originalDark++;
    if (Math.max(b[i], b[i + 1], b[i + 2]) > 130) lightenedAbove130++;
  }
  return { originalDark, lightenedAbove130, fraction: lightenedAbove130 / originalDark };
}

const cases = [];
async function record(name, source, identity = auth, scale = 2) {
  const stamped = await watermarkDownload(source, 'pdf', identity);
  const before = await render(source, scale), after = await render(stamped, scale);
  await writeFile(path.join(out, `${name}-original.pdf`), source);
  await writeFile(path.join(out, `${name}-stamped.pdf`), stamped);
  await writeFile(path.join(out, `${name}-original.png`), before.canvas.toBuffer('image/png'));
  await writeFile(path.join(out, `${name}-stamped.png`), after.canvas.toBuffer('image/png'));
  await writeFile(path.join(out, `${name}-comparison.png`), comparison(before, after, name, name !== 'small-crop-unicode').toBuffer('image/png'));
  const pixels = originalDarkPixels(before, after);
  assert.ok(pixels.originalDark > 0);
  assert.ok(pixels.fraction < 0.001, `${name} dark original content was painted away`);
  assert.ok(after.text.includes(identity.userId));
  assert.ok(after.text.includes(identity.tenantId));
  cases.push({ name, scale, dimensions: { width: before.canvas.width, height: before.canvas.height }, originalSourceSha256: sha(source), stampedSha256: sha(stamped), pixels, extractedStampText: after.text.includes('Akademik Platform') });
  return { before, after };
}

const textPdf = await makeTextPdf();
const text = await record('dense-text', textPdf);

// An actual image-only PDF, made from the controlled page raster. There is no
// original PDF text layer: this exercises a scan/image delivery path without
// redistributing customer publications or claiming real scanner/OCR validation.
const scanned = await PDFDocument.create();
const image = await scanned.embedPng(text.before.canvas.toBuffer('image/png'));
scanned.addPage([595, 842]).drawImage(image, { x: 0, y: 0, width: 595, height: 842 });
const scannedSource = Buffer.from(await scanned.save());
assert.equal((await render(scannedSource)).text, '');
await record('image-only-scan-surrogate', scannedSource);

const small = await PDFDocument.create();
const font = await small.embedFont(StandardFonts.Helvetica);
const smallPage = small.addPage([260, 310]);
smallPage.setCropBox(15, 20, 220, 250);
smallPage.drawText('SMALL CROP FIXTURE', { x: 25, y: 240, size: 12, font });
smallPage.drawText('Original content remains.', { x: 25, y: 220, size: 10, font });
for (let i = 0; i < 7; i++) smallPage.drawText(`Original bottom ${i + 1}`, { x: 25, y: 95 - i * 10, size: 8, font });
await record('small-crop-unicode', Buffer.from(await small.save()), { ...auth, email: `ğ😀${'long'.repeat(8)}@example.org` }, 3);

const tiny = await PDFDocument.create(); tiny.addPage([5, 5]);
let tinyError;
try { await watermarkDownload(Buffer.from(await tiny.save()), 'pdf', auth); }
catch (error) { tinyError = error.message; }
assert.match(tinyError || '', /narrow|small/);
assert.equal(sha(await readFile(modulePath)), sourceHash, 'watermark module changed during evidence capture');
await copyFile(fileURLToPath(import.meta.url), path.join(out, 'reproduce.mjs'));
await writeFile(path.join(out, 'render-proof.json'), JSON.stringify({
  release: 'v118 predeploy', createdAt: new Date().toISOString(), renderer: `PDF.js ${pdfjsVersion} + @napi-rs/canvas`,
  sourceModule: 'spike/app/social-watermark.mjs', sourceSha256: sourceHash,
  scope: 'Controlled dense text, controlled image-only PDF surrogate, crop/Unicode. No production access. Manual image review recorded separately.',
  cases, tinyPage: { status: 'FAIL_CLOSED', error: tinyError },
}, null, 2));
console.log(JSON.stringify({ out, cases: cases.map(item => ({ name: item.name, pixels: item.pixels })), tinyError }));
