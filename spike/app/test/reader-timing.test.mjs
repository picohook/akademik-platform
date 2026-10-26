import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import http from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { readFile } from 'node:fs/promises';

test('reader report isolates current book/open and includes numeric server stages', async () => {
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const code = source.slice(source.indexOf('function readerFileTimings('), source.indexOf('function readerPerf()'));
  const entry = {name:'http://localhost/api/books/book/file',startTime:110,duration:1000,
    requestStart:120,responseStart:420,responseEnd:1110,encodedBodySize:262144,
    serverTiming:[{name:'app',duration:4.3},{name:'storage',duration:149.8},{name:'unknown',duration:999}]};
  const context = vm.createContext({URL,window:{location:{origin:'http://localhost'}},
    performance:{getEntriesByType:()=>[entry,{...entry,startTime:50},{...entry,name:'http://localhost/api/books/other/file'}]}});
  vm.runInContext(code, context);
  const result = JSON.parse(JSON.stringify(context.readerFileTimings('book',100)));
  assert.deepEqual(result,[{startMs:10,totalMs:1000,ttfbMs:300,downloadMs:690,bytes:262144,serverMs:{app:4,storage:150}}]);
  assert.deepEqual(JSON.parse(JSON.stringify(context.readerFileTimings(null,100))),[]);
});

test('storage header preserves app timing and byte-range response', async () => {
  const source = await readFile(new URL('../storage.mjs',import.meta.url),'utf8');
  const code = source.slice(source.indexOf('export async function serveStoredAsset')).replace('export async','async');
  const context = vm.createContext({performance,pipeline});
  vm.runInContext(code,context);
  const server = http.createServer((req,res)=>{
    res.setHeader('server-timing','app;dur=3.0');
    void context.serveStoredAsset({open:async()=>({
      body:Readable.from([Buffer.from('test')]),status:206,length:4,contentRange:'bytes 0-3/8'
    })},req,res,'r2://private/book.pdf');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const response = await fetch('http://127.0.0.1:'+server.address().port);
    assert.equal(response.status,206);
    assert.equal(response.headers.get('content-range'),'bytes 0-3/8');
    assert.equal(response.headers.get('cache-control'),'private, no-store');
    assert.match(response.headers.get('server-timing'),/^app;dur=3.0, storage;dur=\d+\.\d$/);
    assert.equal(await response.text(),'test');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
  }
});
