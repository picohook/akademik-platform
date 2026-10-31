import { createStorage, serveStoredAsset } from './storage.mjs';
import { APP_CSP } from './security-headers.mjs';
import { assetVersionToken, versionShellAssets } from './asset-version.mjs';
import { normalizeBookVariant } from './public/book-variants.mjs';
import { mutateAnnotation, memoryAnnotationMutations, purgeAnnotationReceipts } from './annotation-sync.mjs';
import { currentTenant, runWithTenant } from './tenant-context.mjs';
import { handleBridgeRequest } from './libedge-bridge-api.mjs';
import http from 'node:http';
import path from 'node:path';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, readFile, readdir, rename, stat, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash, createHmac, randomBytes, randomUUID, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import Busboy from 'busboy';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { indexAsset } from './indexer.mjs';
import { createDownloadService, startDownloadMaintenance } from './download-tickets.mjs';
import { watermarkDownload, inspectWatermarkable } from './social-watermark.mjs';
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
const assetStorage = createStorage({ publicDir: PUBLIC_DIR });
if (assetStorage.driver === 'r2' && !process.env.DATABASE_URL) throw new Error('R2 requires database mode');
const OCR_DIR = path.join(PUBLIC_DIR, 'ocr');
const PORT = Number(process.env.PORT || 3000);
const TENANT_ID = process.env.DEMO_TENANT_ID || '11111111-1111-1111-1111-111111111111';

// The env tenant exists only to give session-less work a starting point
// (login, health, maintenance). It is NOT a fallback inside withTenant.
function requestTenant() {
  const tenantId = currentTenant();
  if (!tenantId) {
    throw new Error('no tenant bound to this request: wrap session-bound work in runWithTenant()');
  }
  return tenantId;
}
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
// No real release number as a fallback: an unset APP_VERSION must look obviously
// wrong (v0-dev) instead of silently reporting a plausible release (see docs/DEPLOY.md).
const APP_VERSION = process.env.APP_VERSION || '0-dev';
const BUILD_SHA = process.env.BUILD_SHA || '';
const BUILD_DATE = process.env.BUILD_DATE || '';
const ASSET_VERSION = assetVersionToken(BUILD_SHA, APP_VERSION);
const APP_ENV = process.env.APP_ENV || (process.env.NODE_ENV === 'production' ? 'production' : 'development');
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || '';
function integerEnv(name, fallback, min, max) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}
const ANNOTATION_RECEIPT_RETENTION_DAYS = integerEnv('ANNOTATION_RECEIPT_RETENTION_DAYS', 90, 1, 3650);
const ANNOTATION_TOMBSTONE_RETENTION_DAYS = integerEnv('ANNOTATION_TOMBSTONE_RETENTION_DAYS', 365, ANNOTATION_RECEIPT_RETENTION_DAYS, 3650);
// Safe by default: per-title watermark=false never disables B2B download stamps.
const B2B_DOWNLOADS = process.env.SOCIAL_DRM_B2B !== 'false';

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
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
};

const demoBooks = [
  {
    id: '33333333-3333-3333-3333-333333333333',
    title: 'Demo PDF — Dummy PDF file',
    subtitle: 'One-page English test document',
    language: 'en',
    abstract:
      'One-page English PDF used to verify reader, search, download and accessibility flows.',
    subjects: ['Demo', 'Platform testing'],
    publisher: 'Academic Platform test fixture',
    publication_year: null,
    asset_id: '55555555-5555-5555-5555-555555555555',
    storage_key: 'seed/sample.pdf',
    page_count: 1,
  },
];

const demoAnnotations = [];
const mutateDemoAnnotation = memoryAnnotationMutations(demoAnnotations);
// Demo mode holds its fixtures in memory, so it must carry the same grant
// db/seed.sql gives the demo tenant. It used to be an empty array, and that
// went unnoticed only because grantAllows() returned true on an empty list -
// in demo mode every book was readable by everyone. With the decision
// fail-closed, an empty list means "no access", so the fixture has to exist.
// Any demo user inherits it through subject_type 'tenant'.
const demoGrants = [{
  id: '77777777-7777-7777-7777-777777777777',
  tenant_id: TENANT_ID,
  subject_type: 'tenant',
  subject_id: TENANT_ID,
  scope_type: 'all',
  scope_id: null,
  scope_key: null,
  source: 'trial',
  status: 'active',
}];
const demoGrantAudit = [];
const demoGroups = [];
const demoGroupMembers = [];
const demoUsage = [];
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

// The LibEdge bridge's catalog half runs as a different role (`akademik_catalog`, 022),
// so it cannot share the app pool: the role is the authorisation, and a pool is bound
// to one role by its connection string. Leaving DATABASE_CATALOG_URL unset is a valid
// state - the bridge simply answers 503 on the catalog path - which is why this is not
// fatal and why it is logged at startup either way. A wrong URL here is not detected
// here; the first catalog request that cannot connect reports it.
let catalogPool = null;
if (process.env.DATABASE_CATALOG_URL) {
  try {
    const pg = await import('pg');
    catalogPool = new pg.default.Pool({ connectionString: process.env.DATABASE_CATALOG_URL, max: 3 });
    console.log('[db] catalog pool created');
  } catch (error) {
    console.warn('[db] catalog pool unavailable, catalog endpoints will answer 503:', error.message);
  }
} else {
  console.log('[db] DATABASE_CATALOG_URL not set, the bridge catalog path will answer 503');
}

async function withTenant(fn) {
  const tenantId = requestTenant();
  const client = await pool.connect();
  try {
    await client.query("select set_config('app.tenant_id', $1, false)", [tenantId]);
    return await fn(client);
  } finally {
    client.release();
  }
}

// Search needs a transaction so pg_trgm's word-similarity threshold stays local.
async function withTenantSearch(fn) {
  const tenantId = requestTenant();
  const client = await pool.connect();
  try {
    await client.query("select set_config('app.tenant_id', $1, false)", [tenantId]);
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

function canManageAccess(role) {
  return role === 'admin' || role === 'librarian';
}

function canEditBook(auth, book) {
  if (!book || !auth) return false;
  if (auth.role === 'admin' || auth.role === 'librarian') return true;
  return auth.role === 'publisher' && book.metadata?.uploaded_by === auth.userId;
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

function scryptAsync(password, salt, length) {
  return new Promise((resolve, reject) => {
    scrypt(String(password), salt, length, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

async function verifyPassword(password, stored) {
  if (!stored) return false;
  const [scheme, salt, hash] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const candidate = await scryptAsync(password, salt, expected.length);
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
  // A session belongs to the tenant the user was found in, not the env tenant.
  return runWithTenant(user.tenant_id || TENANT_ID, () => withTenant(async (client) => {
    await client.query('begin');
    try {
      // Serialize login seat checks for the whole tenant, then for the user.
      // Different users could otherwise pass the tenant count concurrently.
      await client.query('select pg_advisory_xact_lock(hashtext($1::text))', [`tenant:${user.tenant_id || TENANT_ID}`]);
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
              or (subject_type = 'user' and subject_id = $2)
              or (subject_type = 'group' and subject_id in (
                select group_id from user_group_members where user_id = $2
              )))`,
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
  }));
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

// Resolves a login email to its tenant without exposing other tenants' rows to
// the app role. SECURITY DEFINER runs with the rights of the owner (a
// superuser in the dev container, the table owner on EC2), so it can see across
// RLS - which is why it takes one email and returns one uuid, nothing else.
// It is the narrowest thing that lets login work before a tenant is known.
async function tenantForLogin(email) {
  const client = await pool.connect();
  try {
    const { rows } = await client.query('select app.tenant_for_login($1) as tenant_id', [email]);
    return rows[0]?.tenant_id || null;
  } catch (error) {
    // Before 018 is applied the function does not exist. Falling back to the
    // env tenant keeps single-tenant deployments working and is no worse than
    // the previous behaviour.
    if (error.code === '42883') {
      console.warn('[auth] app.tenant_for_login missing; falling back to DEMO_TENANT_ID');
      return TENANT_ID;
    }
    throw error;
  } finally {
    client.release();
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

  // Password derivation must not occupy a scarce database connection.
  // Login is the one place the tenant cannot come from a session. `users` is
  // under RLS, so an app-role query cannot see another tenant's rows - but
  // guessing tenants in a loop would be worse. The email is resolved to its
  // tenant by a function that runs with elevated rights and returns one row,
  // then the ordinary RLS-scoped read runs inside that tenant. A miss and a
  // bad password stay indistinguishable to the caller.
  const tenantId = await tenantForLogin(email);
  if (!tenantId) {
    // Still hash something, so a missing account does not answer faster than a
    // wrong password for an existing one. Same 64-byte length as a real
    // scrypt hash, otherwise the timings differ by an order of magnitude.
    await verifyPassword(password, `scrypt$${randomBytes(16).toString('hex')}$${'0'.repeat(128)}`);
    return null;
  }
  const row = await runWithTenant(tenantId, () => withTenant(async (client) => {
    const { rows } = await client.query(
      `select id, tenant_id, email, display_name, role, password_hash, session_version, max_sessions
         from users
        where tenant_id = $1 and lower(email) = lower($2)
        limit 1`,
      [tenantId, email],
    );
    return rows[0] || null;
  }));
  if (!row || !await verifyPassword(password, row.password_hash)) return null;
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    email: row.email,
    display_name: row.display_name,
    role: row.role,
    session_version: row.session_version,
    max_sessions: row.max_sessions,
  };
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
    if (!rows[0] || !await verifyPassword(currentPassword, rows[0].password_hash)) return false;
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
    if (rows.some((row) => !['upload', 'ingest'].includes(row.source_system))) {
      return { status: 'not_uploaded', keys: [] };
    }
    await client.query('delete from works where id = $1', [id]);
    return { status: 'ok', keys: rows.map((row) => row.storage_key).filter(Boolean) };
  });
}

// Fail-closed: no grant, no access.
//
// This returned true for an empty grant list, so any user whose grants failed
// to match saw the whole catalogue. It hid a real defect in production - the
// single grants row names subject_id 11111111-... while the catalogue is under
// 5799f2a5-..., so it matches nobody, and the admin saw 13 works only because
// this returned true. Access that cannot be decided must be denied.
function grantAllows(book, grants) {
  if (!Array.isArray(grants) || !grants.length) return false;
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

async function activeGrants(auth, dbClient = null) {
  if (!auth) return [];
  // The tenant a user's grants belong to is the tenant they signed in to, not
  // the one this process was started with.
  const tenantId = auth.tenantId || requestTenant();
  if (!pool) {
    return demoGrants.filter((grant) => grant.status === 'active'
      && grant.tenant_id === tenantId
      && ((grant.subject_type === 'tenant' && grant.subject_id === tenantId)
        || (grant.subject_type === 'user' && grant.subject_id === auth.userId)
        || (grant.subject_type === 'group'
          && demoGroupMembers.some((member) => member.group_id === grant.subject_id && member.user_id === auth.userId))));
  }
  try {
    const grantClock = dbClient ? 'clock_timestamp()' : 'now()';
    const load = async (client) => {
      const { rows } = await client.query(
        `select id, subject_type, subject_id, scope_type, scope_id, scope_key, seat_limit
           from grants
          where tenant_id = $1
            and status = 'active'
            and valid_from <= ${grantClock}
            and (valid_to is null or valid_to > ${grantClock})
            and ((subject_type = 'tenant' and subject_id = $1)
              or (subject_type = 'user' and subject_id = $2)
              or (subject_type = 'group' and subject_id in (
                select group_id from user_group_members where user_id = $2
              )))`,
        [tenantId, auth.userId || null],
      );
      return rows;
    };
    return dbClient ? await load(dbClient) : await withTenant(load);
  } catch (error) {
    console.warn('[grants] lookup failed:', error.message);
    throw new Error('grant lookup failed');
  }
}

async function listGrants() {
  if (!pool) return demoGrants;
  return withTenant(async (client) => {
    const { rows } = await client.query(
      `select g.id, g.subject_type, g.subject_id, g.scope_type, g.scope_id, g.scope_key,
              g.seat_limit, g.source, g.status, g.valid_from, g.valid_to, g.created_at,
              coalesce(u.email, ug.name) as subject_email
         from grants g
         left join users u on g.subject_type = 'user' and u.id = g.subject_id
         left join user_groups ug on g.subject_type = 'group' and ug.id = g.subject_id
        where g.tenant_id = $1
        order by g.created_at desc`,
      [requestTenant()],
    );
    return rows;
  });
}

async function logUsage(action, book, auth) {
  if (!book?.asset_id) return;
  const event = {
    action,
    asset_id: book.asset_id,
    user_id: auth?.userId || null,
    occurred_at: new Date().toISOString(),
  };
  if (!pool) {
    demoUsage.push(event);
    return;
  }
  try {
    await withTenant(async (client) => {
      await client.query(
        `insert into audit_events (tenant_id, actor_id, action, object_type, object_id, payload)
         values ($1, $2, $3, 'asset', $4, $5::jsonb)`,
        [requestTenant(), auth?.userId || null, action, book.asset_id, JSON.stringify({ book_id: book.id })],
      );
    });
  } catch (error) {
    console.warn('usage log failed', error.message);
  }
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
    [requestTenant(), grantId, action, auth?.userId || null, JSON.stringify(detail || {})],
  );
}

async function listCollections() {
  if (!pool) return [{ id: 'demo-collection', title: 'Demo koleksiyonu', item_count: 0 }];
  return withTenant(async (client) => {
    const { rows } = await client.query(
      `select c.id, c.title, count(ci.work_id)::int as item_count
         from collections c
         left join collection_items ci on ci.collection_id = c.id
        where c.tenant_id = $1
        group by c.id, c.title
        order by c.title`,
      [requestTenant()],
    );
    return rows;
  });
}

async function listGroups() {
  if (!pool) {
    return demoGroups.map((group) => ({
      ...group,
      member_count: demoGroupMembers.filter((member) => member.group_id === group.id).length,
    }));
  }
  return withTenant(async (client) => {
    const { rows } = await client.query(
      `select g.id, g.name, g.created_at, count(m.user_id)::int as member_count
         from user_groups g
         left join user_group_members m on m.group_id = g.id
        where g.tenant_id = $1
        group by g.id, g.name, g.created_at
        order by g.name`,
      [requestTenant()],
    );
    return rows;
  });
}

async function createGroup(name) {
  const value = String(name || '').trim();
  if (!value) throw new Error('group name required');
  if (!pool) {
    if (demoGroups.some((group) => group.name === value)) throw new Error('group exists');
    const group = { id: randomUUID(), name: value, created_at: new Date().toISOString() };
    demoGroups.push(group);
    return group;
  }
  return withTenant(async (client) => {
    const { rows } = await client.query(
      `insert into user_groups (tenant_id, name) values ($1, $2)
       returning id, name, created_at`,
      [requestTenant(), value],
    );
    return rows[0];
  });
}

async function addGroupMember(groupId, email) {
  const normalized = String(email || '').trim().toLocaleLowerCase('tr');
  if (!groupId || !normalized) throw new Error('group and email required');
  if (!pool) {
    const user = normalized.startsWith('reader') ? USER_ID : '44444444-4444-4444-4444-444444444444';
    if (!demoGroups.some((group) => group.id === groupId)) throw new Error('group not found');
    if (!demoGroupMembers.some((member) => member.group_id === groupId && member.user_id === user)) {
      demoGroupMembers.push({ group_id: groupId, user_id: user });
    }
    return true;
  }
  return withTenant(async (client) => {
    const { rows } = await client.query('select id from users where email = $1 limit 1', [normalized]);
    if (!rows[0]) throw new Error('user not found');
    await client.query(
      'insert into user_group_members (group_id, user_id) values ($1, $2) on conflict do nothing',
      [groupId, rows[0].id],
    );
    return true;
  });
}

async function removeGroupMember(groupId, userId) {
  if (!pool) {
    const index = demoGroupMembers.findIndex((member) => member.group_id === groupId && member.user_id === userId);
    if (index >= 0) demoGroupMembers.splice(index, 1);
    return index >= 0;
  }
  return withTenant(async (client) => {
    const { rowCount } = await client.query(
      'delete from user_group_members where group_id = $1 and user_id = $2',
      [groupId, userId],
    );
    return rowCount > 0;
  });
}

async function createGrant(body, auth) {
  const scopeType = ['all', 'publisher', 'subject', 'collection', 'title'].includes(body.scopeType)
    ? body.scopeType
    : null;
  if (!scopeType) throw new Error('invalid scope');
  const subjectType = ['tenant', 'user', 'group'].includes(body.subjectType) ? body.subjectType : 'tenant';
  let subjectId = TENANT_ID;
  if (subjectType === 'group') {
    subjectId = String(body.subjectGroup || '').trim();
    if (!subjectId) throw new Error('group required');
    if (pool) {
      const found = await withTenant(async (client) => {
        const { rows } = await client.query('select id from user_groups where id = $1 limit 1', [subjectId]);
        return rows[0];
      });
      if (!found) throw new Error('group not found');
    }
  }
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
      [requestTenant(), subjectType, subjectId, scopeType, scopeId, scopeKey, grant.seat_limit, grant.source, grant.valid_to],
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
      [id, requestTenant()],
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
      [requestTenant(), limit],
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
      [requestTenant()],
    );
    const { rows: grantRows } = await client.query(
      `select seat_limit from grants
        where tenant_id = $1 and status = 'active'
          and valid_from <= now() and (valid_to is null or valid_to > now())`,
      [requestTenant()],
    );
    return { activeSessions: sessionRows[0].count, seatLimit: tenantSeatLimit(grantRows) };
  });
}

function tenantSeatLimit(grants) {
  const limits = grants.map((grant) => Number(grant.seat_limit)).filter((value) => Number.isFinite(value) && value > 0);
  return limits.length ? Math.min(...limits) : null;
}

// `dbClient` is passed by the download ticket service, which is already inside a
// transaction on a tenant-bound connection: re-reading through withTenant() there
// would take a second connection and could not see the caller's uncommitted state.
async function canAccessBook(book, auth, dbClient = null) {
  if (!book) return false;
  return grantAllows(book, await activeGrants(auth, dbClient));
}

async function usageCsv() {
  if (!pool) return 'title,publisher,language,readers,progress_rows,avg_percent,annotations\n';
  return withTenant(async (client) => {
    const { rows } = await client.query(
      `select w.title, e.publisher, w.language,
              count(distinct rp.user_id)::int as readers,
              count(rp.asset_id)::int as progress_rows,
              coalesce(round(avg(rp.percent), 1), 0) as avg_percent,
              (select count(*)::int from annotations an
                 join assets a2 on a2.id = an.asset_id
                where a2.edition_id = e.id) as annotations
         from works w
         join editions e on e.work_id = w.id
         left join assets a on a.edition_id = e.id
         left join reading_progress rp on rp.asset_id = a.id
        where (w.tenant_id is null or w.tenant_id = $1)
        group by w.id, w.title, e.id, e.publisher, w.language
        order by readers desc, w.title`,
      [requestTenant()],
    );
    const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    return [
      'title,publisher,language,readers,progress_rows,avg_percent,annotations',
      ...rows.map((row) => [
        escape(row.title), escape(row.publisher), escape(row.language),
        row.readers, row.progress_rows, row.avg_percent, row.annotations,
      ].join(',')),
    ].join('\n') + '\n';
  });
}

function marcRecord(book, base) {
  const author = book.metadata?.authors?.[0];
  const family = author && typeof author === 'object' ? author.family : '';
  const given = author && typeof author === 'object' ? author.given : '';
  const lines = [];
  lines.push(`001 ${book.id}`);
  lines.push('040 ##$aAkademik Platform$cAkademik Platform');
  if (family) lines.push(`100 1#$a${family}${given ? `, ${given}` : ''}`);
  lines.push(`245 10$a${book.title}${book.subtitle ? ` :$b${book.subtitle}` : ''}`);
  if (book.publisher || book.publication_year) {
    lines.push(`260 ##$a${book.publisher || ''}${book.publication_year ? `$c${book.publication_year}` : ''}`);
  }
  (book.subjects || []).slice(0, 6).forEach((subject) => lines.push(`650 #0$a${subject}`));
  lines.push(`856 40$u${base}/api/books/${book.id}/file$zPDF`);
  return `${lines.join('\n')}\n`;
}

async function sushiResponse(url) {
  let params = Object.fromEntries(url.searchParams.entries());
  if (params.request) {
    try {
      params = { ...params, ...JSON.parse(params.request) };
    } catch { /* keep query */ }
  }
  const reportId = String(params.report || params.report_id || 'IR').toUpperCase();
  const begin = params.begin_date || `${new Date().toISOString().slice(0, 7)}-01`;
  const end = params.end_date || new Date().toISOString().slice(0, 10);
  const customer = String(params.customer_id || process.env.SUSHI_CUSTOMER_ID || 'anonymous');
  const esc = escapeXml;
  let rows = [];
  if (!pool) {
    rows = demoBooks.map((book) => ({
      title: book.title,
      asset_id: book.asset_id,
      requests: demoUsage.filter((event) => event.asset_id === book.asset_id).length,
    })).filter((row) => row.requests > 0);
  } else {
    rows = await withTenant(async (client) => {
      const { rows: result } = await client.query(
        `select w.title, ev.object_id as asset_id, count(*)::int as requests
           from audit_events ev
           join assets a on a.id = ev.object_id
           join editions e on e.id = a.edition_id
           join works w on w.id = e.work_id
          where ev.tenant_id = $1
            and ev.action in ('book.view', 'book.download')
            and ev.created_at >= $2::date
            and ev.created_at < ($3::date + interval '1 day')
          group by w.title, ev.object_id
          order by requests desc`,
        [requestTenant(), begin, end],
      );
      return result;
    });
  }
  const items = rows.map((row) => `<ReportItem>
    <ItemIdentifier><Type>Online_Resource</Type><Value>${esc(row.asset_id)}</Value></ItemIdentifier>
    <ItemName>${esc(row.title)}</ItemName>
    <ItemDataType>Book</ItemDataType>
    <ItemPerformance><Instance>
      <MetricType>Total_Item_Requests</MetricType>
      <Count>${Number(row.requests) || 0}</Count>
    </Instance></ItemPerformance>
  </ReportItem>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<ReportResponse xmlns="http://www.niso.org/schemas/counter">
  <Report>
    <ReportHeader>
      <ReportName>Item Requests</ReportName>
      <ReportID>${esc(reportId)}</ReportID>
      <Release>5</Release>
      <InstitutionName>Akademik Platform</InstitutionName>
      <CustomerID>${esc(customer)}</CustomerID>
      <ReportPeriod><BeginDate>${esc(begin)}</BeginDate><EndDate>${esc(end)}</EndDate></ReportPeriod>
      <Created>${new Date().toISOString()}</Created>
    </ReportHeader>
    <ReportItems>${items}</ReportItems>
  </Report>
</ReportResponse>`;
}

function oaiDate(value) {
  return new Date(value || Date.now()).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

async function oaiRecords() {
  if (!pool) {
    return demoBooks.map((book) => ({
      id: book.id,
      title: book.title,
      subtitle: book.subtitle,
      language: book.language || 'tr',
      subjects: book.subjects || [],
      metadata: book.metadata || {},
      publisher: book.publisher,
      publication_year: book.publication_year,
      created_at: book.created_at || new Date().toISOString(),
      format: book.format,
    }));
  }
  return withTenant(async (client) => {
    const { rows } = await client.query(
      `select distinct on (w.id)
              w.id, w.title, w.subtitle, w.language, w.subjects, w.metadata, w.created_at,
              e.publisher, e.publication_year, e.isbn13, e.doi,
              a.format, a.access_status
         from works w
         left join editions e on e.work_id = w.id
         left join assets a on a.edition_id = e.id
        where w.tenant_id is null or w.tenant_id = $1
        order by w.id, a.format`,
      [requestTenant()],
    );
    return rows.filter((row) => row.access_status !== 'restricted');
  });
}

function oaiRecord(record, includeMetadata = true) {
  const identifier = `oai:akademik:${record.id}`;
  const author = record.metadata?.authors?.[0];
  const creator = author && typeof author === 'object'
    ? [author.given, author.family].filter(Boolean).join(' ')
    : (author || '');
  const header = `<header><identifier>${escapeXml(identifier)}</identifier><datestamp>${oaiDate(record.created_at)}</datestamp></header>`;
  if (!includeMetadata) return header;
  return `<record>${header}<metadata><oai_dc:dc
    xmlns:oai_dc="http://www.openarchives.org/OAI/2.0/oai_dc/"
    xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${escapeXml(record.title)}</dc:title>
    ${record.subtitle ? `<dc:description>${escapeXml(record.subtitle)}</dc:description>` : ''}
    ${creator ? `<dc:creator>${escapeXml(creator)}</dc:creator>` : ''}
    ${record.publisher ? `<dc:publisher>${escapeXml(record.publisher)}</dc:publisher>` : ''}
    ${record.publication_year ? `<dc:date>${record.publication_year}</dc:date>` : ''}
    <dc:identifier>${escapeXml(identifier)}</dc:identifier>
    <dc:language>${escapeXml(record.language || 'tr')}</dc:language>
    ${(record.subjects || []).map((subject) => `<dc:subject>${escapeXml(subject)}</dc:subject>`).join('')}
    <dc:type>${escapeXml(record.format === 'epub' ? 'text' : 'text')}</dc:type>
  </oai_dc:dc></metadata></record>`;
}

async function oaiResponse(url, req) {
  const base = `${req.headers['x-forwarded-proto'] || (isSecureRequest(req) ? 'https' : 'http')}://${req.headers.host || 'localhost'}/oai`;
  const verb = url.searchParams.get('verb');
  const prefix = `<?xml version="1.0" encoding="UTF-8"?>\n<OAI-PMH xmlns="http://www.openarchives.org/OAI/2.0/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.openarchives.org/OAI/2.0/ http://www.openarchives.org/OAI/2.0/OAI-PMH.xsd"><responseDate>${oaiDate()}</responseDate><request verb="${escapeXml(verb || '')}">${escapeXml(base)}</request>`;
  const close = '</OAI-PMH>';
  if (!verb) return `${prefix}<error code="badVerb">Missing verb</error>${close}`;
  if (verb === 'Identify') {
    return `${prefix}<Identify><repositoryName>Akademik Platform</repositoryName><baseURL>${escapeXml(base)}</baseURL><protocolVersion>2.0</protocolVersion><adminEmail>library@example.edu.tr</adminEmail><earliestDatestamp>1970-01-01T00:00:00Z</earliestDatestamp><deletedRecord>no</deletedRecord><granularity>YYYY-MM-DDThh:mm:ssZ</granularity></Identify>${close}`;
  }
  if (verb === 'ListMetadataFormats') {
    return `${prefix}<ListMetadataFormats><metadataFormat><metadataPrefix>oai_dc</metadataPrefix><schema>http://www.openarchives.org/OAI/2.0/oai_dc.xsd</schema><metadataNamespace>http://www.openarchives.org/OAI/2.0/oai_dc/</metadataNamespace></metadataFormat></ListMetadataFormats>${close}`;
  }
  if (verb === 'ListSets') return `${prefix}<ListSets></ListSets>${close}`;
  const records = await oaiRecords();
  const identifier = url.searchParams.get('identifier');
  if (verb === 'GetRecord') {
    if (!identifier) return `${prefix}<error code="badArgument">identifier required</error>${close}`;
    const id = identifier.replace(/^oai:akademik:/, '');
    const record = records.find((item) => item.id === id);
    if (!record) return `${prefix}<error code="idDoesNotExist">Unknown identifier</error>${close}`;
    return `${prefix}<GetRecord>${oaiRecord(record)}</GetRecord>${close}`;
  }
  if (verb === 'ListIdentifiers' || verb === 'ListRecords') {
    if (url.searchParams.get('metadataPrefix') !== 'oai_dc') {
      return `${prefix}<error code="cannotDisseminateFormat">Only oai_dc is supported</error>${close}`;
    }
    const from = url.searchParams.get('from');
    const until = url.searchParams.get('until');
    const filtered = records.filter((record) => {
      const day = oaiDate(record.created_at).slice(0, 10);
      return (!from || day >= from.slice(0, 10)) && (!until || day <= until.slice(0, 10));
    });
    const body = filtered.map((record) => oaiRecord(record, verb === 'ListRecords')).join('');
    return `${prefix}<${verb}>${body}</${verb}>${close}`;
  }
  return `${prefix}<error code="badVerb">Unsupported verb</error>${close}`;
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function opdsTokenAuth(req, url) {
  const configured = process.env.OPDS_API_KEY;
  const email = String(process.env.OPDS_USER_EMAIL || '').trim().toLocaleLowerCase('tr');
  if (!configured || !email) return null;
  const header = String(req.headers.authorization || '');
  const supplied = url.searchParams.get('api_key')
    || (header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '');
  if (!supplied || supplied.length !== configured.length
    || !timingSafeEqual(Buffer.from(supplied), Buffer.from(configured))) return null;
  if (!pool) {
    const isLibrarian = email === 'librarian@example.edu.tr';
    if (email !== 'reader@example.edu.tr' && !isLibrarian) return null;
    return {
      userId: isLibrarian ? '44444444-4444-4444-4444-444444444444' : USER_ID,
      tenantId: TENANT_ID,
      email,
      displayName: isLibrarian ? 'Demo Kütüphaneci' : 'Demo Okuyucu',
      role: isLibrarian ? 'librarian' : 'reader',
    };
  }
  // The OPDS client sends an API key, not a cookie, so no session tenant is
  // bound here, and `users` is under FORCE row level security: resolving the email
  // under the env tenant only ever sees that tenant's rows, while the OPDS user
  // generally lives in another one. The tenant is therefore named explicitly by
  // OPDS_TENANT_ID and the lookup runs inside it. No config means no OPDS, which
  // is the fail-closed reading of what used to happen silently: the feed queried
  // whichever tenant the process was started with.
  const tenantId = String(process.env.OPDS_TENANT_ID || '').trim();
  if (!tenantId) return null;
  return runWithTenant(tenantId, () => withTenant(async (client) => {
    const { rows } = await client.query(
      'select id, tenant_id, email, display_name, role from users where email = $1 limit 1',
      [email],
    );
    if (!rows[0]) return null;
    return {
      userId: rows[0].id,
      tenantId: rows[0].tenant_id,
      email: rows[0].email,
      displayName: rows[0].display_name,
      role: rows[0].role,
    };
  }));
}

async function opdsFeed(auth, req) {
  const books = await listBooks(auth);
  const proto = req.headers['x-forwarded-proto'] || (isSecureRequest(req) ? 'https' : 'http');
  const base = `${proto}://${req.headers.host || 'localhost'}`;
  const updated = new Date().toISOString();
  const entries = books.map((book) => {
    const author = book.metadata?.authors?.[0];
    const authorName = author && typeof author === 'object'
      ? [author.given, author.family].filter(Boolean).join(' ')
      : (author || book.publisher || '');
    const type = book.format === 'epub' ? 'application/epub+zip' : 'application/pdf';
    const href = book.format === 'epub'
      ? `${base}/api/books/${book.id}/book.epub`
      : `${base}/api/books/${book.id}/file`;
    return `<entry>
  <title>${escapeXml(book.title)}</title>
  <id>urn:uuid:${escapeXml(book.id)}</id>
  <updated>${updated}</updated>
  ${authorName ? `<author><name>${escapeXml(authorName)}</name></author>` : ''}
  <dc:language>${escapeXml(book.language || 'tr')}</dc:language>
  ${book.publisher ? `<dc:publisher>${escapeXml(book.publisher)}</dc:publisher>` : ''}
  ${book.subjects?.length ? book.subjects.slice(0, 5).map((subject) => `<category term="${escapeXml(subject)}"/>`).join('\n  ') : ''}
  <link rel="http://opds-spec.org/acquisition" href="${escapeXml(href)}" type="${type}"/>
</entry>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/terms/">
  <id>urn:uuid:${escapeXml(auth?.tenantId || requestTenant())}</id>
  <title>Akademik Platform</title>
  <updated>${updated}</updated>
  <link rel="self" href="${base}/opds" type="application/atom+xml;profile=opds-catalog;kind=acquisition"/>
  ${entries}
</feed>`;
}

async function listBooks(auth) {
  if (!pool) {
    const grants = await activeGrants(auth);
    return demoBooks.filter((book) => grantAllows(book, grants)).map(normalizeBookVariant);
  }
  const books = await withTenant(async (client) => {
    const { rows } = await client.query(
      `select w.id, w.title, w.subtitle, w.language, w.abstract, w.subjects, w.metadata,
              e.id as edition_id, e.edition, e.publisher, e.publication_year,
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
      [requestTenant()],
    );
    return rows;
  });
  const grants = await activeGrants(auth);
  return books.filter((book) => grantAllows(book, grants)).map(normalizeBookVariant);
}

async function getBook(id, dbClient = null) {
  if (!pool) { const book = findBook(id); return book ? normalizeBookVariant(book) : null; }
  const load = async (client) => {
    const { rows } = await client.query(
      `select w.id, w.title, w.subtitle, w.language, w.abstract, w.subjects, w.metadata,
              e.id as edition_id, e.edition, e.publisher, e.publication_year,
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
      [id, requestTenant()],
    );
    return rows[0] ? normalizeBookVariant(rows[0]) : null;
  };
  return dbClient ? load(dbClient) : withTenant(load);
}

const downloadService = createDownloadService({
  // A callback, not TENANT_ID: the service is built once at startup but every call
  // runs inside a request, and a request's tenant is bound by runWithTenant().
  // Passing the env tenant here would make the service disagree with withTenant()
  // for anyone outside the env tenant.
  withTenant, getBook, tenantId: requestTenant, b2b: B2B_DOWNLOADS,
  // The authorization decision is the one /file already makes. The service used to
  // carry its own copy of the rule (allowedGrantIds) and the copies disagreed: a
  // tenant whose `download_grants_required` marker was false was allowed to download
  // titles /file refused with 404. Passing canAccessBook() in means "is this book in
  // the catalogue for me?" has exactly one answer.
  access: (book, auth, client) => canAccessBook(book, auth, client),
  // Which grants authorised the book, recorded on the ticket and re-checked on use.
  grantedIds: async (book, auth, client) => (await activeGrants(auth, client))
    .filter(grant => grantAllows(book, [grant]))
    .map(grant => grant.id),
});

// Which tenants a timer sweeps. This runs outside any request, so no tenant is
// bound and nothing can be inferred from the request; the list is read from the
// database instead of the env.
//
// `select id from tenants` returns exactly one row for the app role - tenants_self
// is `using (id = current_setting('app.tenant_id', true)::uuid)`, so the list would
// be whichever tenant that pooled connection last bound, and the sweeper would look
// correct while ignoring every other institution. The list therefore comes from a
// SECURITY DEFINER function that returns ids only (migration 024). Until that is
// applied to a database, the env tenant remains the single tenant a timer covers.
async function maintenanceTenantIds() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query('select tenant_id from app.maintenance_tenants()');
    const ids = rows.map(row => row.tenant_id).filter(Boolean);
    return ids.length ? ids : [TENANT_ID];
  } catch (error) {
    // Not a migration problem, but the same answer a missing migration gets, for
    // three codes rather than one. Measured on PostgreSQL 16 with an empty schema:
    // `select * from app.maintenance_tenants()` fails with 3F000 (invalid_schema_name
    // - schema "app" does not exist), not 42883, because Postgres resolves the schema
    // before the function. 42883 is what remains if the schema exists but the
    // function does not, and 42501 is a missing EXECUTE grant, which is a deployment
    // mistake rather than "no such tenants" but must not silence the sweep either.
    // Catching only 42883 left the sweep throwing on a database that has no
    // `app` schema - which is every database today, and would have been the state
    // the first deploy of that code met. The code was merged but not yet shipped
    // when this was found; v136 runs the commit before it.
    if (error.code === '3F000' || error.code === '42P01' || error.code === '42883' || error.code === '42501') {
      console.warn(`[maintenance] app.maintenance_tenants unavailable (${error.code}); sweeping DEMO_TENANT_ID only`);
      return [TENANT_ID];
    }
    throw error;
  } finally {
    client.release();
  }
}

// `maintenance()` sweeps one tenant's tickets. It is called from a timer, not a
// request, so it must name the tenant itself: withTenant throws when nothing is
// bound, and the previous behaviour - silently reading the env tenant - is what
// the fail-closed change exists to stop. One tenant's failure must not stop the
// others: each is swept inside its own try, and the error is reported with the
// tenant so a broken institution is identifiable.
const downloadMaintenanceService = {
  async maintenance() {
    let ticketsDeleted = 0;
    let limitsDeleted = 0;
    for (const tenantId of await maintenanceTenantIds()) {
      try {
        const result = await runWithTenant(tenantId, () => downloadService.maintenance(tenantId));
        ticketsDeleted += result.ticketsDeleted;
        limitsDeleted += result.limitsDeleted;
      } catch (error) {
        console.warn(`[downloads] maintenance failed for tenant ${tenantId}:`, error.message);
      }
    }
    return { ticketsDeleted, limitsDeleted };
  },
};

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

    // The tenant comes from the session bound by runWithTenant(), not from the
    // process env. Every other query in this file already reads requestTenant();
    // these four were the exception, so a write was aimed at whichever tenant
    // the process was started with rather than the one the caller signed in to.
    if (workSets.length) {
      workValues.push(id, requestTenant());
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
        [JSON.stringify(parseAuthors(body.authors)), id, requestTenant()],
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
      editionValues.push(id, requestTenant());
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
      assetValues.push(id, requestTenant());
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
      [id, requestTenant()],
    );
    return rows[0] || null;
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
              e.id as edition_id, e.edition, e.publisher, e.publication_year,
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
      [requestTenant(), q],
    );
    return rows;
  });
  const grants = await activeGrants(auth);
  return books.filter((book) => grantAllows(book, grants)).map(normalizeBookVariant);
}

async function listAnnotations(assetId, userId) {
  if (!pool) return demoAnnotations.filter((item) => item.asset_id === assetId && item.user_id === userId);
  return withTenant(async (client) => {
    const { rows } = await client.query(
      `select id, asset_id, anchor, color, note, selected_text, tags, status, created_at, updated_at, version
         from annotations
        where asset_id = $1 and user_id = $2
        order by created_at asc`,
      [assetId, userId],
    );
    return rows;
  });
}

async function annotationMutation(method, id, body, userId) {
  const context = { method, id, body, userId, tenantId: TENANT_ID };
  if (!pool) return mutateDemoAnnotation(context);
  return withTenant(async client => {
    // withTenant leases a connection; this unit needs an explicit transaction.
    await client.query('begin');
    await client.query("select set_config('app.user_id', $1, true)", [userId]);
    try {
      const result = await mutateAnnotation(client, context);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
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
      [requestTenant(), userId, body.assetId, JSON.stringify(body.anchor), Number(body.percent || 0)],
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
      [id, requestTenant()],
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

// Admin-facing message for an EPUB that cannot be stamped. The client shows this
// verbatim on a 422, so it names the real consequence instead of the parser error.
const UPLOAD_EPUB_UNSTAMPABLE = 'EPUB indirilemiyor: dosya filigran eklenemeyecek şekilde biçimlendirilmiş';

// Audit payloads are readable by tenant admins, so a raw error string must not
// carry identity (the stamping lines contain user id/email) or file contents.
// Watermark failures are short and structural; anything else is clamped.
function deliveryErrorDetail(message) {
  const text = typeof message === 'string' ? message : '';
  const scrubbed = text
    .replace(/[^\x20-\x7e]/g, '?')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>')
    .replace(/[\w.+-]+@[\w.-]+/g, '<email>')
    .trim();
  return scrubbed.slice(0, 200) || 'unknown delivery error';
}

async function handleUpload(req, auth) {
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

  // An EPUB that cannot be stamped is readable online but never downloadable, and
  // the only symptom is a 409 much later. Reject it at ingest instead: the same
  // parse/validate path as a real download, run against the stored bytes.
  if (format === 'epub') {
    let stampable = null;
    try {
      stampable = await inspectWatermarkable(await readFile(fileMeta.destination), 'epub');
    } catch (error) {
      await unlink(fileMeta.destination).catch(() => {});
      console.warn('[upload] EPUB rejected, cannot be watermarked:', error.message);
      throw Object.assign(new Error(`${UPLOAD_EPUB_UNSTAMPABLE}: ${error.message}`), {
        statusCode: 422, code: 'EPUB_UNSTAMPABLE',
      });
    }
    if (!stampable.documents?.length) console.warn('[upload] EPUB stamped no documents');
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

  let committed = false;
  let remoteKey = null;
  try {
    const book = await withTenant(async (client) => {
      const duplicate = await client.query(
        "select id from assets where source_system = 'upload' and source_id = $1 limit 1",
        [fileMeta.sha256],
      );
      if (duplicate.rowCount > 0) throw new Error('already uploaded');
      if (assetStorage.driver === 'r2') {
        remoteKey = await assetStorage.put(fileMeta.storageKey, await readFile(fileMeta.destination),
          format === 'epub' ? 'application/epub+zip' : 'application/pdf');
        fileMeta.storageKey = remoteKey;
      }

      await client.query('begin');
      try {
        const work = await client.query(
          `insert into works (tenant_id, content_type, title, subtitle, language, abstract, subjects, metadata)
           values ($1, 'monograph', $2, $3, $4, null, $5, $6::jsonb)
           returning id`,
          [requestTenant(), title, subtitle, language, subjects, JSON.stringify({ uploaded: true, authors, uploaded_by: auth?.userId || null })],
        );
        const edition = await client.query(
          `insert into editions (tenant_id, work_id, publisher, publication_year, license_note, rights_note)
           values ($1, $2, $3, $4, $5, $6)
           returning id`,
          [
            requestTenant(),
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
          [requestTenant(), edition.rows[0].id, format, fileMeta.storageKey, pageCount, fileMeta.sha256],
        );
        await client.query('commit');
        committed = true;
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
    if (!committed) {
      await unlink(fileMeta.destination).catch(() => {});
      if (remoteKey) await assetStorage.remove(remoteKey).catch(() => console.warn('[storage] failed upload orphan requires cleanup'));
    }
    throw error;
  } finally {
    if (assetStorage.driver === 'r2') await unlink(fileMeta.destination).catch(() => {});
  }
}

async function servePdf(req, res, storageKey) {
  return serveStoredAsset(assetStorage, req, res, storageKey);
}

async function serveStatic(req, res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.resolve(PUBLIC_DIR, '.' + requested);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    json(res, 403, { error: 'forbidden' });
    return;
  }
  // Check the *resolved* path, not the raw URL: encoded slashes/dots must not
  // escape an allowed prefix into uploads/ or ocr/.
  const relative = '/' + path.relative(PUBLIC_DIR, filePath).split(path.sep).join('/');
  const allowedFiles = new Set([
    '/book-variants.mjs', '/book-links.mjs',
    '/index.html', '/app.js', '/styles.css', '/i18n.mjs', '/citations.mjs', '/pdf-structure.mjs',
    '/search.mjs', '/epub-engine.mjs', '/offline.mjs', '/downloads.mjs', '/ocr-layer.mjs', '/sw.js', '/manifest.webmanifest',
    // Browsers request /favicon.ico on their own when a page declares no icon,
    // and Safari still prefers it over <link rel="icon">. It is the only file at
    // the root that is not a module, so it is listed explicitly.
    '/favicon.ico',
  ]);
  const allowedPrefixes = ['/icons/', '/vendor/'];
  if (relative.includes('..') || (!allowedFiles.has(relative) && !allowedPrefixes.some((prefix) => relative.startsWith(prefix)))) {
    json(res, 404, { error: 'not found' });
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
  // index.html is the one file served with a mutable body: the asset version
  // token is stamped in at response time so it always matches the running build.
  if (ext === '.html' && ASSET_VERSION) {
    let html;
    try {
      html = await readFile(filePath, 'utf8');
    } catch {
      json(res, 404, { error: 'not found' });
      return;
    }
    const body = Buffer.from(versionShellAssets(html, ASSET_VERSION), 'utf8');
    res.writeHead(200, {
      'content-type': MIME[ext],
      'content-length': body.length,
      'cache-control': 'no-cache',
    });
    res.end(body);
    return;
  }
  res.writeHead(200, {
    'content-type': MIME[ext] || 'application/octet-stream',
    'content-length': info.size,
    'cache-control': ext === '.pdf' ? 'private, max-age=0' : (noCache ? 'no-cache' : 'public, max-age=3600'),
  });
  createReadStream(filePath).pipe(res);
}

await mkdir(UPLOAD_DIR, { recursive: true });

// The very first statement in the request handler binds the tenant, so every
// withTenant call anywhere below it - through download-tickets, annotation
// sync, uploads - reads the signed-in user's tenant without being changed.
const BRIDGE_PREFIX = '/api/libedge/v1';

const server = http.createServer(async (req, res) => {
  // The bridge is answered before any tenant is bound, and deliberately outside
  // runWithTenant. Its callers have no session and no cookie: a LibEdge worker signs in
  // as nobody. Binding the session tenant (or the demo tenant) first would give the
  // bridge a tenant context it never asked for, and any future bridge code that reached
  // for requestTenant() would then read an arbitrary tenant's rows and appear to work.
  // Outside the binding, that mistake throws instead. The bridge's own tenant comes from
  // the request path and is bound in libedge-bridge-db.mjs for the duration of one
  // transaction.
  if (isBridgePath(req.url)) {
    return handleBridgeRoute(req, res);
  }
  const boundTenant = readSession(req)?.tenantId || TENANT_ID;
  // /opds carries no session cookie. Re-binding the request to the OPDS tenant
  // once the token has been checked is what makes listBooks and opdsFeed agree
  // with the tenant opdsTokenAuth resolved; otherwise the feed queries the env
  // tenant and returns an empty catalogue to a correctly authenticated client.
  const opdsTenant = await opdsTenantFor(req);
  return runWithTenant(opdsTenant || boundTenant, () => handleRequest(req, res));
});

// Prefix check on the raw path, before parsing: the bridge must be recognisable even
// when the URL is malformed, otherwise a request that `new URL` rejects would be
// answered by the app's 400 instead of the bridge's error shape.
function isBridgePath(rawUrl) {
  const path = String(rawUrl || '').split('?')[0];
  return path === BRIDGE_PREFIX || path.startsWith(`${BRIDGE_PREFIX}/`);
}

// Everything below is translation between http and handleBridgeRequest; no bridge
// decision is made here. The body is read before the call because the request stream is
// the server's, and the status and headers are set from what comes back because the
// response stream is too.
async function handleBridgeRoute(req, res) {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    // A malformed URL is still a bridge request: the answer is the contract's error
    // shape, not a bare string, or LibEdge parses it as a crash.
    json(res, 400, { error: 'INVALID_BODY', detail: 'malformed url' });
    return;
  }
  // Still percent-encoded, on purpose. `url.pathname` is the raw path as Node parsed it,
  // and the bridge decodes each segment exactly once (see splitPath in
  // libedge-bridge-api.mjs). Decoding here as well would decode twice: a ref written
  // `a%2525b` would arrive as `a%`, and - worse - an encoded `%2F` would become a real
  // separator that the route table and every later reader could not tell from one the
  // caller sent. Removing the prefix from the raw path also keeps the slice exact: the
  // prefix is ASCII, so a later byte never changes the offset.
  const pathname = url.pathname.slice(BRIDGE_PREFIX.length) || '/';

  const requestId = String(req.headers['x-request-id'] || '').trim() || randomUUID();
  res.setHeader('x-request-id', requestId);
  res.setHeader('cache-control', 'no-store');

  let body = {};
  try {
    body = await readBridgeBody(req);
  } catch (error) {
    // readJson throws on oversized or unparseable bodies. Both are the caller's fault
    // and both get INVALID_BODY rather than an unhandled rejection.
    json(res, 400, { error: 'INVALID_BODY', request_id: requestId, detail: error.message });
    return;
  }

  const query = {};
  for (const [key, value] of url.searchParams) {
    if (!(key in query)) query[key] = value;
  }

  let answer;
  try {
    answer = await handleBridgeRequest({
      env: process.env,
      pool,
      catalogPool,
      method: req.method,
      pathname,
      // Only the headers the bridge reads, lower-cased: handing it the whole set would
      // invite a later reader to trust something the contract does not define.
      headers: {
        authorization: req.headers.authorization,
        'x-libedge-actor': req.headers['x-libedge-actor'],
      },
      body,
      query,
      requestId,
      now: new Date(),
    });
  } catch (error) {
    // handleBridgeRequest turns every expected failure into an answer; anything thrown
    // here is a bug or a broken connection, and it must still be a JSON body so the
    // caller does not retry against a parse error. The message is logged, not returned:
    // a database error can name a column and a table.
    console.error('[bridge] unhandled error', requestId, error?.message, error?.code, error?.routine);
    json(res, 500, { error: 'INTERNAL', request_id: requestId });
    return;
  }
  json(res, answer.status, answer.body);
}

// A GET has no body and readJson would return {} for an empty stream, but a caller that
// sends one anyway must not have it silently dropped.
async function readBridgeBody(req) {
  if (req.method === 'GET' || req.method === 'DELETE' || req.method === 'HEAD') return {};
  return readJson(req);
}

// Cheap enough to run on every request: it only touches env, and only for a GET
// of /opds. The API key itself is not checked here and must not be: binding a
// tenant is not authorising anything. opdsTokenAuth stays the gate, and a request
// without a valid key is rejected before any book is read.
async function opdsTenantFor(req) {
  if (req.method !== 'GET') return null;
  const pathname = String(req.url || '').split('?')[0];
  if (pathname !== '/opds') return null;
  if (!String(process.env.OPDS_API_KEY || '').trim()) return null;
  return String(process.env.OPDS_TENANT_ID || '').trim() || null;
}

async function handleRequest(req, res) {
  const requestStarted = performance.now();
  let url;
  let pathname;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'bad request' }));
    return;
  }

  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
  res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('cross-origin-opener-policy', 'same-origin');
  if (/\/download(?:-ticket)?$/.test(pathname)) {
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('cache-control', 'no-store');
  }
  res.setHeader('content-security-policy', APP_CSP);

  try {
    if (pathname === '/sushi' && req.method === 'GET') {
      const apiKey = process.env.SUSHI_API_KEY;
      if (apiKey && url.searchParams.get('api_key') !== apiKey) {
        res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('SUSHI api_key required');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/xml; charset=utf-8', 'cache-control': 'no-store' });
      res.end(await sushiResponse(url));
      return;
    }
    if (pathname === '/oai' && req.method === 'GET') {
      const token = process.env.OAI_TOKEN;
      if (token && url.searchParams.get('token') !== token) {
        res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('OAI token required');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/xml; charset=utf-8', 'cache-control': 'public, max-age=300' });
      res.end(await oaiResponse(url, req));
      return;
    }
    if (pathname === '/api/health') {
      json(res, 200, { ok: true, mode: pool ? 'db' : 'demo', tenantId: TENANT_ID });
      return;
    }
    // Deliberately unauthenticated: the footer needs brand/version/build values
    // before login. Decision (2026-10-26): keep it public as-is — the build
    // metadata is low-sensitivity and /api/health already exposes mode/tenantId.
    // Revisit only if the deployment SHA must stop being enumerable.
    if (pathname === '/api/config' && req.method === 'GET') {
      json(res, 200, {
        brandName: BRAND_NAME,
        brandTagline: BRAND_TAGLINE,
        mode: pool ? 'db' : 'demo',
        version: APP_VERSION,
        buildSha: BUILD_SHA,
        buildDate: BUILD_DATE,
        environment: APP_ENV,
        supportEmail: SUPPORT_EMAIL,
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

    const sessionAuth = readSession(req);
    const tokenAuth = pathname === '/opds' && req.method === 'GET'
      ? await opdsTokenAuth(req, url)
      : null;
    const auth = sessionAuth || tokenAuth;
    if (!auth && (pathname.startsWith('/api/') || pathname.startsWith('/ocr/') || pathname === '/opds')) {
      json(res, 401, { error: 'authentication required' });
      return;
    }
    if (sessionAuth && !(await sessionIsValid(sessionAuth))) {
      clearSessionCookie(res, isSecureRequest(req));
      json(res, 401, { error: 'session revoked' });
      return;
    }
    const downloadRoute = pathname.match(/^\/api\/books\/([^/]+)\/(download-ticket|download)$/);
    if (downloadRoute && pool) {
      // Budget all authenticated ticket traffic before CSRF/body/query denial
      // auditing, so invalid requests cannot grow audit_events without bound.
      const limited = await downloadService.checkRequest(auth);
      if (limited) {
        res.setHeader('retry-after', String(limited.retryAfter));
        json(res, limited.status, limited.body);
        return;
      }
    }
    if (sessionAuth && ['POST', 'PATCH', 'DELETE', 'PUT'].includes(req.method) && !requireCsrf(req, sessionAuth)) {
      if (pool && /^\/api\/books\/[^/]+\/download(?:-ticket)?$/.test(pathname)) {
        await downloadService.auditDenied(auth, 'csrf_invalid');
      }
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
      const book = await handleUpload(req, auth);
      json(res, 201, book);
      return;
    }
    if (pathname === '/api/collections' && req.method === 'GET') {
      if (!canManageAccess(auth.role)) {
        json(res, 403, { error: 'yetkiniz yok' });
        return;
      }
      json(res, 200, await listCollections());
      return;
    }
    if (pathname === '/api/groups' && req.method === 'GET') {
      if (!canManageAccess(auth.role)) {
        json(res, 403, { error: 'yetkiniz yok' });
        return;
      }
      json(res, 200, await listGroups());
      return;
    }
    if (pathname === '/api/groups' && req.method === 'POST') {
      if (!canManageAccess(auth.role)) {
        json(res, 403, { error: 'yetkiniz yok' });
        return;
      }
      try {
        json(res, 201, await createGroup((await readJson(req)).name));
      } catch (error) {
        json(res, 400, { error: error.message });
      }
      return;
    }
    if (pathname.startsWith('/api/groups/') && pathname.endsWith('/members') && req.method === 'POST') {
      if (!canManageAccess(auth.role)) {
        json(res, 403, { error: 'yetkiniz yok' });
        return;
      }
      const groupId = decodeURIComponent(pathname.slice('/api/groups/'.length, -'/members'.length));
      try {
        await addGroupMember(groupId, (await readJson(req)).email);
        json(res, 201, { ok: true });
      } catch (error) {
        json(res, 400, { error: error.message });
      }
      return;
    }
    if (pathname.startsWith('/api/groups/') && pathname.endsWith('/members') && req.method === 'DELETE') {
      if (!canManageAccess(auth.role)) {
        json(res, 403, { error: 'yetkiniz yok' });
        return;
      }
      const groupId = decodeURIComponent(pathname.slice('/api/groups/'.length, -'/members'.length));
      const email = String(url.searchParams.get('email') || '').trim().toLocaleLowerCase('tr');
      if (!email) {
        json(res, 400, { error: 'email required' });
        return;
      }
      let userId = null;
      if (!pool) {
        userId = email.startsWith('reader') ? USER_ID : '44444444-4444-4444-4444-444444444444';
      } else {
        userId = await withTenant(async (client) => {
          const { rows } = await client.query('select id from users where email = $1 limit 1', [email]);
          return rows[0]?.id || null;
        });
      }
      if (!userId || !await removeGroupMember(groupId, userId)) {
        json(res, 404, { error: 'member not found' });
        return;
      }
      json(res, 200, { ok: true });
      return;
    }
    if (pathname === '/api/grants' && req.method === 'GET') {
      if (!canManageAccess(auth.role)) {
        json(res, 403, { error: 'yetkiniz yok' });
        return;
      }
      json(res, 200, await listGrants());
      return;
    }
    if (pathname === '/api/grants/usage' && req.method === 'GET') {
      if (!canManageAccess(auth.role)) {
        json(res, 403, { error: 'yetkiniz yok' });
        return;
      }
      json(res, 200, await grantUsage());
      return;
    }
    if (pathname === '/api/grants/audit' && req.method === 'GET') {
      if (!canManageAccess(auth.role)) {
        json(res, 403, { error: 'yetkiniz yok' });
        return;
      }
      json(res, 200, await grantAuditLog(50));
      return;
    }
    if (pathname === '/api/grants' && req.method === 'POST') {
      if (!canManageAccess(auth.role)) {
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
      if (!canManageAccess(auth.role)) {
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
    if (pathname === '/api/reports/usage.csv' && req.method === 'GET') {
      if (!canManageAccess(auth.role)) {
        json(res, 403, { error: 'yetkiniz yok' });
        return;
      }
      res.writeHead(200, {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="usage.csv"',
        'cache-control': 'no-store',
      });
      res.end(await usageCsv());
      return;
    }
    if (pathname === '/opds' && req.method === 'GET') {
      const feed = await opdsFeed(auth, req);
      res.writeHead(200, {
        'content-type': 'application/atom+xml;profile=opds-catalog;kind=acquisition; charset=utf-8',
        'cache-control': 'private, max-age=60',
      });
      res.end(feed);
      return;
    }
    const ticketRoute = pathname.match(/^\/api\/books\/([^/]+)\/(download-ticket|download)$/);
    if (ticketRoute) {
      if (!pool) {
        json(res, 503, { error: 'downloads require database-backed tickets' });
        return;
      }
      if (req.method !== 'POST' || url.search) {
        const denied = await downloadService.auditDenied(auth, url.search ? 'url_parameters_forbidden' : 'post_required', true);
        json(res, denied.status, denied.body);
        return;
      }
      const bookId = ticketRoute[1];
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bookId)) {
        const denied = await downloadService.auditDenied(auth, 'invalid_book_id', false, 400);
        json(res, denied.status, denied.body);
        return;
      }
      let body;
      try { body = await readJson(req, 4096); }
      catch {
        const denied = await downloadService.auditDenied(auth, 'invalid_body', false, 400);
        json(res, denied.status, denied.body);
        return;
      }
      const result = ticketRoute[2] === 'download-ticket'
        ? await downloadService.issue(bookId, auth, body)
        : await downloadService.consume(bookId, auth, body);
      if (result.status !== 200) {
        if (result.retryAfter) res.setHeader('retry-after', String(result.retryAfter));
        json(res, result.status, result.body);
        return;
      }
      const book = result.book;
      let validStorageKey = true;
      let storageKeyError = '';
      try { assetStorage.validate(book.storage_key); } catch (error) { validStorageKey = false; storageKeyError = error.message; }
      if (!validStorageKey) {
        // A stored key the reader cannot serve is a data defect, not a user action:
        // record why, so the operator does not have to guess from a bare 409.
        console.warn('[download] invalid storage key:', storageKeyError);
        await downloadService.auditDenied(auth, 'invalid_storage_key', false, 403,
          { error: deliveryErrorDetail(storageKeyError) }, book);
        json(res, 409, { error: 'download unavailable' });
        return;
      }
      const format = book.format === 'epub' ? 'epub' : 'pdf';
      let payload;
      try {
        const source = await assetStorage.read(book.storage_key);
        payload = result.watermark ? await watermarkDownload(source, format, auth) : source;
      } catch (error) {
        // No fallback to unwatermarked bytes after a stamp/parse/read failure.
        // The reason must survive: a malformed source file (e.g. XHTML that is not
        // well-formed) is otherwise indistinguishable from a storage outage, which
        // is exactly how a permanently undownloadable title stayed invisible.
        console.warn(`[download] ${format} delivery failed:`, error.message);
        await downloadService.auditDenied(auth, 'delivery_failed', false, 403,
          { format, error: deliveryErrorDetail(error.message) }, book);
        json(res, 409, { error: 'download unavailable' });
        return;
      }
      await logUsage('book.download', book, auth);
      const filename = `${book.title.replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 80) || 'kitap'}.${format}`;
      res.writeHead(200, {
        'content-type': format === 'epub' ? 'application/epub+zip' : 'application/pdf',
        'content-length': payload.length,
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'cache-control': 'no-store',
      });
      res.end(payload);
      return;
    }
    if (pathname === '/api/books' && req.method === 'GET') {
      json(res, 200, await listBooks(auth));
      return;
    }
    if (pathname.startsWith('/api/books/') && req.method === 'PATCH') {
      const id = pathname.slice('/api/books/'.length);
      const existing = await getBook(id);
      if (!existing) {
        json(res, 404, { error: 'book not found' });
        return;
      }
      if (!canEditBook(auth, existing)) {
        json(res, 403, { error: 'yetkiniz yok' });
        return;
      }
      const book = await updateBook(id, await readJson(req));
      if (!book) {
        json(res, 404, { error: 'book not found' });
        return;
      }
      json(res, 200, book);
      return;
    }
    if (pathname.startsWith('/api/books/') && req.method === 'DELETE') {
      const id = decodeURIComponent(pathname.slice('/api/books/'.length));
      const existing = await getBook(id);
      if (!existing) {
        json(res, 404, { error: 'book not found' });
        return;
      }
      if (!canEditBook(auth, existing)) {
        json(res, 403, { error: 'yetkiniz yok' });
        return;
      }
      const result = await deleteUploadedBook(id);
      if (result.status === 'not_found') {
        json(res, 404, { error: 'book not found' });
        return;
      }
      if (result.status === 'not_uploaded') {
        json(res, 409, { error: 'only platform-managed titles can be deleted' });
        return;
      }
      for (const key of result.keys) {
        await assetStorage.remove(key).catch(() => console.warn('[storage] deleted title has an orphaned file; cleanup required')); 
      }
      json(res, 200, { ok: true });
      return;
    }
    if (pathname === '/api/search' && req.method === 'GET') {
      json(res, 200, await searchBooks(url.searchParams.get('q'), auth));
      return;
    }
    const marcMatch = pathname.match(/^\/api\/books\/([^/]+)\/marc$/);
    if (marcMatch && req.method === 'GET') {
      if (!canManageAccess(auth.role)) {
        json(res, 403, { error: 'yetkiniz yok' });
        return;
      }
      const bookId = decodeURIComponent(marcMatch[1]);
      const book = await getBook(bookId);
      if (!book || !await canAccessBook(book, auth)) {
        json(res, 404, { error: 'book not found' });
        return;
      }
      const proto = req.headers['x-forwarded-proto'] || (isSecureRequest(req) ? 'https' : 'http');
      const base = `${proto}://${req.headers.host || 'localhost'}`;
      res.writeHead(200, {
        'content-type': 'application/marc; charset=utf-8',
        'content-disposition': `attachment; filename="book-${book.id}.mrc"`,
        'cache-control': 'no-store',
      });
      res.end(marcRecord(book, base));
      return;
    }
    const ocrMatch = pathname.match(/^\/ocr\/([0-9a-f-]{36})\/(page-\d{3})\.hocr$/i);
    if (ocrMatch && req.method === 'GET') {
      const assetId = ocrMatch[1];
      const book = await getBook(assetId);
      if (!book || !await canAccessBook(book, auth)) {
        json(res, 403, { error: 'yetkiniz yok' });
        return;
      }
      const ocrPath = path.resolve(OCR_DIR, assetId, `${ocrMatch[2]}.hocr`);
      if (!ocrPath.startsWith(OCR_DIR + path.sep)) {
        json(res, 404, { error: 'not found' });
        return;
      }
      let info;
      try {
        info = await stat(ocrPath);
      } catch {
        json(res, 404, { error: 'not found' });
        return;
      }
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': info.size,
        'cache-control': 'private, no-cache',
      });
      createReadStream(ocrPath).pipe(res);
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
      if (!req.headers.range) await logUsage('book.view', book, auth);
      res.setHeader('server-timing', `app;dur=${(performance.now() - requestStarted).toFixed(1)}`);
      await servePdf(req, res, storageKey);
      return;
    }
    const annotationBase = pathname.startsWith('/api/annotations/v1') ? '/api/annotations/v1' : '/api/annotations';
    if (pathname === annotationBase && req.method === 'GET') {
      if (url.searchParams.has('ownerId') && url.searchParams.get('ownerId') !== auth.userId) { json(res, 403, { error: 'annotation owner mismatch' }); return; }
      json(res, 200, await listAnnotations(url.searchParams.get('assetId'), auth.userId));
      return;
    }
    if ((pathname === annotationBase && req.method === 'POST')
        || (pathname.startsWith(annotationBase + '/') && ['PATCH', 'DELETE'].includes(req.method))) {
      const id = req.method === 'POST' ? null : pathname.slice(annotationBase.length + 1);
      const result = await annotationMutation(req.method, id, await readJson(req), auth.userId);
      json(res, result.status, result.body);
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
    const status = Number.isInteger(error.statusCode) ? error.statusCode
      : error.message === 'already uploaded' ? 409
        : error.message === 'file too large' ? 413
          : /PDF|empty|required/.test(error.message || '') ? 400
            : 500;
    json(res, status, { error: error.message || 'internal error' });
  }
}

const stopDownloadMaintenance = pool ? startDownloadMaintenance(downloadMaintenanceService) : () => {};
server.once('close', stopDownloadMaintenance);
// The catalog pool is idle when no bridge request is in flight, but keeping a socket to
// the database open after the server has closed is exactly what stops a test container
// from being removed cleanly.
server.once('close', () => { if (catalogPool) catalogPool.end().catch(() => {}); });

let annotationMaintenanceTimer;
let annotationMaintenanceStart;
async function runAnnotationMaintenance() {
  if (!pool) return;
  // No request, no session: the tenants come from maintenanceTenantIds(), not from
  // the env. Each tenant gets its own transaction and its own app.tenant_id, so the
  // RLS the purge relies on is the tenant being purged rather than whichever one
  // the process happened to start with. A failing tenant is reported and skipped;
  // the others still run.
  let receiptsDeleted = 0;
  let tombstonesDeleted = 0;
  for (const tenantId of await maintenanceTenantIds()) {
    try {
      const result = await runWithTenant(tenantId, () => withTenant(async (client) => {
        await client.query('begin');
        await client.query("select set_config('app.maintenance', 'on', true)");
        try {
          const purged = await purgeAnnotationReceipts(client, {
            tenantId,
            retentionDays: ANNOTATION_RECEIPT_RETENTION_DAYS,
            tombstoneDays: ANNOTATION_TOMBSTONE_RETENTION_DAYS,
          });
          await client.query('commit');
          return purged;
        } catch (error) {
          await client.query('rollback').catch(() => {});
          throw error;
        }
      }));
      receiptsDeleted += result.receiptsDeleted;
      tombstonesDeleted += result.tombstonesDeleted;
    } catch (error) {
      console.warn(`[annotations] retention failed for tenant ${tenantId}:`, error.message);
    }
  }
  if (receiptsDeleted || tombstonesDeleted) {
    console.log(`[annotations] retention: ${receiptsDeleted} receipts, ${tombstonesDeleted} tombstones`);
  }
}
if (pool) {
  annotationMaintenanceStart = setTimeout(() => {
    runAnnotationMaintenance().catch(error => console.warn('[annotations] retention failed:', error.message));
  }, 60_000);
  annotationMaintenanceStart.unref?.();
  annotationMaintenanceTimer = setInterval(() => {
    runAnnotationMaintenance().catch(error => console.warn('[annotations] retention failed:', error.message));
  }, 6 * 60 * 60 * 1000);
  annotationMaintenanceTimer.unref?.();
}
server.once('close', () => {
  clearTimeout(annotationMaintenanceStart);
  clearInterval(annotationMaintenanceTimer);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[web] http://localhost:${PORT} (${pool ? 'db' : 'demo'} mode)`);
});
