import http from 'node:http';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
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

async function searchBooks(query) {
  const q = String(query || '').trim();
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
  const noCache = ['.html', '.js', '.mjs', '.css'].includes(ext);
  res.writeHead(200, {
    'content-type': MIME[ext] || 'application/octet-stream',
    'content-length': info.size,
    'cache-control': ext === '.pdf' ? 'private, max-age=0' : (noCache ? 'no-cache' : 'public, max-age=3600'),
  });
  createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);

  try {
    if (pathname === '/api/health') {
      json(res, 200, { ok: true, mode: pool ? 'db' : 'demo', tenantId: TENANT_ID });
      return;
    }
    if (pathname === '/api/books' && req.method === 'GET') {
      json(res, 200, await listBooks());
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
    json(res, 500, { error: error.message || 'internal error' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[web] http://localhost:${PORT} (${pool ? 'db' : 'demo'} mode)`);
});
