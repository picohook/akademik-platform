// LibRead public demo: the real reader, with its API answered here, in the visitor's browser.
//
// Loaded before the reader's own scripts on /demo/. Every /api/ request the reader makes is answered by this file and goes no
// further; the only /api/ requests that reach the server are the two fixed public-domain book files. Notes, reading progress and
// favourites are kept in this browser, under one demo user, and never leave it. Nothing here can reach a real account: an
// unknown /api/ path is answered with 404, never forwarded.
(() => {
  'use strict';
  const PREFIX = 'libread-public-demo:v1:';
  const STATE_KEY = PREFIX + 'state';
  const USER = Object.freeze({ id: 'de000000-0000-4000-8000-0000000000d1', email: 'demo@libedge.com', displayName: 'Demo', role: 'reader' });
  const ID = (n) => `de000000-0000-4000-8000-00000000${n}`;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const COLORS = ['yellow', 'green', 'blue', 'pink', 'bookmark'];
  const CREATED = '2026-11-02T00:00:00.000Z';

  const BOOKS = [
    {
      id: ID('a001'), asset_id: ID('b001'), format: 'epub', title: 'Earth at Night', subtitle: '', work_title: 'Earth at Night', edition: '',
      language: 'en', publisher: 'NASA', publication_year: 2019, page_count: null, storage_key: 'demo/earth-at-night.epub',
      subjects: ['Earth science', 'Photography'],
      abstract: 'Five illustrated chapters of NASA\'s Earth at Night, from city lights to polar auroras, with the original acknowledgments and cover credits.',
      metadata: { authors: [{ family: 'NASA Science Mission Directorate', given: '' }] },
      allow_copy: true, allow_download: false, allow_print: false, watermark: false, created_at: CREATED,
    },
    {
      id: ID('a002'), asset_id: ID('b002'), format: 'pdf', title: 'Earth as Art', subtitle: '', work_title: 'Earth as Art', edition: '',
      language: 'en', publisher: 'NASA', publication_year: 2012, page_count: 11, storage_key: 'demo/earth-as-art.pdf',
      subjects: ['Earth science', 'Satellite imagery'],
      abstract: 'Eleven pages (12-22) of NASA\'s Earth as Art: satellite images of the planet as a gallery of colour and pattern.',
      metadata: { authors: [{ family: 'Friedl', given: 'Lori' }, { family: 'Yuen', given: 'Kevin' }] },
      allow_copy: true, allow_download: false, allow_print: false, watermark: false, created_at: CREATED,
    },
  ];

  // ---- the visitor's data -----------------------------------------------------------------------------------------------
  let memory = { annotations: [], progress: {}, favorites: [], receipts: {} };
  const load = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(STATE_KEY) || 'null');
      if (saved && typeof saved === 'object') {
        memory = {
          annotations: Array.isArray(saved.annotations) ? saved.annotations : [],
          progress: saved.progress && typeof saved.progress === 'object' ? saved.progress : {},
          favorites: Array.isArray(saved.favorites) ? saved.favorites : [],
          receipts: saved.receipts && typeof saved.receipts === 'object' ? saved.receipts : {},
        };
      }
    } catch { /* storage closed or unreadable: this visit starts empty */ }
  };
  const save = () => { try { localStorage.setItem(STATE_KEY, JSON.stringify(memory)); } catch { /* kept in memory for this visit */ } };
  load();

  // ---- the API ----------------------------------------------------------------------------------------------------------
  const reply = (status, body) => ({ status, body });
  const fail = (status, code) => reply(status, { error: code });
  const bookIds = new Set(BOOKS.map((book) => book.id));

  function mutateAnnotation(method, id, body) {
    if (!body || typeof body !== 'object') return fail(400, 'invalid_annotation_request');
    if (Object.hasOwn(body, 'ownerId') && body.ownerId !== USER.id) return fail(403, 'annotation_owner_mismatch');
    if (!body.operationId) return fail(428, 'operation_id_required');
    if (!UUID.test(body.operationId)) return fail(400, 'invalid_operation_id');
    const operation = String(body.operationId).toLowerCase();
    if (memory.receipts[operation]) return structuredClone(memory.receipts[operation]);
    let result;
    if (method === 'POST') {
      if (!UUID.test(body.assetId || '') || !body.anchor || typeof body.anchor !== 'object' || Array.isArray(body.anchor)) return fail(400, 'invalid_annotation_anchor');
      const color = body.color || 'yellow';
      if (!COLORS.includes(color)) return fail(400, 'invalid_annotation_color');
      const now = new Date().toISOString();
      const created = {
        id: crypto.randomUUID(), asset_id: String(body.assetId).toLowerCase(), anchor: body.anchor, color,
        note: String(body.note || '').trim().slice(0, 4000) || null, selected_text: body.selectedText ? String(body.selectedText).slice(0, 20000) : null,
        tags: [], status: 'active', created_at: now, updated_at: now, version: 1,
      };
      memory.annotations.push(created);
      result = reply(201, created);
    } else {
      if (!UUID.test(id || '')) return fail(400, 'invalid_annotation_id');
      if (!Number.isInteger(body.baseVersion) || body.baseVersion < 1) return fail(428, 'annotation_version_required');
      const row = memory.annotations.find((item) => item.id === id);
      if (!row) result = reply(404, { error: 'annotation_not_found', current: null });
      else if (row.version !== body.baseVersion) result = reply(409, { error: 'annotation_conflict', current: row });
      else if (method === 'DELETE') {
        memory.annotations.splice(memory.annotations.indexOf(row), 1);
        result = reply(200, { ok: true, id, version: row.version });
      } else {
        if (Object.hasOwn(body, 'note')) row.note = String(body.note || '').trim().slice(0, 4000) || null;
        if (Object.hasOwn(body, 'color')) {
          if (!COLORS.includes(body.color)) return fail(400, 'invalid_annotation_color');
          row.color = body.color;
        }
        row.version += 1;
        row.updated_at = new Date().toISOString();
        result = reply(200, row);
      }
    }
    memory.receipts[operation] = structuredClone(result);
    save();
    return structuredClone(result);
  }

  function handle(pathname, search, method, body) {
    const params = new URLSearchParams(search);
    if (pathname === '/api/health') return reply(200, { ok: true, mode: 'demo', tenantId: null });
    if (pathname === '/api/config') {
      return reply(200, { brandName: 'LibRead', brandTagline: 'demo', mode: 'demo', version: 'demo', buildSha: '', buildDate: '', environment: 'demo', supportEmail: '', aiSelection: false });
    }
    if (pathname === '/api/me') return reply(200, USER);
    if (pathname === '/api/books' && method === 'GET') return reply(200, BOOKS);
    if (pathname === '/api/collections') return reply(200, []);
    if (pathname === '/api/favorites' && method === 'GET') return reply(200, memory.favorites.map((work_id) => ({ work_id })));
    const favorite = /^\/api\/favorites\/([^/]+)$/.exec(pathname);
    if (favorite && ['PUT', 'DELETE'].includes(method)) {
      const id = decodeURIComponent(favorite[1]);
      if (!bookIds.has(id)) return fail(404, 'book not found');
      memory.favorites = method === 'PUT' ? [...new Set([...memory.favorites, id])] : memory.favorites.filter((item) => item !== id);
      save();
      return reply(200, { ok: true });
    }
    if (pathname === '/api/library/progress' && method === 'GET') {
      return reply(200, Object.values(memory.progress).map((row) => ({ asset_id: row.asset_id, percent: row.percent, updated_at: row.updated_at }))
        .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))));
    }
    if (pathname === '/api/progress' && method === 'GET') return reply(200, memory.progress[params.get('assetId')] || null);
    if (pathname === '/api/progress' && method === 'POST') {
      if (!body?.assetId || !body.anchor || !BOOKS.some((book) => book.asset_id === body.assetId)) return fail(400, 'assetId and anchor are required');
      const row = { asset_id: body.assetId, anchor: body.anchor, percent: Number(body.percent || 0), updated_at: new Date().toISOString() };
      memory.progress[body.assetId] = row;
      save();
      return reply(200, row);
    }
    if (pathname === '/api/annotations/v1' && method === 'GET') {
      if (params.has('ownerId') && params.get('ownerId') !== USER.id) return fail(403, 'annotation owner mismatch');
      return reply(200, memory.annotations.filter((row) => row.asset_id === String(params.get('assetId') || '').toLowerCase()));
    }
    if (pathname === '/api/annotations/v1' && method === 'POST') return mutateAnnotation('POST', null, body);
    const annotation = /^\/api\/annotations\/v1\/([^/]+)$/.exec(pathname);
    if (annotation && ['PATCH', 'DELETE'].includes(method)) return mutateAnnotation(method, decodeURIComponent(annotation[1]), body);
    if (pathname === '/api/logout' || pathname === '/api/logout-all') return reply(200, { ok: true });
    return fail(404, 'not available in the demo');
  }

  // The two book files and the covers are public static files: they go to the network like any asset. Everything else under
  // /api/ stops here.
  const publicFile = /^\/api\/books\/[0-9a-f-]{36}\/(?:file|book\.epub)$/;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    let url;
    try { url = new URL(typeof input === 'string' ? input : input.url, window.location.href); } catch { return nativeFetch(input, init); }
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/') || publicFile.test(url.pathname)) return nativeFetch(input, init);
    const method = String(init.method || (typeof input === 'object' && input.method) || 'GET').toUpperCase();
    let body = null;
    try {
      const raw = init.body !== undefined ? init.body : (typeof input === 'object' && method !== 'GET' ? await input.clone().text() : null);
      body = typeof raw === 'string' && raw ? JSON.parse(raw) : null;
    } catch { body = null; }
    const { status, body: payload } = handle(url.pathname, url.search, method, body);
    return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  };

  // ---- reset ------------------------------------------------------------------------------------------------------------
  // Clears only what the demo wrote: its own state, its keys, and the notes and queue rows that belong to the demo user. A real
  // account's data in the same browser is not touched.
  async function clearDemoRows() {
    if (!window.indexedDB) return;
    const db = await new Promise((resolve) => {
      const request = indexedDB.open('akademik-offline');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
    if (!db) return;
    try {
      for (const name of ['annotations', 'annotation-ops']) {
        if (!db.objectStoreNames.contains(name)) continue;
        await new Promise((resolve) => {
          const tx = db.transaction(name, 'readwrite');
          const request = tx.objectStore(name).openCursor();
          request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) return;
            if (cursor.value && cursor.value.ownerId === USER.id) cursor.delete();
            cursor.continue();
          };
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
          tx.onabort = () => resolve();
        });
      }
    } finally { db.close(); }
  }

  async function resetDemo() {
    try {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith(PREFIX) || key.includes(USER.id) || BOOKS.some((book) => key.includes(book.id) || key.includes(book.asset_id))) localStorage.removeItem(key);
      }
      if (localStorage.getItem('offlineAnnotationUser') === USER.id) localStorage.removeItem('offlineAnnotationUser');
    } catch { /* storage closed */ }
    await clearDemoRows().catch(() => {});
    window.location.reload();
  }

  // ---- the page around the reader -----------------------------------------------------------------------------------------
  const english = (() => { try { return localStorage.getItem('uiLang') === 'en'; } catch { return false; } })();
  const text = english
    ? { note: 'Demo · your notes stay in this browser', reset: 'Reset demo', confirm: 'Delete the notes, favourites and progress of this demo?', account: 'Open an account' }
    : { note: 'Demo · notlarınız yalnız bu tarayıcıda', reset: 'Demoyu sıfırla', confirm: 'Bu demodaki notlar, favoriler ve ilerleme silinsin mi?', account: 'Hesap aç' };

  const style = document.createElement('style');
  style.textContent = `
    #passwordBtn, #logoutBtn, #logoutAllBtn, #offlineBtn, #openUpload { display: none !important; }
    .demo-pill { position: fixed; right: 12px; bottom: 12px; z-index: 40; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; max-width: calc(100vw - 24px);
      padding: 6px 12px; border: 1px solid #c9d3e6; border-radius: 999px; background: #fff; color: #2e4484; font: 12px/1.4 system-ui, sans-serif; box-shadow: 0 4px 18px rgba(20, 30, 60, .12); }
    .demo-pill button, .demo-pill a { all: unset; cursor: pointer; color: #2e4484; text-decoration: underline; text-underline-offset: 2px; font: inherit; }
    .demo-pill button:focus-visible, .demo-pill a:focus-visible { outline: 2px solid #3b6fc4; outline-offset: 2px; }
    body:has(#reader:not([hidden])) .demo-pill, body:has(dialog[open]) .demo-pill { display: none; }
  `;
  const mount = () => {
    document.head.appendChild(style);
    const pill = document.createElement('div');
    pill.className = 'demo-pill';
    pill.setAttribute('role', 'note');
    const label = document.createElement('span');
    label.textContent = text.note;
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.textContent = text.reset;
    reset.addEventListener('click', () => { if (window.confirm(text.confirm)) resetDemo(); });
    const account = document.createElement('a');
    account.href = '/auth/libedge/start?ctx=individual';
    account.textContent = text.account;
    pill.append(label, reset, account);
    document.body.appendChild(pill);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
