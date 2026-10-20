import http from 'node:http';
import path from 'node:path';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, readFile, readdir, stat, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import Busboy from 'busboy';
import { PDFDocument } from 'pdf-lib';
import { indexAsset } from './indexer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'uploads');
const PORT = Number(process.env.PORT || 3000);
const TENANT_ID = process.env.DEMO_TENANT_ID || '11111111-1111-1111-1111-111111111111';
const USER_ID = process.env.DEMO_USER_ID || '22222222-2222-2222-2222-222222222222';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
};

const demoBooks = [
  {
    id: '33333333-3333-3333-3333-333333333333',
    title: 'Diş Hekimliğinde İmplant Komplikasyonları',
    subtitle: 'Klinik değerlendirme ve yönetim',
    language: 'tr',
    abstract:
      'İmplant tedavisinde karşılaşılan komplikasyonların sınıflandırılması, tanısı ve yönetimi. Vaka temelli bir yaklaşım.',
    subjects: ['Diş Hekimliği', 'Implantoloji'],
    publisher: 'Demo Akademik Yayıncılık',
    publication_year: 2026,
    asset_id: '55555555-5555-5555-5555-555555555555',
    storage_key: 'seed/sample.pdf',
    page_count: 6,
  },
];

const demoAnnotations = [];
const demoProgress = new Map();
const demoHashes = new Set();

let pool = null;
if (process.env.DATABASE_URL) {
  try {
    const pg = await import('pg');
    pool = new pg.default.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
    console.log('[db] PostgreSQL pool created');
  } catch (error) {
    console.warn('[db] pg unavailable, falling back to demo mode:', error.message);
  }
} else {
  console.log('[db] DATABASE_URL not set, demo mode');
}

async function withTenant(fn) {
  const client = await pool.connect();
  try {
    await client.query("select set_config('app.tenant_id', $1, false)", [TENANT_ID]);
    return await fn(client);
  } finally {
    client.release();
  }
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(payload);
}

function normalizeText(value) {
  return String(value || '').toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim();
}

async function readJson(req, limit = 1_000_000) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('payload too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function listBooks() {
  if (!pool) return demoBooks;
  return withTenant(async (client) => {
    const { rows } = await client.query(
      `select w.id, w.title, w.subtitle, w.language, w.abstract, w.subjects,
              e.publisher, e.publication_year,
              a.id as asset_id, a.storage_key, a.page_count
         from works w
         join editions e on e.work_id = w.id
         join assets a on a.edition_id = e.id
        where (w.tenant_id is null or w.tenant_id = $1)
        order by w.created_at desc`,
      [TENANT_ID],
    );
    return rows;
  });
}

async function getBook(id) {
  if (!pool) return findBook(id) || null;
  return withTenant(async (client) => {
    const { rows } = await client.query(
      `select w.id, w.title, w.subtitle, w.language, w.abstract, w.subjects,
              e.publisher, e.publication_year,
              a.id as asset_id, a.storage_key, a.page_count
         from works w
         join editions e on e.work_id = w.id
         join assets a on a.edition_id = e.id
        where (w.id = $1 or a.id = $1)
          and (w.tenant_id is null or w.tenant_id = $2)
        limit 1`,
      [id, TENANT_ID],
    );
    return rows[0] || null;
  });
}

async function updateBook(id, body) {
  if (!pool) {
    const book = findBook(id);
    if (!book) return null;
    if (body.title !== undefined) book.title = String(body.title).trim();
    if (body.subtitle !== undefined) book.subtitle = body.subtitle ? String(body.subtitle).trim() : null;
    if (body.language !== undefined) book.language = String(body.language).toLowerCase();
    if (body.publisher !== undefined) book.publisher = body.publisher || null;
    if (body.year !== undefined) book.publication_year = Number(body.year);
    if (body.subjects !== undefined) book.subjects = Array.isArray(body.subjects) ? body.subjects : [];
    return book;
  }

  return withTenant(async (client) => {
    const workSets = [];
    const workValues = [];
    let workIndex = 1;
    const addWork = (column, value) => {
      workSets.push(`${column} = $${workIndex}`);
      workValues.push(value);
      workIndex += 1;
    };

    if (body.title !== undefined) addWork('title', String(body.title).trim());
    if (body.subtitle !== undefined) addWork('subtitle', body.subtitle ? String(body.subtitle).trim() : null);
    if (body.language !== undefined) addWork('language', String(body.language).toLowerCase());
    if (body.subjects !== undefined) {
      addWork('subjects', Array.isArray(body.subjects)
        ? body.subjects
        : String(body.subjects).split(/[;,]/).map((item) => item.trim()).filter(Boolean));
    }

    if (workSets.length) {
      workValues.push(id, TENANT_ID);
      await client.query(
        `update works set ${workSets.join(', ')}
          where id = $${workIndex} and tenant_id = $${workIndex + 1}`,
        workValues,
      );
    }

    const editionSets = [];
    const editionValues = [];
    let editionIndex = 1;
    if (body.publisher !== undefined) {
      editionSets.push(`publisher = $${editionIndex}`);
      editionValues.push(body.publisher || null);
      editionIndex += 1;
    }
    if (body.year !== undefined) {
      editionSets.push(`publication_year = $${editionIndex}`);
      editionValues.push(Number(body.year));
      editionIndex += 1;
    }
    if (editionSets.length) {
      editionValues.push(id, TENANT_ID);
      await client.query(
        `update editions set ${editionSets.join(', ')}
          where work_id = $${editionIndex} and tenant_id = $${editionIndex + 1}`,
        editionValues,
      );
    }

    const { rows } = await client.query(
      `select w.id, w.title, w.subtitle, w.language, w.abstract, w.subjects,
              e.publisher, e.publication_year,
              a.id as asset_id, a.storage_key, a.page_count
         from works w
         join editions e on e.work_id = w.id
         join assets a on a.edition_id = e.id
        where (w.id = $1 or a.id = $1)
          and (w.tenant_id is null or w.tenant_id = $2)
        limit 1`,
      [id, TENANT_ID],
    );
    return rows[0] || null;
  });
}

async function deleteAnnotation(id) {
  if (!pool) {
    const index = demoAnnotations.findIndex((item) => item.id === id);
    if (index >= 0) demoAnnotations.splice(index, 1);
    return index >= 0;
  }
  return withTenant(async (client) => {
    const result = await client.query(
      'delete from annotations where id = $1 and user_id = $2 returning id',
      [id, USER_ID],
    );
    return result.rowCount > 0;
  });
}

async function searchBooks(query) {  const q = String(query || '').trim();
  if (!q) return listBooks();
  if (!pool) {
    const lower = q.toLocaleLowerCase('tr');
    return demoBooks.filter((book) =>
      [book.title, book.subtitle, book.abstract, ...(book.subjects || [])]
        .join(' ')
        .toLocaleLowerCase('tr')
        .includes(lower),
    );
  }
  return withTenant(async (client) => {
    const { rows } = await client.query(
      `select w.id, w.title, w.subtitle, w.language, w.abstract, w.subjects,
              e.publisher, e.publication_year,
              a.id as asset_id, a.storage_key, a.page_count,
              ts_rank(a.search_vector, websearch_to_tsquery('turkish', $2)) as rank
         from works w
         join editions e on e.work_id = w.id
         join assets a on a.edition_id = e.id
        where (w.tenant_id is null or w.tenant_id = $1)
          and (
            w.title ilike '%' || $2 || '%'
            or coalesce(w.abstract, '') ilike '%' || $2 || '%'
            or a.search_vector @@ websearch_to_tsquery('turkish', $2)
          )
        order by rank desc nulls last, w.created_at desc
        limit 50`,
      [TENANT_ID, q],
    );
    return rows;
  });
}

async function listAnnotations(assetId) {
  if (!pool) return demoAnnotations.filter((item) => item.asset_id === assetId);
  return withTenant(async (client) => {
    const { rows } = await client.query(
      `select id, asset_id, anchor, color, note, selected_text, status, created_at
         from annotations
        where asset_id = $1 and user_id = $2
        order by created_at asc`,
      [assetId, USER_ID],
    );
    return rows;
  });
}

async function createAnnotation(body) {
  const anchor = body.anchor;
  if (!anchor || typeof anchor !== 'object') throw new Error('anchor is required');
  if (!body.assetId) throw new Error('assetId is required');
  if (!pool) {
    const row = {
      id: randomUUID(),
      asset_id: body.assetId,
      anchor,
      color: body.color || 'yellow',
      note: body.note || null,
      selected_text: body.selectedText || null,
      status: 'active',
      created_at: new Date().toISOString(),
    };
    demoAnnotations.push(row);
    return row;
  }
  return withTenant(async (client) => {
    const { rows } = await client.query(
      `insert into annotations (tenant_id, user_id, asset_id, anchor, color, note, selected_text)
       values ($1, $2, $3, $4::jsonb, $5, $6, $7)
       returning id, asset_id, anchor, color, note, selected_text, status, created_at`,
      [TENANT_ID, USER_ID, body.assetId, JSON.stringify(anchor), body.color || 'yellow', body.note || null, body.selectedText || null],
    );
    return rows[0];
  });
}

async function getProgress(assetId) {
  if (!pool) return demoProgress.get(assetId) || null;
  return withTenant(async (client) => {
    const { rows } = await client.query(
      `select asset_id, anchor, percent, updated_at
         from reading_progress
        where asset_id = $1 and user_id = $2`,
      [assetId, USER_ID],
    );
    return rows[0] || null;
  });
}

async function saveProgress(body) {
  if (!body.assetId || !body.anchor) throw new Error('assetId and anchor are required');
  const row = {
    asset_id: body.assetId,
    anchor: body.anchor,
    percent: Number(body.percent || 0),
    updated_at: new Date().toISOString(),
  };
  if (!pool) {
    demoProgress.set(body.assetId, row);
    return row;
  }
  return withTenant(async (client) => {
    const { rows } = await client.query(
      `insert into reading_progress (tenant_id, user_id, asset_id, anchor, percent, updated_at)
       values ($1, $2, $3, $4::jsonb, $5, now())
       on conflict (user_id, asset_id)
       do update set anchor = excluded.anchor, percent = excluded.percent, updated_at = now()
       returning asset_id, anchor, percent, updated_at`,
      [TENANT_ID, USER_ID, body.assetId, JSON.stringify(body.anchor), Number(body.percent || 0)],
    );
    return rows[0];
  });
}

function findBook(id) {
  return demoBooks.find((book) => book.id === id || book.asset_id === id);
}

async function resolveStorageKey(id) {
  if (!pool) return findBook(id)?.storage_key || null;
  return withTenant(async (client) => {
    const { rows } = await client.query(
      `select a.storage_key
         from assets a
         join editions e on e.id = a.edition_id
         join works w on w.id = e.work_id
        where (w.id = $1 or a.id = $1)
          and (w.tenant_id is null or w.tenant_id = $2)
        limit 1`,
      [id, TENANT_ID],
    );
    return rows[0]?.storage_key || null;
  });
}

async function listOcrPages(assetId) {
  const dir = path.join(PUBLIC_DIR, 'ocr', assetId);
  try {
    const files = await readdir(dir);
    return files
      .map((name) => /^page-(\d{3})\.hocr$/.exec(name))
      .filter(Boolean)
      .map((match) => Number(match[1]))
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}

async function handleUpload(req) {
  const MAX_BYTES = 1024 * 1024 * 1024;
  const fields = {};
  let fileMeta = null;
  let writePromise = null;

  const busboy = Busboy({
    headers: req.headers,
    limits: { fileSize: MAX_BYTES, files: 1, fields: 30 },
  });

  busboy.on('field', (name, value) => {
    fields[name] = value;
  });

  busboy.on('file', (name, file, info) => {
    if (fileMeta) {
      file.resume();
      return;
    }
    const id = randomUUID();
    const storageKey = `uploads/${id}.pdf`;
    const destination = path.join(PUBLIC_DIR, storageKey);
    const hash = createHash('sha256');
    let bytes = 0;
    let truncated = false;
    file.on('data', (chunk) => {
      hash.update(chunk);
      bytes += chunk.length;
    });
    file.on('limit', () => {
      truncated = true;
    });

    const stream = createWriteStream(destination);
    file.pipe(stream);
    fileMeta = {
      id,
      storageKey,
      destination,
      filename: info.filename || 'upload.pdf',
      mimeType: info.mimeType,
      truncated: () => truncated,
    };
    writePromise = new Promise((resolve, reject) => {
      stream.on('finish', resolve);
      stream.on('error', reject);
      file.on('error', reject);
    }).then(() => {
      fileMeta.sha256 = hash.digest('hex');
      fileMeta.size = bytes;
    });
  });

  const parsed = new Promise((resolve, reject) => {
    busboy.on('close', resolve);
    busboy.on('error', reject);
    req.on('error', reject);
  });

  req.pipe(busboy);
  await parsed;
  if (writePromise) await writePromise;

  if (!fileMeta) throw new Error('PDF file is required');
  if (fileMeta.truncated()) {
    await unlink(fileMeta.destination).catch(() => {});
    throw new Error('file too large');
  }
  if (fileMeta.size < 5) {
    await unlink(fileMeta.destination).catch(() => {});
    throw new Error('empty file');
  }

  const handle = await open(fileMeta.destination, 'r');
  const magic = Buffer.alloc(5);
  await handle.read(magic, 0, 5, 0);
  await handle.close();
  if (magic.toString('latin1') !== '%PDF-') {
    await unlink(fileMeta.destination).catch(() => {});
    throw new Error('not a PDF');
  }

  let pageCount = null;
  if (fileMeta.size <= 150 * 1024 * 1024) {
    try {
      const buffer = await readFile(fileMeta.destination);
      const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
      pageCount = pdf.getPageCount();
    } catch (error) {
      console.warn('[upload] page count failed:', error.message);
    }
  }

  const title = String(fields.title || path.basename(fileMeta.filename, path.extname(fileMeta.filename))).trim() || 'Adsız';
  const subtitle = fields.subtitle ? String(fields.subtitle).trim() : null;
  const language = fields.language === 'en' ? 'en' : 'tr';
  const publisher = fields.publisher ? String(fields.publisher).trim() : null;
  const year = fields.year ? Number(fields.year) : null;
  const subjects = String(fields.subjects || '')
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (!pool) {
    if (demoHashes.has(fileMeta.sha256)) {
      await unlink(fileMeta.destination).catch(() => {});
      throw new Error('already uploaded');
    }
    const assetId = randomUUID();
    const workId = randomUUID();
    demoHashes.add(fileMeta.sha256);
    const book = {
      id: workId,
      title,
      subtitle,
      language,
      abstract: null,
      subjects,
      publisher,
      publication_year: year,
      asset_id: assetId,
      storage_key: fileMeta.storageKey,
      page_count: pageCount,
    };
    demoBooks.unshift(book);
    return book;
  }

  try {
    const book = await withTenant(async (client) => {
      const duplicate = await client.query(
        "select id from assets where source_system = 'upload' and source_id = $1 limit 1",
        [fileMeta.sha256],
      );
      if (duplicate.rowCount > 0) throw new Error('already uploaded');

      await client.query('begin');
      try {
        const work = await client.query(
          `insert into works (tenant_id, content_type, title, subtitle, language, abstract, subjects, metadata)
           values ($1, 'monograph', $2, $3, $4, null, $5, $6::jsonb)
           returning id`,
          [TENANT_ID, title, subtitle, language, subjects, JSON.stringify({ uploaded: true })],
        );
        const edition = await client.query(
          `insert into editions (tenant_id, work_id, publisher, publication_year, license_note, rights_note)
           values ($1, $2, $3, $4, $5, $6)
           returning id`,
          [
            TENANT_ID,
            work.rows[0].id,
            publisher,
            Number.isFinite(year) ? year : null,
            'Uploaded by operator; rights confirmed.',
            'Local scaffold upload.',
          ],
        );
        const asset = await client.query(
          `insert into assets
             (tenant_id, edition_id, format, storage_key, page_count, quality_score,
              source_system, source_id, source_checksum, harvested_at, access_status)
           values ($1, $2, 'pdf', $3, $4, null, 'upload', $5, $5, now(), 'open')
           returning id`,
          [TENANT_ID, edition.rows[0].id, fileMeta.storageKey, pageCount, fileMeta.sha256],
        );
        await client.query('commit');
        return { workId: work.rows[0].id, assetId: asset.rows[0].id };
      } catch (error) {
        await client.query('rollback').catch(() => {});
        throw error;
      }
    });

    const saved = await getBook(book.workId);
    if (!saved) throw new Error('book insert failed');
    void indexAsset({
      pool,
      tenantId: TENANT_ID,
      assetId: saved.asset_id,
      storageKey: fileMeta.storageKey,
      publicDir: PUBLIC_DIR,
    }).catch((error) => console.warn('[index] upload indexing failed:', error.message));
    return saved;
  } catch (error) {
    await unlink(fileMeta.destination).catch(() => {});
    throw error;
  }
}

async function servePdf(req, res, storageKey) {
  const safePath = path.resolve(PUBLIC_DIR, storageKey);
  if (!safePath.startsWith(PUBLIC_DIR + path.sep)) {
    json(res, 403, { error: 'forbidden' });
    return;
  }
  let info;
  try {
    info = await stat(safePath);
  } catch {
    json(res, 404, { error: 'file not found' });
    return;
  }
  const range = req.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      res.writeHead(416, { 'content-range': `bytes */${info.size}` });
      res.end();
      return;
    }
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1;
    if (start > end || start >= info.size) {
      res.writeHead(416, { 'content-range': `bytes */${info.size}` });
      res.end();
      return;
    }
    res.writeHead(206, {
      'content-type': 'application/pdf',
      'content-length': end - start + 1,
      'content-range': `bytes ${start}-${end}/${info.size}`,
      'accept-ranges': 'bytes',
      'cache-control': 'private, max-age=0',
    });
    createReadStream(safePath, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, {
    'content-type': 'application/pdf',
    'content-length': info.size,
    'accept-ranges': 'bytes',
    'cache-control': 'private, max-age=0',
  });
  createReadStream(safePath).pipe(res);
}

async function serveStatic(req, res, pathname) {
  const relative = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.resolve(PUBLIC_DIR, '.' + relative);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    json(res, 403, { error: 'forbidden' });
    return;
  }
  let info;
  try {
    info = await stat(filePath);
  } catch {
    json(res, 404, { error: 'not found' });
    return;
  }
  if (!info.isFile()) {
    json(res, 404, { error: 'not found' });
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const noCache = ['.html', '.js', '.mjs', '.css', '.hocr'].includes(ext);
  res.writeHead(200, {
    'content-type': MIME[ext] || 'application/octet-stream',
    'content-length': info.size,
    'cache-control': ext === '.pdf' ? 'private, max-age=0' : (noCache ? 'no-cache' : 'public, max-age=3600'),
  });
  createReadStream(filePath).pipe(res);
}

await mkdir(UPLOAD_DIR, { recursive: true });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);

  try {
    if (pathname === '/api/health') {
      json(res, 200, { ok: true, mode: pool ? 'db' : 'demo', tenantId: TENANT_ID });
      return;
    }
    if (pathname.startsWith('/api/ocr/') && req.method === 'GET') {
      const assetId = pathname.slice('/api/ocr/'.length);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(assetId)) {
        json(res, 400, { error: 'invalid asset id' });
        return;
      }
      json(res, 200, { assetId, pages: await listOcrPages(assetId) });
      return;
    }
    const searchMatch = pathname.match(/^\/api\/books\/([^/]+)\/search$/);
    if (searchMatch && req.method === 'GET') {
      const bookId = decodeURIComponent(searchMatch[1]);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bookId)) {
        json(res, 400, { error: 'invalid book id' });
        return;
      }
      const book = await getBook(bookId);
      if (!book) {
        json(res, 404, { error: 'book not found' });
        return;
      }
      const query = normalizeText(url.searchParams.get('q') || '');
      if (!pool || !query) {
        json(res, 200, { indexed: false, results: [] });
        return;
      }
      try {
        const data = await withTenant(async (client) => {
          const { rows } = await client.query(
            `select page_no, text_content, text_search, source
               from asset_pages
              where asset_id = $1 and position($2 in text_search) > 0
              order by page_no
              limit 100`,
            [book.asset_id, query],
          );
          const indexed = rows.length > 0 || (await client.query(
            'select exists(select 1 from asset_pages where asset_id = $1) as present',
            [book.asset_id],
          )).rows[0].present;
          return { indexed, rows };
        });

        const results = data.rows.map((row) => {
          const index = row.text_search.indexOf(query);
          const start = Math.max(0, index - 45);
          const end = Math.min(row.text_content.length, index + query.length + 45);
          return {
            page: row.page_no,
            snippet: `${start > 0 ? '…' : ''}${row.text_content.slice(start, end)}${end < row.text_content.length ? '…' : ''}`,
            source: row.source,
          };
        });
        json(res, 200, { indexed: data.indexed, results });
      } catch (error) {
        console.warn('[search] index unavailable:', error.message);
        json(res, 200, { indexed: false, results: [] });
      }
      return;
    }
    if (pathname === '/api/upload' && req.method === 'POST') {
      const book = await handleUpload(req);
      json(res, 201, book);
      return;
    }
    if (pathname === '/api/books' && req.method === 'GET') {
      json(res, 200, await listBooks());
      return;
    }
    if (pathname.startsWith('/api/books/') && req.method === 'PATCH') {
      const id = pathname.slice('/api/books/'.length);
      const book = await updateBook(id, await readJson(req));
      if (!book) {
        json(res, 404, { error: 'book not found' });
        return;
      }
      json(res, 200, book);
      return;
    }
    if (pathname === '/api/search' && req.method === 'GET') {
      json(res, 200, await searchBooks(url.searchParams.get('q')));
      return;
    }
    if (pathname.startsWith('/api/books/') && pathname.endsWith('/file') && req.method === 'GET') {
      const id = pathname.slice('/api/books/'.length, -'/file'.length);
      const storageKey = await resolveStorageKey(id);
      if (!storageKey) {
        json(res, 404, { error: 'book not found' });
        return;
      }
      await servePdf(req, res, storageKey);
      return;
    }
    if (pathname === '/api/annotations' && req.method === 'GET') {
      json(res, 200, await listAnnotations(url.searchParams.get('assetId')));
      return;
    }
    if (pathname === '/api/annotations' && req.method === 'POST') {
      json(res, 201, await createAnnotation(await readJson(req)));
      return;
    }
    if (pathname.startsWith('/api/annotations/') && req.method === 'DELETE') {
      const id = pathname.slice('/api/annotations/'.length);
      const removed = await deleteAnnotation(id);
      json(res, removed ? 200 : 404, { ok: removed });
      return;
    }
    if (pathname === '/api/progress' && req.method === 'GET') {
      json(res, 200, await getProgress(url.searchParams.get('assetId')));
      return;
    }
    if (pathname === '/api/progress' && req.method === 'POST') {
      json(res, 200, await saveProgress(await readJson(req)));
      return;
    }
    if (pathname.startsWith('/api/')) {
      json(res, 404, { error: 'api route not found' });
      return;
    }
    await serveStatic(req, res, pathname);
  } catch (error) {
    console.error('[request]', error);
    const status = error.message === 'already uploaded' ? 409
      : error.message === 'file too large' ? 413
        : /PDF|empty|required/.test(error.message || '') ? 400
          : 500;
    json(res, status, { error: error.message || 'internal error' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[web] http://localhost:${PORT} (${pool ? 'db' : 'demo'} mode)`);
});
