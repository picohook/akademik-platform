import path from 'node:path';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

export const MAX_ASSET_BYTES = 300 * 1024 * 1024;
const REMOTE = 'r2://';

function relativeKey(key) {
  if (typeof key !== 'string' || !key || key.includes('\\') || key.includes('\0') || key.startsWith('/') || key.split('/').some(p => !p || p === '.' || p === '..')) {
    throw new Error('invalid storage key');
  }
  return key;
}

export function createStorage({ publicDir, env = process.env, client } = {}) {
  const root = path.resolve(publicDir);
  const driver = env.STORAGE_DRIVER || 'local';
  if (!['local', 'r2'].includes(driver)) throw new Error('unsupported STORAGE_DRIVER');
  let s3 = client;
  const bucket = env.R2_BUCKET;
  const prefix = env.R2_PREFIX || 'libedge';
  if (driver === 'r2') {
    for (const name of ['R2_ENDPOINT', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) {
      if (!env[name]) throw new Error(`missing ${name}`);
    }
    const url = new URL(env.R2_ENDPOINT);
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.r2.cloudflarestorage.com') || url.username || url.password || url.port || url.search || url.hash || url.pathname !== '/') throw new Error('invalid R2 endpoint');
    if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error('invalid R2 bucket');
    relativeKey(prefix);
    s3 ||= new S3Client({
      endpoint: url.origin, region: 'auto', forcePathStyle: true,
      credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      maxAttempts: 3,
      requestHandler: { connectionTimeout: 10_000, requestTimeout: 120_000 },
    });
  }
  function locate(key) {
    if (key?.startsWith(REMOTE)) {
      if (driver !== 'r2') throw new Error('R2 asset requires R2 configuration');
      const remoteKey = relativeKey(key.slice(REMOTE.length));
      if (!remoteKey.startsWith(`${prefix}/`)) throw new Error('R2 key outside configured prefix');
      return { remoteKey };
    }
    return { file: path.join(root, relativeKey(key)) };
  }
  async function send(Command, Key, extra = {}) {
    try { return await s3.send(new Command({ Bucket: bucket, Key, ...extra })); }
    catch (error) {
      // Do not leak request URLs, credentials, or provider response bodies to clients/logs.
      const clean = new Error('object storage operation failed');
      if (error.$metadata?.httpStatusCode === 404 || error.name === 'NoSuchKey' || error.name === 'NotFound') clean.code = 'ENOENT';
      throw clean;
    }
  }
  async function info(key) {
    const target = locate(key);
    if (target.file) return stat(target.file);
    const result = await send(HeadObjectCommand, target.remoteKey);
    return { size: result.ContentLength, etag: result.ETag };
  }
  async function stream(key, range, etag) {
    const target = locate(key);
    if (target.file) return createReadStream(target.file, range);
    const result = await send(GetObjectCommand, target.remoteKey, {
      ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}),
      ...(etag ? { IfMatch: etag } : {}),
    });
    return result.Body instanceof Readable ? result.Body : Readable.fromWeb(result.Body);
  }
  return {
    driver, validate: key => { locate(key); }, info, stream,
    async read(key) {
      const metadata = await info(key);
      if (metadata.size > MAX_ASSET_BYTES) throw new Error('asset exceeds read limit');
      const body = await stream(key, undefined, metadata.etag);
      const chunks = []; let length = 0;
      try {
        for await (const chunk of body) {
          length += chunk.length;
          if (length > MAX_ASSET_BYTES) throw new Error('asset exceeds read limit');
          chunks.push(Buffer.from(chunk));
        }
      } finally { body.destroy(); }
      return Buffer.concat(chunks);
    },
    async put(key, bytes, contentType) {
      relativeKey(key);
      if (bytes.length > MAX_ASSET_BYTES) throw new Error('asset exceeds upload limit');
      if (driver === 'local') {
        const file = path.join(root, key);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, bytes, { flag: 'wx' });
        return key;
      }
      const remoteKey = `${prefix}/${key}`;
      await send(PutObjectCommand, remoteKey, { Body: bytes, ContentType: contentType, ContentMD5: createHash('md5').update(bytes).digest('base64'), IfNoneMatch: '*' });
      return REMOTE + remoteKey;
    },
    async remove(key) {
      const target = locate(key);
      if (target.file) return unlink(target.file).catch(error => { if (error.code !== 'ENOENT') throw error; });
      await send(DeleteObjectCommand, target.remoteKey);
    },
  };
}

export function parseRange(value, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value || '');
  if (!match || (!match[1] && !match[2])) return null;
  let start; let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix); end = size - 1;
  } else {
    start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) return null;
  return { start, end };
}

// Call only after session and grant authorization. Never redirect to a public bucket URL.
export async function serveStoredAsset(storage, req, res, key) {
  let metadata;
  try { metadata = await storage.info(key); }
  catch (error) {
    res.writeHead(error.code === 'ENOENT' ? 404 : 502, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ error: 'file unavailable' })); return;
  }
  const range = req.headers.range ? parseRange(req.headers.range, metadata.size) : undefined;
  if (req.headers.range && !range) {
    res.writeHead(416, { 'content-range': `bytes */${metadata.size}`, 'cache-control': 'no-store' }); res.end(); return;
  }
  let body;
  try { body = await storage.stream(key, range, metadata.etag); }
  catch {
    res.writeHead(502, { 'cache-control': 'no-store' }); res.end(); return;
  }
  const close = () => body.destroy();
  res.once('close', close);
  res.writeHead(range ? 206 : 200, {
    'content-type': key.toLowerCase().endsWith('.epub') ? 'application/epub+zip' : 'application/pdf',
    'content-length': range ? range.end - range.start + 1 : metadata.size,
    ...(range ? { 'content-range': `bytes ${range.start}-${range.end}/${metadata.size}` } : {}),
    'accept-ranges': 'bytes', 'cache-control': 'private, no-store',
  });
  try { await pipeline(body, res); }
  catch { res.destroy(); }
  finally { res.removeListener('close', close); }
}
