import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The three catalogue designs in Chromium: switching, persistence, kept state, keyboard, fit, contrast.
// HTTP data are fixtures; the server/DB gates have their own suites.
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
].map(([title,language,publisher,publication_year,author],i)=>({id:`a0000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,
  asset_id:`b0000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,title,language,publisher,publication_year,
  metadata:{authors:[author]},subjects:['Science'],format:'pdf',allow_download:false,created_at:'2020-01-01'}));
const DESIGNS=['classic','light','salon'];
try {
  for(let i=0;i<100;i++) { try { if((await fetch(base+'/api/health')).ok) break; } catch { /* starting */ } await new Promise(r=>setTimeout(r,100)); if(i===99)throw Error(log); }
  browser=await chromium.launch();
  const context=await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:'block'});
  const page=await context.newPage(), errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const favorites=new Set();
  await page.route('**/api/books',route=>route.fulfill({json:books}));
  await page.route('**/api/search?*',route=>{
    const q=new URL(route.request().url()).searchParams.get('q').toLocaleLowerCase('tr');
    return route.fulfill({json:books.filter(book=>book.title.toLocaleLowerCase('tr').includes(q))});
  });
  await page.route('**/api/library/progress',route=>route.fulfill({json:books.slice(0,2).map((book,i)=>({asset_id:book.asset_id,percent:30+i*20,updated_at:`2026-10-${30-i}T10:00:00Z`}))}));
  await page.route(/\/api\/favorites(?:\/[^/?]+)?$/,route=>{
    const request=route.request(), method=request.method(), id=request.url().split('/').pop();
    if(method==='GET') return route.fulfill({json:[...favorites].map(work_id=>({work_id}))});
    if(method==='PUT')favorites.add(id);else favorites.delete(id);
    return route.fulfill({json:{ok:true}});
  });
  await page.goto(base);
  await page.locator('#adminLogin > summary').click();
  await page.fill('#loginEmail','reader@example.edu.tr'); await page.fill('#loginPassword','demo1234');
  await page.locator('#adminLogin button[type=submit]').click();
  await page.locator('#loginScreen').waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.querySelectorAll('#grid .card').length===4);
  const design=()=>page.evaluate(()=>document.documentElement.dataset.design);
  const titles=()=>page.locator('#grid .cover .title').allTextContents();
  const noOverflow=label=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth).then(ok=>check(ok,label));

  same(await design(),'light','LibRead Açık is the default');

  // state the designs must not reset: search, sort, favourites
  await page.fill('#search','a');
  await page.waitForFunction(()=>document.querySelectorAll('#grid .card').length===3);
  await page.selectOption('#librarySort','title-asc');
  const star=page.locator(`#grid [data-work-id="${books[0].id}"] .library-star`);
  await star.click();
  await page.waitForFunction(id=>document.querySelector(`#grid [data-work-id="${id}"] .library-star`)?.getAttribute('aria-pressed')==='true',books[0].id);
  const beforeTitles=await titles();

  // dialog: opens, Escape closes, focus returns to the trigger
  const trigger=page.locator('#lrDesignBtn');
  await trigger.focus(); await page.keyboard.press('Enter');
  await page.locator('#designDialog').waitFor({state:'visible'});
  same(await page.locator('#designDialog [data-design-option]').count(),3,'three designs offered');
  await page.keyboard.press('Escape');
  await page.locator('#designDialog').waitFor({state:'hidden'});
  same(await trigger.evaluate(e=>e===document.activeElement),true,'focus returns to the Tasarım button');

  for(const id of ['classic','salon','light','classic']){
    await trigger.click();
    const option=page.locator(`[data-design-option="${id}"]`);
    await option.click();
    same(await design(),id,`${id} applies without reload`);
    same(await option.getAttribute('aria-pressed'),'true',`${id} option pressed`);
    check((await page.locator('#designStatus').textContent()).length>0,'choice announced');
    await page.keyboard.press('Escape');
    same(await titles(),beforeTitles,`${id}: catalogue order and filter kept`);
    same(await page.inputValue('#search'),'a',`${id}: search kept`);
    same(await page.inputValue('#librarySort'),'title-asc',`${id}: sort kept`);
    same(await star.getAttribute('aria-pressed'),'true',`${id}: favourite kept`);
  }
  await page.reload(); await page.waitForFunction(()=>document.querySelectorAll('#grid .card').length>0);
  same(await design(),'classic','choice survives reload');

  // brand and logo
  for(const id of DESIGNS){
    await page.evaluate(d=>{document.documentElement.dataset.design=d;},id);
    const text=await page.locator('#lrSidebar').innerText();
    check(!/LİBEDGE/.test(text),`${id}: no dotted capital I in the brand`);
    check(/LIBEDGE/.test(text),`${id}: LIBEDGE written`);
  }
  const logo=await page.locator('.lr-logo').evaluate(img=>img.getAttribute('src'));
  same(logo,'/icons/libread-logo.png','the real logo file');

  // views
  await page.evaluate(()=>{document.documentElement.dataset.design='light';});
  await page.locator('.lr-nav-item[data-view="favorites"]').click();
  await page.waitForFunction(()=>document.querySelectorAll('#grid .card').length===1);
  same(await page.locator('#lrCatalogueTitle').textContent(),'Favori kitaplarınız','favourites heading');
  await page.locator('.lr-nav-item[data-view="history"]').click();
  await page.waitForFunction(()=>document.querySelectorAll('#grid .card').length===2);
  await page.locator('.lr-nav-item[data-view="all"]').click();
  await page.locator('.lr-view-btn[data-layout="list"]').click();
  check(await page.locator('#grid').evaluate(e=>e.classList.contains('list')),'list layout');
  await page.locator('.lr-view-btn[data-layout="grid"]').click();

  // fit and contrast in every design, language and width
  const contrast=()=>page.evaluate(()=>{
    const parse=c=>c.match(/[\d.]+/g).map(Number);
    const lum=([r,g,b])=>{const f=v=>{v/=255;return v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4;};return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b);};
    const bg=el=>{for(let n=el;n;n=n.parentElement){const c=parse(getComputedStyle(n).backgroundColor);if(c.length<4||c[3]>0.9)return c.slice(0,3);}return [255,255,255];};
    const bad=[];
    for(const sel of ['.lr-heading h1','.lr-heading .lede','.lr-nav-item','.lr-sidebar-label','#lrCatalogueTitle','.card-title','.card-sub','.lr-help']){
      const el=document.querySelector(sel); if(!el||!el.offsetParent)continue;
      const fg=parse(getComputedStyle(el).color), a=lum(fg.slice(0,3)), b=lum(bg(el));
      const ratio=(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
      if(ratio<4.5)bad.push(`${sel} ${ratio.toFixed(2)}`);
    }
    return bad;
  });
  // colours are measured at rest, not halfway through a hover/design transition
  await page.addStyleTag({content:'*,*::before,*::after{transition:none!important}'});
  if(process.env.SHOTS_DIR) await mkdir(process.env.SHOTS_DIR,{recursive:true});
  for(const lang of ['tr','en']){
    await page.evaluate(l=>localStorage.setItem('uiLang',l),lang);
    await page.reload(); await page.waitForFunction(()=>document.querySelectorAll('#grid .card').length>0);
    await page.addStyleTag({content:'*,*::before,*::after{transition:none!important}'});
    for(const width of [1440,390,320]){
      await page.setViewportSize({width,height:900});
      for(const id of DESIGNS){
        await page.evaluate(d=>{document.documentElement.dataset.design=d;},id);
        await noOverflow(`${lang} ${width}px ${id}: no horizontal overflow`);
        same(await contrast(),[],`${lang} ${width}px ${id}: text contrast`);
        if(process.env.SHOTS_DIR) await page.screenshot({path:path.join(process.env.SHOTS_DIR,`library-${id}-${lang}-${width}.png`)});
      }
    }
  }
  await page.setViewportSize({width:390,height:844});
  await page.locator('#lrOpenNav').click();
  check(await page.locator('#lrSidebar').evaluate(e=>e.classList.contains('open')&&!e.inert),'phone drawer opens');
  await page.keyboard.press('Escape');
  check(await page.locator('#lrSidebar').evaluate(e=>!e.classList.contains('open')&&e.inert),'Escape closes the drawer');
  same(await page.locator('#lrOpenNav').evaluate(e=>e===document.activeElement),true,'focus returns to the menu button');

  // a browser that cannot store anything still renders and switches
  await context.addInitScript(()=>{Storage.prototype.getItem=()=>{throw Error('disabled');};Storage.prototype.setItem=()=>{throw Error('disabled');};});
  await page.reload(); await page.waitForFunction(()=>document.querySelectorAll('#grid .card').length>0);
  await page.setViewportSize({width:1440,height:900});
  await page.locator('#lrDesignBtn').click(); await page.locator('[data-design-option="salon"]').click();
  same(await design(),'salon','design switches even with storage blocked');
  same(errors,[],'no uncaught browser errors');
  console.log(JSON.stringify({passed:true,checks}));
} finally { await browser?.close(); server.kill(); }
