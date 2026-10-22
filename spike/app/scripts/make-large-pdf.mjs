// Generate a text-heavy PDF for page-count/scroll tests.
// Usage: node scripts/make-large-pdf.mjs [pages] [out]
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const pages = Number(process.argv[2] || 2000);
const out = path.resolve(process.argv[3] || 'tmp/large-2000.pdf');
const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
for (let index = 1; index <= pages; index += 1) {
  const page = pdf.addPage([595, 842]);
  page.drawText(`Large PDF performance fixture — page ${index}`, {
    x: 48, y: 790, size: 16, font, color: rgb(0.12, 0.11, 0.1),
  });
  page.drawText('The quick brown fox jumps over the lazy dog. '.repeat(8), {
    x: 48, y: 730, size: 9, font, color: rgb(0.25, 0.24, 0.22), lineHeight: 14, maxWidth: 500,
  });
}
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, await pdf.save());
console.log(`${out} — ${pages} pages`);
