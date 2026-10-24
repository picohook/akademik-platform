import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { once } from 'node:events';
import { copyFile, cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
const output = path.join(repoDir, 'docs/reader-evidence/v121-bookmark-regression',runId);
const tenantId = '11111111-1111-1111-1111-111111111111';
const userId = randomUUID(), email = 'offline-reader@browser.test', secondUserId=randomUUID(), secondEmail='bookmark-second@browser.test';
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
const report = { runId, startedAt: new Date().toISOString(), version: 121, status: 'running', source: {}, cases: [], cleanup: {}, limitations: ['Small generated PDF/reflowable EPUB only; not large-file, screen-reader, multi-tab idempotency or cross-device conflict acceptance.', 'Isolated owned PostgreSQL and real Edge; production/dev services untouched.', '401/403/429/500 retry and retaining A queue during account switch use explicitly controlled HTTP failures.'] };
let temporary, admin, app, browser, context, page, base, cdp, containerCreated = false, phase = 'setup', appLog = '';
function redact(error) { let value = String(error?.stack || error); for (const token of [...secrets, ...tickets]) value = value.replaceAll(token, '[redacted]'); return value.replace(/postgres(?:ql)?:\/\/[^\s]+/g, '[database connection redacted]'); }
async function persist() { const text = JSON.stringify(report, null, 2); assert.ok(![...secrets, ...tickets].some(secret => text.includes(secret)), 'evidence contains no secrets'); await writeFile(path.join(output, 'results.json'), text); }
async function docker(...args) { return (await exec('docker', args, { timeout: 60000, maxBuffer: 1024 * 1024, windowsHide: true })).stdout.trim(); }
async function until(label, fn, timeout = 30000) { const end = Date.now() + timeout; let last; do { try { const value = await fn(); if (value) return value; } catch (e) { last = e; } await pause(100); } while (Date.now() < end); throw new Error(`${label} timed out${last ? ': ' + redact(last) : ''}`); }
async function freePort() { const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening'); const port = socket.address().port; await new Promise((resolve, reject) => socket.close(e => e ? reject(e) : resolve())); return port; }
async function stage(id, fn) { phase = id; const result = await fn(); report.cases.push({ ...result, id, status: 'PASS' }); await persist(); console.log(JSON.stringify({ id, status: 'PASS' })); }
async function pdf(original) { const doc = await PDFDocument.create(); const font = await doc.embedFont(StandardFonts.Helvetica); doc.addPage([600, 760]).drawText(original, { x: 40, y: 680, size: 14, font }); doc.addPage([600,760]).drawText(original+" page two",{x:40,y:680,size:14,font}); return Buffer.from(await doc.save()); }
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
  for (const name of ['server.mjs', 'indexer.mjs', 'download-tickets.mjs', 'annotation-sync.mjs', 'social-watermark.mjs']) await copyFile(path.join(appDir, name), path.join(isolated, name));
  await cp(path.join(appDir, 'public'), path.join(isolated, 'public'), { recursive: true, filter: file => !['uploads', 'ocr'].some(name => file === path.join(appDir, 'public', name) || file.startsWith(path.join(appDir, 'public', name) + path.sep)) });
  const sourceFiles = ['server.mjs', 'indexer.mjs', 'download-tickets.mjs', 'annotation-sync.mjs', 'social-watermark.mjs', 'public/app.js', 'public/index.html', 'public/offline.mjs', 'public/downloads.mjs', 'public/sw.js', 'public/epub-engine.mjs', 'public/styles.css', 'public/i18n.mjs', 'public/citations.mjs'];
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
  await admin.query('update assets set page_count=2 where id=$1',[fixtures[0].asset]);
  await admin.query("insert into users(id,tenant_id,email,display_name,role,password_hash,max_sessions) values($1,$2,$3,$3,'reader',$4,10)",[secondUserId,tenantId,secondEmail,hash]);
  for (const fixture of fixtures.slice(1)) { await admin.query('insert into works(id,tenant_id,title,language) values($1,$2,$3,\'en\')', [fixture.id, tenantId, fixture.title]); await admin.query('insert into editions(id,tenant_id,work_id) values($1,$2,$3)', [fixture.edition, tenantId, fixture.id]); await admin.query('insert into assets(id,tenant_id,edition_id,format,storage_key,watermark,allow_download,page_count) values($1,$2,$3,$4,$5,false,true,1)', [fixture.asset, tenantId, fixture.edition, fixture.format, 'seed/' + fixture.filename]); }
  const appPort = await freePort(); base = `http://127.0.0.1:${appPort}`;
  const env = { ...process.env, DATABASE_URL: `postgres://akademik_app:${appPassword}@127.0.0.1:${port}/browser_test`, PORT: String(appPort), SESSION_SECRET: sessionSecret, DEMO_TENANT_ID: tenantId, NODE_ENV: 'test', NODE_OPTIONS: '', APP_VERSION: '121' }; delete env.SOCIAL_DRM_B2B;
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
async function shellReady() {
  await page.evaluate(async () => { await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true })); });
  await until('SW13 complete required shell', () => page.evaluate(async () => { const cache = await caches.open('akademik-shell-v13'); const required = ['/', '/app.js', '/downloads.mjs', '/offline.mjs', '/vendor/pdfjs/pdf.mjs', '/vendor/pdfjs/pdf.worker.mjs', '/vendor/epubjs/jszip.min.js', '/vendor/epubjs/epub.min.js', '/epub-engine.mjs']; return (await Promise.all(required.map(file => cache.match(file, { ignoreSearch: true })))).every(Boolean); }));
  return { cache: 'akademik-shell-v13', controller: await page.evaluate(() => Boolean(navigator.serviceWorker.controller)) };
}
async function cleanup() {
  await context?.setOffline(false).catch(() => {}); await browser?.close().catch(() => {}); report.cleanup.browser = !browser || !browser.isConnected();
  if (app && app.exitCode === null && app.signalCode === null) { app.kill(); await Promise.race([once(app, 'exit'), pause(5000)]); if (app.exitCode === null && app.signalCode === null) { app.kill('SIGKILL'); await Promise.race([once(app, 'exit'), pause(5000)]); } } report.cleanup.app = !app || app.exitCode !== null || app.signalCode !== null;
  await admin?.end().catch(() => {});
  if (containerCreated) { const label = await docker('inspect', '--format', '{{index .Config.Labels "akademik.offline-browser-test"}}', container); assert.equal(label, runId); await docker('stop', container); report.cleanup.database = true; } else report.cleanup.database = true;
  if (temporary) { const resolved = path.resolve(temporary); assert.ok(resolved.startsWith(path.resolve(tempParent) + path.sep) && path.basename(resolved).startsWith('offline-browser-')); await rm(resolved, { recursive: true, force: true }); report.cleanup.temporaryCopy = true; }
}

async function api(url,options={}){const csrf=(await context.cookies()).find(c=>c.name==='akademik_csrf')?.value;return context.request.fetch(base+url,{...options,headers:{...options.headers,'x-csrf-token':csrf||''}});}
async function local(f,owner=userId){return page.evaluate(async({asset,owner})=>{const o=await import('/offline.mjs');return{notes:await o.listLocalAnnotations(asset,owner),ops:await o.listAnnotationOps()};},{asset:f.asset,owner});}
async function dbMarks(f,owner=userId){return(await admin.query("select id,anchor,color,note from annotations where asset_id=$1 and user_id=$2 and color='bookmark'",[f.asset,owner])).rows;}
async function close(){if(await page.locator('#reader').isVisible()){await page.locator('#closeReader').click();await page.locator('#reader').waitFor({state:'hidden'});}await page.evaluate(()=>history.replaceState(null,'','/'));}
async function open(f){await close();await page.locator('#offlineBtn').click();await page.locator('#offlineList .grant-row').filter({hasText:f.title}).locator('button').first().click();if(f.format==='pdf')await page.locator('#textLayer span').first().waitFor();else{await page.locator('#epubView iframe').first().contentFrame().locator('body').waitFor();await until('EPUB initialized',async()=>(await page.locator('#readerMeta').textContent()).includes('EPUB ·'));}if(!await page.locator('#notesPanel').isVisible())await page.locator('#toggleNotes').click();await pause(250);}
async function star(on){await until('bookmark star '+on,async()=>(await page.locator('#bookmarkBtn').getAttribute('aria-pressed'))===String(on));}
async function toggle(on){await page.locator('#bookmarkBtn').click();await star(on);}
async function reloadOffline(){await page.evaluate(()=>history.replaceState(null,'','/'));await page.reload({waitUntil:'domcontentloaded'});await page.locator('#grid .card').first().waitFor();}
async function loginAs(address){await page.locator('#loginScreen').waitFor({state:'visible'});await page.evaluate(()=>history.replaceState(null,'','/'));await page.locator('#loginEmail').fill(address);await page.locator('#loginPassword').fill(password);await page.locator('#loginPassword').press('Enter');await page.locator('#loginScreen').waitFor({state:'hidden'});await page.locator('#grid .card').first().waitFor();}
async function logout(){await close();await Promise.all([page.waitForEvent('domcontentloaded'),page.locator('#logoutBtn').click()]);await page.locator('#loginScreen').waitFor({state:'visible'});assert.equal(await page.evaluate(()=>localStorage.getItem('offlineAnnotationUser')),null);}
try {
 await setup();await stage('pdf-native-ticketed-offline-copy',()=>captureBook(fixtures[0]));await stage('epub-native-ticketed-offline-copy',()=>captureBook(fixtures[1]));await stage('serviceworker-v13-complete-shell',shellReady);
 for(const f of fixtures.slice(0,2)){
  await context.setOffline(true);await open(f);
  await stage(f.format+'-unsent-bookmark-toggle-cancels-create',async()=>{await toggle(true);let x=await local(f);assert.equal(x.ops.length,1);assert.equal(x.ops[0].type,'create');assert.equal(x.ops[0].ownerId,userId);assert.equal(x.notes[0].color,'bookmark');await toggle(false);x=await local(f);assert.equal(x.ops.length,0);assert.equal(x.notes.length,0);assert.equal((await dbMarks(f)).length,0);return{nativeAtomicQueue:true,noServerWrite:true};});
  await stage(f.format+'-offline-bookmark-reload-jump-and-one-post',async()=>{
   if(f.format==='pdf'){await page.locator('#pageInput').fill('2');await page.locator('#pageInput').press('Enter');await until('physical page two',async()=>(await page.locator('#pageInput').inputValue())==='2');await pause(200);}
   await toggle(true);const before=(await local(f)).notes.find(x=>x.color==='bookmark');f.savedLocalId=before.id;f.anchor=before.anchor;
   assert.equal(before.anchor.type,f.format);if(f.format==='epub')assert.ok(before.anchor.cfi);else assert.equal(before.anchor.page,2);
   await reloadOffline();await open(f);assert.equal((await local(f)).notes.filter(x=>x.color==='bookmark').length,1);
   if(f.format==='pdf'){await page.locator('#reader').getAttribute('aria-busy');await page.locator('#pageInput').fill('1');await page.locator('#pageInput').press('Enter');await until('page one rendered',async()=>(await page.locator('#reader').getAttribute('aria-busy'))==='false'&&(await page.locator('#pageInput').inputValue())==='1');}
   await page.locator('#notesList .note-item').click();await star(true);if(f.format==='pdf'){await until('bookmark target rendered',async()=>(await page.locator('#reader').getAttribute('aria-busy'))==='false');await page.locator('#notesList .note-item').click();}
   if(f.format==='pdf')assert.equal(await page.locator('#pageInput').inputValue(),'2');
   await page.screenshot({path:path.join(output,f.format+'-offline-bookmark.png')});await context.setOffline(false);
   await until('one persisted bookmark',async()=>(await dbMarks(f)).length===1);await until('create ack',async()=>(await local(f)).ops.length===0);
   const after=(await local(f)).notes.find(x=>x.id===f.savedLocalId);assert.equal(after.pending,false);assert.equal(after.server_id,(await dbMarks(f))[0].id);
   await page.evaluate(async owner=>(await import('/offline.mjs')).syncAnnotationOperations(owner),userId);assert.equal((await dbMarks(f)).length,1);return{hardReload:true,position:before.anchor,localAliasPreserved:true,oneServerRow:true};
  });
  await stage(f.format+'-offline-delete-tombstone-reload-and-delete',async()=>{
   await context.setOffline(true);const server=(await dbMarks(f))[0];await page.locator('#notesList .note-delete').click();await star(false);let x=await local(f);assert.equal(x.ops.length,1);assert.equal(x.ops[0].type,'delete');assert.equal(x.ops[0].serverId,server.id);
   await page.evaluate(async({f,server,owner})=>{const o=await import('/offline.mjs');await o.cacheServerAnnotations(f.asset,[{...server,asset_id:f.asset}],owner);if((await o.listLocalAnnotations(f.asset,owner)).length)throw Error('tombstone failed');},{f,server,owner:userId});
   await reloadOffline();await open(f);assert.equal(await page.locator('#notesList .note-item').count(),0);await star(false);await context.setOffline(false);
   await until('server deletion',async()=>(await dbMarks(f)).length===0);await until('delete ack',async()=>(await local(f)).ops.length===0);return{canonicalServerId:true,staleGetHidden:true,offlineReload:true,serverDeleted:true};
  });
  await stage(f.format+'-cached-online-create-delete-syncs',async()=>{await toggle(true);await until('online bookmark saved',async()=>(await dbMarks(f)).length===1);await until('online create ack',async()=>(await local(f)).ops.length===0);await until('pending label gone',async()=>await page.locator('#notesList [role=status]').count()===0);await page.locator('#notesList .note-delete').click();await star(false);assert.equal(await page.locator('#toast').textContent(),'Yer imi bu cihazdan kaldırıldı');await until('online delete saved',async()=>(await dbMarks(f)).length===0);await until('online delete ack',async()=>(await local(f)).ops.length===0);return{cachedReaderOnline:true,pendingStateClears:true};});
  await close();
 }
 await stage('http-failures-retain-bookmark-until-retry',async()=>{
  const f=fixtures[0];await open(f);let code=401,hits=0;const observed=[];await page.route('**/api/annotations/v1',route=>{if(route.request().method()==='POST'){hits++;observed.push(code);return route.fulfill({status:code,contentType:'application/json',body:'{}'});}return route.continue();});await toggle(true);await until('first controlled failure',()=>hits>0);await until('retained after first failure',async()=>(await local(f)).ops.length===1);
  for(const status of[403,429,500]){code=status;await page.evaluate(async owner=>(await import('/offline.mjs')).syncAnnotationOperations(owner),userId);assert.equal((await local(f)).ops.length,1);assert.equal((await dbMarks(f)).length,0);}
  assert.deepEqual(observed,[401,403,429,500]);await page.unroute('**/api/annotations/v1');await page.evaluate(async owner=>(await import('/offline.mjs')).syncAnnotationOperations(owner),userId);assert.equal((await dbMarks(f)).length,1);assert.equal((await local(f)).ops.length,0);await toggle(false);await until('retry fixture deleted',async()=>(await dbMarks(f)).length===0);await close();return{controlledStatuses:observed,draftRetained:true,realPostgresRetry:true,staleUiAliasDeletion:true};
 });
 // Hold A's queue with an explicit 403 until the real logout/login completes.
 await context.setOffline(true);for(const f of fixtures.slice(0,2)){await open(f);await toggle(true);await close();}
 assert.equal((await local(fixtures[0])).ops.length,2);
 await page.route('**/api/annotations/v1',route=>route.request().method()==='POST'&&route.request().postDataJSON()?.ownerId===userId?route.fulfill({status:403,contentType:'application/json',body:'{}'}):route.continue());
 await context.setOffline(false);await page.reload();await page.locator('#logoutBtn').waitFor();await logout();await loginAs(secondEmail);await page.unroute('**/api/annotations/v1');
 for(const f of fixtures.slice(0,2)){
  const r=await api('/api/annotations',{method:'POST',data:{operationId:randomUUID(),assetId:f.asset,anchor:f.anchor,color:'bookmark',note:'B own bookmark',ownerId:secondUserId}});assert.equal(r.status(),201);
  await open(f);await page.evaluate(async({asset,owner})=>{const r=await fetch('/api/annotations?assetId='+asset);await(await import('/offline.mjs')).cacheServerAnnotations(asset,await r.json(),owner);},{asset:f.asset,owner:secondUserId});await close();
 }
 await context.setOffline(true);await reloadOffline();
 for(const f of fixtures.slice(0,2))await stage(f.format+'-B-offline-hides-A-and-keeps-A-queue',async()=>{await open(f);assert.equal(await page.locator('#notesList .note-item').count(),1);assert.equal((await local(f,secondUserId)).notes[0].note,'B own bookmark');assert.equal((await local(f)).notes[0].ownerId,userId);assert.equal((await local(f)).ops.filter(x=>x.ownerId===userId).length,2);await page.evaluate(async owner=>{await(await import('/offline.mjs')).syncAnnotationOperations(owner,()=>{throw Error('B should have no queued request');});},secondUserId);assert.equal((await dbMarks(f)).length,0);await page.screenshot({path:path.join(output,f.format+'-B-bookmark-privacy.png')});await close();return{realAccountSwitch:true,APendingQueueRetained:true,OnlyBVisible:true};});
 await context.setOffline(false);await page.reload();await page.locator('#logoutBtn').waitFor();await logout();await loginAs(email);
 for(const f of fixtures.slice(0,2))await stage(f.format+'-A-return-flushes-only-own-bookmark',async()=>{await open(f);await until('A queue saved',async()=>(await dbMarks(f)).length===1);await until('all A ack',async()=>(await local(f)).ops.length===0);assert.equal((await dbMarks(f,secondUserId)).length,1);assert.equal(await page.locator('#notesList .note-item').count(),1);assert.equal((await local(f)).notes[0].ownerId,userId);await close();return{AQueueRecovered:true,BServerBookmarkUntouched:true};});
 await stage('logout-offline-no-identity-no-bookmarks',async()=>{await page.reload();await page.locator('#logoutBtn').waitFor();await logout();await context.setOffline(true);await reloadOffline();for(const f of fixtures.slice(0,2)){await open(f);assert.equal(await page.locator('#notesList .note-item').count(),0);await page.locator('#bookmarkBtn').click();assert.equal((await local(f)).ops.length,0);await close();}return{missingIdentityReturnsNothing:true,noUnownedBookmarkCreated:true};});
 assert.deepEqual(browserErrors,[]);report.status='passed';
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
