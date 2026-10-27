import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SERVER_ENTRY, PUBLIC_MODULES, serverImportGraph, serverFiles, copyServerFiles,
} from './helpers/server-files.mjs';

// test/ -> app/ (helpers/ resolves its own depth internally)
const appDir = new URL('../', import.meta.url);

async function relativeImports(file) {
  const source = await readFile(fileURLToPath(new URL(file, appDir)), 'utf8');
  const found = new Set();
  for (const pattern of [/\bfrom\s+['"](\.[^'"]+)['"]/g, /\bimport\s+['"](\.[^'"]+)['"]/g]) {
    for (const match of source.matchAll(pattern)) found.add(match[1].split('?')[0]);
  }
  return [...found];
}

test('the derived list covers every relative import of server.mjs', async () => {
  // This is the regression that hit twice: server.mjs gained an import, the
  // hand-written per-test copy lists did not, and nine tests failed with
  // ERR_MODULE_NOT_FOUND in their temp sandbox.
  const listed = new Set(await serverFiles());
  const missing = [];
  for (const specifier of await relativeImports(SERVER_ENTRY)) {
    const normalized = specifier.replace(/^\.\//, '');
    if (!listed.has(normalized)) missing.push(normalized);
  }
  assert.deepEqual(missing, [], `server.mjs imports not in the copy list: ${missing.join(', ')}`);
});

test('security-headers.mjs is in the list (the v133 regression)', async () => {
  assert.ok((await serverFiles()).includes('security-headers.mjs'));
});

test('every listed file exists, so a rename cannot leave a stale entry', async () => {
  for (const file of await serverFiles()) {
    await assert.doesNotReject(readFile(fileURLToPath(new URL(file, appDir))), `missing: ${file}`);
  }
});

test('nested public modules keep their directory structure', async () => {
  const files = await serverFiles();
  assert.ok(files.includes('public/search.mjs'));
  assert.ok(files.includes('public/book-variants.mjs'));
  assert.ok(!files.some(file => file.startsWith('./')));
});

test('PUBLIC_MODULES are part of the returned list', async () => {
  const files = await serverFiles();
  for (const file of PUBLIC_MODULES) assert.ok(files.includes(file), `missing: ${file}`);
});

test('the list is deduplicated and stable across calls', async () => {
  const first = await serverFiles();
  const second = await serverFiles();
  assert.deepEqual(first, second);
  assert.equal(new Set(first).size, first.length);
  assert.equal(first[0], SERVER_ENTRY);
});

test('copyServerFiles preserves paths and writes the same bytes', async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), 'server-files-'));
  try {
    const copied = await copyServerFiles(appDir, target);
    assert.deepEqual(copied, await serverFiles());
    for (const file of ['server.mjs', 'security-headers.mjs', 'public/search.mjs']) {
      const original = await readFile(fileURLToPath(new URL(file, appDir)));
      const sandboxed = await readFile(path.join(target, file));
      assert.deepEqual(sandboxed, original, `content differs: ${file}`);
    }
    // Nested files need their parent directory to exist, which is the bug a
    // naive name-only copy has.
    const nested = await readdir(path.join(target, 'public'));
    assert.ok(nested.includes('search.mjs'));
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});
