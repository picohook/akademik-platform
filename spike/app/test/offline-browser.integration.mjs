import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyServerFiles } from './helpers/server-files.mjs';
import { promisify } from 'node:util';
import pg from 'pg';
import JSZip from 'jszip';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');

// No target/DATABASE_URL argument: this test owns every server/database it uses.
const exec = promisify(execFile);
const appDir = fileURLToPath(new URL('../', import.meta.url));
const repoDir = path.resolve(appDir, '../..');
const tempParent = path.join(appDir, 'tmp');
const runId = randomUUID(), container = `akademik-offline-browser-${runId}`;
const output = path.join(repoDir, 'docs/reader-evidence/v118-predeploy-2026-10-23/browser');
const tenantId = '11111111-1111-1111-1111-111111111111';
const userId = randomUUID(), email = 'offline-reader@browser.test';
const fixtures = [
  { id: '33333333-3333-3333-3333-333333333333', asset: '55555555-5555-5555-5555-555555555555', title: 'Browser PDF fixture', format: 'pdf', filename: 'browser.pdf', original: 'Original offline PDF fixture' },
  { id: randomUUID(), asset: randomUUID(), edition: randomUUID(), title: 'Browser EPUB fixture', format: 'epub', filename: 'browser.epub', original: 'Original offline EPUB fixture' },
  { id: randomUUID(), asset: randomUUID(), edition: randomUUID(), title: 'Browser quota rate fixture', format: 'pdf', filename: 'quota.pdf', original: 'Original quota fixture' },
];
const secrets = Array.from({ length: 4 }, () => randomBytes(24).toString('hex'));
const [dbPassword, appPassword, password, sessionSecret] = secrets;
const tickets = [], traffic = [], deliveryBodies = new Map(), pending = [], browserErrors = [];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { runId, startedAt: new Date().toISOString(), version: 118, status: 'running', source: {}, cases: [], cleanup: {}, limitations: ['CDP native origin quota override; not physical disk-full hardware.', 'Only generated small PDF and reflowable EPUB; no scan/500MB fixture.', 'Isolated loopback app and PostgreSQL; not production or human screen-reader acceptance.'] };
let temporary, admin, app, browser, context, page, base, cdp, containerCreated = false, phase = 'setup', appLog = '';
function redact(error) { let value = String(error?.stack || error); for (const token of [...secrets, ...tickets]) value = value.replaceAll(token, '[redacted]'); return value.replace(/postgres(?:ql)?:\/\/[^\s]+/g, '[database connection redacted]'); }
async function persist() { const text = JSON.stringify(report, null, 2); assert.ok(![...secrets, ...tickets].some(secret => text.includes(secret)), 'evidence contains no secrets'); await writeFile(path.join(output, 'results.json'), text); }
async function docker(...args) { return (await exec('docker', args, { timeout: 60000, maxBuffer: 1024 * 1024, windowsHide: true })).stdout.trim(); }
async function until(label, fn, timeout = 30000) { const end = Date.now() + timeout; let last; do { try { const value = await fn(); if (value) return value; } catch (e) { last = e; } await pause(100); } while (Date.now() < end); throw new Error(`${label} timed out${last ? ': ' + redact(last) : ''}`); }
async function freePort() { const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening'); const port = socket.address().port; await new Promise((resolve, reject) => socket.close(e => e ? reject(e) : resolve())); return port; }
async function stage(id, fn) { phase = id; const result = await fn(); report.cases.push({ ...result, id, status: 'PASS' }); await persist(); console.log(JSON.stringify({ id, status: 'PASS' })); }
async function pdf(original) { const doc = await PDFDocument.create(); const font = await doc.embedFont(StandardFonts.Helvetica); doc.addPage([600, 760]).drawText(original, { x: 40, y: 680, size: 14, font }); return Buffer.from(await doc.save()); }
async function epub() { const zip = new JSZip(); zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' }); zip.file('META-INF/container.xml', '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'); zip.file('OEBPS/content.opf', '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">offline-browser</dc:identifier><dc:title>Offline EPUB</dc:title><dc:language>en</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>'); zip.file('OEBPS/chapter.xhtml', `<html xmlns="http://www.w3.org/1999/xhtml" lang="en"><head><title>Offline chapter</title></head><body><h1>${fixtures[1].original}</h1><p>Research chapter persists after hard reload without network.</p></body></html>`); return zip.generateAsync({ type: 'nodebuffer' }); }
async function readPdf(bytes) { const doc = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise; try { const chunks = []; for (let n = 1; n <= doc.numPages; n++) chunks.push((await (await doc.getPage(n)).getTextContent()).items.map(item => item.str || '').join(' ')); return chunks.join('\n'); } finally { await doc.destroy(); } }
async function setup() {
  await mkdir(output, { recursive: true });
  let previous;
  try { previous = JSON.parse(await readFile(path.join(output, 'results.json'), 'utf8')); } catch { /* first run */ }
  if (previous?.status === 'failed') {
    assert.match(previous.runId, /^[0-9a-f-]{36}$/);
    const failed = path.resolve(output, 'failed-attempt', previous.runId);
    assert.ok(failed.startsWith(path.resolve(output) + path.sep));
    await mkdir(failed, { recursive: true });
    for (const entry of await readdir(output, { withFileTypes: true })) if (entry.isFile()) await rename(path.join(output, entry.name), path.join(failed, entry.name));
    await writeFile(path.join(failed, 'README.md'), 'Failed isolated attempt retained for diagnosis. Its status and limitations remain authoritative for that attempt; this is not final acceptance. All recorded cleanup results are in results.json.\n');
  }
  await mkdir(output, { recursive: true }); await mkdir(tempParent, { recursive: true });
  temporary = await mkdtemp(path.join(tempParent, 'offline-browser-'));
  const isolated = path.join(temporary, 'app'); await mkdir(isolated);
  await copyServerFiles(appDir, isolated);
  await cp(path.join(appDir, 'public'), path.join(isolated, 'public'), { recursive: true, filter: file => !['uploads', 'ocr'].some(name => file === path.join(appDir, 'public', name) || file.startsWith(path.join(appDir, 'public', name) + path.sep)) });
  const sourceFiles = ['server.mjs', 'tenant-context.mjs', 'storage.mjs', 'indexer.mjs', 'download-tickets.mjs', 'annotation-sync.mjs', 'social-watermark.mjs', 'public/app.js', 'public/index.html', 'public/offline.mjs', 'public/downloads.mjs', 'public/sw.js', 'public/epub-engine.mjs', 'public/styles.css', 'public/i18n.mjs', 'public/citations.mjs', 'public/book-variants.mjs'];
  for (const file of sourceFiles) { const bytes = await readFile(path.join(isolated, file)); assert.equal(sha(bytes), sha(await readFile(path.join(appDir, file)))); report.source[file] = sha(bytes); }
  await mkdir(path.join(isolated, 'public/seed'), { recursive: true });
  for (const fixture of fixtures) await writeFile(path.join(isolated, 'public/seed', fixture.filename), fixture.format === 'epub' ? await epub() : await pdf(fixture.original));
  report.postgresImage = await docker('image', 'inspect', 'postgres:16-alpine', '--format', '{{.Id}}');
  await docker('run', '--detach', '--rm', '--name', container, '--label', `akademik.offline-browser-test=${runId}`, '--tmpfs', '/var/lib/postgresql/data', '--publish', '127.0.0.1::5432', '--env', 'POSTGRES_USER=browser_admin', '--env', 'POSTGRES_DB=browser_test', '--env', `POSTGRES_PASSWORD=${dbPassword}`, 'postgres:16-alpine'); containerCreated = true;
  const port = Number((await docker('port', container, '5432/tcp')).match(/:(\d+)\s*$/)?.[1]); assert.ok(port);
  const adminUrl = `postgres://browser_admin:${dbPassword}@127.0.0.1:${port}/browser_test`;
  await until('PostgreSQL ready', async () => { const client = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 1000 }); try { await client.connect(); return true; } finally { await client.end().catch(() => {}); } });
  admin = new pg.Client({ connectionString: adminUrl }); await admin.connect();
  for (const file of ['db/schema.sql', 'db/seed.sql']) { const bytes = await readFile(path.join(repoDir, file)); report.source[file] = sha(bytes); await admin.query(bytes.toString('utf8')); }
  await admin.query(`alter role akademik_app password '${appPassword}'`);
  const role = (await admin.query("select rolsuper, rolbypassrls from pg_roles where rolname='akademik_app'")).rows[0]; assert.equal(role.rolsuper, false); assert.equal(role.rolbypassrls, false); report.databaseRole = role;
  const salt = randomBytes(16).toString('hex'); const hash = `scrypt$${salt}$${scryptSync(password, salt, 64).toString('hex')}`;
  await admin.query('insert into users(id,tenant_id,email,display_name,role,password_hash,max_sessions) values($1,$2,$3,$3,\'reader\',$4,10)', [userId, tenantId, email, hash]);
  await admin.query('update works set title=$1, language=\'en\' where id=$2', [fixtures[0].title, fixtures[0].id]);
  await admin.query('update assets set storage_key=$1,watermark=false,allow_download=true,page_count=1 where id=$2', ['seed/' + fixtures[0].filename, fixtures[0].asset]);
  for (const fixture of fixtures.slice(1)) { await admin.query('insert into works(id,tenant_id,title,language) values($1,$2,$3,\'en\')', [fixture.id, tenantId, fixture.title]); await admin.query('insert into editions(id,tenant_id,work_id) values($1,$2,$3)', [fixture.edition, tenantId, fixture.id]); await admin.query('insert into assets(id,tenant_id,edition_id,format,storage_key,watermark,allow_download,page_count) values($1,$2,$3,$4,$5,false,true,1)', [fixture.asset, tenantId, fixture.edition, fixture.format, 'seed/' + fixture.filename]); }
  const appPort = await freePort(); base = `http://127.0.0.1:${appPort}`;
  const env = { ...process.env, DATABASE_URL: `postgres://akademik_app:${appPassword}@127.0.0.1:${port}/browser_test`, PORT: String(appPort), SESSION_SECRET: sessionSecret, DEMO_TENANT_ID: tenantId, NODE_ENV: 'test', NODE_OPTIONS: '', APP_VERSION: '118' }; delete env.SOCIAL_DRM_B2B;
  app = spawn(process.execPath, ['server.mjs'], { cwd: isolated, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); app.on('error', e => { appLog += redact(e); }); for (const stream of [app.stdout, app.stderr]) stream.on('data', bytes => appLog = (appLog + bytes).slice(-12000));
  await until('app ready', async () => { assert.equal(app.exitCode, null, redact(appLog)); return (await fetch(base + '/api/health')).ok; });
  browser = await chromium.launch({ channel: 'msedge', headless: true }); report.browser = browser.version();
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'allow' }); page = await context.newPage(); page.setDefaultTimeout(20000);
  page.on('pageerror', e => browserErrors.push({ phase, message: redact(e.message), stack: redact(e.stack) }));
  page.on('request', request => { const url = new URL(request.url()); if (url.origin === base && /^\/api\/books\/[^/]+\/(download(?:-ticket)?|file|book\.epub)$/.test(url.pathname)) traffic.push({ phase, method: request.method(), path: url.pathname }); });
  page.on('response', response => { const url = new URL(response.url()); if (url.origin !== base || response.request().method() !== 'POST') return; if (url.pathname.endsWith('/download-ticket') && response.status() === 201) { pending.push(response.json().then(payload => { if (typeof payload.ticket === 'string') tickets.push(payload.ticket); }).catch(error => browserErrors.push(redact(error)))); return; } if (!url.pathname.endsWith('/download')) return; pending.push((async () => { const bytes = await response.body(); if (response.status() === 200) deliveryBodies.set(url.pathname.split('/')[3], bytes); })().catch(error => browserErrors.push(redact(error)))); });
  const login = await context.request.post(base + '/api/login', { data: { email, password } });
  assert.equal(login.status(), 200, 'real API login populates native browser cookie jar');
  report.login = 'real API login with browser cookie jar, followed by actual UI offline card clicks';
  await page.goto(base + '/'); await page.locator('#loginScreen').waitFor({ state: 'hidden' }); await page.locator('#grid .card').first().waitFor();
  report.fixture = { tenantId, userId, email, books: fixtures.map(({ edition, ...fixture }) => fixture), b2bEnvironment: 'unset; secure default exercised', watermarkMetadata: false };
}
async function databaseBooks() { return page.evaluate(async () => { const offline = await import('/offline.mjs'); const entries = await offline.listOfflineBooks(); const result = []; for (const entry of entries) { const stored = await offline.getOfflineBook(entry.id); const bytes = new Uint8Array(await stored.blob.arrayBuffer()); const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join(''); result.push({ id: entry.id, size: stored.blob.size, type: stored.blob.type, isBlob: stored.blob instanceof Blob, downloadProvenance: stored.downloadProvenance, sha256: digest, metadata: JSON.stringify({ ...stored, blob: undefined }) }); } return result; }); }
async function captureBook(fixture) {
  const card = page.locator('#grid .card').filter({ hasText: fixture.title }); await card.locator('.offline-card-btn').click();
  await until('native IndexedDB save', async () => (await databaseBooks()).some(entry => entry.id === fixture.id)); await Promise.all(pending);
  const stored = (await databaseBooks()).find(entry => entry.id === fixture.id); assert.ok(stored.isBlob); assert.equal(stored.downloadProvenance, 'ticketed-download-v1');
  const delivered = deliveryBodies.get(fixture.id); assert.ok(delivered); assert.equal(stored.sha256, sha(delivered));
  assert.ok(tickets.length > 0, 'observed ticket values exist only in test process memory');
  assert.ok(![...secrets, ...tickets].some(secret => stored.metadata.includes(secret)));
  assert.equal(/[0-9a-f]{64}/.test(stored.metadata), false, 'native IndexedDB metadata contains no ticket/hash');
  const text = fixture.format === 'epub' ? await (await JSZip.loadAsync(delivered)).file('OEBPS/chapter.xhtml').async('string') : await readPdf(delivered);
  for (const value of [fixture.original, 'Akademik Platform', userId, tenantId, email]) assert.ok(text.includes(value), `stamp identity/original missing: ${value}`);
  const requests = traffic.filter(request => request.phase === phase); assert.deepEqual(requests.map(({ method, path: route }) => ({ method, suffix: route.split('/').at(-1) })), [{ method: 'POST', suffix: 'download-ticket' }, { method: 'POST', suffix: 'download' }]);
  await writeFile(path.join(output, `saved-${fixture.format}.${fixture.format}`), delivered); await page.screenshot({ path: path.join(output, `saved-${fixture.format}.png`) });
  return { bookId: fixture.id, sha256: stored.sha256, bytes: stored.size, nativeIndexedDBBlob: true, stampMarkers: ['user UUID', 'tenant UUID', 'email', 'platform', 'original text'], requests, downloadProvenance: stored.downloadProvenance };
}
async function nativeQuota() {
  // Chromium M144+ exposes static navigator quota. This separate controlled
  // browser restores native dynamic estimates; no API/storage/IDB is mocked.
  if (await page.locator('#reader').isVisible()) { await page.locator('#closeReader').click(); await page.locator('#reader').waitFor({ state: 'hidden' }); await pause(300); }
  await context.setOffline(false); await pause(100); await browser.close();
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-features=StaticStorageQuota'] });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'allow' });
  page = await context.newPage(); page.setDefaultTimeout(20000);
  page.on('pageerror', error => browserErrors.push({ phase, message: redact(error.message), stack: redact(error.stack) }));
  page.on('request', request => { const url = new URL(request.url()); if (url.origin === base && /^\/api\/books\/[^/]+\/(download(?:-ticket)?|file|book\.epub)$/.test(url.pathname)) traffic.push({ phase, method: request.method(), path: url.pathname }); });
  await admin.query('delete from download_ticket_limits where tenant_id=$1 and user_id=$2', [tenantId, userId]);
  const login = await context.request.post(base + '/api/login', { data: { email, password } }); assert.equal(login.status(), 200);
  await page.goto(base + '/'); await page.locator('#loginScreen').waitFor({ state: 'hidden' }); await page.locator('#grid .card').first().waitFor();
  await shellReady();
  await page.locator('#grid .card').filter({ hasText: fixtures[0].title }).locator('.offline-card-btn').click();
  await until('controlled browser native IndexedDB seed', async () => (await databaseBooks()).some(entry => entry.id === fixtures[0].id));
  cdp = await context.newCDPSession(page);
  const baseline = await page.evaluate(() => navigator.storage.estimate());
  const requestedQuota = Math.ceil(baseline.usage || 0) + 1024;
  await cdp.send('Storage.overrideQuotaForOrigin', { origin: base, quotaSize: requestedQuota });
  try {
    const observedNative = await cdp.send('Storage.getUsageAndQuota', { origin: base });
    assert.equal(observedNative.overrideActive, true); assert.equal(observedNative.quota, requestedQuota);
    const observed = await page.evaluate(() => navigator.storage.estimate());
    assert.equal(observed.quota, requestedQuota); assert.ok(observed.quota < baseline.quota);
    const before = await databaseBooks();
    await page.locator('#grid .card').filter({ hasText: fixtures[2].title }).locator('.offline-card-btn').click();
    await page.waitForFunction(() => /Çevrimdışı alan yetersiz/.test(document.querySelector('#toast')?.textContent || ''));
    const after = await databaseBooks();
    assert.deepEqual(after.map(entry => ({ id: entry.id, sha256: entry.sha256 })), before.map(entry => ({ id: entry.id, sha256: entry.sha256 })));
    assert.ok(!after.some(entry => entry.id === fixtures[2].id));
    const toast = await page.locator('#toast').innerText();
    await page.screenshot({ path: path.join(output, 'controlled-native-quota-admission.png') });
    return { browser: browser.version(), browserArgs: ['--disable-features=StaticStorageQuota'], baseline, requestedQuota, observed, observedNative, toast, unchangedBooks: after.map(entry => ({ id: entry.id, sha256: entry.sha256 })), nativeOverride: true, mockedStorage: false, coverage: 'native quota estimate admission guard; not an IndexedDB transaction QuotaExceededError or physical disk-full test' };
  } finally { await cdp.send('Storage.overrideQuotaForOrigin', { origin: base }); }
}
async function rateLimit() {
  await admin.query('delete from download_ticket_limits where tenant_id=$1 and user_id=$2', [tenantId, userId]);
  const issued = await page.evaluate(async bookId => { const statuses = []; for (let n = 0; n < 10; n++) { const response = await fetch(`/api/books/${bookId}/download-ticket`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); statuses.push(response.status); await response.text(); } return statuses; }, fixtures[2].id); assert.deepEqual(issued, Array(10).fill(201));
  const before = await databaseBooks(); const responsePromise = page.waitForResponse(response => response.url().endsWith(`/api/books/${fixtures[2].id}/download-ticket`) && response.status() === 429);
  await page.locator('#grid .card').filter({ hasText: fixtures[2].title }).locator('.offline-card-btn').click(); const response = await responsePromise; const payload = await response.json(); assert.ok(Number(response.headers()['retry-after']) > 0); assert.ok(payload.retryAfter > 0); await page.waitForFunction(() => /Çok fazla indirme isteği; \d+ saniye sonra tekrar deneyin\./.test(document.querySelector('#toast')?.textContent || '')); const after = await databaseBooks(); assert.deepEqual(after.map(entry => ({ id: entry.id, sha256: entry.sha256 })), before.map(entry => ({ id: entry.id, sha256: entry.sha256 }))); const toast = await page.locator('#toast').innerText(); await page.screenshot({ path: path.join(output, 'real-rate-limit.png') }); return { prefillStatuses: issued, httpStatus: response.status(), retryAfter: Number(response.headers()['retry-after']), toast, unchangedBookCount: after.length };
}
async function shellReady() {
  await page.evaluate(async () => { await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true })); });
  await until('SW9 complete required shell', () => page.evaluate(async () => { const cache = await caches.open('akademik-shell-v9'); const required = ['/', '/app.js', '/downloads.mjs', '/offline.mjs', '/vendor/pdfjs/pdf.mjs', '/vendor/pdfjs/pdf.worker.mjs', '/vendor/epubjs/jszip.min.js', '/vendor/epubjs/epub.min.js', '/epub-engine.mjs']; return (await Promise.all(required.map(file => cache.match(file, { ignoreSearch: true })))).every(Boolean); }));
  return { cache: 'akademik-shell-v9', controller: await page.evaluate(() => Boolean(navigator.serviceWorker.controller)) };
}
async function offlineReload() {
  await context.setOffline(true); await page.reload({ waitUntil: 'domcontentloaded' }); await page.locator('#loginScreen').waitFor({ state: 'hidden' }); await page.locator('#grid .card').filter({ hasText: fixtures[0].title }).waitFor(); assert.equal(await page.evaluate(() => navigator.onLine), false); return { hardReload: true, nativeNetworkOffline: true, cachedBooks: (await databaseBooks()).length };
}
async function renderOffline(fixture) {
  if (await page.locator('#reader').isVisible()) { await page.locator('#closeReader').click(); await page.locator('#reader').waitFor({ state: 'hidden' }); }
  await page.locator('#grid .card').filter({ hasText: fixture.title }).locator('.open-btn').click(); let text;
  if (fixture.format === 'pdf') { await page.locator('#textLayer span').first().waitFor(); await until('offline PDF original and identity', async () => { text = await page.locator('#textLayer').innerText(); return text.includes(fixture.original) && text.includes(userId) && text.includes(tenantId) && text.includes(email); }); } else { const body = page.locator('#epubView iframe').first().contentFrame().locator('body'); await body.waitFor(); await until('offline EPUB original and identity', async () => { text = await body.innerText(); return text.includes(fixture.original) && text.includes(userId) && text.includes(tenantId) && text.includes(email); }); }
  assert.equal(await page.evaluate(() => navigator.onLine), false); await page.screenshot({ path: path.join(output, `offline-render-${fixture.format}.png`) }); return { reader: fixture.format, originalAndIdentityRendered: true, nativeNetworkOffline: true };
}
async function cleanup() {
  await context?.setOffline(false).catch(() => {}); await browser?.close().catch(() => {}); report.cleanup.browser = !browser || !browser.isConnected();
  if (app && app.exitCode === null && app.signalCode === null) { app.kill(); await Promise.race([once(app, 'exit'), pause(5000)]); if (app.exitCode === null && app.signalCode === null) { app.kill('SIGKILL'); await Promise.race([once(app, 'exit'), pause(5000)]); } } report.cleanup.app = !app || app.exitCode !== null || app.signalCode !== null;
  await admin?.end().catch(() => {});
  if (containerCreated) { const label = await docker('inspect', '--format', '{{index .Config.Labels "akademik.offline-browser-test"}}', container); assert.equal(label, runId); await docker('stop', container); report.cleanup.database = true; } else report.cleanup.database = true;
  if (temporary) { const resolved = path.resolve(temporary); assert.ok(resolved.startsWith(path.resolve(tempParent) + path.sep) && path.basename(resolved).startsWith('offline-browser-')); await rm(resolved, { recursive: true, force: true }); report.cleanup.temporaryCopy = true; }
}
try {
  await setup(); console.log('Owned PostgreSQL, native Edge and API cookie-jar login ready; actual UI offline clicks follow.');
  await stage('pdf-card-native-indexeddb-stamped-bytes', () => captureBook(fixtures[0]));
  await stage('epub-card-native-indexeddb-stamped-bytes', () => captureBook(fixtures[1]));
  await stage('serviceworker-v9-complete-shell', shellReady);
  await stage('real429-ui-wait-no-write', rateLimit);
  await stage('hard-reload-network-offline', offlineReload);
  await stage('offline-pdf-native-render', () => renderOffline(fixtures[0]));
  await stage('offline-epub-native-iframe-render', () => renderOffline(fixtures[1]));
  await stage('controlled-native-quota-admission-no-write', nativeQuota);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.cases.push({ id: phase, status: 'FAIL', error: redact(error) }); report.appLog = redact(appLog); await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {}); console.error(redact(error)); process.exitCode = 1;
} finally {
  try { await cleanup(); } catch (error) { report.cleanup.error = redact(error); report.status = 'failed'; process.exitCode = 1; }
  report.completedAt = new Date().toISOString(); report.requests = traffic; report.browserErrors = browserErrors;
  report.sourceStillMatches = {}; for (const [file, hash] of Object.entries(report.source)) { const original = file.startsWith('db/') ? path.join(repoDir, file) : path.join(appDir, file); report.sourceStillMatches[file] = hash === sha(await readFile(original)); }
  if (!Object.values(report.sourceStillMatches).every(Boolean)) { report.status = 'failed'; report.sourceChanged = true; process.exitCode = 1; }
  if (browserErrors.length) { report.status = 'failed'; process.exitCode = 1; }
  await mkdir(output, { recursive: true }); await persist();
  const artifacts = []; for (const entry of await readdir(output, { withFileTypes: true })) { if (!entry.isFile()) continue; const name = entry.name; if (name === 'manifest.json') continue; const bytes = await readFile(path.join(output, name)); artifacts.push({ file: name, bytes: bytes.length, sha256: sha(bytes) }); }
  await writeFile(path.join(output, 'manifest.json'), JSON.stringify({ runId, source: report.source, artifacts, cleanup: report.cleanup }, null, 2));
  console.log(JSON.stringify({ status: report.status, passed: report.cases.filter(item => item.status === 'PASS').length, total: report.cases.length, cleanup: report.cleanup, evidence: output }));
}
