import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { once } from 'node:events';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { serverFiles } from './helpers/server-files.mjs';
import { promisify } from 'node:util';
import pg from 'pg';
import JSZip from 'jszip';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

// Destructive authorization tests are only permitted in this owned, temporary
// database. Never accept an external URL, DATABASE_URL or existing container.
const exec = promisify(execFile);
const appDir = fileURLToPath(new URL('../', import.meta.url));
const repoDir = path.resolve(appDir, '../..');
const tempParent = path.join(appDir, 'tmp');
const runId = randomUUID();
const container = `akademik-social-drm-${runId}`;
const tenantId = '11111111-1111-1111-1111-111111111111';
const readerId = '22222222-2222-2222-2222-222222222222';
const workId = '33333333-3333-3333-3333-333333333333';
const assetId = '55555555-5555-5555-5555-555555555555';
const grantId = '77777777-7777-7777-7777-777777777777';
const epubWork = randomUUID(), epubEdition = randomUUID(), epubAsset = randomUUID();
const adminId = randomUUID(), otherId = randomUUID(), otherTenant = randomUUID();
const passwords = Array.from({ length: 4 }, () => randomBytes(24).toString('hex'));
const [dbPassword, appPassword, userPassword, sessionSecret] = passwords;
const tokens = [];
const children = [];
const genericDenials = [];
const report = { runId, startedAt: new Date().toISOString(), status: 'running', source: {}, scenarios: [], cleanup: {} };
const output = path.join(repoDir, 'tmp', `social-drm-${new Date().toISOString().replace(/[:.]/g, '-')}`);
let temporary, admin, appDatabaseUrl, adminUrl, base, peer;
let containerCreated = false;
let checks = 0;
let cleanupPromise;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
function redact(error) {
  let text = String(error?.stack || error);
  for (const secret of [...passwords, ...tokens]) text = text.replaceAll(secret, '[redacted]');
  return text.replace(/postgres(?:ql)?:\/\/[^\s]+/g, '[database connection redacted]');
}
function equal(actual, expected, label) { assert.equal(actual, expected, label); checks++; }
function ok(condition, label) { assert.ok(condition, label); checks++; }
async function docker(...args) {
  return (await exec('docker', args, { timeout: 60_000, maxBuffer: 1024 * 1024, windowsHide: true })).stdout.trim();
}
async function eventually(label, fn, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  let last;
  do {
    try { if (await fn()) return; } catch (error) { last = error; }
    await pause(100);
  } while (Date.now() < deadline);
  throw new Error(`${label} timed out${last ? `: ${redact(last)}` : ''}`);
}
async function freePort() {
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  return port;
}
async function startApp() {
  const port = await freePort();
  const env = { ...process.env, DATABASE_URL: appDatabaseUrl, PORT: String(port), DEMO_TENANT_ID: tenantId, SESSION_SECRET: sessionSecret, BRAND_NAME: 'Akademik Platform', NODE_OPTIONS: '', NODE_ENV: 'test', OPDS_API_KEY: '', OPDS_USER_EMAIL: '' };
  delete env.SOCIAL_DRM_B2B; // Exercise the secure default, not an explicit true.
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: path.join(temporary, 'app'), env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  const entry = { child, error: null, log: '', base: `http://127.0.0.1:${port}` };
  children.push(entry);
  child.on('error', (error) => { entry.error = error; });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => { entry.log = (entry.log + chunk).slice(-20_000); });
  await eventually('isolated app readiness', async () => {
    if (entry.error) throw entry.error;
    assert.equal(child.exitCode, null, 'isolated app exited');
    const response = await fetch(entry.base + '/api/health', { signal: AbortSignal.timeout(1500) });
    return response.ok && (await response.json()).mode === 'db';
  });
  return entry.base;
}
async function request(route, session, { method = 'GET', body, csrf = true, headers = {}, target = base } = {}) {
  const requestHeaders = new Headers(headers);
  if (session) {
    requestHeaders.set('cookie', session.cookie);
    if (csrf) requestHeaders.set('x-csrf-token', session.csrf);
  }
  if (body !== undefined) requestHeaders.set('content-type', 'application/json');
  const response = await fetch(target + route, {
    method, headers: requestHeaders, body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual', signal: AbortSignal.timeout(20_000),
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  let data;
  try { data = JSON.parse(text); } catch { /* PDF/EPUB/Range bytes. */ }
  return { status: response.status, headers: response.headers, bytes, data,
    cookies: response.headers.getSetCookie().map((value) => value.split(';')[0]) };
}
async function login(email) {
  const response = await request('/api/login', null, { method: 'POST', body: { email, password: userPassword } });
  equal(response.status, 200, 'fixture user login');
  const csrf = response.cookies.find((value) => value.startsWith('akademik_csrf='));
  ok(csrf, 'CSRF cookie issued');
  return { cookie: response.cookies.join('; '), csrf: decodeURIComponent(csrf.slice('akademik_csrf='.length)) };
}
async function issue(session, book = workId, body = {}) {
  const response = await request(`/api/books/${book}/download-ticket`, session, { method: 'POST', body });
  equal(response.status, 201, 'download ticket issued');
  const token = response.data?.ticket;
  ok(typeof token === 'string' && /^[a-f0-9]{64}$/i.test(token), 'ticket is 256 random bits encoded as 64 hex digits');
  tokens.push(token);
  equal(response.data.expiresIn, 60, 'ticket advertises 60-second TTL');
  return { token, response };
}
async function consume(session, token, book = workId, extra = {}) {
  return request(`/api/books/${book}/download`, session, { method: 'POST', body: { ticket: token }, ...extra });
}
async function denied(session, token, book = workId) {
  const response = await consume(session, token, book);
  equal(response.status, 403, 'invalid or unauthorized ticket denied');
  equal(response.data?.error, 'download ticket rejected', 'generic denial message');
  genericDenials.push(response.data.error);
  return response;
}
async function ticketRow(token) {
  return (await admin.query('select *, extract(epoch from expires_at-created_at)::numeric as ttl from download_tickets where token_hash=$1', [sha(token)])).rows[0];
}
async function resetRateFixture() {
  // Each existing authorization scenario starts with an unused budget. Keep
  // the real limiter enabled; dedicated cross-process tests exercise its caps.
  await admin.query('delete from download_ticket_limits where tenant_id=$1', [tenantId]);
}
async function readPdf(bytes) {
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  const doc = await task.promise;
  const pages = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) pages.push((await (await doc.getPage(n)).getTextContent()).items.map((item) => item.str || '').join(' '));
  } finally { await doc.destroy(); }
  return pages.join('\n');
}
async function makeEpub() {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  zip.file('OEBPS/content.opf', '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">drm-fixture</dc:identifier><dc:title>DRM fixture</dc:title><dc:language>en</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>');
  zip.file('OEBPS/chapter.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml" lang="en"><head><title>Chapter</title></head><body><h1>Original fixture content</h1><p>Research chapter.</p></body></html>');
  return zip.generateAsync({ type: 'nodebuffer' });
}
async function setup() {
  report.postgresImage = await docker('image', 'inspect', 'postgres:16-alpine', '--format', '{{.Id}}');
  await mkdir(tempParent, { recursive: true });
  temporary = await mkdtemp(path.join(tempParent, 'social-drm-'));
  const sandbox = path.join(temporary, 'app');
  await mkdir(path.join(sandbox, 'public/seed'), { recursive: true });
  for (const file of await serverFiles(appDir)) {
    // Nested sources (public/, and sso/ since reader SSO) need their parent directory
    // before copyFile will write into it; without this a new subdirectory in
    // server.mjs's import graph fails here and nowhere else.
    await mkdir(path.dirname(path.join(sandbox, file)), { recursive: true });
    await copyFile(path.join(appDir, file), path.join(sandbox, file));
    report.source[file] = sha(await readFile(path.join(sandbox, file)));
  }
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage().drawText('Original DRM fixture content', { x: 40, y: 700, font, size: 12 });
  await writeFile(path.join(sandbox, 'public/seed/social.pdf'), await pdf.save());
  await writeFile(path.join(sandbox, 'public/seed/social.epub'), await makeEpub());
  await docker('run', '--detach', '--rm', '--name', container, '--label', `akademik.social-drm-test=${runId}`,
    '--tmpfs', '/var/lib/postgresql/data', '--publish', '127.0.0.1::5432', '--env', 'POSTGRES_USER=social_admin',
    '--env', 'POSTGRES_DB=social_test', '--env', `POSTGRES_PASSWORD=${dbPassword}`, 'postgres:16-alpine');
  containerCreated = true;
  const port = Number((await docker('port', container, '5432/tcp')).match(/:(\d+)\s*$/)?.[1]);
  ok(port, 'isolated DB port allocated');
  adminUrl = `postgres://social_admin:${dbPassword}@127.0.0.1:${port}/social_test`;
  appDatabaseUrl = `postgres://akademik_app:${appPassword}@127.0.0.1:${port}/social_test`;
  await eventually('isolated PostgreSQL readiness', async () => {
    const client = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 1000 });
    try { await client.connect(); return true; } finally { await client.end().catch(() => {}); }
  });
  admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  const schema = await readFile(path.join(repoDir, 'db/schema.sql'), 'utf8');
  const seed = await readFile(path.join(repoDir, 'db/seed.sql'), 'utf8');
  const migration = await readFile(path.join(repoDir, 'db/migrations/013-download-tickets.sql'), 'utf8');
  const migration014 = await readFile(path.join(repoDir, 'db/migrations/014-download-ticket-limits.sql'), 'utf8');
  for (const [name, text] of [['schema.sql', schema], ['seed.sql', seed], ['013-download-tickets.sql', migration], ['014-download-ticket-limits.sql', migration014]]) report.source[name] = sha(text);
  await admin.query(schema);
  await admin.query(seed);
  equal((await admin.query("select to_regclass('download_tickets')::text as name")).rows[0].name, 'download_tickets', 'fresh schema creates download tickets');
  equal((await admin.query('select download_grants_required from tenants where id=$1', [tenantId])).rows[0].download_grants_required, true, 'fresh seed triggers durable grant policy marker');
  // Simulate a real pre-013 schema inside this owned DB, preserving existing
  // tenant/grant rows so ALTER ADD COLUMN and backfill are actually exercised.
  await admin.query('drop trigger remember_download_grant_policy on grants');
  await admin.query('drop function remember_download_grant_policy()');
  await admin.query('drop table download_tickets');
  await admin.query('alter table tenants drop column download_grants_required');
  await admin.query(migration);
  equal((await admin.query('select download_grants_required from tenants where id=$1', [tenantId])).rows[0].download_grants_required, true, '013 upgrade adds marker and backfills existing grant tenant');
  await admin.query(migration);
  equal((await admin.query('select download_grants_required from tenants where id=$1', [tenantId])).rows[0].download_grants_required, true, '013 second application preserves durable marker');
  equal((await admin.query("select to_regclass('download_ticket_limits')::text as name")).rows[0].name, 'download_ticket_limits', 'fresh schema creates shared rate-limit table');
  await admin.query('drop table download_ticket_limits');
  await admin.query(migration014);
  await admin.query(migration014);
  equal((await admin.query("select to_regclass('download_ticket_limits')::text as name")).rows[0].name, 'download_ticket_limits', '014 upgrade and repeat application create shared limiter');
  checks += 2;
  await admin.query(`alter role akademik_app password '${appPassword}'`);
  // Login resolves an email to its tenant before any tenant is bound, and
  // `users` is under RLS, so the app role needs this helper. Run the real
  // migration rather than a copy: a copy can drift from what ships.
  await admin.query(await readFile(path.join(repoDir, 'db/migrations/018-tenant-for-login.sql'), 'utf8'));
  const { rows: [role] } = await admin.query("select rolsuper, rolbypassrls from pg_roles where rolname='akademik_app'");
  equal(role.rolsuper, false, 'app role is not superuser');
  equal(role.rolbypassrls, false, 'app role cannot bypass RLS');
  const salt = randomBytes(16).toString('hex');
  const hash = `scrypt$${salt}$${scryptSync(userPassword, salt, 64).toString('hex')}`;
  await admin.query('update users set password_hash=$1,max_sessions=10', [hash]);
  for (const [id, email, roleName] of [[adminId, 'admin@social.test', 'admin'], [otherId, 'other@social.test', 'reader']]) {
    await admin.query('insert into users(id,tenant_id,email,display_name,role,password_hash,max_sessions) values($1,$2,$3,$3,$4,$5,10)', [id, tenantId, email, roleName, hash]);
  }
  await admin.query("insert into tenants(id,name,slug) values($1,'Other tenant','social-other')", [otherTenant]);
  await admin.query("update assets set storage_key='seed/social.pdf',watermark=false,allow_download=true where id=$1", [assetId]);
  await admin.query("insert into works(id,tenant_id,title,language) values($1,$2,'EPUB social fixture','en')", [epubWork, tenantId]);
  await admin.query('insert into editions(id,tenant_id,work_id) values($1,$2,$3)', [epubEdition, tenantId, epubWork]);
  await admin.query("insert into assets(id,tenant_id,edition_id,format,storage_key,watermark,allow_download) values($1,$2,$3,'epub','seed/social.epub',false,true)", [epubAsset, tenantId, epubEdition]);
  base = await startApp(); peer = await startApp();
  console.log('Isolated PostgreSQL16, RLS app role and two Node servers ready; SOCIAL_DRM_B2B unset (default exercised).');
  return { reader: await login('reader@example.edu.tr'), other: await login('other@social.test'), administrator: await login('admin@social.test') };
}

async function policyAndStamps({ reader, other, administrator }) {
  equal((await request(`/api/books/${workId}/download-ticket`, null, { method: 'POST', body: {} })).status, 401, 'anonymous issue denied');
  equal((await request(`/api/books/${workId}/download-ticket`, reader, { method: 'POST', body: {}, csrf: false })).status, 403, 'issue needs CSRF');
  equal((await request(`/api/books/${workId}/download`, reader)).status, 403, 'legacy GET download cannot bypass tickets');
  const { token, response } = await issue(reader);
  const row = await ticketRow(token);
  equal(row.token_hash, sha(token), 'only SHA-256 token hash persisted');
  ok(!JSON.stringify(row).includes(token), 'raw token absent from database row');
  equal(row.user_id, readerId, 'ticket user binding persisted');
  equal(row.tenant_id, tenantId, 'ticket tenant binding persisted');
  equal(row.asset_id, assetId, 'ticket asset binding persisted');
  equal(row.work_id, workId, 'ticket work binding persisted');
  equal(Number(row.ttl), 60, 'DB-clock ticket TTL exactly 60 seconds');
  equal(new Date(response.data.expiresAt).getTime(), new Date(row.expires_at).getTime(), 'expiry response reflects database value');
  ok(row.grant_ids.includes(grantId), 'original matching grant snapshotted');
  equal((await consume(reader, token, workId, { csrf: false })).status, 403, 'consume needs CSRF');
  await denied(other, token);
  const pdf = await consume(reader, token);
  equal(pdf.status, 200, 'authorized PDF ticket consumed');
  ok(pdf.headers.get('content-type')?.includes('application/pdf'), 'download returns PDF');
  const text = await readPdf(pdf.bytes);
  for (const marker of ['Akademik Platform', readerId, tenantId, 'reader@example.edu.tr']) ok(text.includes(marker), 'PDF stamp contains required identity marker despite watermark=false');
  ok(/\d{4}-\d{2}-\d{2}/.test(text), 'PDF stamp contains date');
  ok((await ticketRow(token)).consumed_at, 'consumed_at persisted');
  await denied(reader, token);
  const { saveOfflineDownload } = await import(pathToFileURL(path.join(temporary, 'app/public/downloads.mjs')).href);
  const helperCalls = [];
  const helperFetch = async (route, options) => {
    helperCalls.push({ route, method: options.method });
    const headers = new Headers(options.headers);
    headers.set('cookie', reader.cookie);
    headers.set('x-csrf-token', reader.csrf);
    const response = await fetch(base + route, { ...options, headers, signal: AbortSignal.timeout(20_000) });
    if (route.endsWith('/download-ticket') && response.ok) tokens.push((await response.clone().json()).ticket);
    return response;
  };
  const saved = [];
  for (const book of [{ id: workId, format: 'pdf' }, { id: epubWork, format: 'epub' }]) {
    await saveOfflineDownload(book, {
      fetch: helperFetch,
      storageEstimate: async () => ({ usage: 0, quota: 1024 * 1024 * 1024 }),
      saveOfflineBook: async (savedBook, blob, options) => { saved.push({ book: savedBook, blob, options }); return savedBook; },
    });
  }
  equal(helperCalls.length, 4, 'real offline helper makes issue+consume for PDF and EPUB');
  ok(helperCalls.every((call) => call.method === 'POST' && !call.route.includes('?') && !call.route.endsWith('/file')), 'offline helper never uses raw file route or URL tokens');
  ok(saved.every((item) => item.options.downloadProvenance === 'ticketed-download-v1'), 'offline persistence receives download provenance');
  const offlinePdfText = await readPdf(new Uint8Array(await saved[0].blob.arrayBuffer()));
  for (const marker of ['Akademik Platform', readerId, tenantId, 'reader@example.edu.tr']) ok(offlinePdfText.includes(marker), 'offline helper saves actual server-watermarked PDF identity');
  const zip = await JSZip.loadAsync(await saved[1].blob.arrayBuffer());
  const xhtml = await zip.file('OEBPS/chapter.xhtml').async('string');
  for (const marker of ['Original fixture content', 'Akademik Platform', readerId, tenantId, 'reader@example.edu.tr']) ok(xhtml.includes(marker), 'EPUB XHTML retains original and required identity marker despite watermark=false');
  ok(/\d{4}-\d{2}-\d{2}/.test(xhtml), 'EPUB stamp contains date');
  const range = await request(`/api/books/${workId}/file`, reader, { headers: { Range: 'bytes=0-63' } });
  equal(range.status, 206, 'reader Range endpoint remains available');
  equal(range.bytes.length, 64, 'reader Range has requested byte count');
  const rawRange = new TextDecoder().decode(range.bytes);
  ok(rawRange.startsWith('%PDF-'), 'reader Range remains original PDF bytes, an explicit social-DRM boundary');
  equal((await request('/downloads.mjs', reader)).status, 200, 'new browser download helper is in static allowlist');
  equal((await request(`/api/books/${workId}/download-ticket`, reader, { method: 'POST', body: { watermarkOverride: true, overrideReason: 'Institutionally authorized clean distribution fixture' } })).status, 403, 'reader cannot override watermark');
  equal((await request(`/api/books/${workId}/download-ticket`, administrator, { method: 'POST', body: { watermarkOverride: true } })).status, 400, 'admin override requires reason');
  report.scenarios.push('session/CSRF, token storage/TTL/bindings, real offline helper POST flow saves server-stamped PDF+EPUB, declared raw reader Range boundary');
  console.log('PASS ticket policy and actual PDF/EPUB identity stamps.');
}

async function rejectionAndOverride({ reader, administrator }) {
  const expired = await issue(reader);
  await admin.query("update download_tickets set created_at=now()-interval '120 seconds',expires_at=now()-interval '60 seconds' where token_hash=$1", [sha(expired.token)]);
  await denied(reader, expired.token);
  await denied(reader, randomBytes(32).toString('hex'));
  const wrongAsset = await issue(reader);
  await denied(reader, wrongAsset.token, epubWork);
  const wrongTenant = await issue(reader);
  await admin.query('update download_tickets set tenant_id=$1 where token_hash=$2', [otherTenant, sha(wrongTenant.token)]);
  await denied(reader, wrongTenant.token);
  const metadata = await issue(reader);
  equal((await consume(reader, metadata.token, workId, { body: { ticket: metadata.token, watermarkOverride: true } })).status, 403, 'consume cannot inject watermark override');
  equal((await request(`/api/books/${workId}/download?ticket=${metadata.token}`, reader, { method: 'POST', body: { ticket: metadata.token } })).status, 403, 'ticket in URL rejected');
  equal((await request(`/api/books/${workId}/download?watermarkOverride=true`, reader, { method: 'POST', body: { ticket: metadata.token } })).status, 403, 'query override rejected');
  equal((await request(`/api/books/${workId}/download-ticket?watermark=false`, reader, { method: 'POST', body: {} })).status, 403, 'issue query policy bypass rejected');
  const restricted = await issue(reader);
  await admin.query('update assets set allow_download=false where id=$1', [assetId]);
  await denied(reader, restricted.token);
  await admin.query('update assets set allow_download=true where id=$1', [assetId]);
  const revoked = await issue(reader);
  await admin.query("update grants set status='revoked' where id=$1", [grantId]);
  await denied(reader, revoked.token);
  equal((await request(`/api/books/${workId}/download-ticket`, reader, { method: 'POST', body: {} })).status, 403, 'only configured grant revoked: issue fails closed');
  const replacement = randomUUID();
  await admin.query("insert into grants(id,tenant_id,subject_type,subject_id,scope_type,status) values($1,$2,'tenant',$2,'all','active')", [replacement, tenantId]);
  await denied(reader, revoked.token);
  await admin.query('delete from grants where id=$1', [replacement]);
  await admin.query("update grants set status='active' where id=$1", [grantId]);
  await resetRateFixture(); // Separate fixture for durable last-grant history.
  const rawDeleted = await issue(reader);
  const grantAuditBefore = (await admin.query('select count(*)::int as n from grant_audit')).rows[0].n;
  await admin.query('delete from grants where id=$1', [grantId]);
  equal((await admin.query('select count(*)::int as n from grant_audit')).rows[0].n, grantAuditBefore, 'direct SQL deletion has no application grant audit');
  equal((await admin.query('select download_grants_required from tenants where id=$1', [tenantId])).rows[0].download_grants_required, true, 'durable tenant marker survives direct final-grant deletion');
  await denied(reader, rawDeleted.token);
  equal((await request(`/api/books/${workId}/download-ticket`, reader, { method: 'POST', body: {} })).status, 403, 'direct final-grant deletion also prevents new ticket issue');
  await admin.query("insert into grants(id,tenant_id,subject_type,subject_id,scope_type,status) values($1,$2,'tenant',$2,'all','active')", [grantId, tenantId]);
  const deleted = await issue(reader);
  equal((await request(`/api/grants/${grantId}`, administrator, { method: 'DELETE' })).status, 200, 'administrator deletes final grant through audited API');
  await denied(reader, deleted.token);
  equal((await request(`/api/books/${workId}/download-ticket`, reader, { method: 'POST', body: {} })).status, 403, 'deleted final grant history prevents new ticket issue');
  await admin.query("insert into grants(id,tenant_id,subject_type,subject_id,scope_type,status) values($1,$2,'tenant',$2,'all','active')", [grantId, tenantId]);
  await resetRateFixture(); // Separate fixture for exceptional admin override.
  const bypass = await issue(administrator, workId, { watermarkOverride: true, overrideReason: 'Institutionally authorized clean distribution fixture' });
  const bypassRow = await ticketRow(bypass.token);
  equal(bypassRow.watermark_override, true, 'approved override stored on ticket');
  equal(bypassRow.override_reason, 'Institutionally authorized clean distribution fixture', 'approved override reason persisted');
  const clean = await consume(administrator, bypass.token);
  equal(clean.status, 200, 'authorized admin override consumed');
  const cleanText = await readPdf(clean.bytes);
  ok(!cleanText.includes('Akademik Platform') && cleanText.includes('Original DRM fixture content'), 'explicit approved override produces clean original PDF');
  const demoted = await issue(administrator, workId, { watermarkOverride: true, overrideReason: 'Distribution approved before account role changed' });
  await admin.query("update users set role='reader' where id=$1", [adminId]);
  equal((await request(`/api/books/${workId}/download-ticket`, administrator, { method: 'POST', body: { watermarkOverride: true, overrideReason: 'Stale admin session must not authorize distribution' } })).status, 403, 'stale session admin role cannot issue override');
  await denied(administrator, demoted.token);
  await admin.query("update users set role='admin' where id=$1", [adminId]);
  report.scenarios.push('expiry/replay/user/tenant/asset/policy/grant binding; override injection and current DB admin role');
  console.log('PASS ticket rejection, current authorization and explicit admin override controls.');
}

async function atomicRaceAndRls({ reader }) {
  const race = await issue(reader);
  const consumedBefore = (await admin.query("select count(*)::int as n from audit_events where action='download.ticket.consume'")).rows[0].n;
  const gate = new pg.Client({ connectionString: adminUrl });
  await gate.connect();
  let pending;
  try {
    await gate.query('begin');
    await gate.query('select id from download_tickets where token_hash=$1 for update', [sha(race.token)]);
    pending = Promise.all([consume(reader, race.token), consume(reader, race.token, workId, { target: peer })]);
    pending.catch(() => {});
    await eventually('two process consume contenders blocked on DB lock', async () => {
      const { rows: [row] } = await admin.query("select count(*)::int as n from pg_stat_activity where usename='akademik_app' and wait_event_type='Lock' and query ilike '%download_tickets%'");
      return row.n >= 2;
    }, 10_000);
    checks++;
  } finally {
    await gate.query('rollback').catch(() => {});
    await gate.end();
  }
  const results = await pending;
  equal(results.filter((response) => response.status === 200).length, 1, 'exactly one process consumes ticket');
  equal(results.filter((response) => response.status === 403).length, 1, 'second process loses atomic consume race');
  ok((await ticketRow(race.token)).consumed_at, 'race winner persisted consumed_at');
  equal((await admin.query("select count(*)::int as n from audit_events where action='download.ticket.consume'")).rows[0].n, consumedBefore + 1, 'race has exactly one persisted consume audit');
  const { rows: [security] } = await admin.query("select relrowsecurity,relforcerowsecurity from pg_class where oid='download_tickets'::regclass");
  equal(security.relrowsecurity, true, 'ticket RLS enabled');
  equal(security.relforcerowsecurity, true, 'ticket RLS forced');
  const client = new pg.Client({ connectionString: appDatabaseUrl });
  await client.connect();
  try {
    await client.query("select set_config('app.tenant_id',$1,false)", [otherTenant]);
    equal((await client.query('select count(*)::int as n from download_tickets where token_hash=$1', [sha(race.token)])).rows[0].n, 0, 'other tenant cannot select ticket');
    equal((await client.query('update download_tickets set consumed_at=null where token_hash=$1 returning id', [sha(race.token)])).rowCount, 0, 'other tenant cannot update ticket');
    await assert.rejects(client.query('insert into download_tickets(id,token_hash,tenant_id,user_id,asset_id,work_id,grant_ids,expires_at) values($1,$2,$3,$4,$5,$6,$7,now()+interval \'60 seconds\')', [randomUUID(), sha(randomBytes(32)), tenantId, readerId, assetId, workId, [grantId]]), (error) => error.code === '42501');
    checks++;
    equal((await client.query('select count(*)::int as n from download_ticket_limits where tenant_id=$1', [tenantId])).rows[0].n, 0, 'other tenant cannot read rate budget rows');
    equal((await client.query('update download_ticket_limits set request_count=1 where tenant_id=$1 returning kind', [tenantId])).rowCount, 0, 'other tenant cannot reset rate budget');
    await assert.rejects(client.query("insert into download_ticket_limits(tenant_id,user_id,kind,window_start,request_count) values($1,$2,'issue',now(),1)", [tenantId, otherId]), (error) => error.code === '42501');
    checks++;
  } finally { await client.end(); }
  report.scenarios.push('two-process DB-barrier race: exactly one consumer; forced RLS cross-tenant select/update/insert');
  console.log('PASS synchronized two-process consume race and forced ticket RLS.');
}

async function auditChecks() {
  const { rows } = await admin.query("select action,payload from audit_events where action like 'download.%' order by id");
  for (const action of ['download.ticket.issue', 'download.ticket.consume', 'download.ticket.deny', 'download.watermark.bypass_attempt', 'download.watermark.override']) ok(rows.some((row) => row.action === action), `audit records ${action}`);
  ok(rows.filter((row) => row.action === 'download.ticket.deny').length >= genericDenials.length, 'each tested ticket rejection has a denial audit');
  ok(rows.some((row) => row.action === 'download.watermark.override' && JSON.stringify(row.payload).includes('Institutionally authorized clean distribution fixture')), 'override audit preserves approval reason');
  const serialized = JSON.stringify(rows);
  for (const token of tokens) {
    ok(!serialized.includes(token), 'audit payload never stores raw token');
    ok(!serialized.includes(sha(token)), 'audit payload never stores token hash');
  }
  ok(genericDenials.length >= 7 && genericDenials.every((message) => message === genericDenials[0]), 'all ticket rejection causes share generic message');
  report.scenarios.push('required audit actions present; raw tokens and token hashes absent from audit payloads');
  console.log('PASS audit coverage and token redaction.');
}

async function auditAtomicityAndClock({ reader }) {
  const pending = await issue(reader);
  const ticketsBefore = (await admin.query('select count(*)::int as n from download_tickets')).rows[0].n;
  await admin.query('revoke insert on audit_events from akademik_app');
  try {
    equal((await request(`/api/books/${workId}/download-ticket`, reader, { method: 'POST', body: {} })).status, 500, 'audit insert failure blocks ticket issue');
    equal((await admin.query('select count(*)::int as n from download_tickets')).rows[0].n, ticketsBefore, 'failed issue audit rolls back ticket insertion');
    equal((await consume(reader, pending.token)).status, 500, 'audit insert failure blocks download consume');
    equal((await ticketRow(pending.token)).consumed_at, null, 'failed consume audit rolls back consumed_at');
  } finally { await admin.query('grant insert on audit_events to akademik_app'); }
  equal((await consume(reader, pending.token)).status, 200, 'same ticket succeeds after audit privilege restored');

  const expiring = await issue(reader);
  const gate = new pg.Client({ connectionString: adminUrl });
  await gate.connect();
  let blocked;
  try {
    await gate.query('begin');
    await admin.query("with deadline as materialized (select clock_timestamp()+interval '250 milliseconds' as at) update download_tickets t set created_at=d.at-interval '60 seconds',expires_at=d.at from deadline d where t.token_hash=$1", [sha(expiring.token)]);
    await gate.query('select id from download_tickets where token_hash=$1 for update', [sha(expiring.token)]);
    blocked = consume(reader, expiring.token);
    blocked.catch(() => {});
    await eventually('consumer waiting before ticket expiry', async () => {
      return (await admin.query("select count(*)::int as n from pg_stat_activity where usename='akademik_app' and wait_event_type='Lock' and query ilike '%download_tickets%'")).rows[0].n >= 1;
    }, 2000);
    ok((await admin.query('select expires_at>clock_timestamp() as valid from download_tickets where token_hash=$1', [sha(expiring.token)])).rows[0].valid, 'consumer reached row lock while ticket was unexpired');
    await pause(350);
  } finally {
    await gate.query('rollback').catch(() => {});
    await gate.end();
  }
  const expired = await blocked;
  equal(expired.status, 403, 'ticket expiring during row-lock wait is denied');
  equal(expired.data?.error, 'download ticket rejected', 'expiry after lock uses generic denial');
  genericDenials.push(expired.data.error);
  equal((await ticketRow(expiring.token)).consumed_at, null, 'clock-expired ticket remains unconsumed');
  report.scenarios.push('audit INSERT failure atomically rolls back issue/consume; DB-clock expiry enforced after lock wait');
  console.log('PASS audit rollback guarantees and expiry while blocked on row lock.');
}

async function crossProcessRateLimits({ reader }) {
  await resetRateFixture();
  const ticketsBefore = (await admin.query('select count(*)::int as n from download_tickets')).rows[0].n;
  const auditBefore = (await admin.query('select coalesce(max(id),0)::text as id from audit_events')).rows[0].id;
  const burst = await Promise.all(Array.from({ length: 14 }, (_, index) => request(`/api/books/${workId}/download-ticket`, reader, {
    method: 'POST', body: {}, target: index % 2 ? peer : base,
  })));
  equal(burst.filter((response) => response.status === 201).length, 10, 'two processes share exactly ten issued tickets per user/window');
  const blocked = burst.filter((response) => response.status === 429);
  equal(blocked.length, 4, 'remaining cross-process issue burst is rate limited');
  for (const response of burst.filter((item) => item.status === 201)) {
    ok(/^[a-f0-9]{64}$/.test(response.data?.ticket), 'rate-approved ticket has valid token');
    tokens.push(response.data.ticket);
  }
  for (const response of blocked) {
    ok(Number(response.headers.get('retry-after')) >= 1 && Number(response.headers.get('retry-after')) <= 60, 'limited issue includes bounded Retry-After');
    equal(response.data?.error, 'too many download requests', 'limited issue returns generic rate error');
  }
  equal((await admin.query('select count(*)::int as n from download_tickets')).rows[0].n, ticketsBefore + 10, 'issue limit prevents extra ticket inserts');
  const audits = (await admin.query('select action from audit_events where id>$1', [auditBefore])).rows;
  equal(audits.filter((row) => row.action === 'download.ticket.issue').length, 10, 'only accepted issues write ticket issue audits');
  equal(audits.filter((row) => row.action === 'download.rate_limit').length, 1, 'issue overflow writes one summary for its window');
  equal(audits.length, 11, 'subsequent rejected issues do not amplify audit log');
  const issueLimit = (await admin.query("select request_count,notified from download_ticket_limits where tenant_id=$1 and user_id=$2 and kind='issue'", [tenantId, readerId])).rows[0];
  equal(issueLimit.request_count, 11, 'issue counter saturates at limit plus one');
  equal(issueLimit.notified, true, 'issue summary notification persisted');
  await admin.query("update download_ticket_limits set window_start=clock_timestamp()-interval '2 minutes' where tenant_id=$1 and user_id=$2", [tenantId, readerId]);
  await issue(reader);

  await resetRateFixture();
  const floodAuditBefore = (await admin.query('select coalesce(max(id),0)::text as id from audit_events')).rows[0].id;
  const noToken = '0'.repeat(64);
  const flood = await Promise.all(Array.from({ length: 60 }, async (_, index) => {
    const type = index % 3;
    const response = await request(`/api/books/${workId}/download${type === 0 ? '?watermark=false' : ''}`, reader, {
      method: 'POST', body: { ticket: noToken }, csrf: type !== 1, target: index % 2 ? peer : base,
    });
    return { type, response };
  }));
  equal(flood.filter(({ response }) => response.status === 403).length, 40, 'traffic budget includes invalid tickets, query bypass and CSRF failures');
  equal(flood.filter(({ response }) => response.status === 429).length, 20, 'traffic overflow is shared across two processes');
  for (const { response } of flood.filter((item) => item.response.status === 429)) ok(Number(response.headers.get('retry-after')) >= 1, 'traffic overflow has Retry-After');
  const floodAudits = (await admin.query('select action from audit_events where id>$1', [floodAuditBefore])).rows;
  equal(floodAudits.filter((row) => row.action === 'download.rate_limit').length, 1, 'traffic flood writes only one overflow summary');
  equal(floodAudits.filter((row) => row.action === 'download.ticket.deny').length, 40, 'overflow requests do not add per-request denial audits');
  const queryDenials = flood.filter(({ type, response }) => type === 0 && response.status === 403).length;
  equal(floodAudits.filter((row) => row.action === 'download.watermark.bypass_attempt').length, queryDenials, 'only admitted query attempts write bypass audit');
  equal(floodAudits.length, 41 + queryDenials, 'total flood audit growth stays within admitted request budget plus one summary');
  const trafficLimit = (await admin.query("select request_count,notified from download_ticket_limits where tenant_id=$1 and user_id=$2 and kind='traffic'", [tenantId, readerId])).rows[0];
  equal(trafficLimit.request_count, 41, 'traffic counter saturates at limit plus one');
  equal(trafficLimit.notified, true, 'traffic summary notification persisted');
  await admin.query("update download_ticket_limits set window_start=clock_timestamp()-interval '2 minutes' where tenant_id=$1 and user_id=$2", [tenantId, readerId]);
  await issue(reader);
  report.scenarios.push('DB issue10/min and traffic40/min shared across processes; Retry-After, saturating counters, bounded audit and expired-window recovery');
  console.log('PASS cross-process ticket issue/traffic limits and bounded flood audits.');
}

async function stopApps() {
  for (const { child } of children) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit').catch(() => {});
      child.kill();
      await Promise.race([exited, pause(3000)]);
      if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; }
    }
  }
}

async function maintenanceBounds() {
  // Stop only our two temporary HTTP processes after their tests. Their real
  // scheduled workers must not race the explicitly controlled purge fixtures.
  await stopApps();
  await resetRateFixture();
  const { createDownloadService } = await import(pathToFileURL(path.join(temporary, 'app/download-tickets.mjs')).href);
  const pool = new pg.Pool({ connectionString: appDatabaseUrl, max: 2, statement_timeout: 3000, query_timeout: 5000 });
  const withTenant = async (fn) => {
    const client = await pool.connect();
    try { await client.query("select set_config('app.tenant_id',$1,false)", [tenantId]); return await fn(client); }
    finally { client.release(); }
  };
  const service = createDownloadService({ withTenant, tenantId: () => tenantId, b2b: true });
  const gate = new pg.Client({ connectionString: adminUrl });
  await gate.connect();
  const prefix = `purge-${runId}-`;
  const lockedHash = sha(prefix + 'locked'), recentHash = sha(prefix + 'recent'), foreignHash = sha(prefix + 'foreign');
  let rowLockHeld = false;
  try {
    await gate.query("select pg_advisory_lock(hashtext($1),hashtext('download-maintenance'))", [tenantId]);
    await admin.query("insert into download_tickets(token_hash,tenant_id,user_id,asset_id,work_id,created_at,expires_at) select encode(sha256(convert_to($1||n::text,'UTF8')),'hex'),$2,$3,$4,$5,now()-interval '121 minutes',now()-interval '120 minutes' from generate_series(1,1005) as n", [prefix, tenantId, readerId, assetId, workId]);
    for (const [hash, tenant, expiry] of [[lockedHash, tenantId, '120 minutes'], [recentHash, tenantId, '30 minutes'], [foreignHash, otherTenant, '120 minutes']]) {
      await admin.query("insert into download_tickets(token_hash,tenant_id,user_id,asset_id,work_id,created_at,expires_at) values($1,$2,$3,$4,$5,now()-$6::interval-interval '60 seconds',now()-$6::interval)", [hash, tenant, readerId, assetId, workId, expiry]);
    }
    await admin.query("insert into download_ticket_limits(tenant_id,user_id,kind,window_start,request_count,notified) values($1,$2,'issue',now()-interval '2 days',1,false),($1,$3,'traffic',now(),1,false),($4,$2,'traffic',now()-interval '2 days',1,false)", [tenantId, otherId, readerId, otherTenant]);
    const skipped = await service.maintenance(tenantId);
    equal(skipped.skipped, true, 'maintenance skips when another backend owns tenant advisory lock');
    equal(skipped.ticketsDeleted, 0, 'skipped maintenance deletes no tickets');
    equal(skipped.limitsDeleted, 0, 'skipped maintenance deletes no counters');
    await gate.query('begin'); rowLockHeld = true;
    await gate.query('select id from download_tickets where token_hash=$1 for update', [lockedHash]);
    await gate.query("select pg_advisory_unlock(hashtext($1),hashtext('download-maintenance'))", [tenantId]);
    const first = await service.maintenance(tenantId);
    equal(first.ticketsDeleted, 1000, 'maintenance ticket batch is capped at 1000');
    equal(first.limitsDeleted, 1, 'only tenant stale rate rows are removed');
    const second = await service.maintenance(tenantId);
    equal(second.ticketsDeleted, 5, 'second batch removes remaining unlocked aged tickets');
    ok((await admin.query('select id from download_tickets where token_hash=$1', [lockedHash])).rowCount === 1, 'SKIP LOCKED preserves locked ticket without blocking');
    await gate.query('rollback'); rowLockHeld = false;
    equal((await service.maintenance(tenantId)).ticketsDeleted, 1, 'unlocked aged ticket is removed on next maintenance');
    equal((await admin.query('select count(*)::int as n from download_tickets where token_hash=any($1::text[])', [[recentHash, foreignHash]])).rows[0].n, 2, 'recently expired and other-tenant tickets are retained');
    equal((await admin.query("select count(*)::int as n from download_ticket_limits where (tenant_id=$1 and user_id=$2 and kind='traffic') or tenant_id=$3", [tenantId, readerId, otherTenant])).rows[0].n, 2, 'current and other-tenant rate counters are retained');
    report.scenarios.push('real PostgreSQL maintenance: tenant advisory exclusion, SKIP LOCKED, 1000-row batches, expiry age and tenant boundaries');
    console.log('PASS bounded tenant maintenance, advisory exclusion and SKIP LOCKED.');
  } finally {
    if (rowLockHeld) await gate.query('rollback').catch(() => {});
    await gate.query("select pg_advisory_unlock(hashtext($1),hashtext('download-maintenance'))", [tenantId]).catch(() => {});
    await gate.end();
    await pool.end();
  }
}

async function cleanup() {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    await stopApps();
    report.cleanup.appsStopped = children.every(({ child }) => child.exitCode !== null || child.signalCode !== null);
    await admin?.end().catch(() => {});
    if (containerCreated) {
      equal(await docker('inspect', '--format', '{{index .Config.Labels "akademik.social-drm-test"}}', container), runId, 'owned test container label matches');
      await docker('rm', '--force', container);
      report.cleanup.databaseRemoved = true;
    }
    if (temporary) {
      const relative = path.relative(path.resolve(tempParent), path.resolve(temporary));
      assert.ok(relative.startsWith('social-drm-') && !relative.includes(path.sep) && !path.isAbsolute(relative), 'unsafe cleanup target');
      await rm(temporary, { recursive: true, force: true });
      report.cleanup.temporaryAppRemoved = true;
    }
  })();
  return cleanupPromise;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void cleanup().finally(() => process.exit(130)); });
try {
  const context = await setup();
  await resetRateFixture();
  await policyAndStamps(context);
  await resetRateFixture();
  await rejectionAndOverride(context);
  await resetRateFixture();
  await atomicRaceAndRls(context);
  await resetRateFixture();
  await auditAtomicityAndClock(context);
  await crossProcessRateLimits(context);
  await maintenanceBounds();
  await auditChecks();
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = redact(error);
  console.error(report.error);
  for (const entry of children) console.error(redact(entry.log).split('\n').slice(-12).join('\n'));
  process.exitCode = 1;
} finally {
  await cleanup().catch((error) => { report.status = 'failed'; report.cleanup.error = redact(error); process.exitCode = 1; });
  report.checks = checks;
  report.finishedAt = new Date().toISOString();
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`Social DRM: ${report.status}; ${checks} HTTP/DB/content checks; cleanup ${JSON.stringify(report.cleanup)}.`);
  console.log(`Report: ${path.join(output, 'results.json')}`);
}
