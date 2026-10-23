// Build small PDFs with and without /PageLabels for reader acceptance tests.
// Usage: node scripts/make-page-label-pdf.mjs [outDir]
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const outDir = path.resolve(process.argv[2] || 'spike/app/test/fixtures');

function buildPdf({ labels }) {
  const objects = [];
  const add = (body) => { objects.push(body); return objects.length; };
  const catalog = add('');
  const pages = add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pageIds = [];
  const contentIds = [];

  for (let index = 1; index <= 6; index += 1) {
    const content = `BT /F1 24 Tf 40 320 Td (Visual page ${index}) Tj ET`;
    contentIds.push(add(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`));
    pageIds.push(add(''));
  }

  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pages} 0 R${labels
    ? ` /PageLabels << /Nums [0 << /S /r >> 2 << /S /D /St 1 >>] >>`
    : ''} >>`;
  objects[pages - 1] = `<< /Type /Pages /Count 6 /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`;
  pageIds.forEach((pageId, index) => {
    objects[pageId - 1] = `<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 300 400] `
      + `/Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${contentIds[index]} 0 R >>`;
  });

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

await mkdir(outDir, { recursive: true });
const labelled = path.join(outDir, 'page-labels.pdf');
const plain = path.join(outDir, 'page-labels-none.pdf');
await writeFile(labelled, buildPdf({ labels: true }));
await writeFile(plain, buildPdf({ labels: false }));
console.log(JSON.stringify({
  labelled,
  plain,
  expectedLabels: ['i', 'ii', '1', '2', '3', '4'],
  fallback: 'PDF sayfası N for every page',
}, null, 2));
