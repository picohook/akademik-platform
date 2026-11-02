import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

// Cover upload against the real demo-mode server: who may upload, what is accepted, what the browser is shown.
// (The storage/DB path has no Postgres here; the RLS-backed write is the same SQL as the other works updates.)
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const appDir = fileURLToPath(new URL('../', import.meta.url));
const freePort = () => new Promise(resolve => { const s=net.createServer(); s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));}); });
const port=await freePort(), base=`http://127.0.0.1:${port}`;
const env={...process.env,PORT:String(port),NODE_ENV:'development',APP_ENV:'development'};
delete env.DATABASE_URL; delete env.DATABASE_CATALOG_URL;
const server=spawn(process.execPath,['server.mjs'],{cwd:appDir,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
let log='',browser,checks=0;
for(const stream of [server.stdout,server.stderr]) stream.on('data',chunk=>{log+=chunk;});
const same=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks++;};
const check=(condition,label)=>{assert.ok(condition,label);checks++;};
async function signIn(context,email){
  const page=await context.newPage();
  await page.goto(base);
  await page.locator('#adminLogin > summary').click();
  await page.fill('#loginEmail',email); await page.fill('#loginPassword','demo1234');
  await page.locator('#adminLogin button[type=submit]').click();
  await page.locator('#loginScreen').waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.querySelectorAll('#grid .card').length>0);
  return page;
}
try {
  for(let i=0;i<100;i++) { try { if((await fetch(base+'/api/health')).ok) break; } catch { /* starting */ } await new Promise(r=>setTimeout(r,100)); if(i===99)throw Error(log); }
  browser=await chromium.launch();
  const editorCtx=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'});
  const page=await signIn(editorCtx,'librarian@example.edu.tr');
  const bookId=await page.evaluate(async()=>(await (await fetch('/api/books')).json())[0].id);
  const put=(body,type='image/webp')=>page.evaluate(async([id,bytes,type])=>{
    const r=await fetch(`/api/books/${id}/cover`,{method:'PUT',headers:{'content-type':type},body:new Uint8Array(bytes)});return r.status;
  },[bookId,[...body],type]);
  const status=(method)=>page.evaluate(async([id,method])=>(await fetch(`/api/books/${id}/cover`,{method})).status,[bookId,method]);

  same(await status('GET'),404,'no cover yet');
  same(await put(Buffer.from('not an image')),415,'text refused');
  same(await put(Buffer.concat([Buffer.from('RIFF'),Buffer.alloc(4),Buffer.from('WEBPVP8 '),Buffer.alloc(40)])),415,'a WebP without a size is refused');
  same(await put(Buffer.alloc(401*1024)),413,'over 400 KB refused');

  // a real upload through the edit form: a PNG is shrunk to WebP in the browser
  const png=Buffer.from((await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1000;c.height=1500;const x=c.getContext('2d');x.fillStyle='#c33';x.fillRect(0,0,1000,1500);return c.toDataURL('image/png');})).split(',')[1],'base64');
  await page.locator('#grid .edit-btn:not(.offline-card-btn)').first().click();
  await page.setInputFiles('#editCover',{name:'cover.png',mimeType:'image/png',buffer:png});
  await page.locator('#editForm button[type=submit]').click();
  await page.waitForFunction(()=>document.querySelector('#grid .cover-img')?.complete&&document.querySelector('#grid .cover-img').naturalWidth>0);
  const info=await page.locator('#grid .cover-img').first().evaluate(i=>({src:new URL(i.src).pathname+new URL(i.src).search,w:i.naturalWidth,h:i.naturalHeight,ratio:i.parentElement.style.aspectRatio}));
  check(/^\/api\/books\/[^/]+\/cover\?v=\d+$/.test(info.src),'card shows the book\'s own cover URL');
  same(info.w,480,'shrunk to 480 px wide');
  check(Math.abs(info.w/info.h-2/3)<0.01&&Math.abs(parseFloat(info.ratio)-2/3)<0.01,'ratio kept');
  const listed=await page.evaluate(async()=>JSON.stringify((await (await fetch('/api/books')).json())[0].metadata));
  check(!listed.includes('book-covers')&&!listed.includes('"key"'),'the storage key is not sent to the browser');
  same(await status('GET'),200,'editor can read the cover');

  // other people
  const outside=await browser.newContext({serviceWorkers:'block'});
  same((await outside.request.get(`${base}/api/books/${bookId}/cover`)).status()>=400,true,'signed-out request gets no cover');
  const readerCtx=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'});
  const reader=await signIn(readerCtx,'reader@example.edu.tr');
  same(await reader.evaluate(async id=>(await fetch(`/api/books/${id}/cover`)).status,bookId),200,'a reader sees the cover');
  same(await reader.evaluate(async id=>(await fetch(`/api/books/${id}/cover`,{method:'PUT',headers:{'content-type':'image/webp'},body:new Uint8Array(30)})).status,bookId),403,'a reader cannot upload');
  same(await reader.evaluate(async id=>(await fetch(`/api/books/${id}/cover`,{method:'DELETE'})).status,bookId),403,'a reader cannot remove');
  same(await reader.evaluate(async id=>(await fetch(`/api/books/${id}/cover`,{method:'PUT',headers:{'content-type':'image/webp','x-csrf-token':'wrong'},body:new Uint8Array(30)})).status,bookId)>=400,true,'wrong CSRF refused');
  await readerCtx.close(); await outside.close();

  // removing it
  await page.locator('#grid .edit-btn:not(.offline-card-btn)').first().click();
  check(await page.locator('#editCoverRemoveRow').isVisible(),'remove option shown when a cover exists');
  await page.check('#editCoverRemove');
  await page.locator('#editForm button[type=submit]').click();
  await page.waitForFunction(()=>!document.querySelector('#grid .cover-img[src*="/api/books/"]'));
  checks++;
  same(await status('GET'),404,'cover removed');
  const errors=log.match(/Error|TypeError/g);
  check(!errors,'no server errors in the log');
  console.log(JSON.stringify({passed:true,checks}));
} finally { await browser?.close(); server.kill(); }
