// Embed a directory of JPEG pages into one image-heavy PDF.
// Usage: node scripts/make-image-pdf.mjs tmp/image-pages ../../tmp/large-500mb.pdf
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';

const dir = path.resolve(process.argv[2] || 'tmp/image-pages');
const out = path.resolve(process.argv[3] || 'tmp/large-500mb.pdf');
const files = (await readdir(dir)).filter((file) => file.endsWith('.jpg')).sort();
if (!files.length) throw new Error(`no JPEG pages in ${dir}`);

const pdf = await PDFDocument.create();
for (const file of files) {
  const bytes = await readFile(path.join(dir, file));
  const image = await pdf.embedJpg(bytes);
  const page = pdf.addPage([595, 842]);
  page.drawImage(image, { x: 0, y: 0, width: 595, height: 842 });
}
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, await pdf.save());
console.log(`${out} — ${files.length} pages`);
