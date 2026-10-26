import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { importCatalog,preflight,stableId } from '../import-catalog.mjs';
const tenantId='11111111-1111-1111-1111-111111111111';
const digest=b=>createHash('sha256').update(b).digest('hex');
async function fixture(t) {
 const directory=await mkdtemp(path.join(os.tmpdir(),'oa-import-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const books=[];
 for(let i=1;i<=11;i++) {
  const bytes=Buffer.from(`%PDF-fixture ${i}`);const file_name=`${i}.pdf`;await writeFile(path.join(directory,file_name),bytes);
  books.push({id:`libedge-oa-${String(i).padStart(3,'0')}`,title:`Book ${i}`,hosting_allowed_under_license:true,
   license_url:'https://creativecommons.org/licenses/by/4.0/',attribution_text:'Fixture credits',author:['Author'],creator_role:'author',languages:['en'],subject:[],
   source_url:'https://example.org',assets:[{file_name,format:'PDF',language:'en',file_size_bytes:bytes.length,sha256:digest(bytes),reader_ready:true,year:2020,mime_type:'application/pdf'}]});
 }
 const manifest={schema_version:'2.0',collection_title:'OA',books};const bytes=Buffer.from(JSON.stringify(manifest));
 await writeFile(path.join(directory,'LibEdge_11_Books_Import.json'),bytes);
 return {directory,books,plan:await preflight(directory,{expectedManifestSha:digest(bytes)}),expectedManifestSha:digest(bytes)};
}
function environment({existing=null,failInsert=false,failCommit=false}={}) {
 const commands=[];const keys=[];const deleted=[];let released=false;
 const client={release(){released=true;},async query(sql,args=[]) {
  commands.push({sql,args});
  if(sql.startsWith('select id from tenants'))return {rows:[{id:tenantId}]};
  if(sql.startsWith('select metadata from works'))return {rows:existing ? [{metadata:{oa_import_checksum:existing.import_checksum}}] : []};
  if(sql.startsWith('select a.id,a.source_id'))return {rows:existing.verified_assets.map(a=>({source_id:`${tenantId}:${existing.id}:${a.file_name}`,source_checksum:a.sha256,storage_key:'r2://libedge/'+a.file_name}))};
  if(failInsert && sql.startsWith('insert into assets'))throw new Error('insert failed');
  if(failCommit && sql==='commit')throw new Error('connection lost');
  return {rows:[]};
 }};
 const storage={driver:'r2',async put(k,b){keys.push(k);return 'r2://libedge/'+k;},async remove(k){deleted.push(k);},async info(k){return {size:existing.verified_assets.find(a=>k.endsWith(a.file_name)).file_size_bytes};}};
 return {pool:{connect:async()=>client},storage,commands,keys,deleted,get released(){return released;}};
}
test('all input verified before changes, modified asset and manifest rejected',async t=>{
 const f=await fixture(t);assert.equal(f.plan.assetCount,11);
 await assert.rejects(preflight(f.directory),/manifest checksum/);
 await writeFile(path.join(f.directory,'1.pdf'),'tampered');
 await assert.rejects(preflight(f.directory,{expectedManifestSha:f.expectedManifestSha}),/size mismatch|checksum mismatch/);
});
test('multi-asset work inserts one work, separate editions and correct CC rights metadata',async t=>{
 const f=await fixture(t);const book=f.plan.books[0];book.verified_assets.push({...book.verified_assets[0],file_name:'translation.pdf',language:'tr',year:2022});
 const plan={...f.plan,books:[book]};const e=environment();const result=await importCatalog({...e,plan,tenantId});
 assert.equal(result.insertedWorks,1);assert.equal(result.insertedAssets,2);
 assert.equal(e.commands.filter(c=>c.sql.startsWith('insert into works')).length,1);
 const m=JSON.parse(e.commands.find(c=>c.sql.startsWith('insert into works')).args[7]);
 assert.equal(Object.keys(m.asset_variants).length,2);assert.equal(m.catalog_status,'draft');assert.equal(m.oa_catalog.license_url,book.license_url);
 assert.equal(e.commands.filter(c=>c.sql.startsWith('insert into editions')).length,2);
 assert.ok(e.commands.some(c=>c.sql==='commit'));assert.equal(e.deleted.length,0);assert.ok(e.released);
});
test('matching existing catalog skipped without R2 writes or duplicate rows',async t=>{
 const f=await fixture(t);const book=f.plan.books[0];const e=environment({existing:book});
 const result=await importCatalog({...e,plan:{...f.plan,books:[book]},tenantId});
 assert.equal(result.skippedWorks,1);assert.equal(result.insertedAssets,0);assert.equal(e.keys.length,0);
});
test('SQL failure rolls back and removes newly written objects',async t=>{
 const f=await fixture(t);const e=environment({failInsert:true});
 await assert.rejects(importCatalog({...e,plan:f.plan,tenantId}),/insert failed/);
 assert.ok(e.commands.some(c=>c.sql==='rollback'));assert.equal(e.deleted.length,1);assert.ok(e.released);
});
test('uncertain commit never deletes possibly committed files',async t=>{
 const f=await fixture(t);const e=environment({failCommit:true});
 await assert.rejects(importCatalog({...e,plan:{...f.plan,books:[f.plan.books[0]]},tenantId}),/connection lost/);
 assert.equal(e.keys.length,1);assert.equal(e.deleted.length,0);assert.ok(e.released);
});
test('stable work and asset identities are scoped by tenant',()=>{
 assert.equal(stableId(tenantId+':book'),stableId(tenantId+':book'));
 assert.notEqual(stableId(tenantId+':book'),stableId('other:book'));
 assert.match(stableId('id'),/^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
});
