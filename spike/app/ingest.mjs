#!/usr/bin/env node
/**
 * Ingest PDFs into the scaffold database.
 *
 * Usage:
 *   node ingest.mjs <file-or-directory> [more...] [options]
 *
 * Options:
 *   --title "..."        title for a single file (default: filename)
 *   --publisher "..."    default: "Demo Akademik Yayıncılık"
 *   --year 2026          default: current year
 *   --language tr        default: tr
 *   --subjects "A;B"     default: []
 *   --tenant <uuid>      default: DEMO_TENANT_ID
 *   --dry-run            read PDFs and print metadata; no database, no writes
 *
 * Requires DATABASE_URL unless --dry-run is used.
 */
import { readFile, readdir, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { createStorage } from './storage.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';

const PUBLIC_DIR = path.join(process.cwd(), 'public');
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'uploads');

const argv = process.argv.slice(2);
const options = {
  title: null,
  publisher: 'Demo Akademik Yayıncılık',
  year: new Date().getFullYear(),
  language: 'tr',
  subjects: [],
  tenant: process.env.DEMO_TENANT_ID || '11111111-1111-1111-1111-111111111111',
  dryRun: false,
};
const inputs = [];

for (let index = 0; index < argv.length; index += 1) {
  const arg = argv[index];
  if (arg === '--dry-run') options.dryRun = true;
  else if (arg === '--title') options.title = argv[++index];
  else if (arg === '--publisher') options.publisher = argv[++index];
  else if (arg === '--year') options.year = Number(argv[++index]);
  else if (arg === '--language') options.language = argv[++index];
  else if (arg === '--subjects') options.subjects = String(argv[++index] || '').split(/[;,]/).map((s) => s.trim()).filter(Boolean);
  else if (arg === '--tenant') options.tenant = argv[++index];
  else if (arg === '--help' || arg === '-h') {
    console.log('Usage: node ingest.mjs <file-or-directory> [options]');
    console.log('Options: --title --publisher --year --language --subjects --tenant --dry-run');
    process.exit(0);
  } else if (arg.startsWith('--')) {
    console.error(`Unknown option: ${arg}`);
    process.exit(2);
  } else {
    inputs.push(arg);
  }
}

async function collectPdfs(entry) {
  const info = await stat(entry);
  if (info.isDirectory()) {
    const names = await readdir(entry);
    return names
      .filter((name) => name.toLowerCase().endsWith('.pdf'))
      .map((name) => path.join(entry, name));
  }
  return [entry];
}

function titleFromFile(file) {
  return path.basename(file, path.extname(file)).replace(/[_-]+/g, ' ').trim();
}

async function inspect(file) {
  const buffer = await readFile(file);
  if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new Error(`${file}: not a PDF`);
  }
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  let pageCount = null;
  try {
    const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
    pageCount = pdf.getPageCount();
  } catch (error) {
    console.warn(`[warn] ${file}: page count failed (${error.message})`);
  }
  return { buffer, sha256, pageCount, size: buffer.length };
}

async function main() {
  if (!inputs.length) {
    console.error('No input. Pass a PDF or a directory.');
    process.exit(2);
  }

  const files = (await Promise.all(inputs.map(collectPdfs))).flat();
  if (!files.length) {
    console.error('No PDF files found.');
    process.exit(2);
  }

  let pool = null;
  if (!options.dryRun) {
    if (!process.env.DATABASE_URL) {
      console.error('DATABASE_URL is required (or use --dry-run).');
      process.exit(2);
    }
    const pg = await import('pg');
    pool = new pg.default.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    await mkdir(UPLOAD_DIR, { recursive: true });
  }

  const storage = options.dryRun ? null : createStorage({ publicDir: PUBLIC_DIR });
  for (const file of files) {
    const { buffer, sha256, pageCount, size } = await inspect(file);
    const title = options.title && files.length === 1 ? options.title : titleFromFile(file);
    const mb = (size / 1024 / 1024).toFixed(1);
    console.log(`[pdf] ${path.basename(file)} · ${mb} MB · ${pageCount ?? '?'} pages · ${sha256.slice(0, 12)}`);

    if (options.dryRun) continue;

    const id = randomUUID();
    let storageKey = `uploads/${id}.pdf`;
    let storedKey = null;
    let committed = false;

    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('app.tenant_id', $1, false)", [options.tenant]);

      const duplicate = await client.query(
        "select id from assets where source_system = 'ingest' and source_id = $1 limit 1",
        [sha256],
      );
      if (duplicate.rowCount > 0) {
        console.log(`[skip] already ingested as ${duplicate.rows[0].id}`);
        await client.query('rollback');
        continue;
      }

      storedKey = await storage.put(storageKey, buffer, 'application/pdf');
      storageKey = storedKey;
      const work = await client.query(
        `insert into works (tenant_id, content_type, title, language, abstract, subjects, metadata)
         values ($1, 'monograph', $2, $3, $4, $5, $6::jsonb)
         returning id`,
        [options.tenant, title, options.language, null, options.subjects, JSON.stringify({ ingested: true })],
      );
      const edition = await client.query(
        `insert into editions (tenant_id, work_id, publisher, publication_year, license_note, rights_note)
         values ($1, $2, $3, $4, $5, $6)
         returning id`,
        [
          options.tenant,
          work.rows[0].id,
          options.publisher,
          options.year,
          'Test ingest; rights confirmed by the operator.',
          'Local scaffold ingest.',
        ],
      );
      const asset = await client.query(
        `insert into assets
           (tenant_id, edition_id, format, storage_key, page_count, quality_score,
            source_system, source_id, source_checksum, harvested_at, access_status)
         values ($1, $2, 'pdf', $3, $4, null, 'ingest', $5, $5, now(), 'open')
         returning id`,
        [options.tenant, edition.rows[0].id, storageKey, pageCount, sha256],
      );

      await client.query('commit');
      committed = true;
      console.log(`[ok] ${title} -> work ${work.rows[0].id}, asset ${asset.rows[0].id}`);
    } catch (error) {
      await client.query('rollback').catch(() => {});
      if (!committed && storedKey) await storage.remove(storedKey).catch(() => console.warn('[storage] failed ingest orphan requires cleanup'));
      console.error(`[fail] ${file}: ${error.message}`);
      process.exitCode = 1;
    } finally {
      client.release();
    }
  }

  if (pool) await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

