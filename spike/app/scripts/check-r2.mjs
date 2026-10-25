// Credentialed live probe. Writes only its own random object and removes it.
import { randomUUID } from 'node:crypto';
import { createStorage } from '../storage.mjs';
const storage = createStorage({ publicDir: new URL('../public', import.meta.url).pathname });
if (storage.driver !== 'r2') throw new Error('STORAGE_DRIVER must be r2');
let key;
try {
  const source = Buffer.from(`LibEdge R2 probe ${randomUUID()}\n`);
  key = await storage.put(`checks/${randomUUID()}.pdf`, source, 'application/octet-stream');
  if (!(await storage.read(key)).equals(source)) throw new Error('round-trip mismatch');
  const body = await storage.stream(key, { start: 2, end: 6 });
  const parts = []; for await (const part of body) parts.push(part);
  if (!Buffer.concat(parts).equals(source.subarray(2, 7))) throw new Error('range mismatch');
  await storage.remove(key);
  const removed = key; key = null;
  try { await storage.info(removed); throw new Error('probe object still exists'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  console.log('R2 PASS: put/read/range/delete; temporary object removed.');
} finally {
  if (key) await storage.remove(key);
}
