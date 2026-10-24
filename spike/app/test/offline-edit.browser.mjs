import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { cp, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const appDir=fileURLToPath(new URL('../',import.meta.url)),root=path.resolve(appDir,'../..'),runId=randomUUID();
const appVersion=(await readFile(path.join(appDir,'public/index.html'),'utf8')).match(/app\.js\?v=(\d+)/)[1],shell=(await readFile(path.join(appDir,'public/sw.js'),'utf8')).match(/akademik-shell-v\d+/)[0];
const out=path.join(root,'docs/reader-evidence/v'+appVersion+'-offline-edit',runId),tempRoot=path.join(appDir,'tmp');
const report={runId,version:Number(appVersion),revision:'privacy-fix',startedAt:new Date().toISOString(),status:'running',scope:'Isolated copied demo server, real Edge/IndexedDB/UI and real annotation HTTP; no production/dev services or database used.',cases:[],cleanup:{},sources:{}};
let temp,app,browser,context,page,base,owner,phase='setup',log='';const errors=[];
const pause=ms=>new Promise(r=>setTimeout(r,ms)),sha=b=>createHash('sha256').update(b).digest('hex');
const persist=()=>writeFile(path.join(out,'results.json'),JSON.stringify(report,null,2)+'\n');
async function stage(id,fn){phase=id;const result=await fn();report.cases.push({...result,id,status:'PASS'});await persist();console.log(JSON.stringify({id,status:'PASS'}));}
async function until(name,fn){for(let n=0;n<200;n++){try{if(await fn())return;}catch{}await pause(100);}throw Error('Timed out: '+name);}
async function api(url,options={}){const csrf=(await context.cookies()).find(c=>c.name==='akademik_csrf')?.value;return context.request.fetch(base+url,{...options,headers:{...options.headers,'x-csrf-token':csrf||''}});}
async function create(book,note){const r=await api('/api/annotations',{method:'POST',data:{operationId:randomUUID(),assetId:book.asset_id,anchor:book.format==='epub'?{type:'epub',cfi:'epubcfi(/6/2[chapter]!/4/2/1:0)'}:{type:'pdf',page:1,rects:[[20,20,80,15]]},note,tags:['original'],color:'yellow',selectedText:'Fixture selection'}});assert.equal(r.status(),201);return r.json();}
async function rows(book){const r=await api('/api/annotations?assetId='+book.asset_id);assert.equal(r.status(),200);return r.json();}
async function open(book){if(await page.locator('#reader').isVisible()){await page.locator('#closeReader').click();await page.locator('#reader').waitFor({state:'hidden'});}await page.locator('#grid .card').filter({hasText:book.title}).locator('.open-btn').click();if(book.format==='pdf')await page.locator('#textLayer span').first().waitFor();else {await page.locator('#epubView iframe').first().contentFrame().locator('body').waitFor();await until('EPUB reader initialized',async()=>(await page.locator('#readerMeta').textContent()).includes('EPUB ·'));}}
async function openCached(book){
 if(await page.locator('#reader').isVisible()){await page.locator('#closeReader').click();await page.locator('#reader').waitFor({state:'hidden'});}
 await page.locator('#offlineBtn').click();
 await page.locator('#offlineList .grant-row').filter({hasText:book.title}).locator('button').first().click();
 if(book.format==='pdf')await page.locator('#textLayer span').first().waitFor();else {await page.locator('#epubView iframe').first().contentFrame().locator('body').waitFor();await until('EPUB reader initialized',async()=>(await page.locator('#readerMeta').textContent()).includes('EPUB ·'));}
}
async function notes(){if(!await page.locator('#notesPanel').isVisible())await page.locator('#toggleNotes').click();}
async function edit(oldText,newText,tags='alpha; beta; alpha'){await notes();const item=page.locator('#notesList .note-item').filter({hasText:oldText});await item.locator('.note-edit-btn').click();await item.locator('.note-edit textarea').fill(newText);await item.locator('.note-tags-input').fill(tags);await item.locator('.note-edit button.primary').click();await page.locator('#notesList .note-body').filter({hasText:newText}).waitFor();}
async function snapshot(assetId){return page.evaluate(async({asset,owner})=>{const o=await import('/offline.mjs');return{local:await o.listLocalAnnotations(asset,owner),ops:await o.listAnnotationOps()};},{asset:assetId,owner});}
async function seed(note){await page.evaluate(async({note,owner})=>{const o=await import('/offline.mjs');await o.saveLocalAnnotation({...note,server_id:note.id,ownerId:owner,pending:false});},{note,owner});}

async function rawNotes(assetId){return page.evaluate(async asset=>{
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('akademik-offline',2);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 try{return await new Promise((resolve,reject)=>{const r=db.transaction('annotations').objectStore('annotations').index('asset_id').getAll(asset);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}finally{db.close();}
},assetId);}
async function loginAs(email){
 await page.locator('#loginScreen').waitFor({state:'visible'});await page.evaluate(()=>history.replaceState(null,'','/'));await page.locator('#loginEmail').fill(email);await page.locator('#loginPassword').fill('demo1234');
 await page.locator('#loginPassword').press('Enter');await page.locator('#loginScreen').waitFor({state:'hidden'});await page.locator('#grid .card').first().waitFor();
}

async function epub(){const z=new JSZip();z.file('mimetype','application/epub+zip',{compression:'STORE'});z.file('META-INF/container.xml','<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/book.opf" media-type="application/epub+zip"/></rootfiles></container>');z.file('OEBPS/book.opf',`<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">${runId}</dc:identifier><dc:title>Offline edit EPUB</dc:title><dc:language>en</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>`);z.file('OEBPS/chapter.xhtml','<html xmlns="http://www.w3.org/1999/xhtml" lang="en"><head><title>Chapter</title></head><body><h1>Offline editing fixture</h1><p>Selections and personal notes survive reload.</p></body></html>');return z.generateAsync({type:'nodebuffer'});}
async function setup(){
 await mkdir(out,{recursive:true});await mkdir(tempRoot,{recursive:true});temp=await mkdtemp(path.join(tempRoot,'offline-edit-'));const dir=path.join(temp,'app');await mkdir(dir);
 for(const name of ['server.mjs','indexer.mjs','download-tickets.mjs','annotation-sync.mjs','social-watermark.mjs'])await copyFile(path.join(appDir,name),path.join(dir,name));
 await cp(path.join(appDir,'public'),path.join(dir,'public'),{recursive:true,filter:f=>!['uploads','ocr'].some(n=>f===path.join(appDir,'public',n)||f.startsWith(path.join(appDir,'public',n)+path.sep))});
 for(const file of ['server.mjs','public/app.js','public/offline.mjs','public/index.html','public/sw.js','public/i18n.mjs'])report.sources[file]=sha(await readFile(path.join(dir,file)));
 const socket=net.createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(r=>socket.close(r));base='http://127.0.0.1:'+port;
 app=spawn(process.execPath,['server.mjs'],{cwd:dir,env:{...process.env,DATABASE_URL:'',PORT:String(port),APP_VERSION:appVersion,SESSION_SECRET:randomUUID(),NODE_OPTIONS:''},windowsHide:true,stdio:['ignore','pipe','pipe']});app.on('error',e=>log+=e.message);for(const s of[app.stdout,app.stderr])s.on('data',b=>log=(log+b).slice(-6000));
 await until('owned server',async()=>{assert.equal(app.exitCode,null);const r=await fetch(base+'/api/health');return r.ok&&(await r.json()).mode==='demo';});
 browser=await chromium.launch({channel:'msedge',headless:true});context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'allow'});page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push({phase,error:e.stack}));report.browser=browser.version();
 const login=await context.request.post(base+'/api/login',{data:{email:'librarian@example.edu.tr',password:'demo1234'}});assert.equal(login.status(),200);owner=(await login.json()).id;assert.ok(owner);
 const pdf=await PDFDocument.create();pdf.addPage([600,760]).drawText('Offline edit PDF '+runId,{x:30,y:680,size:12});const books=[];
 for(const[format,buffer]of[['pdf',Buffer.from(await pdf.save())],['epub',await epub()]]){const r=await api('/api/upload',{method:'POST',multipart:{title:'Offline edit '+format+' '+runId,language:'en',file:{name:'fixture.'+format,mimeType:format==='pdf'?'application/pdf':'application/epub+zip',buffer}}});assert.equal(r.status(),201);books.push(await r.json());}
 await page.goto(base+'/');await page.locator('#loginScreen').waitFor({state:'hidden'});await page.locator('#grid .card').first().waitFor();
 // Cache generated files directly as test fixtures, not as a download-policy test.
 for(const book of books)await page.evaluate(async b=>{const o=await import('/offline.mjs'),r=await fetch('/api/books/'+b.id+'/file');if(!r.ok)throw Error('fixture stream');await o.saveOfflineBook(b,await r.blob(),{downloadProvenance:'test-fixture'});},book);
 await page.evaluate(async()=>{await Promise.race([navigator.serviceWorker.ready,new Promise((_,r)=>setTimeout(()=>r(Error('SW timeout')),15000))]);});
 await until('current full shell',()=>page.evaluate(async shell=>{const c=await caches.open(shell);return(await Promise.all(['/','/app.js','/offline.mjs','/vendor/pdfjs/pdf.mjs','/vendor/pdfjs/pdf.worker.mjs','/vendor/epubjs/jszip.min.js','/vendor/epubjs/epub.min.js','/epub-engine.mjs'].map(p=>c.match(p,{ignoreSearch:true})))).every(Boolean);},shell));
 return books;
}
try{
 const books=await setup(),pdf=books[0];
 for(const book of books){
  const original=await create(book,'Original '+book.format);await page.reload();await page.locator('#loginScreen').waitFor({state:'hidden'});await open(book);await notes();await page.locator('.note-body').filter({hasText:original.note}).waitFor();
  await stage(book.format+'-offline-ui-edit-reload-sync',async()=>{
   await context.setOffline(true);await edit(original.note,'Draft one '+book.format);await edit('Draft one '+book.format,'Final draft '+book.format);
   const queued=await snapshot(book.asset_id);assert.equal(queued.ops.length,1);assert.equal(queued.ops[0].type,'update');assert.equal(queued.ops[0].serverId,original.id);assert.equal(queued.ops[0].ownerId,owner);assert.equal(queued.local.find(x=>x.id===original.id).note,'Final draft '+book.format);assert.deepEqual(queued.ops[0].changes.tags,['alpha','beta']);
   await page.reload({waitUntil:'domcontentloaded'});await page.locator('#loginScreen').waitFor({state:'hidden'});await open(book);await notes();await page.locator('.note-body').filter({hasText:'Final draft '+book.format}).waitFor();assert.equal((await snapshot(book.asset_id)).ops.length,1);
   await page.screenshot({path:path.join(out,book.format+'-offline-edited.png')});await context.setOffline(false);
   await until('real PATCH after reconnect',async()=>(await rows(book)).find(x=>x.id===original.id)?.note==='Final draft '+book.format);await until('queue acknowledged',async()=>(await snapshot(book.asset_id)).ops.length===0);
   const local=(await snapshot(book.asset_id)).local.find(x=>x.id===original.id);assert.equal(local.pending,false);assert.deepEqual(local.tags,['alpha','beta']);await until('pending indicator cleared',async()=>!await page.locator('#notesList [role=status]').count());return{nativeIndexedDB:true,hardReload:true,serverId:original.id,coalescedEdits:2,pendingAfterSync:false};
  });
  await stage(book.format+'-cached-reader-online-edit-clears-pending',async()=>{await edit('Final draft '+book.format,'Connected edit '+book.format);await until('cached reader online edit synced',async()=>(await rows(book)).find(x=>x.id===original.id)?.note==='Connected edit '+book.format);await until('cached reader indicator cleared',async()=>!await page.locator('#notesList [role=status]').count());assert.equal((await snapshot(book.asset_id)).ops.length,0);return{backgroundSync:true,pendingIndicatorCleared:true};});
  await stage(book.format+'-unsaved-editor-survives-reconnect',async()=>{await context.setOffline(true);await notes();const item=page.locator('#notesList .note-item').filter({hasText:'Connected edit '+book.format});await item.locator('.note-edit-btn').click();const draft='Unsaved reconnect draft '+book.format;await item.locator('.note-edit textarea').fill(draft);const refreshed=page.waitForResponse(r=>r.url().includes('/api/annotations/v1?assetId='+book.asset_id)&&r.request().method()==='GET'&&r.status()===200);await context.setOffline(false);await refreshed;await pause(250);assert.equal(await item.locator('.note-edit textarea').inputValue(),draft);await item.locator('.note-edit button.primary').click();await until('unsaved draft explicitly saved',async()=>(await rows(book)).find(x=>x.id===original.id)?.note===draft);await until('final ack',async()=>(await snapshot(book.asset_id)).ops.length===0);return{editorPreserved:true,savedOnlyAfterClick:true};});
 }
 await page.locator('#closeReader').click();await page.locator('#reader').waitFor({state:'hidden'});
 await stage('unsent-create-edited-once-posted-once',async()=>page.evaluate(async({owner,asset})=>{const o=await import('/offline.mjs'),id='offline-'+crypto.randomUUID(),now=new Date().toISOString();const note={id,asset_id:asset,anchor:{type:'pdf',page:1,rects:[]},color:'yellow',note:'new',tags:[],pending:true,ownerId:owner};await o.saveAnnotationWithOperation(note,{opId:crypto.randomUUID(),type:'create',localId:id,assetId:asset,payload:{assetId:asset,anchor:note.anchor,color:'yellow',note:'new'},createdAt:now});await o.editLocalAnnotation(id,{note:'edited unsent',tags:'one;one;two'},owner);const queued=await o.listAnnotationOps();if(queued.length!==1||queued[0].type!=='create'||queued[0].payload.note!=='edited unsent')throw Error('create not coalesced');const calls=[];await o.syncAnnotationOperations(owner,(url,options)=>{calls.push(options.method);return fetch(url,options);});const local=(await o.listLocalAnnotations(asset,owner)).find(x=>x.id===id);if(calls.join()!=='POST'||local.pending||!local.server_id)throw Error('duplicate create');return{calls,localAliasPreserved:true};},{owner,asset:pdf.asset_id}));
 await stage('edit-during-create-becomes-patch',async()=>page.evaluate(async({owner,asset})=>{const o=await import('/offline.mjs'),id='offline-'+crypto.randomUUID(),note={id,asset_id:asset,anchor:{type:'pdf',page:1,rects:[]},color:'green',note:'first',tags:[],pending:true,ownerId:owner};await o.saveAnnotationWithOperation(note,{opId:crypto.randomUUID(),type:'create',localId:id,assetId:asset,payload:{assetId:asset,anchor:note.anchor,note:'first',color:'green'},createdAt:new Date().toISOString()});let started,release;const ready=new Promise(r=>started=r),barrier=new Promise(r=>release=r),calls=[];const flush=o.syncAnnotationOperations(owner,async(url,options)=>{calls.push(options.method);const response=await fetch(url,options);if(options.method==='POST'){started();await barrier;}return response;});await ready;await o.editLocalAnnotation(id,{note:'changed during POST',tags:['latest']},owner);release();await flush;const local=(await o.listLocalAnnotations(asset,owner)).find(x=>x.id===id);if(calls.join()!=='POST,PATCH'||local.note!=='changed during POST'||local.pending)throw Error('in-flight edit lost');return{calls,latestDraftPreserved:true};},{owner,asset:pdf.asset_id}));
 await stage('delete-during-create-compensates',async()=>page.evaluate(async({owner,asset})=>{const o=await import('/offline.mjs'),id='offline-'+crypto.randomUUID(),note={id,asset_id:asset,anchor:{type:'pdf',page:1},color:'yellow',note:'delete while posting',tags:[],pending:true,ownerId:owner};await o.saveAnnotationWithOperation(note,{opId:crypto.randomUUID(),type:'create',localId:id,assetId:asset,payload:{assetId:asset,anchor:note.anchor,note:note.note},createdAt:new Date().toISOString()});let started,release;const ready=new Promise(r=>started=r),barrier=new Promise(r=>release=r),calls=[];const flush=o.syncAnnotationOperations(owner,async(url,options)=>{calls.push(options.method);const response=await fetch(url,options);if(options.method==='POST'){started();await barrier;}return response;});await ready;await o.removeLocalAnnotationWithOperation(note,owner);release();await flush;if(calls.join()!=='POST,DELETE'||(await o.listLocalAnnotations(asset,owner)).some(x=>x.id===id)||(await o.listAnnotationOps()).length)throw Error('deleted note resurrected');return{calls,noResurrection:true};},{owner,asset:pdf.asset_id}));
 const failureNote=await create(pdf,'retry base');await seed(failureNote);
 await stage('failure-retains-draft-and-cache-does-not-overwrite',async()=>page.evaluate(async({owner,asset,note})=>{const o=await import('/offline.mjs');await o.editLocalAnnotation(note.id,{note:'keep my draft'},owner);for(const status of[401,403,500]){await o.syncAnnotationOperations(owner,async()=>new Response('{}',{status}));if((await o.listAnnotationOps()).length!==1)throw Error('failed operation discarded');}await o.cacheServerAnnotations(asset,[note],owner);const local=(await o.listLocalAnnotations(asset,owner)).find(x=>x.id===note.id);if(local.note!=='keep my draft'||!local.pending)throw Error('stale GET overwrote draft');await o.syncAnnotationOperations(owner);return{statuses:[401,403,500],draftRetained:true,retryAcknowledged:(await o.listAnnotationOps()).length===0};},{owner,asset:pdf.asset_id,note:failureNote}));
 const second=await create(pdf,'account guard');await seed(second);
 await stage('another-account-does-not-flush-and-api-checks-owner',async()=>{await page.evaluate(async({owner,id})=>{const o=await import('/offline.mjs');await o.editLocalAnnotation(id,{note:'owned draft'},owner);await o.syncAnnotationOperations('22222222-2222-2222-2222-222222222222',()=>{throw Error('cross-account request');});if((await o.listAnnotationOps()).length!==1)throw Error('cross-account queue lost');},{owner,id:second.id});const denied=await api('/api/annotations/'+second.id,{method:'PATCH',data:{ownerId:'22222222-2222-2222-2222-222222222222',note:'wrong owner'}});assert.equal(denied.status(),403);const deniedCreate=await api('/api/annotations',{method:'POST',data:{ownerId:'22222222-2222-2222-2222-222222222222',assetId:pdf.asset_id,anchor:{type:'pdf'},note:'wrong create'}});assert.equal(deniedCreate.status(),403);await page.evaluate(async owner=>(await import('/offline.mjs')).syncAnnotationOperations(owner),owner);assert.equal((await rows(pdf)).find(x=>x.id===second.id).note,'owned draft');return{patchDenied:403,createDenied:403};});
 const deleted=await create(pdf,'delete queued update');await seed(deleted);
 await stage('edit-then-delete-clears-update-and-tombstone-hides-stale-get',async()=>page.evaluate(async({owner,asset,note})=>{const o=await import('/offline.mjs');await o.editLocalAnnotation(note.id,{note:'never replay'},owner);await o.removeLocalAnnotationWithOperation({...note,server_id:note.id,ownerId:owner},owner);await o.cacheServerAnnotations(asset,[note],owner);if((await o.listLocalAnnotations(asset,owner)).some(x=>x.id===note.id))throw Error('tombstone ignored');const queued=await o.listAnnotationOps();if(queued.length!==1||queued[0].type!=='delete')throw Error('stale update remains');await o.syncAnnotationOperations(owner);return{deleteOnly:true,noResurrection:true};},{owner,asset:pdf.asset_id,note:deleted}));
 await stage('native-transaction-abort-keeps-note-and-queue-atomic',async()=>page.evaluate(async({owner,asset})=>{const o=await import('/offline.mjs'),id='offline-'+crypto.randomUUID();let failed=false;try{await o.saveAnnotationWithOperation({id,asset_id:asset,ownerId:owner,note:'must roll back'},{opId:crypto.randomUUID(),type:'create',localId:id,payload:{nonCloneable:()=>{}}});}catch(e){failed=e.name==='DataCloneError';}if(!failed||(await o.listLocalAnnotations(asset,owner)).some(x=>x.id===id)||(await o.listAnnotationOps()).some(x=>x.localId===id))throw Error('partial IDB commit');return{nativeDataCloneError:true,noPartialWrite:true};},{owner,asset:pdf.asset_id}));
 await stage('legacy-unowned-draft-is-quarantined-without-data-loss',async()=>{
  const id='offline-'+randomUUID();
  await page.evaluate(async({owner,asset,id})=>{
   const o=await import('/offline.mjs');
   await o.saveLocalAnnotation({id,asset_id:asset,note:'legacy private',pending:true});
   let code;try{await o.editLocalAnnotation(id,{note:'unsafe claim'},owner);}catch(e){code=e.code;}
   if(code!=='ANNOTATION_OWNER_REQUIRED')throw Error('legacy account silently claimed');
   if((await o.listLocalAnnotations(asset,owner)).some(x=>x.id===id))throw Error('legacy note visible');
  },{owner,asset:pdf.asset_id,id});
  assert.equal((await rawNotes(pdf.asset_id)).find(x=>x.id===id).note,'legacy private');
  return{ownerVerificationRequired:true,legacyDataPreserved:true,hiddenFromNormalList:true};
 });

 const privacy=[];
 // Seed owned server notes while online, then edit both offline through the real UI.
 for(const book of books){
  const original=(await rows(book)).find(x=>x.note==='Unsaved reconnect draft '+book.format);
  assert.ok(original);await seed(original);privacy.push({book,id:original.id,secret:'A private offline '+book.format,previous:original.note});
 }
 await context.setOffline(true);
 for(const fixture of privacy){await openCached(fixture.book);await edit(fixture.previous,fixture.secret);await page.locator('#closeReader').click();await page.locator('#reader').waitFor({state:'hidden'});}
 const queuedA=(await snapshot(pdf.asset_id)).ops;
 assert.equal(queuedA.filter(x=>x.ownerId===owner).length,2);
 await context.setOffline(false);
 await until('A offline edits acknowledged before real online logout',async()=>{
  for(const fixture of privacy)if((await rows(fixture.book)).find(x=>x.id===fixture.id)?.note!==fixture.secret)return false;
  return (await snapshot(pdf.asset_id)).ops.length===0;
 });
 await Promise.all([page.waitForEvent('domcontentloaded'),page.locator('#logoutBtn').click()]);
 await page.locator('#loginScreen').waitFor({state:'visible'});
 await context.setOffline(true);await page.reload({waitUntil:'domcontentloaded'});
 await page.locator('#grid .card').first().waitFor();
 assert.equal(await page.evaluate(()=>localStorage.getItem('offlineAnnotationUser')),null);
 for(const fixture of privacy)await stage(fixture.book.format+'-logged-out-offline-hides-all-notes',async()=>{
  await open(fixture.book);await notes();assert.equal(await page.locator('#notesList .note-item').count(),0);
  await page.screenshot({path:path.join(out,fixture.book.format+'-logged-out-private-notes-hidden.png')});
  await page.locator('#closeReader').click();await page.locator('#reader').waitFor({state:'hidden'});
  return{logoutClearsRememberedIdentity:true,privateNotesHidden:true,legacyNotesHidden:true};
 });
 await page.evaluate(()=>history.replaceState(null,'','/'));await context.setOffline(false);await page.reload();await loginAs('reader@example.edu.tr');
 const userB=(await(await api('/api/me')).json()).id;assert.notEqual(userB,owner);
 // A demo server shares annotations. Do not open a reader online as B: these
 // fixtures test local read isolation, without claiming demo server isolation.
 for(const fixture of privacy)await page.evaluate(async({asset,userB,format})=>{
  const o=await import('/offline.mjs');
  await o.saveLocalAnnotation({id:crypto.randomUUID(),asset_id:asset,ownerId:userB,note:'B own '+format,tags:[],color:'yellow',anchor:format==='pdf'?{type:'pdf',page:1,rects:[]}:{type:'epub',cfi:'epubcfi(/6/2[chapter]!/4/2/1:0)'},pending:false});
  await o.saveLocalAnnotation({id:crypto.randomUUID(),asset_id:asset,note:'Legacy hidden '+format,pending:true,tags:[]});
 },{asset:fixture.book.asset_id,userB,format:fixture.book.format});
 await context.setOffline(true);await page.reload({waitUntil:'domcontentloaded'});await page.locator('#grid .card').first().waitFor();
 for(const fixture of privacy)await stage(fixture.book.format+'-account-B-offline-cannot-read-A-or-legacy',async()=>{
  await open(fixture.book);await notes();
  const bodies=await page.locator('#notesList .note-body').allTextContents();
  assert.deepEqual(bodies,['B own '+fixture.book.format],JSON.stringify({identity:await page.evaluate(()=>localStorage.getItem('offlineAnnotationUser')),stored:(await rawNotes(fixture.book.asset_id)).map(x=>({id:x.id,owner:x.ownerId,note:x.note}))}));
  const result=await page.evaluate(async({asset,userB})=>{const o=await import('/offline.mjs');return{missing:await o.listLocalAnnotations(asset),nullOwner:await o.listLocalAnnotations(asset,null),owned:await o.listLocalAnnotations(asset,userB),ops:await o.listAnnotationOps()};},{asset:fixture.book.asset_id,userB});
  assert.deepEqual(result.missing,[]);assert.deepEqual(result.nullOwner,[]);assert.equal(result.owned.length,1);
  assert.equal(result.ops.filter(x=>x.ownerId===owner).length,0);
  assert.ok((await rawNotes(fixture.book.asset_id)).some(x=>x.id===fixture.id&&x.note===fixture.secret));
  await page.screenshot({path:path.join(out,fixture.book.format+'-account-B-private-notes-hidden.png')});
  await page.locator('#closeReader').click();await page.locator('#reader').waitFor({state:'hidden'});
  return{sameBrowserProfile:true,hardReloadOffline:true,ownNoteVisible:true,accountANoteHidden:true,legacyNoteHidden:true,missingOwnerReturnsNothing:true,accountADraftRetained:true};
 });
 // Return to A and reopen the retained local notes without network.
 await page.evaluate(()=>history.replaceState(null,'','/'));await context.setOffline(false);await page.reload();await page.locator('#logoutBtn').waitFor();
 await Promise.all([page.waitForEvent('domcontentloaded'),page.locator('#logoutBtn').click()]);await loginAs('librarian@example.edu.tr');
 await context.setOffline(true);
 for(const fixture of privacy)await stage(fixture.book.format+'-account-A-return-restores-own-offline-draft',async()=>{
  await openCached(fixture.book);await notes();const bodies=await page.locator('#notesList .note-body').allTextContents();
  assert.ok(bodies.includes(fixture.secret));assert.ok(bodies.every(x=>!x.includes('B own')&&!x.includes('Legacy hidden')&&!x.includes('legacy private')));
  await page.locator('#closeReader').click();await page.locator('#reader').waitFor({state:'hidden'});
  return{originalDraftPreserved:true,otherAccountHidden:true,legacyHidden:true};
 });

 assert.deepEqual(errors,[]);report.status='passed';
}catch(e){report.status='failed';report.error={phase,message:e.stack};report.serverLog=log;await page?.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});console.error(e.stack);process.exitCode=1;}
finally{
 await context?.setOffline(false).catch(()=>{});await browser?.close().catch(()=>{});report.cleanup.browser=!browser||!browser.isConnected();
 if(app&&app.exitCode===null&&app.signalCode===null){app.kill();await Promise.race([once(app,'exit'),pause(5000)]);}report.cleanup.server=!app||app.exitCode!==null||app.signalCode!==null;
 if(temp){const target=path.resolve(temp);assert.ok(target.startsWith(path.resolve(tempRoot)+path.sep)&&path.basename(target).startsWith('offline-edit-'));await rm(target,{recursive:true,force:true});report.cleanup.temp=true;}
 report.pageErrors=errors;for(const[file,hash]of Object.entries(report.sources))assert.equal(sha(await readFile(path.join(appDir,file))),hash,'source changed: '+file);if(errors.length||Object.values(report.cleanup).some(x=>!x)){report.status='failed';process.exitCode=1;}report.completedAt=new Date().toISOString();await persist();console.log(JSON.stringify({status:report.status,cases:report.cases.length,errors:errors.length,cleanup:report.cleanup,evidence:out}));
}
