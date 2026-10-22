import path from 'node:path';
import { readFile } from 'node:fs/promises';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import JSZip from 'jszip';

const MAX_INDEX_BYTES = 300 * 1024 * 1024;
const BATCH_SIZE = 20;

function normalize(value) {
  return String(value || '').toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim();
}

function decodeEntities(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function hocrText(html) {
  const words = [...html.matchAll(/class=["']ocrx_word["'][^>]*>([\s\S]*?)<\/span>/gi)]
    .map((match) => decodeEntities(match[1].replace(/<[^>]+>/g, ' ')))
    .join(' ');
  return words.replace(/\s+/g, ' ').trim();
}

async function readHocr(publicDir, assetId, pageNumber) {
  const file = path.join(publicDir, 'ocr', assetId, `page-${String(pageNumber).padStart(3, '0')}.hocr`);
  try {
    return hocrText(await readFile(file, 'utf8'));
  } catch {
    return '';
  }
}

async function flushPages(client, assetId, tenantId, pages) {
  if (!pages.length) return;
  const values = [];
  const params = [];
  pages.forEach((page, index) => {
    const base = index * 7;
    values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`);
    params.push(assetId, tenantId, page.pageNumber, page.text, page.search, page.source, page.locator || null);
  });
  await client.query(
    `insert into asset_pages (asset_id, tenant_id, page_no, text_content, text_search, source, locator)
     values ${values.join(', ')}
     on conflict (asset_id, page_no) do update
       set text_content = excluded.text_content,
           text_search = excluded.text_search,
           source = excluded.source,
           locator = excluded.locator,
           updated_at = now()`,
    params,
  );
}

export async function indexAsset({ pool, tenantId, assetId, storageKey, publicDir }) {
  if (String(storageKey).toLowerCase().endsWith('.epub')) {
    return indexEpubAsset({ pool, tenantId, assetId, storageKey, publicDir });
  }
  if (!String(storageKey).toLowerCase().endsWith('.pdf')) {
    throw new Error('page index skipped: not a PDF');
  }
  const filePath = path.join(publicDir, storageKey);
  const buffer = await readFile(filePath);
  if (buffer.length > MAX_INDEX_BYTES) {
    throw new Error(`page index skipped: ${buffer.length} bytes exceeds ${MAX_INDEX_BYTES}`);
  }

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;

  const client = await pool.connect();
  let indexed = 0;
  try {
    await client.query("select set_config('app.tenant_id', $1, false)", [tenantId]);
    await client.query('delete from asset_pages where asset_id = $1', [assetId]);

    let batch = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      let text = '';
      let source = 'pdf';
      try {
        const page = await doc.getPage(pageNumber);
        const content = await page.getTextContent();
        text = content.items.map((item) => item.str).join(' ').replace(/\s+/g, ' ').trim();
        await page.cleanup();
      } catch (error) {
        console.warn(`[index] page ${pageNumber}/${doc.numPages}: ${error.message}`);
      }

      if (text.length < 5) {
        const ocr = await readHocr(publicDir, assetId, pageNumber);
        if (ocr) {
          text = ocr;
          source = 'ocr';
        }
      }

      batch.push({ pageNumber, text, search: normalize(text), source });
      if (batch.length >= BATCH_SIZE) {
        await flushPages(client, assetId, tenantId, batch);
        indexed += batch.length;
        batch = [];
        if (indexed % 100 === 0) {
          console.log(`[index] ${assetId}: ${indexed}/${doc.numPages}`);
        }
      }
    }
    if (batch.length) {
      await flushPages(client, assetId, tenantId, batch);
      indexed += batch.length;
    }
  } finally {
    client.release();
    await doc.destroy();
  }

  console.log(`[index] ${assetId}: ${indexed} pages indexed`);
  return indexed;
}

export async function indexEpubAsset({ pool, tenantId, assetId, storageKey, publicDir }) {
  const filePath = path.join(publicDir, storageKey);
  const buffer = await readFile(filePath);
  if (buffer.length > MAX_INDEX_BYTES) {
    throw new Error(`EPUB index skipped: ${buffer.length} bytes exceeds ${MAX_INDEX_BYTES}`);
  }
  const zip = await JSZip.loadAsync(buffer);
  const containerEntry = zip.file('META-INF/container.xml');
  if (!containerEntry) throw new Error('EPUB container.xml missing');
  const container = await containerEntry.async('string');
  const opfPath = container.match(/full-path=["']([^"']+)["']/i)?.[1];
  if (!opfPath) throw new Error('EPUB package path missing');
  const opfEntry = zip.file(opfPath);
  if (!opfEntry) throw new Error(`EPUB package missing: ${opfPath}`);
  const opf = await opfEntry.async('string');
  const opfDir = path.posix.dirname(opfPath);
  const attr = (tag, name) => tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`, 'i'))?.[1] || '';
  const manifest = new Map();
  for (const match of opf.matchAll(/<item\b[^>]*>/gi)) {
    const id = attr(match[0], 'id');
    const href = attr(match[0], 'href');
    if (id && href) manifest.set(id, href);
  }
  const spine = [...opf.matchAll(/<itemref\b[^>]*>/gi)]
    .map((match) => attr(match[0], 'idref'))
    .filter((id) => manifest.has(id));

  const pages = [];
  for (let spineIndex = 0; spineIndex < spine.length; spineIndex += 1) {
    const id = spine[spineIndex];
    const href = decodeURIComponent(manifest.get(id).split('#')[0]);
    const fullPath = path.posix.normalize(path.posix.join(opfDir, href));
    const entry = zip.file(fullPath);
    if (!entry) continue;
    const text = stripXhtml(await entry.async('string'));
    if (!text) continue;
    pages.push({ pageNumber: spineIndex + 1, text, search: normalize(text), source: 'epub', locator: href });
  }
  if (!pages.length) throw new Error('EPUB has no indexable spine text');

  const client = await pool.connect();
  try {
    await client.query("select set_config('app.tenant_id', $1, false)", [tenantId]);
    await client.query('begin');
    try {
      await client.query('delete from asset_pages where asset_id = $1', [assetId]);
      await flushPages(client, assetId, tenantId, pages);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    }
  } finally {
    client.release();
  }
  console.log(`[index] ${assetId}: ${pages.length} EPUB chapters indexed`);
  return pages.length;
}

function stripXhtml(html) {
  const source = String(html || '');
  const body = source.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || source;
  return decodeEntities(body
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code))))
    .replace(/\s+/g, ' ')
    .trim();
}

export async function indexAll({ pool, tenantId, publicDir, force = false }) {
  const client = await pool.connect();
  let rows = [];
  try {
    await client.query("select set_config('app.tenant_id', $1, false)", [tenantId]);
    const condition = force
      ? 'true'
      : `(not exists (select 1 from asset_pages p where p.asset_id = a.id)
           or (a.page_count is not null
               and (select count(*) from asset_pages p where p.asset_id = a.id) < a.page_count))`;
    ({ rows } = await client.query(
      `select a.id, a.storage_key, a.tenant_id
         from assets a
        where a.format in ('pdf', 'epub')
          and ${condition}
        order by a.created_at`,
    ));
  } finally {
    client.release();
  }
  console.log(`[index] ${rows.length} asset(s) need indexing`);
  for (const row of rows) {
    try {
      await indexAsset({
        pool,
        tenantId: row.tenant_id || tenantId,
        assetId: row.id,
        storageKey: row.storage_key,
        publicDir,
      });
    } catch (error) {
      console.error(`[index] ${row.id}: ${error.message}`);
    }
  }
  return rows.length;
}
