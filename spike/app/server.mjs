import http from 'node:http';
import path from 'node:path';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, readFile, readdir, rename, stat, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import Busboy from 'busboy';
import JSZip from 'jszip';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import { indexAsset } from './indexer.mjs';
import {
  buildSnippet,
  catalogMatches,
  findSnippetAnchor,
  foldSearch,
  foldWords,
  normalizeSearch,
} from './public/search.mjs';

function chapterNumberFromHref(href) {
  const base = decodeURIComponent(String(href || '').split('/').pop() || '');
  const match = base.match(/chapter[\s_-]*(\d+)/i);
  return match ? Number(match[1]) : null;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'uploads');
const PORT = Number(process.env.PORT || 3000);
const TENANT_ID = process.env.DEMO_TENANT_ID || '11111111-1111-1111-1111-111111111111';
const USER_ID = process.env.DEMO_USER_ID || '22222222-2222-2222-2222-222222222222';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-only-session-secret-change-me';
const SESSION_COOKIE = 'akademik_session';
const CSRF_COOKIE = 'akademik_csrf';
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;
const loginAttempts = new Map();
const demoSessions = new Map();
const DEMO_EMAIL = process.env.DEMO_EMAIL || 'reader@example.edu.tr';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'demo1234';
const BRAND_NAME = process.env.BRAND_NAME || 'Akademik Platform';
const BRAND_TAGLINE = process.env.BRAND_TAGLINE || 'spike';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.pdf': 'application/pdf',
  '.epub': 'application/epub+zip',
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
const demoGrants = [];
const demoGrantAudit = [];
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

// Search needs a transaction so pg_trgm's word-similarity threshold stays local.
async function withTenantSearch(fn) {
  const client = await pool.connect();
  try {
    await client.query("select set_config('app.tenant_id', $1, false)", [TENANT_ID]);
    await client.query('begin');
    await client.query("select set_config('pg_trgm.word_similarity_threshold', '0.35', true)");
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
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

function canManage(role) {
  return role === 'admin' || role === 'librarian' || role === 'publisher';
}

function parseAuthors(value) {
  const items = Array.isArray(value) ? value : String(value || '').split(';');  return items.map((item) => {
    if (item && typeof item === 'object') {
      return {
        family: String(item.family || item.last || '').trim(),
        given: String(item.given || item.first || '').trim(),
      };
    }
    const text = String(item || '').trim();
    if (!text) return null;
    if (text.includes(',')) {
      const [family, ...given] = text.split(',');
      return { family: family.trim(), given: given.join(',').trim() };
    }
    const parts = text.split(/\s+/);
    return { family: parts.pop(), given: parts.join(' ') };
  }).filter((author) => author && author.family);
}

function parseCookies(header) {
  const cookies = {};
  String(header || '').split(';').forEach((part) => {
    const index = part.indexOf('=');
    if (index < 0) return;
    cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  });
  return cookies;
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  return String(forwarded ? forwarded.split(',')[0] : req.socket.remoteAddress || 'unknown').trim();
}

function isSecureRequest(req) {
  return req.headers['x-forwarded-proto'] === 'https' || Boolean(req.socket.encrypted);
}

function loginRateStatus(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry) return 0;
  if (entry.reset <= now) {
    loginAttempts.delete(ip);
    return 0;
  }
  return entry.count >= LOGIN_MAX_ATTEMPTS ? Math.ceil((entry.reset - now) / 1000) : 0;
}

function recordLoginFailure(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || entry.reset <= now) {
    loginAttempts.set(ip, { count: 1, reset: now + LOGIN_WINDOW });
    return;
  }
  entry.count += 1;
  if (entry.count >= LOGIN_MAX_ATTEMPTS) entry.reset = now + LOGIN_WINDOW;
}

function clearLoginFailures(ip) {
  loginAttempts.delete(ip);
}

function requireCsrf(req, auth) {
  const header = req.headers['x-csrf-token'];
  const cookie = parseCookies(req.headers.cookie)[CSRF_COOKIE];
  return Boolean(auth.csrf && header && cookie && header === auth.csrf && cookie === auth.csrf);
}

function signSession(user) {
  const payload = {
    sub: user.id,
    tenant: user.tenant_id || TENANT_ID,
    email: user.email,
    name: user.display_name || user.email,
    role: user.role || 'reader',
    ver: Number(user.session_version || 0),
    sid: user.session_id,
    csrf: user.csrf,
    exp: Date.now() + SESSION_TTL,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function readSession(req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;
  const expected = createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  if (signature.length !== expected.length
    || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.sub || !payload.exp || payload.exp < Date.now()) return null;
    return {
      userId: payload.sub,
      tenantId: payload.tenant,
      email: payload.email,
      displayName: payload.name,
      role: payload.role,
      sessionVersion: Number(payload.ver || 0),
      sessionId: payload.sid,
      csrf: payload.csrf,
    };
  } catch {
    return null;
  }
}

function setSessionCookie(res, user, secure = false) {
  const maxAge = Math.floor(SESSION_TTL / 1000);
  const secureFlag = secure ? ' Secure;' : '';
  const session = encodeURIComponent(signSession(user));
  res.setHeader('set-cookie', [
    `${SESSION_COOKIE}=${session}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge};${secureFlag}`,
    `${CSRF_COOKIE}=${encodeURIComponent(user.csrf)}; SameSite=Lax; Path=/; Max-Age=${maxAge};${secureFlag}`,
  ]);
}

function clearSessionCookie(res, secure = false) {
  const secureFlag = secure ? ' Secure;' : '';
  res.setHeader('set-cookie', [
    `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0;${secureFlag}`,
    `${CSRF_COOKIE}=; SameSite=Lax; Path=/; Max-Age=0;${secureFlag}`,
  ]);
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  const [scheme, salt, hash] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const candidate = scryptSync(String(password), salt, expected.length);
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

function sessionLimitError(max, code = 'SESSION_LIMIT') {
  const error = new Error(code === 'TENANT_SEAT_LIMIT' ? 'tenant seat limit reached' : 'session limit reached');
  error.code = code;
  error.limit = max;
  return error;
}

async function createSession(user, req) {
  const max = Number(user.max_sessions || 3);
  const id = randomUUID();
  if (!pool) {
    const sessions = demoSessions.get(user.id) || [];
    if (sessions.length >= max) throw sessionLimitError(max);
    sessions.push(id);
    demoSessions.set(user.id, sessions);
    return id;
  }
  return withTenant(async (client) => {
    await client.query('begin');
    try {
      // Serialize concurrent logins for the same user so two requests cannot
      // both pass the count check.
      await client.query('select pg_advisory_xact_lock(hashtext($1::text))', [user.id]);
      await client.query(
        "delete from user_sessions where user_id = $1 and last_seen_at < now() - interval '7 days'",
        [user.id],
      );
      const { rows } = await client.query(
        `select count(*)::int as count
           from user_sessions
          where user_id = $1
            and last_seen_at >= now() - interval '2 hours'`,
        [user.id],
      );
      if (rows[0].count >= max) throw sessionLimitError(max);
      const { rows: grantRows } = await client.query(
        `select seat_limit
           from grants
          where tenant_id = $1
            and status = 'active'
            and valid_from <= now()
            and (valid_to is null or valid_to > now())
            and ((subject_type = 'tenant' and subject_id = $1)
              or (subject_type = 'user' and subject_id = $2))`,
        [user.tenant_id || TENANT_ID, user.id],
      );
      const seatLimit = tenantSeatLimit(grantRows);
      if (seatLimit) {
        const { rows: tenantRows } = await client.query(
          `select count(*)::int as count
             from user_sessions
            where tenant_id = $1
              and last_seen_at >= now() - interval '2 hours'`,
          [user.tenant_id || TENANT_ID],
        );
        if (tenantRows[0].count >= seatLimit) throw sessionLimitError(seatLimit, 'TENANT_SEAT_LIMIT');
      }
      await client.query(
        `insert into user_sessions (id, user_id, tenant_id, ip, user_agent)
         values ($1, $2, $3, $4, $5)`,
        [id, user.id, user.tenant_id || TENANT_ID, clientIp(req), String(req.headers['user-agent'] || '').slice(0, 300)],
      );
      await client.query('commit');
      return id;
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    }
  });
}

async function deleteSession(sessionId, userId) {
  if (!sessionId) return;
  if (!pool) {
    const sessions = demoSessions.get(userId) || [];
    demoSessions.set(userId, sessions.filter((id) => id !== sessionId));
    return;
  }
  await withTenant(async (client) => {
    await client.query(
      'delete from user_sessions where id = $1 and user_id = $2',
      [sessionId, userId],
    );
  });
}

async function deleteAllSessions(userId) {
  if (!pool) {
    demoSessions.delete(userId);
    return;
  }
  await withTenant(async (client) => {
    await client.query('delete from user_sessions where user_id = $1', [userId]);
  });
}

async function sessionIsValid(auth) {
  if (!auth.sessionId) return false;
  if (!pool) return (demoSessions.get(auth.userId) || []).includes(auth.sessionId);
  try {
    return await withTenant(async (client) => {
      const { rows } = await client.query(
        `select u.session_version, s.id
           from users u
           join user_sessions s on s.id = $2 and s.user_id = u.id
          where u.id = $1
          limit 1`,
        [auth.userId, auth.sessionId],
      );
      if (!rows[0] || Number(rows[0].session_version) !== auth.sessionVersion) return false;
      await client.query(
        'update user_sessions set last_seen_at = now() where id = $1',
        [auth.sessionId],
      );
      return true;
    });
  } catch (error) {
    console.warn('[auth] session check failed:', error.message);
    return false;
  }
}

async function loginUser(emailValue, passwordValue) {
  const email = String(emailValue || '').trim().toLocaleLowerCase('tr');
  const password = String(passwordValue || '');
  if (!email || !password) return null;

  if (!pool) {
    const isLibrarian = email === 'librarian@example.edu.tr';
    if (password === DEMO_PASSWORD && (email === DEMO_EMAIL || isLibrarian)) {
      return {
        id: isLibrarian ? '44444444-4444-4444-4444-444444444444' : USER_ID,
        tenant_id: TENANT_ID,
        email,
        display_name: isLibrarian ? 'Demo Kütüphaneci' : 'Demo Okuyucu',
        role: isLibrarian ? 'librarian' : 'reader',
        session_version: 0,
        max_sessions: 3,
      };
    }
    return null;
  }

  return withTenant(async (client) => {
    const { rows } = await client.query(
      `select id, tenant_id, email, display_name, role, password_hash, session_version, max_sessions
         from users
        where tenant_id = $1 and lower(email) = lower($2)
        limit 1`,
      [TENANT_ID, email],
    );
    const row = rows[0];
    if (!row || !verifyPassword(password, row.password_hash)) return null;
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      email: row.email,
      display_name: row.display_name,
      role: row.role,
      session_version: row.session_version,
      max_sessions: row.max_sessions,
    };
  });
}


function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

async function changePassword(userId, currentPassword, newPassword) {
  if (String(newPassword || '').length < 8) throw new Error('password too short');
  if (!pool) {
    if (String(currentPassword || '') !== DEMO_PASSWORD) return false;
    demoSessions.delete(userId);
    return true;
  }
  return withTenant(async (client) => {
    const { rows } = await client.query(
      'select password_hash from users where id = $1 limit 1',
      [userId],
    );
    if (!rows[0] || !verifyPassword(currentPassword, rows[0].password_hash)) return false;
    await client.query(
      'update users set password_hash = $1, session_version = session_version + 1 where id = $2',
      [hashPassword(newPassword), userId],
    );
    await client.query('delete from user_sessions where user_id = $1', [userId]);
    return true;
  });
}

async function revokeAllSessions(userId) {
  if (!pool) {
    demoSessions.delete(userId);
    return true;
  }
  return withTenant(async (client) => {
    await client.query(
      'update users set session_version = session_version + 1 where id = $1',
      [userId],
    );
    await client.query('delete from user_sessions where user_id = $1', [userId]);
    return true;
  });
}

function normalizeTags(value) {
  const items = Array.isArray(value) ? value : String(value || '').split(/[;,]/);
  return [...new Set(items.map((item) => String(item || '').trim()).filter(Boolean))].slice(0, 20);
}

function asBool(value, fallback = true) {
  if (value === undefined) return fallback;
  return value !== false && value !== 'false' && value !== 0 && value !== '0';
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

async function deleteUploadedBook(id) {
  if (!pool) {
    const index = demoBooks.findIndex((book) => book.id === id);
    if (index < 0) return { status: 'not_found', keys: [] };
    const [book] = demoBooks.splice(index, 1);
    if (book.sha256) demoHashes.delete(book.sha256);
    return { status: 'ok', keys: [book.storage_key] };
  }
  return withTenant(async (client) => {
    const { rows } = await client.query(
      `select a.storage_key, a.source_system
         from works w
         join editions e on e.work_id = w.id
         join assets a on a.edition_id = e.id
        where w.id = $1
        limit 50`,
      [id],
    );
    if (!rows.length) return { status: 'not_found', keys: [] };
    if (rows.some((row) => row.source_system !== 'upload')) {
      return { status: 'not_uploaded', keys: [] };
    }
    await client.query('delete from works where id = $1', [id]);
    return { status: 'ok', keys: rows.map((row) => row.storage_key).filter(Boolean) };
  });
}

function grantAllows(book, grants) {
  if (!grants.length) return true;
  const publisher = String(book.publisher || '').toLocaleLowerCase('tr');
  const subjects = (book.subjects || []).map((value) => String(value).toLocaleLowerCase('tr'));
  return grants.some((grant) => {
    if (grant.scope_type === 'all') return true;
    if (grant.scope_type === 'title') return String(grant.scope_id || '') === String(book.id);
    if (grant.scope_type === 'publisher') return String(grant.scope_key || '').toLocaleLowerCase('tr') === publisher;
    if (grant.scope_type === 'subject') return subjects.includes(String(grant.scope_key || '').toLocaleLowerCase('tr'));
    if (grant.scope_type === 'collection') {
      return (book.collection_ids || []).map(String).includes(String(grant.scope_id || ''));
    }
    return false;
  });
}

async function activeGrants(auth) {
  if (!auth) return [];
  if (!pool) {
    return demoGrants.filter((grant) => grant.status === 'active'
      && grant.tenant_id === TENANT_ID
      && ((grant.subject_type === 'tenant' && grant.subject_id === TENANT_ID)
        || (grant.subject_type === 'user' && grant.subject_id === auth.userId)));
  }
  try {
    const tenantId = auth.tenantId || TENANT_ID;
    return await withTenant(async (client) => {
      const { rows } = await client.query(
        `select id, subject_type, subject_id, scope_type, scope_id, scope_key, seat_limit
           from grants
          where tenant_id = $1
            and status = 'active'
            and valid_from <= now()
            and (valid_to is null or valid_to > now())
            and ((subject_type = 'tenant' and subject_id = $1)
              or (subject_type = 'user' and subject_id = $2))`,
        [tenantId, auth.userId || null],
      );
      return rows;
    });
  } catch (error) {
    console.warn('[grants] lookup failed:', error.message);
    return [];
  }
}

async function listGrants() {
  if (!pool) return demoGrants;
  return withTenant(async (client) => {
    const { rows } = await client.query(
      `select g.id, g.subject_type, g.subject_id, g.scope_type, g.scope_id, g.scope_key,
              g.seat_limit, g.source, g.status, g.valid_from, g.valid_to, g.created_at,
              u.email as subject_email
         from grants g
         left join users u on g.subject_type = 'user' and u.id = g.subject_id
        where g.tenant_id = $1
        order by g.created_at desc`,
      [TENANT_ID],
    );
    return rows;
  });
}

async function logGrantAudit(client, auth, grantId, action, detail) {
  if (!pool) {
    demoGrantAudit.unshift({
      id: randomUUID(), grant_id: grantId, action, actor_user_id: auth?.userId || null,
      detail, created_at: new Date().toISOString(),
    });
    return;
  }
  await client.query(
    `insert into grant_audit (tenant_id, grant_id, action, actor_user_id, detail)
     values ($1, $2, $3, $4, $5::jsonb)`,
    [TENANT_ID, grantId, action, auth?.userId || null, JSON.stringify(detail || {})],
  );
}

async function createGrant(body, auth) {
  const scopeType = ['all', 'publisher', 'subject', 'collection', 'title'].includes(body.scopeType)
    ? body.scopeType
    : null;
  if (!scopeType) throw new Error('invalid scope');
  const subjectType = body.subjectType === 'user' ? 'user' : 'tenant';
  let subjectId = TENANT_ID;
  if (subjectType === 'user') {
    const email = String(body.subjectEmail || '').trim().toLocaleLowerCase('tr');
    if (!email) throw new Error('user email required');
    if (!pool) {
      if (email !== 'reader@example.edu.tr' && email !== 'librarian@example.edu.tr') throw new Error('user not found');
      subjectId = email.startsWith('reader') ? USER_ID : '44444444-4444-4444-4444-444444444444';
    } else {
      const row = await withTenant(async (client) => {
        const { rows } = await client.query('select id from users where email = $1 limit 1', [email]);
        return rows[0];
      });
      if (!row) throw new Error('user not found');
      subjectId = row.id;
    }
  }
  const scopeId = ['title', 'collection'].includes(scopeType) ? (body.scopeId || null) : null;
  const scopeKey = ['publisher', 'subject'].includes(scopeType) ? String(body.scopeKey || '').trim() : null;
  if (['title', 'collection'].includes(scopeType) && !scopeId) throw new Error('scope id required');
  if (['publisher', 'subject'].includes(scopeType) && !scopeKey) throw new Error('scope key required');
  const seatLimit = Number(body.seatLimit);
  const grant = {
    id: randomUUID(),
    tenant_id: TENANT_ID,
    subject_type: subjectType,
    subject_id: subjectId,
    scope_type: scopeType,
    scope_id: scopeId,
    scope_key: scopeKey,
    seat_limit: Number.isFinite(seatLimit) && seatLimit > 0 ? seatLimit : null,
    source: ['subscription', 'trial', 'purchase', 'manual'].includes(body.source) ? body.source : 'manual',
    status: 'active',
    valid_to: body.validTo || null,
    created_at: new Date().toISOString(),
  };
  if (!pool) {
    demoGrants.unshift(grant);
    await logGrantAudit(null, auth, grant.id, 'create', {
      subjectType, scopeType, scopeKey, scopeId,
    });
    return grant;
  }
  return withTenant(async (client) => {
    const { rows } = await client.query(
      `insert into grants
         (tenant_id, subject_type, subject_id, scope_type, scope_id, scope_key,
          seat_limit, source, status, valid_to)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9)
       returning id, subject_type, subject_id, scope_type, scope_id, scope_key,
                 seat_limit, source, status, valid_from, valid_to, created_at`,
      [TENANT_ID, subjectType, subjectId, scopeType, scopeId, scopeKey, grant.seat_limit, grant.source, grant.valid_to],
    );
    await logGrantAudit(client, auth, rows[0].id, 'create', {
      subjectType, scopeType, scopeKey, scopeId,
    });
    return rows[0];
  });
}

async function deleteGrant(id, auth) {
  if (!pool) {
    const index = demoGrants.findIndex((grant) => grant.id === id);
    if (index < 0) return false;
    const [grant] = demoGrants.splice(index, 1);
    await logGrantAudit(null, auth, id, 'revoke', { scopeType: grant.scope_type });
    return true;
  }
  return withTenant(async (client) => {
    const { rows, rowCount } = await client.query(
      'delete from grants where id = $1 and tenant_id = $2 returning scope_type, scope_key, scope_id, subject_type, subject_id',
      [id, TENANT_ID],
    );
    if (rowCount > 0) await logGrantAudit(client, auth, id, 'revoke', rows[0] || {});
    return rowCount > 0;
  });
}

async function grantAuditLog(limit = 50) {
  if (!pool) return demoGrantAudit.slice(0, limit);
  return withTenant(async (client) => {
    const { rows } = await client.query(
      `select a.id, a.grant_id, a.action, a.actor_user_id, a.detail, a.created_at,
              u.email as actor_email
         from grant_audit a
         left join users u on u.id = a.actor_user_id
        where a.tenant_id = $1
        order by a.created_at desc
        limit $2`,
      [TENANT_ID, limit],
    );
    return rows;
  });
}

async function grantUsage() {
  if (!pool) {
    const seats = [...demoSessions.values()].reduce((total, list) => total + list.length, 0);
    const limits = demoGrants.map((grant) => Number(grant.seat_limit)).filter((value) => value > 0);
    return { activeSessions: seats, seatLimit: limits.length ? Math.min(...limits) : null };
  }
  return withTenant(async (client) => {
    const { rows: sessionRows } = await client.query(
      `select count(*)::int as count from user_sessions
        where tenant_id = $1 and last_seen_at >= now() - interval '2 hours'`,
      [TENANT_ID],
    );
    const { rows: grantRows } = await client.query(
      `select seat_limit from grants
        where tenant_id = $1 and status = 'active'
          and valid_from <= now() and (valid_to is null or valid_to > now())`,
      [TENANT_ID],
    );
    return { activeSessions: sessionRows[0].count, seatLimit: tenantSeatLimit(grantRows) };
  });
}

function tenantSeatLimit(grants) {
  const limits = grants.map((grant) => Number(grant.seat_limit)).filter((value) => Number.isFinite(value) && value > 0);
  return limits.length ? Math.min(...limits) : null;
}

async function canAccessBook(book, auth) {
  if (!book) return false;
  return grantAllows(book, await activeGrants(auth));
}

async function listBooks(auth) {
  if (!pool) {
    const grants = await activeGrants(auth);
    return demoBooks.filter((book) => grantAllows(book, grants));
  }
  const books = await withTenant(async (client) => {
    const { rows } = await client.query(
      `select w.id, w.title, w.subtitle, w.language, w.abstract, w.subjects, w.metadata,
              e.publisher, e.publication_year,
              (select array_agg(ci.collection_id::text)
                 from collection_items ci
                where ci.work_id = w.id) as collection_ids,
              a.id as asset_id, a.format, a.source_system, a.storage_key, a.page_count,
              a.allow_copy, a.allow_download, a.allow_print, a.watermark
         from works w
         join editions e on e.work_id = w.id
         join assets a on a.edition_id = e.id
        where (w.tenant_id is null or w.tenant_id = $1)
        order by w.created_at desc`,
      [TENANT_ID],
    );
    return rows;
  });
  const grants = await activeGrants(auth);
  return books.filter((book) => grantAllows(book, grants));
}

async function getBook(id) {
  if (!pool) return findBook(id) || null;
  return withTenant(async (client) => {
    const { rows } = await client.query(
      `select w.id, w.title, w.subtitle, w.language, w.abstract, w.subjects, w.metadata,
              e.publisher, e.publication_year,
              (select array_agg(ci.collection_id::text)
                 from collection_items ci
                where ci.work_id = w.id) as collection_ids,
              a.id as asset_id, a.format, a.source_system, a.storage_key, a.page_count,
              a.allow_copy, a.allow_download, a.allow_print, a.watermark
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
    if (body.authors !== undefined) {
      book.metadata = { ...(book.metadata || {}), authors: parseAuthors(body.authors) };
    }
    if (body.allow_copy !== undefined) book.allow_copy = asBool(body.allow_copy);
    if (body.allow_download !== undefined) book.allow_download = asBool(body.allow_download);
    if (body.allow_print !== undefined) book.allow_print = asBool(body.allow_print);
    if (body.watermark !== undefined) book.watermark = asBool(body.watermark);
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

    if (body.authors !== undefined) {
      await client.query(
        `update works
            set metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{authors}', $1::jsonb)
          where id = $2 and tenant_id = $3`,
        [JSON.stringify(parseAuthors(body.authors)), id, TENANT_ID],
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

    const assetSets = [];
    const assetValues = [];
    let assetIndex = 1;
    const addAsset = (column, value) => {
      assetSets.push(`${column} = $${assetIndex}`);
      assetValues.push(value);
      assetIndex += 1;
    };
    if (body.allow_copy !== undefined) addAsset('allow_copy', asBool(body.allow_copy));
    if (body.allow_download !== undefined) addAsset('allow_download', asBool(body.allow_download));
    if (body.allow_print !== undefined) addAsset('allow_print', asBool(body.allow_print));
    if (body.watermark !== undefined) addAsset('watermark', asBool(body.watermark));
    if (assetSets.length) {
      assetValues.push(id, TENANT_ID);
      await client.query(
        `update assets set ${assetSets.join(', ')}
          where edition_id in (
            select id from editions where work_id = $${assetIndex} and tenant_id = $${assetIndex + 1}
          )`,
        assetValues,
      );
    }

    const { rows } = await client.query(
      `select w.id, w.title, w.subtitle, w.language, w.abstract, w.subjects, w.metadata,
              e.publisher, e.publication_year,
              (select array_agg(ci.collection_id::text)
                 from collection_items ci
                where ci.work_id = w.id) as collection_ids,
              a.id as asset_id, a.format, a.source_system, a.storage_key, a.page_count,
              a.allow_copy, a.allow_download, a.allow_print, a.watermark
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

async function deleteAnnotation(id, userId) {
  if (!pool) {
    const index = demoAnnotations.findIndex((item) => item.id === id);
    if (index >= 0) demoAnnotations.splice(index, 1);
    return index >= 0;
  }
  return withTenant(async (client) => {
    const result = await client.query(
      'delete from annotations where id = $1 and user_id = $2 returning id',
      [id, userId],
    );
    return result.rowCount > 0;
  });
}

async function searchBooks(query, auth) {
  const q = String(query || '').trim();
  if (!q) return listBooks(auth);
  if (!pool) {
    const grants = await activeGrants(auth);
    return demoBooks.filter((book) =>
      grantAllows(book, grants)
      && catalogMatches([book.title, book.subtitle, book.abstract, ...(book.subjects || [])], q),
    );
  }
  const books = await withTenant(async (client) => {
    // Language-aware: use the work's own FTS dictionary, fold Turkish
    // diacritics for substring and trigram matching, and rank stem hits first.
    const { rows } = await client.query(
      `select w.id, w.title, w.subtitle, w.language, w.abstract, w.subjects, w.metadata,
              e.publisher, e.publication_year,
              (select array_agg(ci.collection_id::text)
                 from collection_items ci
                where ci.work_id = w.id) as collection_ids,
              a.id as asset_id, a.format, a.source_system, a.storage_key, a.page_count,
              a.allow_copy, a.allow_download, a.allow_print, a.watermark,
              ts_rank(ts.vector, ts.query) as rank,
              (folded.folded_text like '%' || q.folded || '%') as phrase_hit
         from works w
         join editions e on e.work_id = w.id
         join assets a on a.edition_id = e.id
         cross join lateral (
           select case
                    when lower(coalesce(w.language, 'tr')) like 'en%' then 'english'::regconfig
                    when lower(coalesce(w.language, 'tr')) like 'tr%' then 'turkish'::regconfig
                    else 'simple'::regconfig
                  end as cfg,
                  concat_ws(' ', w.title, w.subtitle, coalesce(w.abstract, ''),
                            array_to_string(w.subjects, ' ')) as document
         ) lang
         cross join lateral (
           select to_tsvector(lang.cfg, lang.document) as vector,
                  websearch_to_tsquery(lang.cfg, $2) as query
         ) ts
         cross join lateral (
           select translate(lower(lang.document), 'çğıöşü', 'cgiosu') as folded_text,
                  translate(lower(coalesce(w.title, '')), 'çğıöşü', 'cgiosu') as folded_title
         ) folded
         cross join lateral (
           select translate(lower($2), 'çğıöşü', 'cgiosu') as folded
         ) q
        where (w.tenant_id is null or w.tenant_id = $1)
          and (
            folded.folded_text like '%' || q.folded || '%'
            or ts.vector @@ ts.query
            or word_similarity(q.folded, folded.folded_title) >= 0.55
          )
        order by phrase_hit desc,
                 greatest(ts_rank(ts.vector, ts.query),
                          word_similarity(q.folded, folded.folded_title)) desc,
                 w.created_at desc
        limit 50`,
      [TENANT_ID, q],
    );
    return rows;
  });
  const grants = await activeGrants(auth);
  return books.filter((book) => grantAllows(book, grants));
}

async function listAnnotations(assetId, userId) {
  if (!pool) return demoAnnotations.filter((item) => item.asset_id === assetId);
  return withTenant(async (client) => {
    const { rows } = await client.query(
      `select id, asset_id, anchor, color, note, selected_text, tags, status, created_at, updated_at
         from annotations
        where asset_id = $1 and user_id = $2
        order by created_at asc`,
      [assetId, userId],
    );
    return rows;
  });
}

async function createAnnotation(body, userId) {
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
      tags: normalizeTags(body.tags),
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    demoAnnotations.push(row);
    return row;
  }
  return withTenant(async (client) => {
    const { rows } = await client.query(
      `insert into annotations (tenant_id, user_id, asset_id, anchor, color, note, selected_text, tags)
       values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)
       returning id, asset_id, anchor, color, note, selected_text, tags, status, created_at, updated_at`,
      [TENANT_ID, userId, body.assetId, JSON.stringify(anchor), body.color || 'yellow', body.note || null, body.selectedText || null, normalizeTags(body.tags)],
    );
    return rows[0];
  });
}

async function updateAnnotation(id, body, userId) {
  const colors = ['yellow', 'green', 'blue', 'pink', 'bookmark'];
  const hasNote = Object.prototype.hasOwnProperty.call(body, 'note');
  const hasColor = Object.prototype.hasOwnProperty.call(body, 'color');
  const hasTags = Object.prototype.hasOwnProperty.call(body, 'tags');
  if (!hasNote && !hasColor && !hasTags) throw new Error('note, color or tags is required');
  if (hasColor && !colors.includes(body.color)) throw new Error('invalid color');

  if (!pool) {
    const row = demoAnnotations.find((item) => item.id === id);
    if (!row) return null;
    if (hasNote) row.note = body.note ? String(body.note).trim() || null : null;
    if (hasColor) row.color = body.color;
    if (hasTags) row.tags = normalizeTags(body.tags);
    row.updated_at = new Date().toISOString();
    return row;
  }

  return withTenant(async (client) => {
    const sets = [];
    const params = [];
    if (hasNote) {
      params.push(body.note ? String(body.note).trim() || null : null);
      sets.push(`note = $${params.length}`);
    }
    if (hasColor) {
      params.push(body.color);
      sets.push(`color = $${params.length}`);
    }
    if (hasTags) {
      params.push(normalizeTags(body.tags));
      sets.push(`tags = $${params.length}`);
    }
    params.push(id, userId);
    const { rows } = await client.query(
      `update annotations
          set ${sets.join(', ')}, updated_at = now()
        where id = $${params.length - 1} and user_id = $${params.length}
        returning id, asset_id, anchor, color, note, selected_text, tags, status, created_at, updated_at`,
      params,
    );
    return rows[0] || null;
  });
}

async function getProgress(assetId, userId) {
  if (!pool) return demoProgress.get(assetId) || null;
  return withTenant(async (client) => {
    const { rows } = await client.query(
      `select asset_id, anchor, percent, updated_at
         from reading_progress
        where asset_id = $1 and user_id = $2`,
      [assetId, userId],
    );
    return rows[0] || null;
  });
}

async function saveProgress(body, userId) {
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
      [TENANT_ID, userId, body.assetId, JSON.stringify(body.anchor), Number(body.percent || 0)],
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

async function detectUploadFormat(destination) {
  const handle = await open(destination, 'r');
  const magic = Buffer.alloc(5);
  await handle.read(magic, 0, 5, 0);
  await handle.close();
  if (magic.toString('latin1') === '%PDF-') return 'pdf';
  if (magic[0] === 0x50 && magic[1] === 0x4b) {
    try {
      const zip = await JSZip.loadAsync(await readFile(destination));
      const mimetype = zip.file('mimetype');
      if (mimetype && (await mimetype.async('string')).trim() === 'application/epub+zip') {
        return 'epub';
      }
    } catch {
      return null;
    }
  }
  return null;
}

async function handleUpload(req) {
  const MAX_BYTES = 300 * 1024 * 1024;
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
    const storageKey = `uploads/${id}.upload`;
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

  if (!fileMeta) throw new Error('PDF or EPUB file is required');
  if (fileMeta.truncated()) {
    await unlink(fileMeta.destination).catch(() => {});
    throw new Error('file too large');
  }
  if (fileMeta.size < 5) {
    await unlink(fileMeta.destination).catch(() => {});
    throw new Error('empty file');
  }

  const format = await detectUploadFormat(fileMeta.destination);
  if (!format) {
    await unlink(fileMeta.destination).catch(() => {});
    throw new Error('not a PDF or EPUB');
  }
  const finalKey = `uploads/${fileMeta.id}.${format}`;
  const finalPath = path.join(PUBLIC_DIR, finalKey);
  await rename(fileMeta.destination, finalPath);
  fileMeta.storageKey = finalKey;
  fileMeta.destination = finalPath;

  let pageCount = null;
  if (format === 'pdf' && fileMeta.size <= 150 * 1024 * 1024) {
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
  const authors = parseAuthors(fields.authors);

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
      sha256: fileMeta.sha256,
      source_system: 'upload',
      format,
      page_count: pageCount,
      metadata: { authors },
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
          [TENANT_ID, title, subtitle, language, subjects, JSON.stringify({ uploaded: true, authors })],
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
           values ($1, $2, $3, $4, $5, null, 'upload', $6, $6, now(), 'open')
           returning id`,
          [TENANT_ID, edition.rows[0].id, format, fileMeta.storageKey, pageCount, fileMeta.sha256],
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
    if (format === 'pdf' || format === 'epub') {
      void indexAsset({
        pool,
        tenantId: TENANT_ID,
        assetId: saved.asset_id,
        storageKey: fileMeta.storageKey,
        publicDir: PUBLIC_DIR,
      }).catch((error) => console.warn('[index] upload indexing failed:', error.message));
    }
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
  const contentType = path.extname(storageKey).toLowerCase() === '.epub'
    ? 'application/epub+zip'
    : 'application/pdf';
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
      'content-type': contentType,
      'content-length': end - start + 1,
      'content-range': `bytes ${start}-${end}/${info.size}`,
      'accept-ranges': 'bytes',
      'cache-control': 'private, max-age=0',
    });
    createReadStream(safePath, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, {
    'content-type': contentType,
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

  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
  res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('cross-origin-opener-policy', 'same-origin');
  res.setHeader(
    'content-security-policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
    + "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; "
    + "frame-src 'self' blob: data:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; "
    + "form-action 'self'; frame-ancestors 'none'",
  );

  try {
    if (pathname === '/api/health') {
      json(res, 200, { ok: true, mode: pool ? 'db' : 'demo', tenantId: TENANT_ID });
      return;
    }
    if (pathname === '/api/config' && req.method === 'GET') {
      json(res, 200, {
        brandName: BRAND_NAME,
        brandTagline: BRAND_TAGLINE,
        mode: pool ? 'db' : 'demo',
      });
      return;
    }
    if (pathname === '/api/login' && req.method === 'POST') {
      const ip = clientIp(req);
      const retryAfter = loginRateStatus(ip);
      if (retryAfter > 0) {
        res.setHeader('retry-after', String(retryAfter));
        json(res, 429, { error: 'too many attempts', retryAfter });
        return;
      }
      const body = await readJson(req);
      const user = await loginUser(body.email, body.password);
      if (!user) {
        recordLoginFailure(ip);
        json(res, 401, { error: 'invalid credentials' });
        return;
      }
      clearLoginFailures(ip);
      let sessionId;
      try {
        sessionId = await createSession(user, req);
      } catch (error) {
        if (error.code === 'SESSION_LIMIT' || error.code === 'TENANT_SEAT_LIMIT') {
          json(res, 429, {
            error: error.code === 'TENANT_SEAT_LIMIT' ? 'tenant seat limit reached' : 'session limit reached',
            limit: error.limit,
          });
          return;
        }
        throw error;
      }
      const csrf = randomBytes(18).toString('base64url');
      setSessionCookie(res, { ...user, session_id: sessionId, csrf }, isSecureRequest(req));
      json(res, 200, {
        id: user.id,
        email: user.email,
        displayName: user.display_name || user.email,
        role: user.role,
      });
      return;
    }
    if (pathname === '/api/logout' && req.method === 'POST') {
      const session = readSession(req);
      if (session?.sessionId) await deleteSession(session.sessionId, session.userId);
      clearSessionCookie(res, isSecureRequest(req));
      json(res, 200, { ok: true });
      return;
    }
    if (pathname === '/api/me' && req.method === 'GET') {
      const session = readSession(req);
      if (!session || !(await sessionIsValid(session))) {
        json(res, 401, { error: 'authentication required' });
        return;
      }
      json(res, 200, {
        id: session.userId,
        email: session.email,
        displayName: session.displayName,
        role: session.role,
      });
      return;
    }

    const auth = readSession(req);
    if (pathname.startsWith('/api/') && !auth) {
      json(res, 401, { error: 'authentication required' });
      return;
    }
    if (auth && !(await sessionIsValid(auth))) {
      clearSessionCookie(res, isSecureRequest(req));
      json(res, 401, { error: 'session revoked' });
      return;
    }
    if (auth && ['POST', 'PATCH', 'DELETE', 'PUT'].includes(req.method) && !requireCsrf(req, auth)) {
      json(res, 403, { error: 'csrf token missing or invalid' });
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
      if (!await canAccessBook(book, auth)) {
        json(res, 403, { error: 'yetkiniz yok' });
        return;
      }
      const query = normalizeSearch(url.searchParams.get('q') || '');
      const flag = (name) => ['1', 'true', 'on'].includes(
        String(url.searchParams.get(name) || '').toLocaleLowerCase('tr'),
      );
      const whole = flag('whole');
      const fuzzy = flag('fuzzy');
      if (!pool || !query) {
        json(res, 200, { indexed: false, results: [] });
        return;
      }
      try {
        const foldedQuery = foldSearch(query);
        const language = String(book.language || 'tr').toLocaleLowerCase('tr');
        const english = language.startsWith('en');
        const tsColumnName = english ? 'text_tsv_en' : 'text_tsv';
        const tsColumn = `p.${tsColumnName}`;
        const tsConfig = english ? 'english' : 'turkish';
        const wordQuery = foldWords(query);
        const data = await withTenantSearch(async (client) => {
          // Only the top 100 candidate pages get hit counts and text, so large
          // books do not decompress every page on each search.
          const wordFilter = whole ? "and text_words like '% ' || $4 || ' %'" : '';
          const stemBranch = whole ? '' : `union all
               select page_no, 1 as tier from asset_pages
                where asset_id = $1 and ${tsColumnName} @@ websearch_to_tsquery('${tsConfig}', $2)`;
          const { rows } = await client.query(
            `with candidates as (
               select page_no, 0 as tier from asset_pages
                where asset_id = $1 and text_search like '%' || $2 || '%' ${wordFilter}
               union all
               select page_no, 0 as tier from asset_pages
                where asset_id = $1 and text_fold like '%' || $3 || '%' ${wordFilter}
               ${stemBranch}
             ),
             top as (
               select page_no, min(tier) as tier
                 from candidates
                group by page_no
                order by min(tier), page_no
                limit 100
             )
             select p.page_no, p.source, p.locator, top.tier,
                    (length(p.text_search) - length(replace(p.text_search, $2, '')))
                      / greatest(length($2), 1) as exact_hits,
                    (length(p.text_fold) - length(replace(p.text_fold, $3, '')))
                      / greatest(length($3), 1) as folded_hits,
                    (length(p.text_words) - length(replace(p.text_words, ' ' || $4 || ' ', ' ')))
                      / greatest(length($4) + 1, 1) as word_hits,
                    case when ${tsColumn} @@ websearch_to_tsquery('${tsConfig}', $2)
                         then 1 else 0 end as stem_hits,
                    (case when a.anchor > 46 then '…' else '' end) ||
                    substring(p.text_content from greatest(a.anchor - 45, 1) for 90 + length($2)) ||
                    (case when a.anchor + 45 + length($2) < length(p.text_content)
                          then '…' else '' end) as snippet
               from top
               join asset_pages p on p.page_no = top.page_no and p.asset_id = $1
               cross join lateral (
                 select coalesce(
                   nullif(strpos(p.text_fold, $3), 0),
                   nullif(strpos(p.text_fold, left($3, 4)), 0),
                   1
                 ) as anchor
               ) a
              order by top.tier, p.page_no`,
            [book.asset_id, query, foldedQuery, wordQuery],
          );
          const indexed = rows.length > 0 || (await client.query(
            'select exists(select 1 from asset_pages where asset_id = $1) as present',
            [book.asset_id],
          )).rows[0].present;
          // Typo tolerance is a fallback tier: only run it when the indexed
          // tiers are thin, since word similarity over every page is costly.
          let fuzzyRows = [];
          if (fuzzy && !whole && rows.length < 3) {
            ({ rows: fuzzyRows } = await client.query(
              `select page_no, text_content, source, locator,
                      word_similarity($2, text_fold) as score
                 from asset_pages
                where asset_id = $1
                  and length($2) >= 4
                  and word_similarity($2, text_fold) >= 0.6
                order by score desc, page_no
                limit 20`,
              [book.asset_id, foldedQuery],
            ));
          }
          return { indexed, rows, fuzzyRows };
        });

        const results = data.rows.map((row) => {
          const exactHits = Number(row.exact_hits);
          const foldedHits = Number(row.folded_hits);
          const wordHits = Number(row.word_hits);
          const stemHits = Number(row.stem_hits);
          const matchType = whole && wordHits > 0
            ? 'word'
            : exactHits > 0
              ? 'exact'
              : foldedHits > 0
                ? 'folded'
                : stemHits > 0
                  ? 'stem'
                  : 'fuzzy';
          const matches = matchType === 'word'
            ? wordHits
            : matchType === 'exact'
              ? exactHits
              : matchType === 'folded'
                ? foldedHits
                : 1;
          return {
            page: row.page_no,
            href: row.locator || null,
            chapter: chapterNumberFromHref(row.locator),
            snippet: row.snippet,
            source: row.source,
            matches,
            matchType,
          };
        });
        const seenPages = new Set(results.map((item) => item.page));
        for (const row of data.fuzzyRows) {
          if (seenPages.has(row.page_no)) continue;
          const anchor = findSnippetAnchor(row.text_content, query);
          results.push({
            page: row.page_no,
            href: row.locator || null,
            chapter: chapterNumberFromHref(row.locator),
            snippet: buildSnippet(row.text_content, anchor.index, anchor.length),
            source: row.source,
            matches: 1,
            matchType: 'fuzzy',
            fuzzyScore: Math.round(Number(row.score) * 100) / 100,
          });
        }
        json(res, 200, { indexed: data.indexed, results });
      } catch (error) {
        console.warn('[search] index unavailable:', error.message);
        json(res, 200, { indexed: false, results: [] });
      }
      return;
    }
    if (pathname === '/api/password' && req.method === 'POST') {
      if (!pool) {
        json(res, 501, { error: 'password change requires database mode' });
        return;
      }
      const body = await readJson(req);
      try {
        const changed = await changePassword(auth.userId, body.currentPassword, body.newPassword);
        if (!changed) {
          json(res, 400, { error: 'current password is incorrect' });
          return;
        }
        clearSessionCookie(res, isSecureRequest(req));
        json(res, 200, { ok: true, relogin: true });
      } catch (error) {
        json(res, 400, { error: error.message });
      }
      return;
    }
    if (pathname === '/api/logout-all' && req.method === 'POST') {
      if (!pool) {
        json(res, 501, { error: 'session revocation requires database mode' });
        return;
      }
      await revokeAllSessions(auth.userId);
      clearSessionCookie(res, isSecureRequest(req));
      json(res, 200, { ok: true });
      return;
    }
    if (pathname === '/api/upload' && req.method === 'POST') {
      if (!canManage(auth.role)) {
        json(res, 403, { error: 'yetkiniz yok' });
        return;
      }
      const book = await handleUpload(req);
      json(res, 201, book);
      return;
    }
    if (pathname === '/api/grants' && req.method === 'GET') {
      if (!canManage(auth.role)) {
        json(res, 403, { error: 'yetkiniz yok' });
        return;
      }
      json(res, 200, await listGrants());
      return;
    }
    if (pathname === '/api/grants/usage' && req.method === 'GET') {
      if (!canManage(auth.role)) {
        json(res, 403, { error: 'yetkiniz yok' });
        return;
      }
      json(res, 200, await grantUsage());
      return;
    }
    if (pathname === '/api/grants/audit' && req.method === 'GET') {
      if (!canManage(auth.role)) {
        json(res, 403, { error: 'yetkiniz yok' });
        return;
      }
      json(res, 200, await grantAuditLog(50));
      return;
    }
    if (pathname === '/api/grants' && req.method === 'POST') {
      if (!canManage(auth.role)) {
        json(res, 403, { error: 'yetkiniz yok' });
        return;
      }
      try {
        json(res, 201, await createGrant(await readJson(req), auth));
      } catch (error) {
        json(res, 400, { error: error.message });
      }
      return;
    }
    if (pathname.startsWith('/api/grants/') && req.method === 'DELETE') {
      if (!canManage(auth.role)) {
        json(res, 403, { error: 'yetkiniz yok' });
        return;
      }
      const id = decodeURIComponent(pathname.slice('/api/grants/'.length));
      if (!await deleteGrant(id, auth)) {
        json(res, 404, { error: 'grant not found' });
        return;
      }
      json(res, 200, { ok: true });
      return;
    }
    if (pathname === '/api/books' && req.method === 'GET') {
      json(res, 200, await listBooks(auth));
      return;
    }
    if (pathname.startsWith('/api/books/') && req.method === 'PATCH') {
      if (!canManage(auth.role)) {
        json(res, 403, { error: 'yetkiniz yok' });
        return;
      }
      const id = pathname.slice('/api/books/'.length);
      const book = await updateBook(id, await readJson(req));
      if (!book) {
        json(res, 404, { error: 'book not found' });
        return;
      }
      json(res, 200, book);
      return;
    }
    if (pathname.startsWith('/api/books/') && req.method === 'DELETE') {
      if (!canManage(auth.role)) {
        json(res, 403, { error: 'yetkiniz yok' });
        return;
      }
      const id = decodeURIComponent(pathname.slice('/api/books/'.length));
      const result = await deleteUploadedBook(id);
      if (result.status === 'not_found') {
        json(res, 404, { error: 'book not found' });
        return;
      }
      if (result.status === 'not_uploaded') {
        json(res, 409, { error: 'only uploaded titles can be deleted' });
        return;
      }
      for (const key of result.keys) {
        const safePath = path.resolve(PUBLIC_DIR, key);
        if (safePath.startsWith(PUBLIC_DIR + path.sep)) await unlink(safePath).catch(() => {});
      }
      json(res, 200, { ok: true });
      return;
    }
    if (pathname === '/api/search' && req.method === 'GET') {
      json(res, 200, await searchBooks(url.searchParams.get('q'), auth));
      return;
    }
    const downloadMatch = pathname.match(/^\/api\/books\/([^/]+)\/download$/);
    if (downloadMatch && req.method === 'GET') {
      const bookId = decodeURIComponent(downloadMatch[1]);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bookId)) {
        json(res, 400, { error: 'invalid book id' });
        return;
      }
      const book = await getBook(bookId);
      if (!book) {
        json(res, 404, { error: 'book not found' });
        return;
      }
      if (!await canAccessBook(book, auth)) {
        json(res, 403, { error: 'yetkiniz yok' });
        return;
      }
      if (book.allow_download === false) {
        json(res, 403, { error: 'download disabled for this title' });
        return;
      }
      if (book.format === 'epub') {
        json(res, 501, { error: 'EPUB download is not supported yet' });
        return;
      }
      const safePath = path.resolve(PUBLIC_DIR, book.storage_key);
      if (!safePath.startsWith(PUBLIC_DIR + path.sep)) {
        json(res, 400, { error: 'invalid storage key' });
        return;
      }
      const buffer = await readFile(safePath);
      let payload = buffer;
      if (book.watermark !== false) {
        const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
        const font = await pdf.embedFont(StandardFonts.Helvetica);
        const stamp = `${auth.email} · ${new Date().toISOString().slice(0, 10)}`;
        pdf.getPages().forEach((page) => {
          const { width, height } = page.getSize();
          page.drawText(stamp, {
            x: 36,
            y: 22,
            size: 8,
            font,
            color: rgb(0.45, 0.45, 0.45),
            opacity: 0.6,
          });
          page.drawText(stamp, {
            x: width * 0.16,
            y: height * 0.48,
            size: 16,
            font,
            color: rgb(0.45, 0.45, 0.45),
            opacity: 0.12,
            rotate: degrees(35),
          });
        });
        payload = Buffer.from(await pdf.save());
      }
      const filename = `${book.title.replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 80) || 'kitap'}.pdf`;
      res.writeHead(200, {
        'content-type': 'application/pdf',
        'content-length': payload.length,
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'cache-control': 'no-store',
      });
      res.end(payload);
      return;
    }
    const bookFile = pathname.startsWith('/api/books/')
      && (pathname.endsWith('/file') || pathname.endsWith('/book.epub'))
      && req.method === 'GET';
    if (bookFile) {
      const epubFile = pathname.endsWith('/book.epub');
      const suffix = epubFile ? '/book.epub' : '/file';
      const id = pathname.slice('/api/books/'.length, -suffix.length);
      const book = await getBook(id);
      if (!book || !await canAccessBook(book, auth)) {
        json(res, 404, { error: 'book not found' });
        return;
      }
      const storageKey = book.storage_key;
      if (!storageKey || (epubFile && !storageKey.toLowerCase().endsWith('.epub'))) {
        json(res, 404, { error: 'book not found' });
        return;
      }
      await servePdf(req, res, storageKey);
      return;
    }
    if (pathname === '/api/annotations' && req.method === 'GET') {
      json(res, 200, await listAnnotations(url.searchParams.get('assetId'), auth.userId));
      return;
    }
    if (pathname === '/api/annotations' && req.method === 'POST') {
      json(res, 201, await createAnnotation(await readJson(req), auth.userId));
      return;
    }
    if (pathname.startsWith('/api/annotations/') && req.method === 'PATCH') {
      const id = pathname.slice('/api/annotations/'.length);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        json(res, 400, { error: 'invalid annotation id' });
        return;
      }
      const updated = await updateAnnotation(id, await readJson(req), auth.userId);
      json(res, updated ? 200 : 404, updated || { error: 'annotation not found' });
      return;
    }
    if (pathname.startsWith('/api/annotations/') && req.method === 'DELETE') {
      const id = pathname.slice('/api/annotations/'.length);
      const removed = await deleteAnnotation(id, auth.userId);
      json(res, removed ? 200 : 404, { ok: removed });
      return;
    }
    if (pathname === '/api/progress' && req.method === 'GET') {
      json(res, 200, await getProgress(url.searchParams.get('assetId'), auth.userId));
      return;
    }
    if (pathname === '/api/progress' && req.method === 'POST') {
      json(res, 200, await saveProgress(await readJson(req), auth.userId));
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
