// Node-side PDF.js baseline (no canvas): load, first page text, 20 page texts.
// Usage: node scripts/bench-pdf.mjs path/to/file.pdf
import { readFile } from 'node:fs/promises';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/bench-pdf.mjs <file.pdf>');
  process.exit(1);
}
const data = await readFile(file);
const start = performance.now();
const doc = await pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false }).promise;
const load = performance.now() - start;
const firstStart = performance.now();
const first = await doc.getPage(1);
const content = await first.getTextContent();
const firstMs = performance.now() - firstStart;
const batchStart = performance.now();
for (let pageNumber = 2; pageNumber <= Math.min(21, doc.numPages); pageNumber += 1) {
  const page = await doc.getPage(pageNumber);
  await page.getTextContent();
  page.cleanup();
}
const batchMs = performance.now() - batchStart;
first.cleanup();
await doc.destroy();
console.log(JSON.stringify({
  file, bytes: data.length, pages: doc.numPages,
  loadMs: Math.round(load), firstTextMs: Math.round(firstMs),
  firstTextChars: content.items.map((item) => item.str).join(' ').length,
  twentyTextsMs: Math.round(batchMs),
}, null, 2));
