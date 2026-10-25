import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Readable } from 'node:stream';
import { createStorage, parseRange, serveStoredAsset, MAX_ASSET_BYTES } from '../storage.mjs';

const env = { STORAGE_DRIVER: 'r2', R2_ENDPOINT: 'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com', R2_BUCKET: 'libedge-books', R2_PREFIX: 'pilot', R2_ACCESS_KEY_ID: 'test', R2_SECRET_ACCESS_KEY: 'test' };
function fakeClient() {
  const objects = new Map(); const calls = [];
  return { objects, calls, async send(command) {
    calls.push(command); const { Key, Body, Range, IfMatch } = command.input;
    assert.equal(command.input.Bucket, env.R2_BUCKET);
    const name = command.constructor.name;
    if (name === 'PutObjectCommand') { assert.equal(command.input.IfNoneMatch, '*'); objects.set(Key, Buffer.from(Body)); return {}; }
    if (name === 'DeleteObjectCommand') { objects.delete(Key); return {}; }
    if (!objects.has(Key)) throw Object.assign(new Error('SECRET must not escape'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
    const bytes = objects.get(Key);
    if (name === 'HeadObjectCommand') return { ContentLength: bytes.length, ETag: 'test-etag' };
    assert.equal(name, 'GetObjectCommand');
    if (IfMatch) assert.equal(IfMatch, 'test-etag');
    const range = Range ? parseRange(Range, bytes.length) : null;
    if (Range && !range) throw Object.assign(new Error('range'), {name:'InvalidRange', $metadata:{httpStatusCode:416}});
    const output = range ? bytes.subarray(range.start, range.end + 1) : bytes;
    return { Body: Readable.from([output]), ContentLength: output.length,
      ContentRange: range ? `bytes ${range.start}-${range.end}/${bytes.length}` : undefined,
      $metadata: { httpStatusCode: range ? 206 : 200 } };
  } };
}

async function setup(t, remote = false) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'libedge-storage-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const client = fakeClient();
  return { dir, client, storage: createStorage({ publicDir: dir, env: remote ? env : {}, client }) };
}

for (const remote of [false, true]) {
  test(`${remote ? 'R2' : 'local'} put/read/range/delete round trip`, async t => {
    const { storage, client } = await setup(t, remote);
    const key = await storage.put('uploads/book.pdf', Buffer.from('0123456789'), 'application/pdf');
    assert.equal(key, remote ? 'r2://pilot/uploads/book.pdf' : 'uploads/book.pdf');
    assert.equal((await storage.read(key)).toString(), '0123456789');
    const body = await storage.stream(key, { start: 2, end: 4 });
    const parts = []; for await (const chunk of body) parts.push(chunk);
    assert.equal(Buffer.concat(parts).toString(), '234');
    await storage.remove(key);
    await assert.rejects(storage.read(key), e => e.code === 'ENOENT');
    if (remote) assert.equal(client.objects.size, 0);
  });
}

test('R2 retains explicit local seed compatibility, never falls back for missing remote object', async t => {
  const { dir, storage } = await setup(t, true);
  await writeFile(path.join(dir, 'sample.pdf'), 'local');
  assert.equal((await storage.read('sample.pdf')).toString(), 'local');
  await assert.rejects(storage.read('r2://pilot/sample.pdf'), /object storage operation failed/);
});

test('reject traversal, absolute paths, remote prefix escape and missing configuration', async t => {
  const { storage, dir } = await setup(t, true);
  for (const key of ['', '../x', '/etc/passwd', 'uploads/../x', 'a\\b', 'a//b', 'r2://other/a.pdf']) assert.throws(() => storage.validate(key));
  assert.throws(() => createStorage({ publicDir: dir, env: { STORAGE_DRIVER: 'r2' } }), /missing R2_ENDPOINT/);
  assert.throws(() => createStorage({ publicDir: dir, env: { ...env, R2_ENDPOINT: 'https://attacker.example' } }), /endpoint/);
  assert.throws(() => createStorage({ publicDir: dir, env: {} }).validate('r2://pilot/a.pdf'), /requires R2/);
});

test('provider errors do not expose secrets', async t => {
  const { dir } = await setup(t);
  const storage = createStorage({ publicDir: dir, env, client: { send: async () => { throw new Error('SECRET credential URL'); } } });
  await assert.rejects(storage.read('r2://pilot/a.pdf'), e => e.message === 'object storage operation failed');
});

test('oversized remote object rejected before GET', async t => {
  const { dir } = await setup(t);
  let count = 0;
  const storage = createStorage({ publicDir: dir, env, client: { send: async () => { count++; return { ContentLength: MAX_ASSET_BYTES + 1 }; } } });
  await assert.rejects(storage.read('r2://pilot/large.pdf'), /limit/);
  assert.equal(count, 1);
});

test('single range parsing: closed, open, suffix, clamping, malformed and overflow', () => {
  for (const [value, expected] of [
    ['bytes=2-4', { start: 2, end: 4 }], ['bytes=7-', { start: 7, end: 9 }],
    ['bytes=-3', { start: 7, end: 9 }], ['bytes=-30', { start: 0, end: 9 }],
    ['bytes=0-99', { start: 0, end: 9 }], ['bytes=9-3', null], ['bytes=10-', null],
    ['bytes=-0', null], ['bytes=-', null], ['bytes=0-1,3-4', null], ['bytes=99999999999999999999-', null],
  ]) assert.deepEqual(parseRange(value, 10), expected, value);
});

test('HTTP delivery: remote PDF/EPUB, ranges, no public URL, missing and upstream error', async t => {
  const { storage, client, dir } = await setup(t, true);
  const key = await storage.put('uploads/a.pdf', Buffer.from('0123456789'), 'application/pdf');
  const epub = await storage.put('uploads/a.epub', Buffer.from('epub'), 'application/epub+zip');
  const server = http.createServer((req, res) => serveStoredAsset(storage, req, res, req.url === '/epub' ? epub : req.url === '/missing' ? 'r2://pilot/no.pdf' : key));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const full = await fetch(base); assert.equal(full.status, 200); assert.equal(await full.text(), '0123456789');
  assert.equal(full.headers.get('location'), null); assert.equal(full.headers.get('cache-control'), 'private, no-store');
  for (const [range, expected] of [['bytes=2-4', '234'], ['bytes=-3', '789'], ['bytes=7-', '789']]) {
    const result = await fetch(base, { headers: { range } }); assert.equal(result.status, 206); assert.equal(await result.text(), expected);
  }
  const bad = await fetch(base, { headers: { range: 'bytes=99-' } }); assert.equal(bad.status, 416); assert.equal(bad.headers.get('content-range'), 'bytes */10');
  const missing = await fetch(base + '/missing'); assert.equal(missing.status, 404); await missing.text();
  const book = await fetch(base + '/epub'); assert.equal(book.headers.get('content-type'), 'application/epub+zip'); assert.equal(await book.text(), 'epub');
  assert.ok(client.calls.some(c => c.constructor.name === 'GetObjectCommand' && c.input.Range === 'bytes=-3')); 
  const broken = createStorage({ publicDir: dir, env, client: { send: async () => { throw new Error('secret'); } } });
  const fail = http.createServer((req, res) => serveStoredAsset(broken, req, res, key));
  await new Promise(resolve => fail.listen(0, '127.0.0.1', resolve)); t.after(() => { fail.closeAllConnections(); fail.close(); });
  const response = await fetch(`http://127.0.0.1:${fail.address().port}`); assert.equal(response.status, 502); assert.doesNotMatch(await response.text(), /secret/);
});


test('valid reader requests use one GET and zero HEAD, including repeated suffix reads', async t => {
  const {storage, client} = await setup(t,true);
  const key = await storage.put('uploads/single.pdf',Buffer.from('0123456789'),'application/pdf');
  for (const range of [undefined,'bytes=2-4','bytes=-3','bytes=7-','bytes=0-99']) {
    client.calls.length=0;
    const opened=await storage.open(key,range);
    for await (const chunk of opened.body) {}
    assert.deepEqual(client.calls.map(c=>c.constructor.name),['GetObjectCommand']);
  }
});

test('range metadata mismatch fails closed and destroys upstream body',async t=>{
 const {dir}=await setup(t);
 for (const result of [
   {ContentLength:3,ContentRange:'bytes 0-2/10'},
   {ContentLength:3},
   {ContentLength:3,ContentRange:'bytes 2-4/10',$metadata:{httpStatusCode:200}},
   {ContentLength:99,ContentRange:'bytes 2-4/10'},
 ]) {
   const body=Readable.from(['234']);
   const storage=createStorage({publicDir:dir,env,client:{send:async()=>({...result,Body:body})}});
   await assert.rejects(storage.open('r2://pilot/a.pdf','bytes=2-4'),/metadata/);
   assert.equal(body.destroyed,true);
 }
});
