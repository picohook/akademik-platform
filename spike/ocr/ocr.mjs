#!/usr/bin/env node
/**
 * OCR spike: run tesseract.js over synthetic scan pages.
 *
 * Usage:
 *   node ocr.mjs --images ../fixtures/scan-pages --truth ../fixtures/scan-truth.json \
 *                --lang tur --out ../fixtures/ocr-output.json [--hocr-dir ../fixtures/hocr]
 *
 * The first run downloads the requested traineddata files; this can take a minute.
 */
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createWorker } from 'tesseract.js';

const argv = process.argv.slice(2);
const options = {
  images: '../fixtures/scan-pages',
  truth: '../fixtures/scan-truth.json',
  lang: 'tur',
  out: '../fixtures/ocr-output.json',
  hocrDir: null,
  limit: 0,
};

for (let index = 0; index < argv.length; index += 1) {
  const arg = argv[index];
  if (arg === '--images') options.images = argv[++index];
  else if (arg === '--truth') options.truth = argv[++index];
  else if (arg === '--lang') options.lang = argv[++index];
  else if (arg === '--out') options.out = argv[++index];
  else if (arg === '--hocr-dir') options.hocrDir = argv[++index];
  else if (arg === '--limit') options.limit = Number(argv[++index]);
  else {
    console.error(`Unknown option: ${arg}`);
    process.exit(2);
  }
}

function normalize(text) {
  return String(text || '')
    .toLocaleLowerCase('tr')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .trim();
}

function levenshtein(a, b) {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const previous = new Array(b.length + 1);
  const current = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) previous[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j];
  }
  return previous[b.length];
}

function cer(reference, hypothesis) {
  const a = normalize(reference);
  const b = normalize(hypothesis);
  if (!a.length) return 0;
  return levenshtein(a, b) / a.length;
}

async function main() {
  const files = (await readdir(options.images))
    .filter((name) => /\.(png|jpe?g|tiff?)$/i.test(name))
    .sort()
    .slice(0, options.limit > 0 ? options.limit : undefined)
    .map((name) => path.join(options.images, name));

  if (!files.length) {
    console.error(`No images in ${options.images}`);
    process.exit(2);
  }

  let truth = [];
  try {
    truth = JSON.parse(await readFile(options.truth, 'utf8'));
  } catch {
    console.warn(`[warn] truth file not readable: ${options.truth}; CER will be skipped`);
  }

  console.log(`[ocr] ${files.length} page(s), lang=${options.lang}`);
  let worker;
  try {
    worker = await createWorker(options.lang, 1, {
      logger: (message) => {
        if (message.status === 'recognizing text') {
          process.stdout.write(`\r  ${message.status} ${Math.round((message.progress || 0) * 100)}%`);
        }
      },
    });
  } catch (error) {
    console.error(`[fail] worker initialization: ${error.message}`);
    process.exit(1);
  }

  const pages = [];
  if (options.hocrDir) await mkdir(options.hocrDir, { recursive: true });

  for (let index = 0; index < files.length; index += 1) {
    const image = files[index];
    const started = Date.now();
    try {
      const { data } = await worker.recognize(image, {}, { text: true, hocr: true, tsv: true });
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);
      const pageTruth = truth[index]?.text || '';
      const pageCer = pageTruth ? cer(pageTruth, data.text) : null;
      const hocr = data.hocr || '';
      if (options.hocrDir) {
        const name = path.basename(image).replace(/\.[^.]+$/, '.hocr');
        await writeFile(path.join(options.hocrDir, name), hocr, 'utf8');
      }
      pages.push({
        image: path.basename(image),
        text: data.text,
        confidence: data.confidence,
        cer: pageCer,
        hocrChars: hocr.length,
        seconds: Number(elapsed),
      });
      const cerText = pageCer === null ? 'n/a' : `${(pageCer * 100).toFixed(1)}%`;
      console.log(`\n[page ${index + 1}] ${path.basename(image)} · ${elapsed}s · conf ${data.confidence ?? '?'} · CER ${cerText} · hOCR ${hocr.length} chars`);
    } catch (error) {
      console.error(`\n[page ${index + 1}] ${path.basename(image)} failed: ${error.message}`);
      pages.push({ image: path.basename(image), error: error.message });
    }
  }

  await worker.terminate();
  await writeFile(options.out, JSON.stringify({ lang: options.lang, pages }, null, 2), 'utf8');
  console.log(`\n[out] ${options.out}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
