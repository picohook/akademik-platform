// Read-only comparison; does not create sessions, objects or database records.
import pg from 'pg';
import { performance } from 'node:perf_hooks';
import { createStorage } from '../storage.mjs';

const client=new pg.Client({connectionString:process.env.DATABASE_URL});
try {
 await client.connect();
 await client.query("select set_config('app.tenant_id',$1,false)",[process.env.DEMO_TENANT_ID || '11111111-1111-1111-1111-111111111111']);
 const {rows}=await client.query("select storage_key from assets where storage_key like 'r2://%' order by page_count desc nulls last limit 1");
 if(!rows[0])throw new Error('No R2 asset found');
 const key=rows[0].storage_key;
 const storage=createStorage({publicDir:'/app/public'});
 for(let run=1;run<=3;run++) {
  let started=performance.now();
  const info=await storage.info(key);
  const old=await storage.stream(key,{start:0,end:Math.min(65535,info.size-1)},info.etag);
  let oldBytes=0;for await(const part of old)oldBytes+=part.length;
  const legacyMs=Math.round(performance.now()-started);
  started=performance.now();
  const opened=await storage.open(key,'bytes=0-65535');
  const headersMs=Math.round(performance.now()-started);
  let singleBytes=0;for await(const part of opened.body)singleBytes+=part.length;
  const singleMs=Math.round(performance.now()-started);
  if(opened.status!==206 || oldBytes!==singleBytes || singleBytes!==Math.min(65536,info.size))throw new Error('Reader range validation failed');
  console.log(JSON.stringify({run,legacyHeadAndGetMs:legacyMs,singleGetHeadersMs:headersMs,singleGetTotalMs:singleMs,bytes:singleBytes,status:opened.status}));
 }
} finally {await client.end();}
