// Explicit, pinned import of the reviewed 2026-10-23 OA package.
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createStorage } from './storage.mjs';

export const MANIFEST_SHA = '30a248048ffd20bc3541153f1e985a59c25e14bfb1ef21a2bb22a67a7600ac85';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function stableId(value) {
  const b = Buffer.from(hash(value).slice(0, 32), 'hex');
  b[6] = (b[6] & 15) | 80; b[8] = (b[8] & 63) | 128;
  const h = b.toString('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}

export async function preflight(directory, { expectedManifestSha = MANIFEST_SHA } = {}) {
  const root = await realpath(directory);
  const manifestBytes = await readFile(path.join(root, 'LibEdge_11_Books_Import.json'));
  if (hash(manifestBytes) !== expectedManifestSha) throw new Error('manifest checksum mismatch');
  const manifest = JSON.parse(manifestBytes.toString('utf8').replace(/^\uFEFF/, ''));
  if (manifest.schema_version !== '2.0' || manifest.books.length !== 11) throw new Error('unexpected catalog schema/count');
  const books = []; let totalBytes = 0; const seenBooks = new Set(); const seenFiles = new Set();
  for (const book of manifest.books) {
    if (!/^libedge-oa-\d{3}$/.test(book.id) || seenBooks.has(book.id)) throw new Error('invalid/duplicate book ID');
    seenBooks.add(book.id);
    if (!book.hosting_allowed_under_license || !book.license_url || !book.attribution_text) throw new Error(`missing rights metadata: ${book.id}`);
    const assets = [];
    for (const asset of book.assets.filter(a => a.reader_ready)) {
      if (!['PDF', 'EPUB'].includes(asset.format) || !['en','tr'].includes(asset.language)) throw new Error('unsupported asset');
      if (path.basename(asset.file_name) !== asset.file_name || seenFiles.has(asset.file_name)) throw new Error('invalid/duplicate filename');
      seenFiles.add(asset.file_name);
      const file = await realpath(path.join(root, asset.file_name));
      if (path.dirname(file) !== root) throw new Error('asset escapes input directory');
      const info = await stat(file);
      if (!info.isFile() || info.size !== asset.file_size_bytes || info.size > 300 * 1024 * 1024) throw new Error(`file size mismatch: ${asset.file_name}`);
      const digest = createHash('sha256');
      for await (const chunk of createReadStream(file)) digest.update(chunk);
      if (digest.digest('hex') !== asset.sha256) throw new Error(`file checksum mismatch: ${asset.file_name}`);
      assets.push({ ...asset, file }); totalBytes += info.size;
    }
    books.push({ ...book, verified_assets: assets, import_checksum: hash(JSON.stringify(book)) });
  }
  if (seenFiles.size !== 11) throw new Error('expected exactly 11 reader files');
  return { books, totalBytes, assetCount: seenFiles.size, manifest };
}

export async function importCatalog({ plan, pool, storage, tenantId }) {
  const client = await pool.connect();
  const createdKeys = []; let commitAttempted = false; let begun = false;
  let lock = false; let inserted = 0; let skipped = 0; let assetCount = 0;
  try {
    await client.query("select set_config('app.tenant_id', $1, false)", [tenantId]);
    await client.query("select pg_advisory_lock(hashtextextended($1, 0))", [`libedge-oa:${tenantId}`]); lock = true;
    const tenant = await client.query('select id from tenants where id = $1', [tenantId]);
    if (!tenant.rows.length) throw new Error('target tenant not found');
    await client.query('begin'); begun = true;
    const collectionId = stableId(`${tenantId}:libedge-oa-collection`);
    await client.query(`insert into collections (id,tenant_id,title,slug,description,visibility)
      values ($1,$2,$3,'libedge-open-academic','Reviewed OA starter collection; catalog acceptance pending','tenant')
      on conflict (id) do nothing`, [collectionId,tenantId,plan.manifest.collection_title]);
    for (const book of plan.books) {
      const workId = stableId(`${tenantId}:${book.id}`);
      const existing = await client.query('select metadata from works where id = $1', [workId]);
      if (existing.rows.length) {
        if (existing.rows[0].metadata?.oa_import_checksum !== book.import_checksum) throw new Error(`existing metadata conflict: ${book.id}`);
        const old = await client.query(`select a.id,a.source_id,a.source_checksum,a.storage_key from assets a join editions e on e.id=a.edition_id where e.work_id=$1`,[workId]);
        if (old.rows.length !== book.verified_assets.length) throw new Error(`existing asset count conflict: ${book.id}`);
        for (const asset of book.verified_assets) {
          const row = old.rows.find(a => a.source_id === `${tenantId}:${book.id}:${asset.file_name}`);
          if (!row || row.source_checksum !== asset.sha256 || !row.storage_key.startsWith('r2://')) throw new Error(`existing asset conflict: ${book.id}`);
          if ((await storage.info(row.storage_key)).size !== asset.file_size_bytes) throw new Error(`stored object size mismatch: ${book.id}`);
        }
        skipped++; continue;
      }
      const variants = Object.fromEntries(book.verified_assets.map(a => [stableId(`${tenantId}:${book.id}:${a.file_name}`), {
        language:a.language, format:a.format.toLowerCase(), year:a.year, edition:a.edition_note || book.edition,
        title:book.id === 'libedge-oa-007' ? (a.language === 'tr' ? 'Derin Öğrenmeye Dalış' : 'Dive into Deep Learning') : book.title,
      }]));
      const { verified_assets, import_checksum, ...original } = book;
      const metadata = { authors:book.author, creator_role:book.creator_role, catalog_status:'draft',
        oa_import_id:book.id, oa_import_checksum:import_checksum, asset_variants:variants, oa_catalog:original,
        source_url:book.source_url,license_url:book.license_url,attribution_text:book.attribution_text,
        imported_collection:'libedge-open-academic' };
      await client.query(`insert into works (id,tenant_id,content_type,title,subtitle,language,abstract,subjects,metadata)
        values ($1,$2,'monograph',$3,$4,$5,$6,$7,$8::jsonb)`,
        [workId,tenantId,book.title,book.subtitle || null,book.languages.includes('en')?'en':book.languages[0],book.description_tr,book.subject,JSON.stringify(metadata)]);
      // A source-only work remains a metadata record without a fabricated reader asset.
      for (const asset of verified_assets) {
        const bytes = await readFile(asset.file);
        // Recheck after preflight to detect changed input before any object is written.
        if (hash(bytes) !== asset.sha256) throw new Error(`input changed: ${asset.file_name}`);
        const format = asset.format.toLowerCase();
        const key = await storage.put(`uploads/${randomUUID()}.${format}`, bytes, asset.mime_type);
        createdKeys.push(key);
        const editionId = stableId(`${tenantId}:${book.id}:edition:${asset.file_name}`);
        await client.query(`insert into editions (id,tenant_id,work_id,publisher,publication_year,edition,isbn13,doi,license_uri,license_note,rights_note)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [editionId,tenantId,workId,book.publisher,asset.year,asset.edition_note || book.edition || null,
            book.isbn_ebook ? String(book.isbn_ebook).replace(/\.0$/,'') : null,book.doi || null,
            book.license_url,[book.license,book.permission_notes].filter(Boolean).join('\n'),book.attribution_text]);
        await client.query(`insert into assets (id,tenant_id,edition_id,format,storage_key,page_count,source_system,source_id,source_url,source_checksum,harvested_at,access_status,allow_copy,allow_download,allow_print,watermark)
          values ($1,$2,$3,$4,$5,$6,'ingest',$7,$8,$9,now(),'open',true,true,true,false)`,
          [stableId(`${tenantId}:${book.id}:${asset.file_name}`),tenantId,editionId,format,key,asset.page_count ?? null,
            `${tenantId}:${book.id}:${asset.file_name}`,book.id==='libedge-oa-007' && asset.language==='tr' ? 'https://github.com/d2l-ai/d2l-tr' : book.source_url,asset.sha256]);
        assetCount++;
      }
      await client.query('insert into collection_items (collection_id,work_id,position) values ($1,$2,$3)',[collectionId,workId,inserted]);
      inserted++;
    }
    commitAttempted = true;
    await client.query('commit'); begun = false;
    return { insertedWorks:inserted, skippedWorks:skipped, insertedAssets:assetCount, collectionId };
  } catch (error) {
    if (begun) await client.query('rollback').catch(() => {});
    // An ambiguous COMMIT may have succeeded: never delete possibly referenced files.
    if (!commitAttempted) for (const key of createdKeys) {
      await storage.remove(key).catch(() => console.warn('Orphan object cleanup required; no catalog commit.'));
    }
    if (commitAttempted) console.warn('Commit result uncertain; preserve R2 objects and inspect before retry.');
    throw error;
  } finally {
    if (lock) await client.query('select pg_advisory_unlock(hashtextextended($1,0))',[`libedge-oa:${tenantId}`]).catch(() => {});
    client.release();
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(a => !['--apply','--directory','--tenant'].includes(a) && a.startsWith('--'))) throw new Error('unknown option');
  const directory = args.includes('--directory') ? args[args.indexOf('--directory')+1] : '/incoming';
  const plan = await preflight(directory);
  console.log(`PREFLIGHT PASS: ${plan.books.length} works, ${plan.assetCount} reader files, ${plan.totalBytes} bytes; hashes verified.`);
  console.log('The Turing Way: source-only metadata; ZIP not uploaded as reader content.');
  if (!args.includes('--apply')) { console.log('DRY RUN: no database or R2 changes.'); return; }
  const tenantId = args[args.indexOf('--tenant')+1];
  if (!args.includes('--tenant') || !/^[a-f0-9-]{36}$/i.test(tenantId || '')) throw new Error('explicit --tenant UUID required');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
  const storage = createStorage({ publicDir:fileURLToPath(new URL('./public',import.meta.url)) });
  if (storage.driver !== 'r2') throw new Error('this cohort must use R2 storage');
  const { default:pg } = await import('pg');
  const pool = new pg.Pool({ connectionString:process.env.DATABASE_URL,max:1 });
  try { console.log(JSON.stringify(await importCatalog({plan,pool,storage,tenantId}))); }
  finally { await pool.end(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode=1; });
}
