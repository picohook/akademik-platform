import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Chromium checks the shipped UI/server. Personal-library and catalogue HTTP
// responses are fixtures here; the real DB/API gates have their own suite.
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
const books=[
  ['Zaman Studies','en','London',2018,'Zorlu'],
  ['İstanbul Tarihi','tr','Ankara',2022,'İnan'],
  ['Işık Bilimi','tr','İzmir',2024,'Çelik'],
  ['Çalışma Kitabı','tr','Ankara',2020,'Ada'],
  ['Added Recently','en','London',null,'Writer'],
].map(([title,language,publisher,publication_year,author],i)=>({id:`a0000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,
  asset_id:`b0000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,title,language,publisher,publication_year,
  metadata:{authors:[author]},subjects:[i===0?'History':'Science'],format:'pdf',allow_download:false,created_at:publication_year?'2020-01-01':'2026-01-01'}));
try {
  for(let i=0;i<100;i++) { try { if((await fetch(base+'/api/health')).ok) break; } catch { /* starting */ } await new Promise(r=>setTimeout(r,100)); if(i===99)throw Error(log); }
  browser=await chromium.launch();
  const context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'});
  const page=await context.newPage(), errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const favorites=new Set(), mutations=[];
  let failFavorite=false, progressRows=books.map((book,i)=>({asset_id:book.asset_id,percent:i*20,updated_at:`2026-10-${String(30-i).padStart(2,'0')}T10:00:00Z`}));
  await page.route('**/api/books',route=>route.fulfill({json:books}));
  await page.route('**/api/search?*',route=>{
    const q=new URL(route.request().url()).searchParams.get('q').toLocaleLowerCase('tr');
    return route.fulfill({json:books.filter(book=>book.title.toLocaleLowerCase('tr').includes(q))});
  });
  await page.route('**/api/library/progress',route=>route.fulfill({json:progressRows}));
  await page.route(/\/api\/favorites(?:\/[^/?]+)?$/,route=>{
    const request=route.request(), method=request.method(), id=request.url().split('/').pop();
    if(method==='GET') return route.fulfill({json:[...favorites].map(work_id=>({work_id}))});
    mutations.push({method,id,csrf:request.headers()['x-csrf-token']});
    if(failFavorite) return route.fulfill({status:403,json:{error:'denied'}});
    if(method==='PUT')favorites.add(id);else favorites.delete(id);
    return route.fulfill({json:{ok:true}});
  });
  await page.goto(base);
  await page.locator('#adminLogin > summary').click();
  await page.fill('#loginEmail','reader@example.edu.tr'); await page.fill('#loginPassword','demo1234');
  await page.locator('#adminLogin button[type=submit]').click();
  await page.locator('#loginScreen').waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.querySelectorAll('#grid .card').length===5);
  const titles=()=>page.locator('#grid .cover .title').allTextContents();
  const waitTitles=async expected=>{await page.waitForFunction(want=>JSON.stringify([...document.querySelectorAll('#grid .cover .title')].map(e=>e.textContent))===JSON.stringify(want),expected);same(await titles(),expected,'catalogue order/filter');};
  const az=['Added Recently','Çalışma Kitabı','Işık Bilimi','İstanbul Tarihi','Zaman Studies'];
  await page.selectOption('#librarySort','title-asc'); await waitTitles(az);
  await page.selectOption('#librarySort','title-desc'); await waitTitles([...az].reverse());
  await page.selectOption('#librarySort','newest'); await waitTitles(['Added Recently','Işık Bilimi','İstanbul Tarihi','Çalışma Kitabı','Zaman Studies']);
  await page.selectOption('#librarySort','author-asc'); await waitTitles(['Çalışma Kitabı','Işık Bilimi','İstanbul Tarihi','Added Recently','Zaman Studies']);
  await page.reload(); await page.waitForFunction(()=>document.querySelector('#librarySort').value==='author-asc'); checks++;
  const first=page.locator(`#grid [data-work-id="${books[0].id}"] .library-star`);
  await first.focus(); await page.keyboard.press('Space');
  await page.waitForFunction(id=>document.querySelector(`#grid [data-work-id="${id}"] .library-star`).getAttribute('aria-pressed')==='true',books[0].id);
  same(await first.evaluate(e=>e===document.activeElement),true,'star keeps keyboard focus');
  check(Boolean(mutations[0].csrf),'star sends CSRF header');
  same(mutations[0].method,'PUT','star sends PUT');
  same(await page.locator(`#continueReading [data-work-id="${books[0].id}"] .library-star`).getAttribute('aria-pressed'),'true','shelf star stays consistent');
  await page.locator('#libraryFavorites').click(); await waitTitles(['Zaman Studies']);
  same(await page.locator('#libraryFavorites').getAttribute('aria-pressed'),'true','favourites chip pressed');
  await page.fill('#search','Işık'); await waitTitles([]);
  await page.fill('#search',''); await waitTitles(['Zaman Studies']);
  await page.locator('#grid .library-star').click(); await waitTitles([]);
  same(mutations.at(-1).method,'DELETE','toggle sends DELETE');
  same(await page.locator('#libraryFavorites').evaluate(e=>e===document.activeElement),true,'removed star returns focus to favourites chip');
  await page.locator('#libraryFavorites').click(); await waitTitles(['Çalışma Kitabı','Işık Bilimi','İstanbul Tarihi','Added Recently','Zaman Studies']);
  failFavorite=true;
  await page.locator('#grid .library-star').first().click();
  await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('kaydedilemedi'));
  same(await page.locator('#grid .library-star').first().getAttribute('aria-pressed'),'false','failed request does not set star'); failFavorite=false;
  same(await page.locator('#continueReading .card').count(),4,'last four books');
  same(await page.locator('#continueReading .card').evaluateAll(cards=>cards.map(c=>c.dataset.workId)),books.slice(0,4).map(book=>book.id),'continue reading ordered by last progress');
  same(await page.locator('#grid .library-progress').count(),5,'progress bars include zero progress');
  same(await page.locator('#count').getAttribute('aria-live'),'polite','result count announced');
  await page.locator('#libraryFilters summary').click();
  await page.selectOption('#libraryLanguage','tr'); await waitTitles(['Çalışma Kitabı','Işık Bilimi','İstanbul Tarihi']);
  await page.selectOption('#libraryPublisher','Ankara'); await waitTitles(['Çalışma Kitabı','İstanbul Tarihi']);
  await page.fill('#libraryYearFrom','2021'); await waitTitles(['İstanbul Tarihi']);
  await page.fill('#libraryYearTo','2021'); await waitTitles([]);
  await page.fill('#libraryYearTo','2023'); await waitTitles(['İstanbul Tarihi']);
  await page.selectOption('#libraryLanguage',''); await page.selectOption('#libraryPublisher','');
  await page.fill('#libraryYearFrom',''); await page.fill('#libraryYearTo','');
  await page.getByRole('button',{name:'History',exact:true}).click(); await waitTitles(['Zaman Studies']);
  await page.getByRole('button',{name:'Tümü',exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  await page.locator('#libraryFilters summary').click();
  same(await page.locator('#libraryFilters').evaluate(e=>e.open),false,'phone filters collapse');
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'phone has no horizontal scroll with collapsed filters');
  await page.locator('#libraryFilters summary').click();
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'phone has no horizontal scroll with expanded filters');
  await page.locator('#toast').waitFor({state:'hidden'});
  await page.evaluate(()=>window.scrollTo(0,0));
  if(process.env.SHOTS_DIR){await mkdir(process.env.SHOTS_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SHOTS_DIR,'library-phone.png'),fullPage:true});}
  books[4].title='Favoriler';
  await page.evaluate(()=>localStorage.setItem('uiLang','en')); await page.reload();
  await page.locator('#continueReadingTitle').waitFor();
  same(await page.locator('#continueReadingTitle').textContent(),'Continue reading','English shelf');
  same(await page.locator('#libraryFavorites').textContent(),'Favourites','English chip');
  same(await page.locator('#libraryFilters summary').textContent(),'Catalogue filters','English filters');
  same(await page.locator('#librarySort option[value="title-asc"]').textContent(),'Book title A–Z','English sorting');
  // Content that coincides with a short English/Turkish UI word must stay content.
  same(await page.locator('#grid .cover .title').allTextContents(),['Çalışma Kitabı','Işık Bilimi','İstanbul Tarihi','Favoriler','Zaman Studies'],'English preserves book metadata');
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'English phone fits');
  // Sort the selected language variant, rather than a different variant's title.
  books.push({...books[0],asset_id:'c0000000-0000-4000-8000-000000000001',title:'A translated title',language:'tr'});
  await page.reload();
  await page.selectOption('#librarySort','title-asc');
  await waitTitles(['Çalışma Kitabı','Favoriler','Işık Bilimi','İstanbul Tarihi','Zaman Studies']);
  books.pop();
  // The same browser's next account must not inherit this account's sort.
  await page.route('**/api/me',async route=>{
    const response=await route.fetch(),json=await response.json();
    await route.fulfill({response,json:{...json,id:'44444444-4444-4444-4444-444444444444'}});
  });
  await page.reload();
  await page.waitForFunction(()=>document.querySelectorAll('#grid .card').length===5);
  same(await page.locator('#librarySort').inputValue(),'','sort preference is per account');
  // Storage failures cannot prevent sign-in or catalogue rendering.
  await context.addInitScript(()=>{Storage.prototype.getItem=()=>{throw Error('disabled');};Storage.prototype.setItem=()=>{throw Error('disabled');};});
  await page.reload(); await page.waitForFunction(()=>document.querySelectorAll('#grid .card').length===5); checks++;
  same(errors,[],'no uncaught browser errors');
  console.log(JSON.stringify({passed:true,checks}));
} finally { await browser?.close(); server.kill(); }
