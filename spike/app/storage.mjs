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
      if (error.$metadata?.httpStatusCode === 416 || error.name === 'InvalidRange') clean.code = 'ERANGE';
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
  async function open(key, rangeHeader) {
    const target = locate(key);
    const rangeError = size => Object.assign(new Error('invalid byte range'), { code: 'ERANGE', size });
    // Invalid/multiple ranges may need a metadata lookup for the 416 response.
    // Valid reader requests always use exactly one remote GET, with its metadata.
    if (rangeHeader && !validRangeSyntax(rangeHeader)) throw rangeError((await info(key)).size);
    if (target.file) {
      const metadata = await stat(target.file);
      const range = rangeHeader ? parseRange(rangeHeader, metadata.size) : undefined;
      if (rangeHeader && !range) throw rangeError(metadata.size);
      return { body: createReadStream(target.file, range), status: range ? 206 : 200,
        length: range ? range.end - range.start + 1 : metadata.size,
        contentRange: range ? `bytes ${range.start}-${range.end}/${metadata.size}` : undefined };
    }
    let result;
    try {
      result = await send(GetObjectCommand, target.remoteKey, rangeHeader ? { Range: rangeHeader } : {});
    } catch (error) {
      if (error.code === 'ERANGE') throw rangeError((await info(key)).size);
      throw error;
    }
    const body = result.Body instanceof Readable ? result.Body : Readable.fromWeb(result.Body);
    let valid = Number.isSafeInteger(result.ContentLength) && result.ContentLength >= 0;
    if (rangeHeader) {
      const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(result.ContentRange || '');
      const expected = match ? parseRange(rangeHeader, Number(match[3])) : null;
      valid &&= Boolean(expected && expected.start === Number(match[1]) && expected.end === Number(match[2])
        && expected.end - expected.start + 1 === result.ContentLength
        && Number.isSafeInteger(Number(match[3]))
        && (!result.$metadata?.httpStatusCode || result.$metadata.httpStatusCode === 206));
    } else {
      valid &&= !result.ContentRange && (!result.$metadata?.httpStatusCode || result.$metadata.httpStatusCode === 200);
    }
    if (!valid) { body.destroy(); throw new Error('invalid object response metadata'); }
    return { body, status: rangeHeader ? 206 : 200, length: result.ContentLength,
      contentRange: rangeHeader ? result.ContentRange : undefined };
  }
  return {
    driver, validate: key => { locate(key); }, info, stream, open,
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

export function validRangeSyntax(value) {
  if (typeof value !== 'string' || value.length > 128) return false;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return false;
  if (!match[1]) return Number.isSafeInteger(Number(match[2])) && Number(match[2]) > 0;
  const start = Number(match[1]);
  return Number.isSafeInteger(start) && (!match[2] ||
    (Number.isSafeInteger(Number(match[2])) && Number(match[2]) >= start));
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
  let opened;
  try { opened = await storage.open(key, req.headers.range); }
  catch (error) {
    const status = error.code === 'ENOENT' ? 404 : error.code === 'ERANGE' ? 416 : 502;
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store',
      ...(status === 416 && Number.isSafeInteger(error.size) ? { 'content-range': `bytes */${error.size}` } : {}) });
    res.end(JSON.stringify({ error: status === 416 ? 'invalid byte range' : 'file unavailable' })); return;
  }
  const { body, status, length, contentRange } = opened;
  const close = () => body.destroy();
  res.once('close', close);
  if (res.destroyed) { body.destroy(); return; }
  res.writeHead(status, {
    'content-type': key.toLowerCase().endsWith('.epub') ? 'application/epub+zip' : 'application/pdf',
    'content-length': length,
    ...(contentRange ? { 'content-range': contentRange } : {}),
    'accept-ranges': 'bytes', 'cache-control': 'private, no-store',
  });
  try { await pipeline(body, res); }
  catch { res.destroy(); }
  finally { res.removeListener('close', close); }
}
