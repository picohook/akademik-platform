import assert from 'node:assert/strict';
import path from 'node:path';
import net from 'node:net';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile,copyFile,cp,readdir} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import {chromium} from 'file:///C:/Users/OWNER/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';

const exec=promisify(execFile);
const require=createRequire(path.resolve('spike/app/package.json'));
const JSZip=require('jszip');
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const run=path.resolve('tmp/reader-package1-review/run-'+stamp);
const evidence=path.join(run,'evidence');
const source=path.resolve('tmp/reader-package1-review/source-d0e01c9/spike/app');
const appCopy=path.resolve('spike/app/tmp/package1-review-'+stamp);
const productFiles=['server.mjs','indexer.mjs','public/app.js','public/index.html','public/i18n.mjs','public/epub-engine.mjs','public/styles.css','public/offline.mjs'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const report={startedAt:new Date().toISOString(),scope:'Independent pinned v112 R1/R2 retest, account/book settings, English labels, and adjacent EPUB positions; isolated demo, no production writes',cases:[],sources:[]};
const diagnostics=[];
let app,browser,context,page,base,appLog='',epub,pdf,bookmark,highlight,largeEpub;
await mkdir(evidence,{recursive:true});
const save=(file,value)=>writeFile(path.join(evidence,file),JSON.stringify(value,null,2)+'\n');
const screenshot=name=>page.screenshot({path:path.join(evidence,name+'.png'),fullPage:false});
async function stage(id,fn){
 let item;
 try{item={status:'PASS',...(await fn()),id};}
 catch(error){item={id,status:'FAIL',error:error.message,location:await locationState(bookmark?.anchor?.cfi).catch(e=>({error:e.message}))};await screenshot(id+'-failure').catch(()=>{});}
 report.cases.push(item);await save('results.json',report);console.log(JSON.stringify({id:item.id,status:item.status,error:item.error}));return item.status==='PASS';
}
async function login(email){
 await page.goto(base+'/',{waitUntil:'domcontentloaded'});
 if(await page.locator('#logoutBtn').isVisible())await page.locator('#logoutBtn').click();
 await page.locator('#loginScreen:not([hidden])').waitFor();
 await page.locator('#loginEmail').fill(email);await page.locator('#loginPassword').fill('demo1234');
 await page.locator('#loginForm button[type=submit]').click();
 await page.locator('#loginScreen').waitFor({state:'hidden'});await page.locator('#grid .open-btn').first().waitFor();
}
async function api(url,options={}){
 const cookie=(await context.cookies()).find(c=>c.name==='akademik_csrf')?.value;
 const response=await page.request.fetch(base+url,{...options,headers:{...(options.headers||{}),'x-csrf-token':cookie||''}});
 assert.ok(response.ok(),url+' HTTP '+response.status()+' '+(await response.text()).slice(0,200));
 return response.json();
}
const annotations=book=>api('/api/annotations?assetId='+book.asset_id);
async function close(){
 if(await page.locator('#reader').isVisible()){
  await page.locator('#closeReader').click();await page.locator('#reader').waitFor({state:'hidden'});await pause(350);
 }
}
async function open(book){
 await close();
 await page.goto(base+'/',{waitUntil:'domcontentloaded'});
 await page.locator('#grid .card').filter({hasText:book.title}).locator('.open-btn').click();
 await page.locator('#reader:not([hidden])').waitFor();
 await page.waitForFunction(()=>document.activeElement?.id==='closeReader',{},{timeout:15000});
 if(book.format==='epub'){
  await page.waitForFunction(()=>document.querySelector('#epubView iframe')?.contentDocument?.body?.textContent.trim());
  await pause(500);
 }else await page.waitForFunction(()=>document.querySelector('#textLayer').textContent.trim());
}
async function notes(){
 if(!await page.locator('#notesPanel').isVisible())await page.locator('#toggleNotes').click();
 await page.locator('#noteColorFilter').selectOption('all');await page.locator('#noteFilter').fill('');
}
async function closeNotes(){if(await page.locator('#notesPanel').isVisible())await page.locator('#closeNotes').click();}
const cfi=()=>new URL(page.url()).searchParams.get('cfi');
async function locationState(target){return page.evaluate(target=>{
 const frames=[...document.querySelectorAll('#epubView iframe')].map(f=>{
  const result={width:f.clientWidth,height:f.clientHeight,body:f.contentDocument?.body?.innerText.slice(0,180)};
  if(target&&f.contentDocument&&window.ePub?.CFI){try{
   const range=new window.ePub.CFI(target).toRange(f.contentDocument);
   if(range.collapsed&&range.startContainer.nodeType===3&&range.startOffset<range.startContainer.length)range.setEnd(range.startContainer,range.startOffset+1);
   const r=range.getBoundingClientRect();const fr=f.getBoundingClientRect();const clip=document.querySelector('#epubView').getBoundingClientRect();
   const absolute={left:fr.left+r.left,right:fr.left+r.right,top:fr.top+r.top,bottom:fr.top+r.bottom};
   result.target={rect:r.toJSON(),frameRect:fr.toJSON(),viewport:clip.toJSON(),absolute,text:range.startContainer.textContent.slice(0,150),visible:absolute.right>=Math.max(0,clip.left)&&absolute.left<Math.min(innerWidth,clip.right)&&absolute.bottom>=Math.max(0,clip.top)&&absolute.top<Math.min(innerHeight,clip.bottom)};
  }catch(error){result.targetError=error.message}}
  return result;
 });
 return {cfi:new URL(location.href).searchParams.get('cfi'),target,star:document.querySelector('#bookmarkBtn').getAttribute('aria-pressed'),epubExports:Object.keys(window.ePub||{}),frames};
},target)}
async function settings(){return page.evaluate(()=>{
 const frame=document.querySelector('#epubView iframe');
 const body=frame?.contentDocument?.body;
 return {zoom:document.querySelector('#zoomLabel').textContent,theme:document.querySelector('#reader').dataset.theme||document.querySelector('#reader').className,
  bodyFont:body?frame.contentWindow.getComputedStyle(body).fontSize:null,
  bodyBackground:body?frame.contentWindow.getComputedStyle(body).backgroundColor:null,
  keys:Object.fromEntries(Object.entries(localStorage).filter(([key])=>/reader.*(theme|font|pref|setting)/i.test(key)))};
})}

try{
 report.gitHead=(await exec('git',['rev-parse','d0e01c9'])).stdout.trim();report.sourceArchive='git archive d0e01c9';
 report.gitStatus=(await exec('git',['status','--short'])).stdout.trim();
 report.workspaceProductStatus=(await exec('git',['status','--short','--','spike/app'])).stdout.trim();report.productGitStatus='';
 await mkdir(path.join(appCopy,'public'),{recursive:true});
 for(const f of ['server.mjs','indexer.mjs'])await copyFile(path.join(source,f),path.join(appCopy,f));
 await cp(path.join(source,'public'),path.join(appCopy,'public'),{recursive:true,filter:p=>!['uploads','ocr'].some(d=>p===path.join(source,'public',d)||p.startsWith(path.join(source,'public',d)+path.sep))});
 for(const file of productFiles){
  const original=await readFile(path.join(source,file));const tested=await readFile(path.join(appCopy,file));
  assert.ok(original.equals(tested),'Source changed while taking snapshot: '+file);
  report.sources.push({file:'spike/app/'+file,sha256:sha(tested)});
 }
 const index=await readFile(path.join(appCopy,'public/index.html'),'utf8');report.frontend=index.match(/app\.js\?v=(\d+)/)?.[1];
 const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));base='http://127.0.0.1:'+port;report.url=base;
 app=spawn(process.execPath,['server.mjs'],{cwd:appCopy,env:{...process.env,DATABASE_URL:'',PORT:String(port),SESSION_SECRET:randomBytes(32).toString('hex'),DEMO_PASSWORD:'demo1234'},windowsHide:true,stdio:['ignore','pipe','pipe']});
 for(const s of [app.stdout,app.stderr])s.on('data',b=>appLog=(appLog+b).slice(-10000));
 app.on('error',e=>appLog+=e.message);
 let ready=false;for(let i=0;i<120;i++){
  try{const r=await fetch(base+'/api/health',{signal:AbortSignal.timeout(500)});if(r.ok&&(await r.json()).mode==='demo'){ready=true;break}}catch{}
  assert.equal(app.exitCode,null,appLog);await pause(250);
 }assert.ok(ready,'Local demo server not ready: '+appLog);
 browser=await chromium.launch({channel:'msedge',headless:true});report.browser=browser.version();
 context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});page=await context.newPage();
 page.setDefaultTimeout(7000);page.on('pageerror',e=>diagnostics.push({type:'pageerror',message:e.message}));page.on('console',m=>{if(['error','warning'].includes(m.type()))diagnostics.push({type:m.type(),message:m.text()})});
 await login('librarian@example.edu.tr');
 await page.evaluate(()=>{localStorage.setItem('readerEpubFontSize','180');localStorage.setItem('readerTheme','dark')});
 const zip=await JSZip.loadAsync(await readFile(path.join(source,'public/seed/sample.epub')));
 const ch=await zip.file('OEBPS/ch1.xhtml').async('string');
 zip.file('OEBPS/ch1.xhtml',ch.replace('</body>',Array.from({length:75},(_,i)=>`<p>Paragraf ${i+1}. Akademik okuma konumu ve yer imi kabul testi. Bu uzun bölüm farklı sayfalarda gezinmeyi ve yazı boyutu değişince konumun korunmasını sınar.</p>`).join('\n')+'</body>'));
 const epubBytes=await zip.generateAsync({type:'nodebuffer'});await writeFile(path.join(run,'long-fixture.epub'),epubBytes);
 epub=await api('/api/upload',{method:'POST',multipart:{title:'Independent EPUB Acceptance',language:'tr',file:{name:'acceptance.epub',mimeType:'application/epub+zip',buffer:epubBytes}}});
 const largeZip=await JSZip.loadAsync(epubBytes);
 const largeChapter=await largeZip.file('OEBPS/ch2.xhtml').async('string');
 largeZip.file('OEBPS/ch2.xhtml',largeChapter.replace('</body>',Array.from({length:4000},(_,i)=>'<p>Uzun kitap paragraf '+(i+1)+'. Birbirine yakın yüzdelerdeki farklı okuma sayfaları aynı yer imi sayılmamalıdır. Akademik konum testi uzun metin içeriği.</p>').join('\n')+'</body>'));
 const largeBytes=await largeZip.generateAsync({type:'nodebuffer'});await writeFile(path.join(run,'adjacent-fixture.epub'),largeBytes);
 largeEpub=await api('/api/upload',{method:'POST',multipart:{title:'Adjacent EPUB Positions',language:'en',file:{name:'adjacent.epub',mimeType:'application/epub+zip',buffer:largeBytes}}});
 pdf=(await api('/api/books')).find(b=>b.format!=='epub');assert.ok(pdf);
 await open(epub);
 await stage('legacy-global-preferences-ignored',async()=>{const actual=await settings();assert.equal(actual.zoom,'100%');assert.equal(actual.theme,'light');return actual});
 await stage('epub-bookmark-visible',async()=>{assert.ok(await page.locator('#bookmarkBtn').isVisible());return {label:await page.locator('#bookmarkBtn').getAttribute('aria-label')}});
 await stage('epub-bookmark-create',async()=>{
  await page.locator('#nextPage').click();await pause(650);const location=cfi();assert.ok(location);
  await page.locator('#bookmarkBtn').click();await pause(400);
  const rows=await annotations(epub);bookmark=rows.find(a=>a.color==='bookmark');assert.ok(bookmark);assert.equal(bookmark.anchor.type,'epub');assert.equal(bookmark.anchor.cfi,location);
  assert.equal(await page.locator('#bookmarkBtn').getAttribute('aria-pressed'),'true');
  await screenshot('epub-bookmark-created');
  return {bookmarkId:bookmark.id,cfi:location,location:await locationState(location)};
 });
 await stage('epub-bookmark-toggle-remove',async()=>{
  assert.ok(bookmark);await closeNotes();assert.equal(cfi(),bookmark.anchor.cfi);
  assert.ok(bookmark);assert.equal(await page.locator('#bookmarkBtn').getAttribute('aria-pressed'),'true');
  await page.locator('#bookmarkBtn').click();await pause(350);assert.equal((await annotations(epub)).filter(a=>a.color==='bookmark').length,0);
  assert.equal(await page.locator('#bookmarkBtn').getAttribute('aria-pressed'),'false');
  await page.locator('#bookmarkBtn').click();await pause(300);bookmark=(await annotations(epub)).find(a=>a.color==='bookmark');assert.ok(bookmark);
  return {toggleRemoved:true,recreatedCfi:bookmark.anchor.cfi};
 });
 await stage('bookmark-active-through-notes-resize',async()=>{
  assert.ok(bookmark);await notes();await pause(900);const opened=await locationState(bookmark.anchor.cfi);
  await screenshot('bookmark-notes-resized');
  assert.ok(opened.frames.some(f=>f.target?.visible),'Saved target is not visible after opening Notes');
  assert.equal(opened.star,'true','Visible saved bookmark lost its star after opening Notes: '+JSON.stringify(opened));
  await closeNotes();await pause(700);const closed=await locationState(bookmark.anchor.cfi);
  if(closed.frames.some(f=>f.target?.visible))assert.equal(closed.star,'true','Visible saved bookmark lost its star after closing Notes');
  return {opened,closed};
 });
 await stage('epub-bookmark-return-from-panel',async()=>{
  assert.ok(bookmark,'Bookmark setup did not pass');await closeNotes();
  await page.locator('#toggleToc').click();await page.locator('#tocList .toc-item').filter({hasText:'Notlar ve atıflar'}).click();
  await page.waitForFunction(()=>new URL(location.href).searchParams.get('cfi')?.includes('/6/4!'));
  if(await page.locator('#tocPanel').isVisible())await page.locator('#closeToc').click();await pause(650);assert.notEqual(cfi(),bookmark.anchor.cfi);
  await notes();assert.ok((await page.locator('#notesList').innerText()).toLocaleLowerCase('tr').includes('yer imi'));
  await page.locator('#notesList .note-page').first().click();await pause(900);
  const result=await locationState(bookmark.anchor.cfi);assert.ok(result.frames.some(f=>f.target?.visible),'Bookmarked text is not visible after panel jump: '+JSON.stringify(result));
  return {returnedCfi:cfi(),location:result,starAfterReturn:await page.locator('#bookmarkBtn').getAttribute('aria-pressed')};
 });
 await stage('epub-bookmark-reopen',async()=>{
  assert.ok(bookmark);await open(epub);await notes();
  const rows=await annotations(epub);assert.equal(rows.filter(a=>a.color==='bookmark').length,1);assert.equal(await page.locator('#notesList .note-item').count(),1);
  assert.equal(rows.find(a=>a.color==='bookmark').anchor.cfi,bookmark.anchor.cfi);
  await page.locator('#notesList .note-page').first().click();await pause(900);
  const location=await locationState(bookmark.anchor.cfi);assert.ok(location.frames.some(f=>f.target?.visible),'Bookmarked text is not visible after reopening: '+JSON.stringify(location));
  await screenshot('epub-bookmark-reopened');return {cfi:cfi(),readerVisible:await page.locator('#reader').isVisible(),location};
 });
 await stage('epub-returned-bookmark-toggle',async()=>{
  assert.ok(bookmark);const before=await annotations(epub);const location=await locationState(bookmark.anchor.cfi);
  assert.ok(location.frames.some(f=>f.target?.visible),'Return target is not visible');
  await screenshot('returned-bookmark-before-toggle');
  await page.locator('#bookmarkBtn').click();await pause(400);const after=await annotations(epub);
  const currentProgress=await api('/api/progress?assetId='+epub.asset_id);
  const details={savedPercent:bookmark.anchor.percent,currentProgress,savedCfi:bookmark.anchor.cfi,currentCfi:location.cfi,starBefore:location.star,before:before.filter(a=>a.color==='bookmark').map(a=>({id:a.id,cfi:a.anchor.cfi})),after:after.filter(a=>a.color==='bookmark').map(a=>({id:a.id,cfi:a.anchor.cfi}))};
  await save('returned-bookmark-toggle.json',details);await screenshot('returned-bookmark-after-toggle');
  // Restore this fixture for later independent cases, even if toggle unexpectedly creates another bookmark.
  for(const row of after.filter(a=>a.color==='bookmark'&&!before.some(b=>b.id===a.id)))await api('/api/annotations/'+row.id,{method:'DELETE'});
  assert.equal(details.after.length,details.before.length-1,'Returned bookmark toggle did not remove the saved bookmark: '+JSON.stringify(details));
  return details;
 });
 // Subsequent cases use a clean online reader even if point-CFI rendering failed.
 if(!await page.locator('#reader').isVisible()){
  if(bookmark)await api('/api/annotations/'+bookmark.id,{method:'DELETE'});bookmark=null;await open(epub);
 }
 await stage('epub-font-theme-reopen',async()=>{
  await closeNotes();await page.locator('#zoomIn').click();await page.locator('#zoomIn').click();await page.locator('#themeBtn').click();await page.locator('#themeBtn').click();await pause(700);
  const before=await settings();assert.equal(before.zoom,'120%');await open(epub);const after=await settings();
  assert.equal(after.zoom,before.zoom);assert.equal(after.bodyBackground,before.bodyBackground);assert.equal(after.bodyFont,before.bodyFont);await screenshot('epub-settings-reopened');return {before,after};
 });
 await stage('epub-font-theme-reload',async()=>{
  const before=await settings();await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.activeElement?.id==='closeReader',{},{timeout:15000});await pause(700);
  const after=await settings();assert.equal(after.zoom,before.zoom);assert.equal(after.bodyBackground,before.bodyBackground);assert.equal(after.bodyFont,before.bodyFont);return {before,after};
 });
 await stage('epub-bookmark-remove',async()=>{
  await closeNotes();let rows=await annotations(epub);
  if(!rows.some(a=>a.color==='bookmark')){await page.locator('#bookmarkBtn').click();await pause(400);rows=await annotations(epub);}
  const existing=rows.find(a=>a.color==='bookmark');assert.ok(existing);
  await notes();const item=page.locator('#notesList .note-item').filter({hasText:'Yer imi'}).first();await item.locator('.note-delete').click();await pause(350);
  assert.equal((await annotations(epub)).filter(a=>a.color==='bookmark').length,0);assert.equal(await page.locator('#bookmarkBtn').getAttribute('aria-pressed'),'false');bookmark=null;return {remainingBookmarks:0};
 });
 await stage('epub-highlight-with-bookmark',async()=>{
  await closeNotes();await pause(800);
  await page.locator('#epubView iframe').first().contentFrame().locator('body').evaluate((body)=>{
   const document=body.ownerDocument;const win=document.defaultView;
   const paragraph=[...document.querySelectorAll('p')].find(p=>p.getBoundingClientRect().left>=0&&p.getBoundingClientRect().left<win.innerWidth)||document.querySelector('p');
   const text=paragraph.firstChild;const range=document.createRange();range.setStart(text,0);range.setEnd(text,Math.min(text.textContent.length,35));
   win.getSelection().removeAllRanges();win.getSelection().addRange(range);document.dispatchEvent(new win.MouseEvent('mouseup',{bubbles:true}));
  });
  await page.locator('#hlBar:not([hidden])').waitFor();await page.locator('#hlNote').fill('Independent note');await page.locator('#hlSave').click();await pause(500);
  highlight=(await annotations(epub)).find(a=>a.color!=='bookmark');assert.ok(highlight);await page.locator('#bookmarkBtn').click();await pause(350);
  bookmark=(await annotations(epub)).find(a=>a.color==='bookmark');assert.ok(bookmark);await notes();assert.equal(await page.locator('#notesList .note-item').count(),2);return {highlightId:highlight.id,bookmarkId:bookmark.id};
 });
 await stage('pdf-epub-bookmark-isolation',async()=>{
  if(!(await annotations(epub)).some(a=>a.color==='bookmark')){await closeNotes();await page.locator('#bookmarkBtn').click();await pause(350);}
  await open(pdf);await page.locator('#bookmarkBtn').click();await pause(400);const pdfRows=await annotations(pdf);assert.equal(pdfRows.filter(a=>a.color==='bookmark').length,1);assert.ok(pdfRows.every(a=>a.anchor.type==='pdf'));
  await notes();assert.equal(await page.locator('#notesList .note-item').count(),1);assert.ok((await page.locator('#notesList').innerText()).toLocaleLowerCase('tr').includes('sayfa'));
  await closeNotes();await page.locator('#bookmarkBtn').click();await pause(350);assert.equal((await annotations(pdf)).length,0);
  await open(epub);await notes();const epubRows=await annotations(epub);assert.ok(epubRows.length>0);assert.ok(epubRows.every(a=>a.anchor.type==='epub'));assert.equal(await page.locator('#notesList .note-item').count(),epubRows.length);return {pdfBookmarksAddedAndRemoved:true,epubRows:epubRows.length};
 });
 // Clean online bookmark before testing the explicitly excluded offline create.
 for(const row of (await annotations(epub)).filter(a=>a.color==='bookmark'))await api('/api/annotations/'+row.id,{method:'DELETE'});
 await page.evaluate(async(assetId)=>{const m=await import('/offline.mjs');for(const row of await m.listLocalAnnotations(assetId)){if(row.color==='bookmark')await m.deleteLocalAnnotation(row.id)}},epub.asset_id);
 await close();await page.goto(base+'/',{waitUntil:'domcontentloaded'});await page.locator('#grid .card').first().waitFor();
 const card=page.locator('#grid .card').filter({hasText:epub.title});await card.locator('.offline-card-btn').click();await pause(700);
 await page.locator('#offlineBtn').click();const offlineRow=page.locator('#offlineList .grant-row').filter({hasText:epub.title});await offlineRow.waitFor();await offlineRow.locator('button').first().click();
 await page.waitForFunction(()=>document.activeElement?.id==='closeReader',{},{timeout:15000});await pause(500);
 await context.setOffline(true);
 await stage('offline-bookmark-create-remains-excluded',async()=>{
  const before=await page.evaluate(async()=>{const m=await import('/offline.mjs');return {queue:await m.listAnnotationOps(),local:await m.listLocalAnnotations(new URL(location.href).searchParams.get('unused')||'')};});
  await closeNotes();await page.locator('#bookmarkBtn').click();await pause(400);
  const after=await page.evaluate(async()=>{const m=await import('/offline.mjs');return {queue:await m.listAnnotationOps(),toasts:document.querySelector('#toast')?.textContent||document.body.innerText.slice(-300)};});
  assert.equal(after.queue.length,before.queue.length);assert.equal(await page.locator('#bookmarkBtn').getAttribute('aria-pressed'),'false');await screenshot('offline-bookmark-excluded');return {queuedBefore:before.queue.length,queuedAfter:after.queue.length,message:after.toasts};
 });
 await stage('offline-note-create-remains-functional',async()=>{
  const frame=page.frames().find(f=>f.parentFrame());assert.ok(frame);
  await frame.evaluate(()=>{const text=document.querySelector('p').firstChild;const r=document.createRange();r.setStart(text,0);r.setEnd(text,20);getSelection().removeAllRanges();getSelection().addRange(r);document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));});
  await page.locator('#hlBar:not([hidden])').waitFor();await page.locator('#hlNote').fill('Offline independent note');await page.locator('#hlSave').click();await pause(500);
  const ops=await page.evaluate(async()=>{const m=await import('/offline.mjs');return m.listAnnotationOps()});assert.ok(ops.some(o=>o.type==='create'&&o.payload.anchor.type==='epub'&&o.payload.color!=='bookmark'));return {queuedOps:ops.length};
 });
 await context.setOffline(false);await pause(700);await close();

 await stage('settings-user-B-defaults',async()=>{
  await login('reader@example.edu.tr');await open(epub);const actual=await settings();
  assert.equal(actual.zoom,'100%');assert.equal(actual.theme,'light');await screenshot('user-B-defaults');return actual;
 });
 await stage('settings-user-A-restored',async()=>{
  await login('librarian@example.edu.tr');await open(epub);const actual=await settings();
  assert.equal(actual.zoom,'120%');assert.equal(actual.theme,'dark');await screenshot('user-A-restored');return actual;
 });
 await stage('settings-book-specific-and-user-fallback',async()=>{
  await open(largeEpub);const initial=await settings();assert.equal(initial.zoom,'120%');assert.equal(initial.theme,'dark');
  for(let i=0;i<3;i++)await page.locator('#zoomIn').click();await pause(700);assert.equal((await settings()).zoom,'150%');
  await open(epub);const firstBook=await settings();assert.equal(firstBook.zoom,'120%');
  await open(largeEpub);const secondBook=await settings();assert.equal(secondBook.zoom,'150%');
  return {fallback:initial.zoom,firstBook,secondBook};
 });
 await stage('english-bookmark-label-and-export',async()=>{
  await close();await page.evaluate(()=>localStorage.setItem('uiLang','en'));await page.reload({waitUntil:'domcontentloaded'});
  await open(epub);await closeNotes();
  if(!await page.locator('#bookmarkBtn').evaluate(e=>e.getAttribute('aria-pressed')==='true')){await page.locator('#bookmarkBtn').click();await pause(400)}
  await notes();const label=page.locator('#notesList .note-page').filter({hasText:'Bookmark'}).first();await label.waitFor();
  const text=await label.innerText();const transform=await label.evaluate(e=>getComputedStyle(e).textTransform);assert.ok(text.includes('Bookmark'));assert.equal(transform,'none');
  const pendingDownload=page.waitForEvent('download');await page.locator('#exportMd').click();const download=await pendingDownload;
  const output=path.join(evidence,'english-notes.md');await download.saveAs(output);const markdown=await readFile(output,'utf8');assert.ok(markdown.includes('*Bookmark*'));
  await screenshot('english-bookmark');return {label:text,textTransform:transform,download:download.suggestedFilename()};
 });
 await stage('adjacent-pages-remain-distinct-bookmarks',async()=>{
  await close();await page.evaluate(()=>localStorage.setItem('uiLang','tr'));await page.reload({waitUntil:'domcontentloaded'});await open(largeEpub);await closeNotes();
  await page.locator('#bookmarkBtn').click();await pause(400);const before=await annotations(largeEpub);const saved=before.find(a=>a.color==='bookmark');assert.ok(saved);
  bookmark=saved;const savedCfi=saved.anchor.cfi;await page.locator('#nextPage').click();
  await page.waitForFunction(value=>new URL(location.href).searchParams.get('cfi')!==value,savedCfi);await pause(650);
  const location=await locationState(savedCfi);assert.ok(location.frames.every(f=>!f.target?.visible),'First bookmark is still visible; this does not test a different page');
  const progress=await api('/api/progress?assetId='+largeEpub.asset_id);const starBefore=await page.locator('#bookmarkBtn').getAttribute('aria-pressed');
  await screenshot('adjacent-page-before-toggle');await page.locator('#bookmarkBtn').click();await pause(400);const after=await annotations(largeEpub);
  const details={saved:saved.anchor,currentProgress:progress,currentCfi:cfi(),starBefore,savedTarget:location,before:before.map(a=>({id:a.id,anchor:a.anchor})),after:after.map(a=>({id:a.id,anchor:a.anchor}))};
  await save('adjacent-bookmark-toggle.json',details);await screenshot('adjacent-page-after-toggle');
  assert.equal(after.filter(a=>a.color==='bookmark').length,2,'A different non-visible page toggled an earlier bookmark instead of creating a second: '+JSON.stringify({saved:saved.anchor.percent,current:progress.percent,starBefore,before:before.length,after:after.length}));
  assert.ok(after.some(a=>a.id===saved.id),'Earlier bookmark was deleted');return details;
 });
 await stage('bookmark-labels-distinguish-positions',async()=>{
  await open(largeEpub);await notes();const labels=await page.locator('#notesList .note-page').allInnerTexts();
  assert.equal(labels.length,2);assert.equal(new Set(labels).size,2);assert.ok(labels.some(s=>s.includes('#1')));assert.ok(labels.some(s=>s.includes('#2')));
  assert.ok(labels.every(s=>s.includes('%')&&s.includes('Akademik okuma')&&s.includes('Yer imi')));
  await screenshot('bookmark-distinct-labels');return {labels};
 });
 report.completed=true;report.pass=report.cases.every(c=>c.status==='PASS');
 report.currentGitHead=(await exec('git',['rev-parse','HEAD'])).stdout.trim();
 report.sourceUnchangedSinceSnapshot=true;
 for(const entry of report.sources){if(sha(await readFile(path.join(source,entry.file.substring('spike/app/'.length))))!==entry.sha256)report.sourceUnchangedSinceSnapshot=false;}
 report.releaseApproved=report.pass&&report.sourceUnchangedSinceSnapshot&&!report.productGitStatus;
 report.completedAt=new Date().toISOString();await save('results.json',report);await save('browser-console.json',diagnostics);
 const artifacts=[];for(const name of await readdir(evidence)){const bytes=await readFile(path.join(evidence,name));artifacts.push({file:name,bytes:bytes.length,sha256:sha(bytes)});}
 await save('manifest.json',{scope:report.scope,gitHead:report.gitHead,frontend:report.frontend,browser:report.browser,sources:report.sources,artifacts});
 console.log(JSON.stringify({complete:true,passed:report.cases.filter(c=>c.status==='PASS').length,total:report.cases.length,sourceUnchangedSinceSnapshot:report.sourceUnchangedSinceSnapshot,releaseApproved:report.releaseApproved,evidence}));
}catch(error){report.fatal=error.stack;report.appLog=appLog;await save('results.json',report);await save('browser-console.json',diagnostics);console.error(error);process.exitCode=1;}
finally{await context?.setOffline(false).catch(()=>{});await browser?.close().catch(()=>{});app?.kill();}
