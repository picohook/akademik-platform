// The set of app files the isolated-server tests must copy into their sandbox.
//
// Why this module exists: every integration test copies server.mjs and its
// sibling modules into a temp directory, starts the server there, and asserts
// against it. That list used to be written out by hand in each test, which meant
// a new root-level import of server.mjs broke every test that forgot to add it —
// tenant-context.mjs did exactly that once, and security-headers.mjs did it
// again. So the list is DERIVED from server.mjs's own import statements instead
// of restated. Adding an import to server.mjs is now enough; no test changes.
//
// Only relative specifiers are followed. Bare specifiers (busboy, pg, jszip,
// pdf-lib, ...) are resolved from node_modules and need no copying. Query
// suffixes such as '?v=1' are stripped because they are cache-busters for the
// browser, not part of the file name.
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// helpers/ -> test/ -> app/  (tests pass their own appDir, which is also app/)
const APP_DIR = new URL('../../', import.meta.url);

// The entry point of the import walk. Everything else is discovered from it.
export const SERVER_ENTRY = 'server.mjs';

// Modules the sample/public tests additionally ship. Kept separate so tests that
// copy all of public/ do not double-copy, and so the intent stays explicit.
// These are not in server.mjs's import graph: they are browser-side modules that
// a test imports directly (social-drm calls saveOfflineDownload from
// downloads.mjs, which imports offline.mjs) and that must therefore exist in the
// sandbox with the same path the /downloads.mjs static route serves.
export const PUBLIC_MODULES = [
  'public/search.mjs',
  'public/book-variants.mjs',
  'public/downloads.mjs',
  'public/offline.mjs',
];

function relativeSpecifiers(source) {
  const found = [];
  // Matches: from './x.mjs' | from "./x.mjs" | import './x.mjs' | import("./x.mjs")
  const patterns = [
    /\bfrom\s+['"](\.[^'"]+)['"]/g,
    /\bimport\s+['"](\.[^'"]+)['"]/g,
    /\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) found.push(match[1]);
  }
  return found;
}

// Tests pass appDir as a plain path (path.dirname(fileURLToPath(...))), not a
// URL, so normalise it before using it as a URL base.
function toAppDir(appDir) {
  const dir = appDir instanceof URL ? fileURLToPath(appDir) : String(appDir);
  return pathToFileURL(path.resolve(dir) + path.sep);
}

async function resolveFrom(appDir, specifier) {
  const bare = specifier.split('?')[0];
  const candidate = new URL(bare, appDir);
  try {
    await stat(fileURLToPath(candidate));
    return candidate;
  } catch {
    return null;
  }
}

// Breadth-first walk of server.mjs's relative import graph.
// CSS and JS are not modules and are not in the graph; they are covered by the
// public/ copy that browser tests perform.
export async function serverImportGraph(appDir = APP_DIR) {
  const root = toAppDir(appDir);
  const seen = new Set();
  const queue = [new URL(SERVER_ENTRY, root)];
  while (queue.length) {
    const url = queue.shift();
    const file = fileURLToPath(url);
    const relative = path.relative(fileURLToPath(root), file).split(path.sep).join('/');
    if (seen.has(relative)) continue;
    seen.add(relative);
    let source;
    try {
      source = await readFile(file, 'utf8');
    } catch {
      continue;
    }
    for (const specifier of relativeSpecifiers(source)) {
      const resolved = await resolveFrom(url, specifier);
      if (resolved) queue.push(resolved);
    }
  }
  // Env-independent order: entry first, then alphabetical, so assertions and
  // logs stay stable.
  return [SERVER_ENTRY, ...[...seen].filter(name => name !== SERVER_ENTRY).sort()];
}

// Entry + graph + public modules, deduplicated. This is what tests copy.
export async function serverFiles(appDir = APP_DIR) {
  const graph = await serverImportGraph(appDir);
  return [...new Set([...graph, ...PUBLIC_MODULES])];
}

// Copy the app files into `target`. `public/` assets are NOT copied here: tests
// that need them cp() the whole directory, and tests that do not would only
// waste time. Directories are created as needed.
export async function copyServerFiles(appDir, target, files = null) {
  const list = files || await serverFiles(appDir);
  const root = toAppDir(appDir);
  for (const file of list) {
    const destination = path.join(target, file);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(fileURLToPath(new URL(file, root)), destination);
  }
  return list;
}

// The service worker cache name, read from public/sw.js.
//
// Why tests must not hard-code it: browser tests wait for the app shell to be
// cached by opening caches.open('<name>') and checking for required entries.
// caches.open() CREATES the cache when the name is unknown, so a stale name
// yields an empty cache whose checks can never pass - or, worse, an expectation
// that silently stops matching the shipping service worker. That had already
// happened: three tests pinned 'akademik-shell-v13' and one pinned
// 'akademik-shell-v9' while sw.js was on v24. Reading the name from the source
// keeps the assertion honest across every future bump.
export async function shellCacheName(appDir = APP_DIR) {
  const source = await readFile(fileURLToPath(new URL('public/sw.js', toAppDir(appDir))), 'utf8');
  const match = source.match(/const\s+CACHE\s*=\s*['"]([^'"]+)['"]/);
  if (!match) throw new Error('public/sw.js: could not find the CACHE constant');
  return match[1];
}

// Waits until the shipped service worker has filled its shell cache with every
// entry in `required`. Registered on `page` from the test; the name is read here
// so it can never drift from public/sw.js.
export async function ensureShell(page, appDir, required, onWait) {
  const cacheName = await shellCacheName(appDir);
  await onWait(cacheName, `SW complete shell (${cacheName})`, () => page.evaluate(async ({ name, files }) => {
    const cache = await caches.open(name);
    const found = await Promise.all(files.map(file => cache.match(file, { ignoreSearch: true })));
    return found.every(Boolean);
  }, { name: cacheName, files: required }));
  return cacheName;
}
