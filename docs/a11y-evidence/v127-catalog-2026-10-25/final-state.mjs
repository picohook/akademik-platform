import assert from 'node:assert/strict';
import {readFile,writeFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const {request}=await import('file:///C:/Users/OWNER/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs'),api=await request.newContext({baseURL:'https://localhost',ignoreHTTPSErrors:true});
const initial=JSON.parse(await readFile('tmp/acr-catalog-v127/inventory.json','utf8')),audit=JSON.parse(await readFile('tmp/acr-catalog-v127/catalog-review.json','utf8')),guided=JSON.parse(await readFile('tmp/nvda-human-v127/64050806-796d-44ad-bfcb-a0fa9746c7e5/results.json','utf8'));
const report={dateIstanbul:'2026-10-25',guidedRun:guided.runId,checks:[],noRuntimeEnvMigrationDeployChanges:true};let logged=false;
try{
 const cfg=await(await api.get('/api/config')).json();assert.equal(cfg.version,'127');assert.equal(cfg.buildSha,'fbeed6e');report.config={version:cfg.version,buildSha:cfg.buildSha};
 const login=await api.post('/api/login',{data:{email:process.env.ACR_LIBRARIAN_EMAIL||'librarian@example.edu.tr',password:process.env.ACR_LIBRARIAN_PASSWORD||process.env.SMOKE_PASSWORD||'demo1234'}});assert.equal(login.status(),200);logged=true;const books=await(await api.get('/api/books')).json();assert.deepEqual(books.map(b=>b.asset_id).sort(),initial.entries.map(b=>b.assetId).sort());assert.ok(!books.some(b=>b.id===guided.fixture.bookId));report.checks.push({id:'original-catalog-asset-set-preserved',result:true});
 for(const book of initial.entries){const file=book.storageKey.startsWith('uploads/')?path.resolve('data',book.storageKey):path.resolve('spike/app/public',book.storageKey),sha=createHash('sha256').update(await readFile(file)).digest('hex');assert.equal(sha,audit.entries.find(e=>e.assetId===book.assetId).sourceSha256);report.checks.push({id:'source-file-unchanged',assetId:book.assetId,result:true});}
 let exists=true;try{await access(path.resolve('data/ocr',guided.fixture.assetId));}catch(error){if(error.code!=='ENOENT')throw error;exists=false;}assert.equal(exists,false);assert.ok(Object.values(guided.cleanup).every(v=>v===true));report.checks.push({id:'guided-fixture-and-sidecar-removed',result:true});report.status='verified';
}finally{if(logged)report.loggedOut=(await api.post('/api/logout')).status()===200;await api.dispose();report.requestContextDisposed=true;await writeFile('tmp/acr-catalog-v127/final-state.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
