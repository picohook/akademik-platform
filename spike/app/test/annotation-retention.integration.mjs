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
import {purgeAnnotationReceipts} from '../annotation-sync.mjs';
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
const output = path.join(repoDir, 'docs/reader-evidence/v122-retention-review',runId);
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
const report = { runId, startedAt: new Date().toISOString(), version: 122, status: 'running', source: {}, cases: [], cleanup: {}, limitations: ['Owned PostgreSQL/two Node processes and real Edge contexts; not production, large files or human screen-reader acceptance.', 'Isolated owned PostgreSQL and real Edge; production/dev services untouched.', 'Real 410 test tombstones are seeded by admin; this is intentionally separate from the app-role purge, which is tested without privilege bypass.'] };
let extraApp, secondBase, serverEnv, serverDir;
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
  for (const name of ['server.mjs', 'libedge-admin.mjs', 'grant-policy.mjs', 'indexer.mjs', 'download-tickets.mjs', 'annotation-sync.mjs', 'social-watermark.mjs']) await copyFile(path.join(appDir, name), path.join(isolated, name));
  await cp(path.join(appDir, 'public'), path.join(isolated, 'public'), { recursive: true, filter: file => !['uploads', 'ocr'].some(name => file === path.join(appDir, 'public', name) || file.startsWith(path.join(appDir, 'public', name) + path.sep)) });
  const sourceFiles = ['server.mjs', 'libedge-admin.mjs', 'grant-policy.mjs', 'indexer.mjs', 'download-tickets.mjs', 'annotation-sync.mjs', 'social-watermark.mjs', 'public/app.js', 'public/index.html', 'public/offline.mjs', 'public/downloads.mjs', 'public/sw.js', 'public/epub-engine.mjs', 'public/styles.css', 'public/i18n.mjs', 'public/citations.mjs'];
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
  const env = { ...process.env, DATABASE_URL: `postgres://akademik_app:${appPassword}@127.0.0.1:${port}/browser_test`, PORT: String(appPort), SESSION_SECRET: sessionSecret, DEMO_TENANT_ID: tenantId, NODE_ENV: 'test', NODE_OPTIONS: '', APP_VERSION: '122' }; delete env.SOCIAL_DRM_B2B;
  app = spawn(process.execPath, ['server.mjs'], { cwd: isolated, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); app.on('error', e => { appLog += redact(e); }); for (const stream of [app.stdout, app.stderr]) stream.on('data', bytes => appLog = (appLog + bytes).slice(-12000));
  await until('app ready', async () => { assert.equal(app.exitCode, null, redact(appLog)); return (await fetch(base + '/api/health')).ok; });
  serverEnv=env;serverDir=isolated;
  const secondPort=await freePort();secondBase='http://127.0.0.1:'+secondPort;
  extraApp=spawn(process.execPath,['server.mjs'],{cwd:isolated,env:{...env,PORT:String(secondPort)},stdio:['ignore','pipe','pipe'],windowsHide:true});
  extraApp.on('error',e=>appLog+=redact(e));for(const stream of[extraApp.stdout,extraApp.stderr])stream.on('data',b=>appLog=(appLog+b).slice(-12000));
  await until('second Node server',async()=>(await fetch(secondBase+'/api/health')).ok);
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
  if(extraApp&&extraApp.exitCode===null&&extraApp.signalCode===null){extraApp.kill();await Promise.race([once(extraApp,'exit'),pause(5000)]);}report.cleanup.secondServer=!extraApp||extraApp.exitCode!==null||extraApp.signalCode!==null;
  await admin?.end().catch(() => {});
  if (containerCreated) { const label = await docker('inspect', '--format', '{{index .Config.Labels "akademik.offline-browser-test"}}', container); assert.equal(label, runId); await docker('stop', container); report.cleanup.database = true; } else report.cleanup.database = true;
  if (temporary) { const resolved = path.resolve(temporary); assert.ok(resolved.startsWith(path.resolve(tempParent) + path.sep) && path.basename(resolved).startsWith('offline-browser-')); await rm(resolved, { recursive: true, force: true }); report.cleanup.temporaryCopy = true; }
}


async function api(url,options={},target=base,jar=context){const csrf=(await jar.cookies()).find(c=>c.name==='akademik_csrf')?.value;return jar.request.fetch(target+url,{...options,headers:{...options.headers,'x-csrf-token':csrf||''}});}
const anchor={type:'pdf',page:1,rects:[]};
async function create(note='test note',f=fixtures[0],operationId=randomUUID(),target=base){const body={assetId:f.asset,anchor:f.format==='epub'?{type:'epub',cfi:'epubcfi(/6/2[chapter]!/4/2/1:0)'}:anchor,color:'yellow',note,operationId,ownerId:userId};const r=await api('/api/annotations',{method:'POST',data:body},target);assert.equal(r.status(),201);return{row:await r.json(),body};}
async function patch(row,note,target=base,operationId=randomUUID()){return api('/api/annotations/'+row.id,{method:'PATCH',data:{note,baseVersion:row.version,ownerId:userId,operationId}},target);}
async function stored(id){return(await admin.query('select * from annotations where id=$1',[id])).rows[0];}
async function cache(p,row){await p.evaluate(async({row,owner})=>{await(await import('/offline.mjs')).cacheServerAnnotations(row.asset_id,[row],owner);},{row,owner:userId});}
async function local(p,f=fixtures[0]){return p.evaluate(async({asset,owner})=>{const o=await import('/offline.mjs');return{notes:await o.listLocalAnnotations(asset,owner),ops:(await o.listAnnotationOps()).filter(x=>x.ownerId===owner)};},{asset:f.asset,owner:userId});}
async function flush(p){return p.evaluate(async owner=>(await import('/offline.mjs')).syncAnnotationOperations(owner),userId);}
async function queueCreate(p,note){return p.evaluate(async({note,owner,asset})=>{const o=await import('/offline.mjs'),id='offline-'+crypto.randomUUID(),row={id,asset_id:asset,ownerId:owner,anchor:{type:'pdf',page:1,rects:[]},color:'yellow',note,tags:[],pending:true};return o.saveAnnotationWithOperation(row,{opId:crypto.randomUUID(),type:'create',localId:id,assetId:asset,payload:{assetId:asset,anchor:row.anchor,color:row.color,note},createdAt:new Date().toISOString()});},{note,owner:userId,asset:fixtures[0].asset});}
async function close(p){if(await p.locator('#reader').isVisible()){await p.locator('#closeReader').click();await p.locator('#reader').waitFor({state:'hidden'});}await p.evaluate(()=>history.replaceState(null,'','/'));}
async function open(p,f=fixtures[0]){await close(p);await p.locator('#grid .card').filter({hasText:f.title}).locator('.open-btn').click();if(f.format==='pdf'){await p.locator('#textLayer span').first().waitFor();await until('PDF ready',async()=>(await p.locator('#reader').getAttribute('aria-busy'))==='false');}else{await p.locator('#epubView iframe').first().contentFrame().locator('body').waitFor();await until('EPUB ready',async()=>(await p.locator('#readerMeta').textContent()).includes('EPUB ·'));}if(!await p.locator('#notesPanel').isVisible())await p.locator('#toggleNotes').click();}
async function editUI(p,oldText,newText){const item=p.locator('#notesList .note-item').filter({has:p.locator('.note-body').filter({hasText:oldText})});await item.locator('.note-edit-btn').click();await item.locator('textarea').fill(newText);await item.locator('.note-edit button.primary').click();await p.locator('#notesList .note-body').filter({hasText:newText}).waitFor();}
async function conflictItem(p,text){const item=p.locator('#notesList .note-item').filter({has:p.locator('.note-body').filter({hasText:text})});await item.locator('.note-conflict').waitFor();return item;}
async function withDevice(){const jar=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'allow'});const r=await jar.request.post(base+'/api/login',{data:{email,password}});assert.equal(r.status(),200);const p=await jar.newPage();p.on('pageerror',e=>browserErrors.push({phase,message:redact(e)}));await p.goto(base+'/');await p.locator('#loginScreen').waitFor({state:'hidden'});await p.waitForLoadState('networkidle');return{jar,p};}

async function check(id,fn){try{await stage(id,fn);}catch(e){report.cases.push({id,status:'FAIL',error:redact(e),sqlState:e.code});await persist();console.log(JSON.stringify({id,status:'FAIL',error:redact(e),sqlState:e.code}));}}
async function receiptToTombstone(op){await admin.query('begin');try{await admin.query('insert into annotation_operation_tombstones(tenant_id,user_id,operation_id,request_hash,method,annotation_id,created_at) select tenant_id,user_id,operation_id,request_hash,method,annotation_id,created_at from annotation_operations where operation_id=$1',[op]);await admin.query('delete from annotation_operations where operation_id=$1',[op]);await admin.query('commit');}catch(e){await admin.query('rollback');throw e;}}
async function scoped(client,owner,fn,maintenance=false){await client.query('begin');try{await client.query("select set_config('app.tenant_id',$1,true)",[tenantId]);if(owner)await client.query("select set_config('app.user_id',$1,true)",[owner]);if(maintenance)await client.query("select set_config('app.maintenance','on',true)");const result=await fn();await client.query('commit');return result;}catch(e){await client.query('rollback');throw e;}}
let reviewDb,reviewApp,backup;
try{
 await setup();await page.waitForLoadState('networkidle');
 await check('fresh-prod-backup-restored-migration-016-twice-preserves-notes',async()=>{
  const reuse=process.argv.indexOf('--reuse-backup');const stamp=new Date().toISOString().replace(/[:.]/g,'-');backup=reuse>=0?process.argv[reuse+1]:'backups/akademik-v122-review-'+stamp+'-'+runId.slice(0,8)+'.dump';assert.ok(path.resolve(repoDir,backup).startsWith(path.resolve(repoDir,'backups')+path.sep)&&path.basename(backup).startsWith('akademik-v122-review-')&&backup.endsWith('.dump'));
  const prod=['compose','--project-name','akademik-platform-prod','--env-file','.env.production','-f','docker-compose.prod.yml'];
  const dbUser=await docker(...prod,'exec','-T','db','printenv','POSTGRES_USER'),dbName=await docker(...prod,'exec','-T','db','printenv','POSTGRES_DB');
  if(reuse<0)await docker(...prod,'exec','-T','-e','PGOPTIONS=-c default_transaction_read_only=on','db','pg_dump','-U',dbUser,'-d',dbName,'-Fc','-f','/'+backup);
  const bytes=await readFile(path.join(repoDir,backup));if(reuse>=0)assert.equal(sha(bytes),process.argv[reuse+2]);report.privateBackup={file:backup,bytes:bytes.length,sha256:sha(bytes),published:false,reused:reuse>=0};
  await admin.query('create database retention_restore');await docker('cp',path.join(repoDir,backup),container+':/tmp/restore.dump');await docker('exec',container,'pg_restore','-U','browser_admin','-d','retention_restore','--exit-on-error','--no-owner','--no-acl','/tmp/restore.dump');
  const cfg={connectionString:serverEnv.DATABASE_URL.replace('/browser_test','/retention_restore')};reviewApp=new pg.Client(cfg);await reviewApp.connect();
  const restoredAdminUrl=serverEnv.DATABASE_URL.replace('akademik_app:'+appPassword,'browser_admin:'+dbPassword).replace('/browser_test','/retention_restore');reviewDb=new pg.Client({connectionString:restoredAdminUrl});await reviewDb.connect();
  const fingerprint=async()=> (await reviewDb.query("select json_build_object('notes',(select count(*) from annotations),'digest',(select md5(coalesce(string_agg(md5(to_jsonb(a)::text),'' order by id),'')) from annotations a),'assets',(select count(*) from assets)) state")).rows[0].state;
  const before=await fingerprint();await reviewDb.query('grant usage on schema public to akademik_app; grant select,insert on annotation_operations to akademik_app');
  const file='db/migrations/016-annotation-receipt-retention.sql',sql=await readFile(path.join(repoDir,file));report.source[file]=sha(sql);await reviewDb.query(sql.toString());await reviewDb.query(sql.toString());assert.deepEqual(await fingerprint(),before);
  const permissions=(await reviewDb.query("select has_table_privilege('akademik_app','annotation_operations','UPDATE') as update,has_table_privilege('akademik_app','annotation_operations','SELECT') as select,has_table_privilege('akademik_app','annotation_operations','DELETE') as delete")).rows[0];
  report.restore={migrationTwice:true,fingerprintPreserved:true,original:before,permissions};return report.restore;
 });
 await check('normal-create-cas-delete-and-replay',async()=>{const {row,body}=await create('v122 normal note');assert.equal((await api('/api/annotations',{method:'POST',data:body})).status(),201);const p=await patch(row,'v122 normal edited');assert.equal(p.status(),200);assert.equal((await p.json()).version,2);assert.equal((await patch(row,'stale')).status(),409);const del={operationId:randomUUID(),baseVersion:2};assert.equal((await api('/api/annotations/'+row.id,{method:'DELETE',data:del})).status(),200);assert.equal((await api('/api/annotations/'+row.id,{method:'DELETE',data:del})).status(),200);assert.equal(await stored(row.id),undefined);return{post:201,patch:200,version:2,stale:409,deleteReplay:200};});
 await check('user-scoped-receipts-and-transaction-local-reset',async()=>{
  const {body}=await create('owner A receipt');const client=new pg.Client({connectionString:serverEnv.DATABASE_URL});await client.connect();try{
   const a=await scoped(client,userId,async()=> (await client.query('select operation_id from annotation_operations where operation_id=$1',[body.operationId])).rows.length);const b=await scoped(client,secondUserId,async()=> (await client.query('select operation_id from annotation_operations where operation_id=$1',[body.operationId])).rows.length);assert.equal(a,1);assert.equal(b,0);const reset=(await client.query("select nullif(current_setting('app.user_id',true),'') as value")).rows[0].value;assert.equal(reset,null);
   const fallback=await scoped(client,null,async()=> (await client.query('select operation_id from annotation_operations where operation_id=$1',[body.operationId])).rows.length);return{ownerRows:a,otherUserRows:b,settingReset:true,unsetUserFallbackRows:fallback};
  }finally{await client.end();}
 });
 let oldReceipt;
 await check('restored-copy-real-app-role-purge-90-days',async()=>{
  assert.ok(reviewDb&&reviewApp);oldReceipt=(await reviewDb.query('select tenant_id,operation_id from annotation_operations order by created_at limit 1')).rows[0];assert.ok(oldReceipt);
  await reviewDb.query("update annotation_operations set created_at=clock_timestamp()-interval '91 days' where operation_id=$1",[oldReceipt.operation_id]);
  await reviewApp.query('begin');try{await reviewApp.query("select set_config('app.tenant_id',$1,true)",[oldReceipt.tenant_id]);await reviewApp.query("select set_config('app.maintenance','on',true)");const result=await purgeAnnotationReceipts(reviewApp,{tenantId:oldReceipt.tenant_id});await reviewApp.query('commit');assert.equal(result.receiptsMoved,1);assert.equal(result.receiptsDeleted,1);return result;}catch(e){await reviewApp.query('rollback');throw e;}
 });
 await check('diagnostic-update-privilege-alone-does-not-complete-purge',async()=>{
  assert.ok(oldReceipt);await reviewDb.query('grant update on annotation_operations to akademik_app');
  try{await reviewApp.query('begin');await reviewApp.query("select set_config('app.tenant_id',$1,true)",[oldReceipt.tenant_id]);await reviewApp.query("select set_config('app.maintenance','on',true)");const result=await purgeAnnotationReceipts(reviewApp,{tenantId:oldReceipt.tenant_id});await reviewApp.query('commit');assert.equal(result.receiptsMoved,0);assert.equal(result.receiptsDeleted,0);return{controlledCloneOnlyGrant:true,expiredRowStillRetained:true,...result};}catch(e){await reviewApp.query('rollback');throw e;}finally{await reviewDb.query('revoke update on annotation_operations from akademik_app');}
 });

 await check('diagnostic-update-grant-and-policy-exposes-tombstone-maintenance-select-failure',async()=>{
  await reviewDb.query("grant update on annotation_operations to akademik_app; create policy reviewer_update_probe on annotation_operations for update using (tenant_id=current_setting('app.tenant_id',true)::uuid and current_setting('app.maintenance',true)='on')");
  let observed;
  try{await reviewApp.query('begin');await reviewApp.query("select set_config('app.tenant_id',$1,true)",[oldReceipt.tenant_id]);await reviewApp.query("select set_config('app.maintenance','on',true)");try{await purgeAnnotationReceipts(reviewApp,{tenantId:oldReceipt.tenant_id});}catch(e){observed={code:e.code,message:e.message};}finally{await reviewApp.query('rollback');}}
  finally{await reviewDb.query('drop policy reviewer_update_probe on annotation_operations; revoke update on annotation_operations from akademik_app');}
  assert.equal(observed?.code,'42501');assert.ok(observed.message.includes('annotation_operation_tombstones'));return{controlledCloneOnlyUpdateGrantAndPolicy:true,maintenanceTombstoneSelectStillDenied:true,observed};
 });

 await check('manual-tombstone-410-and-hash-mismatch-409',async()=>{
  const {row,body}=await create('expired original note');assert.equal((await api('/api/annotations/'+row.id,{method:'DELETE',data:{operationId:randomUUID(),baseVersion:1}})).status(),200);await receiptToTombstone(body.operationId);const same=await api('/api/annotations',{method:'POST',data:body});assert.equal(same.status(),410);assert.equal((await same.json()).error,'operation_expired');assert.equal((await api('/api/annotations',{method:'POST',data:{...body,note:'changed payload'}})).status(),409);assert.equal(await stored(row.id),undefined);return{manuallySeededTombstone:true,actualHttp:true,same:410,different:409,deletedOriginalNotRecreated:true};
 });

 await check('v121-rollback-ignores-live-tombstone-and-recreates-deleted-note',async()=>{
  const {row,body}=await create('rollback deleted original');assert.equal((await api('/api/annotations/'+row.id,{method:'DELETE',data:{operationId:randomUUID(),baseVersion:1}})).status(),200);await receiptToTombstone(body.operationId);assert.equal((await api('/api/annotations',{method:'POST',data:body})).status(),410);
  const pinned=(await exec('git',['show','933615a:spike/app/annotation-sync.mjs'],{cwd:repoDir,windowsHide:true,maxBuffer:1024*1024})).stdout;
  const old=await import('data:text/javascript;base64,'+Buffer.from(pinned).toString('base64'));const client=new pg.Client({connectionString:serverEnv.DATABASE_URL});await client.connect();
  let result;try{result=await scoped(client,null,()=>old.mutateAnnotation(client,{method:'POST',id:null,body,userId,tenantId}));}finally{await client.end();}
  assert.equal(result.status,201);assert.notEqual(result.body.id,row.id);const resumed=await api('/api/annotations',{method:'POST',data:body});assert.equal(resumed.status(),201);const current=await resumed.json();assert.equal(current.id,result.body.id);
  report.rollbackRegression={oldModuleCommit:'933615a',sameOperationWhileTombstoneActive:true,v122Before:410,v121After:201,v122AfterRollbackWrite:201,deletedNoteRecreated:true};return report.rollbackRegression;
 });

 await check('after-365-day-tombstone-expiry-old-post-can-recreate-documented-boundary',async()=>{
  const {row,body}=await create('very old deleted note');assert.equal((await api('/api/annotations/'+row.id,{method:'DELETE',data:{operationId:randomUUID(),baseVersion:1}})).status(),200);await receiptToTombstone(body.operationId);await admin.query("update annotation_operation_tombstones set purged_at=clock_timestamp()-interval '366 days' where operation_id=$1",[body.operationId]);const expired=await scoped(admin,null,()=>purgeAnnotationReceipts(admin,{tenantId}),true);assert.ok(expired.tombstonesDeleted>=1);const response=await api('/api/annotations',{method:'POST',data:body});assert.equal(response.status(),201);const recreated=await response.json();assert.notEqual(recreated.id,row.id);report.expiryBoundary={sameOldPost:201,annotationRecreated:true,documentedByAuthor:true,notAnUnlimitedIdempotencyGuarantee:true};return report.expiryBoundary;
 });
 await check('edge-actual-410-preserves-draft-reload-and-conflict-ui',async()=>{
  const draft='Edge expired operation draft';const row=await queueCreate(page,draft);
  await page.evaluate(async owner=>(await import('/offline.mjs')).syncAnnotationOperations(owner,async(u,opt)=>{await fetch(u,opt);throw new Error('controlled lost POST reply after server commit');}),userId);
  const before=(await local(page)).ops.find(x=>x.localId===row.id);assert.ok(before.request);await receiptToTombstone(before.request.operationId);await flush(page);let x=(await local(page)).notes.find(x=>x.id===row.id);assert.equal(x.note,draft);assert.equal(x.conflict.reason,'operation_expired');assert.ok((await local(page)).ops.find(x=>x.localId===row.id).conflict);
  await page.goto(base+'/');await page.locator('#loginScreen').waitFor({state:'hidden'});await open(page);const item=page.locator('#notesList .note-item').filter({has:page.locator('.note-conflict')}).filter({hasText:draft});await item.waitFor();assert.ok((await item.textContent()).includes('saklama süresi doldu'));await page.screenshot({path:path.join(output,'edge-operation-expired-draft-preserved.png')});await item.locator('[data-conflict-choice=server]').click();await until('expired local draft discarded',async()=>!(await local(page)).notes.find(x=>x.id===row.id));return{manuallySeededTombstone:true,realCommittedPostReplyLoss:true,realHttp410:true,nativeIndexedDB:true,hardReload:true,draftPreserved:true,conflictUi:true,explicitDiscard:true};
 });
 assert.deepEqual(browserErrors,[]);report.status=report.cases.some(c=>c.status==='FAIL')?'failed':'passed';if(report.status==='failed')process.exitCode=1;
}catch(e){report.status='failed';report.cases.push({id:phase,status:'FAIL',error:redact(e)});console.error(redact(e));process.exitCode=1;}
finally{
 await reviewApp?.end().catch(()=>{});await reviewDb?.end().catch(()=>{});
 try{await cleanup();}catch(e){report.cleanup.error=redact(e);report.status='failed';process.exitCode=1;}
 report.completedAt=new Date().toISOString();report.browserErrors=browserErrors;report.appLog=redact(appLog);report.sourceStillMatches={};for(const[file,hash]of Object.entries(report.source)){const original=file.startsWith('db/')?path.join(repoDir,file):path.join(appDir,file);report.sourceStillMatches[file]=hash===sha(await readFile(original));}if(!Object.values(report.sourceStillMatches).every(Boolean)){report.status='failed';process.exitCode=1;}
 await persist();const artifacts=[];for(const entry of await readdir(output,{withFileTypes:true})){if(!entry.isFile()||entry.name==='manifest.json')continue;const b=await readFile(path.join(output,entry.name));artifacts.push({file:entry.name,bytes:b.length,sha256:sha(b)});}await writeFile(path.join(output,'manifest.json'),JSON.stringify({runId,source:report.source,artifacts,cleanup:report.cleanup},null,2));console.log(JSON.stringify({status:report.status,passed:report.cases.filter(c=>c.status==='PASS').length,total:report.cases.length,cleanup:report.cleanup,evidence:output}));
}
