import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const {request}=await import('file:///C:/Users/OWNER/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs');
const api=await request.newContext({baseURL:'https://localhost',ignoreHTTPSErrors:true});let logged=false;
try{
 const config=await(await api.get('/api/config')).json();assert.equal(config.version,'127');assert.equal(config.buildSha,'fbeed6e');
 const login=await api.post('/api/login',{data:{email:process.env.ACR_LIBRARIAN_EMAIL||'librarian@example.edu.tr',password:process.env.ACR_LIBRARIAN_PASSWORD||process.env.SMOKE_PASSWORD||'demo1234'}});assert.equal(login.status(),200);logged=true;
 const me=await(await api.get('/api/me')).json();assert.equal(me.role,'librarian');const response=await api.get('/api/books');assert.equal(response.status(),200);const rows=await response.json();
 const inventory={dateIstanbul:'2026-10-25',startedAt:new Date().toISOString(),scope:'Read-only librarian-visible production catalog; not an atomic tenant-wide DB snapshot',config:{version:config.version,buildSha:config.buildSha},entries:rows.map(b=>({id:b.id,assetId:b.asset_id,title:b.title,format:b.format,storageKey:b.storage_key,language:b.language,pageCount:b.page_count}))};await mkdir('tmp/acr-catalog-v127',{recursive:true});await writeFile('tmp/acr-catalog-v127/inventory.json',JSON.stringify(inventory,null,2)+'\n');
 const formats={},prefixes={};for(const b of inventory.entries){formats[b.format]=(formats[b.format]||0)+1;const p=b.storageKey?.split('/')[0]||'missing';prefixes[p]=(prefixes[p]||0)+1;}
 console.log(JSON.stringify({entries:rows.length,fields:rows.length?Object.keys(rows[0]):[],formats,prefixes}));
}finally{if(logged)await api.post('/api/logout');await api.dispose();}
