import { offlineBookKey } from './book-variants.mjs';
// IndexedDB storage for downloaded books and offline annotations.
const DB_NAME = 'akademik-offline';
const DB_VERSION = 2;
const BOOKS = 'books';
const ANNOTATIONS = 'annotations';
const QUEUE = 'annotation-ops';

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(BOOKS)) db.createObjectStore(BOOKS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(ANNOTATIONS)) {
        const store = db.createObjectStore(ANNOTATIONS, { keyPath: 'id' });
        store.createIndex('asset_id', 'asset_id');
      }
      if (!db.objectStoreNames.contains(QUEUE)) db.createObjectStore(QUEUE, { keyPath: 'opId' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestValue(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function write(storeName, operation) {
  const db = await openDb();
  const tx = db.transaction(storeName, 'readwrite');
  operation(tx.objectStore(storeName));
  await txDone(tx);
  db.close();
}

async function readAll(storeName, indexName = null, key = null) {
  const db = await openDb();
  const tx = db.transaction(storeName, 'readonly');
  const store = tx.objectStore(storeName);
  const request = indexName ? store.index(indexName).getAll(key) : store.getAll();
  const value = await requestValue(request);
  await txDone(tx);
  db.close();
  return value || [];
}

export async function saveOfflineBook(book, blob, { downloadProvenance } = {}) {
  const entry = {
    id: offlineBookKey(book),
    book: {
      id: book.id,
      title: book.title,
      subtitle: book.subtitle || null,
      publisher: book.publisher || null,
      publication_year: book.publication_year || null,
      edition: book.edition || null,
      language: book.language || 'tr',
      format: book.format || 'pdf',
      asset_id: book.asset_id,
      page_count: book.page_count || null,
      subjects: book.subjects || [],
      metadata: book.metadata || {},
    },
    size: blob.size,
    savedAt: new Date().toISOString(),
    ...(downloadProvenance ? { downloadProvenance } : {}),
    blob,
  };
  await write(BOOKS, (store) => store.put(entry));
  return entry;
}

export async function listOfflineBooks() {
  const entries = await readAll(BOOKS);
  return entries.map(({ blob, ...entry }) => ({ ...entry, hasBlob: Boolean(blob) }));
}

export async function getOfflineBook(id) {
  const db = await openDb();
  const tx = db.transaction(BOOKS, 'readonly');
  const value = await requestValue(tx.objectStore(BOOKS).get(id));
  await txDone(tx);
  db.close();
  return value;
}

export async function deleteOfflineBook(id) {
  await write(BOOKS, (store) => store.delete(id));
}

export async function storageEstimate() {
  if (!navigator.storage?.estimate) return null;
  return navigator.storage.estimate();
}

const PROTOCOL = 1;
const subscribers = new Set();
let channel;
function notify() {
  if (globalThis.BroadcastChannel && !channel) {
    channel = new BroadcastChannel('akademik-annotation-changes');
    channel.onmessage = () => { for (const fn of subscribers) fn(); };
  }
  channel?.postMessage('changed');
  for (const fn of subscribers) fn();
}
export function subscribeAnnotationChanges(callback) {
  subscribers.add(callback);
  if (globalThis.BroadcastChannel && !channel) {
    channel = new BroadcastChannel('akademik-annotation-changes');
    channel.onmessage = () => { for (const fn of subscribers) fn(); };
  }
  return () => subscribers.delete(callback);
}
async function annotationTransaction(run, changed = true) {
  const db = await openDb(), tx = db.transaction([ANNOTATIONS, QUEUE], 'readwrite'), done = txDone(tx);
  try {
    const result = await run(tx.objectStore(ANNOTATIONS), tx.objectStore(QUEUE));
    await done;
    if (changed) notify();
    return result;
  } catch (error) {
    try { tx.abort(); } catch { /* completed */ }
    await done.catch(() => {}); throw error;
  } finally { db.close(); }
}
const revision = () => crypto.randomUUID();
const owned = (row, ownerId) => Boolean(ownerId && row?.ownerId === ownerId);
const versioned = row => Number.isInteger(row?.version) && row.version > 0;
const findOp = (ops, id) => ops.find(op => op.type !== 'lease' && op.localId === id);
const draftFields = row => ({ note: row.note || null, tags: row.tags || [], color: row.color || 'yellow' });
const createPayload = row => ({ assetId: row.asset_id, anchor: row.anchor, selectedText: row.selected_text || null, ...draftFields(row) });
const serverId = row => Object.hasOwn(row, 'server_id') ? (row.server_id || null) : (!row.id.startsWith('offline-') ? row.id : null);
function requireOwner(row, ownerId) {
  if (!owned(row, ownerId)) throw Object.assign(new Error('annotation owner not verified'), { code: 'ANNOTATION_OWNER_REQUIRED' });
}
export async function listLocalAnnotations(assetId, ownerId) {
  if (typeof ownerId !== 'string' || !ownerId) return [];
  return (await readAll(ANNOTATIONS, 'asset_id', assetId)).filter(row => owned(row, ownerId) && (!row.deletedLocally || row.conflict));
}
export async function saveLocalAnnotation(annotation) {
  const row = { ...annotation, localRevision: annotation.localRevision || `server:${annotation.id}:${annotation.version || 'unknown'}` };
  await write(ANNOTATIONS, s => s.put(row)); notify(); return row;
}
export async function deleteLocalAnnotation(id) { await write(ANNOTATIONS, s => s.delete(id)); notify(); }
export const updateLocalAnnotation = saveLocalAnnotation;
export async function queueAnnotationOp(operation) { await write(QUEUE, s => s.put({ ...operation, protocol: PROTOCOL })); notify(); }
export async function listAnnotationOps() { return (await readAll(QUEUE)).filter(op => op.type !== 'lease'); }
export async function deleteAnnotationOp(opId) { await write(QUEUE, s => s.delete(opId)); notify(); }
export async function removeQueuedCreate(localId) {
  return annotationTransaction(async (notes, queue) => {
    const ops = await requestValue(queue.getAll());
    for (const op of ops) if (op.localId === localId && op.type === 'create' && !op.request) queue.delete(op.opId);
  });
}
export function annotationChanges(changes) {
  const result = {};
  if (Object.hasOwn(changes, 'note')) result.note = String(changes.note || '').trim() || null;
  if (Object.hasOwn(changes, 'tags')) {
    const tags = Array.isArray(changes.tags) ? changes.tags : String(changes.tags || '').split(/[;,]/);
    result.tags = [...new Set(tags.map(v => String(v || '').trim()).filter(Boolean))].slice(0, 20);
  }
  if (Object.hasOwn(changes, 'color')) {
    if (!['yellow', 'green', 'blue', 'pink'].includes(changes.color)) throw new Error('invalid annotation color');
    result.color = changes.color;
  }
  if (!Object.keys(result).length) throw new Error('annotation changes required');
  return result;
}
export async function saveAnnotationWithOperation(annotation, operation) {
  requireOwner(annotation, annotation.ownerId);
  return annotationTransaction(async (notes, queue) => {
    const row = { ...annotation, localRevision: revision() };
    notes.put(row);
    queue.put({ ...operation, ownerId: row.ownerId, protocol: PROTOCOL, revision: revision() });
    return row;
  });
}
export async function editLocalAnnotation(id, changes, ownerId, expected) {
  const patch = annotationChanges(changes);
  return annotationTransaction(async (notes, queue) => {
    const local = await requestValue(notes.get(id)); requireOwner(local, ownerId);
    const ops = await requestValue(queue.getAll()), prior = findOp(ops, id);
    const sid = serverId(local);
    if (!prior && !sid) throw new Error('annotation has no queued create or server id');
    const stale = expected && ((expected.localRevision && expected.localRevision !== local.localRevision)
      || (versioned(expected) && versioned(local) && expected.version !== local.version));
    if (stale && local.conflict) {
      throw Object.assign(new Error('conflict changed in another editor'), { code: 'ANNOTATION_CONFLICT_CHANGED' });
    }
    const now = new Date().toISOString();
    const op = prior ? { ...prior } : { opId: revision(), type: 'update', localId: id, serverId: sid,
      assetId: local.asset_id, baseVersion: local.version, ownerId, protocol: PROTOCOL, createdAt: now };
    if (op.type === 'create') op.payload = { ...op.payload, ...patch };
    else { op.type = 'update'; op.changes = { ...op.changes, ...patch }; }
    op.revision = revision();
    const edited = { ...local, ...patch, deletedLocally: false, pending: true, updated_at: now, localRevision: revision() };
    if (stale && !local.conflict) {
      edited.conflict = { kind: 'local', reason: 'another_tab', current: local, desiredType: 'update' };
      op.conflict = true;
    }
    notes.put(edited); queue.put(op); return edited;
  });
}
export async function removeLocalAnnotationWithOperation(annotation, ownerId) {
  return annotationTransaction(async (notes, queue) => {
    const local = await requestValue(notes.get(annotation.id)) || annotation; requireOwner(local, ownerId);
    const ops = await requestValue(queue.getAll()), prior = findOp(ops, local.id), sid = serverId(local);
    const stale = annotation.localRevision && local.localRevision && annotation.localRevision !== local.localRevision;
    if (!sid && !prior?.request && !stale) {
      for (const op of ops) if (op.localId === local.id) queue.delete(op.opId);
      notes.delete(local.id); return null;
    }
    const op = { ...prior, opId: prior?.opId || revision(), type: 'delete', localId: local.id,
      serverId: sid, assetId: local.asset_id, baseVersion: prior?.baseVersion ?? local.version,
      ownerId, protocol: prior?.protocol ?? PROTOCOL, revision: revision(), createdAt: prior?.createdAt || new Date().toISOString() };
    const row = { ...local, pending: true, deletedLocally: true, localRevision: revision() };
    if (stale && !local.conflict) { row.conflict = { kind: 'local', reason: 'another_tab', current: local, desiredType: 'delete' }; op.conflict = true; }
    else if (row.conflict) row.conflict = { ...row.conflict, desiredType: 'delete' };
    notes.put(row); queue.put(op); return row;
  });
}
export async function cacheServerAnnotations(assetId, rows, ownerId) {
  if (!ownerId) return;
  return annotationTransaction(async (notes, queue) => {
    const locals = await requestValue(notes.index('asset_id').getAll(assetId)), ops = await requestValue(queue.getAll());
    const ids = new Set(rows.map(row => row.id));
    for (const row of rows) {
      const local = locals.find(item => (owned(item, ownerId) || !item.ownerId) && (item.id === row.id || item.server_id === row.id));
      if (local?.pending || ops.some(op => op.ownerId === ownerId && op.serverId === row.id)) continue;
      // A server response must not replace another owner's local record.
      if (locals.some(item => item.id === row.id && item.ownerId && item.ownerId !== ownerId)) continue;
      notes.put({ ...row, id: local?.id || row.id, server_id: row.id, ownerId, pending: false,
        localRevision: `server:${row.id}:${row.version}` });
    }
    for (const local of locals) if (owned(local, ownerId) && !local.pending && !ids.has(serverId(local))) notes.delete(local.id);
  });
}
async function freezeOperation(opId) {
  return annotationTransaction(async (notes, queue) => {
    const op = await requestValue(queue.get(opId));
    if (!op || (op.conflict && !op.request)) return null;
    if (op.request) return op;
    op.request = { operationId: revision(), type: op.type, revision: op.revision, serverId: op.serverId,
      payload: structuredClone(op.type === 'create' ? op.payload : { ...(op.changes || {}), baseVersion: op.baseVersion }) };
    queue.put(op); return op;
  }, false);
}
async function markConflict(op, detail) {
  return annotationTransaction(async (notes, queue) => {
    const current = await requestValue(queue.get(op.opId)), local = await requestValue(notes.get(op.localId));
    if (!current || !local || (op.request && current.request?.operationId !== op.request.operationId)) return;
    current.conflict = true; delete current.request;
    notes.put({ ...local, pending: true, conflict: { kind: 'server', current: detail.current || null,
      reason: detail.reason || detail.error, desiredType: current.type }, localRevision: revision() });
    queue.put(current);
  });
}
async function acknowledge(op, saved) {
  return annotationTransaction(async (notes, queue) => {
    const current = await requestValue(queue.get(op.opId)), local = await requestValue(notes.get(op.localId));
    if (!current || current.request?.operationId !== op.request.operationId) return;
    if (op.request.type === 'delete') { queue.delete(current.opId); if (local) notes.delete(local.id); return; }
    if (!local) throw new Error('durable annotation draft missing');
    if (current.revision === op.request.revision && !current.conflict) {
      notes.put({ ...saved, id: local.id, server_id: saved.id, ownerId: op.ownerId, pending: false,
        localRevision: `server:${saved.id}:${saved.version}` }); queue.delete(current.opId); return;
    }
    const next = { ...current, serverId: saved.id, baseVersion: saved.version, protocol: PROTOCOL };
    delete next.request;
    next.type = local.deletedLocally ? 'delete' : 'update';
    next.changes = draftFields(local);
    const row = { ...local, server_id: saved.id, version: saved.version, pending: true };
    if (row.conflict) row.conflict = { ...row.conflict, current: saved, kind: 'server' };
    notes.put(row); queue.put(next);
  });
}
export async function resolveAnnotationConflict(id, choice, ownerId) {
  if (!['local', 'server', 'copy'].includes(choice)) throw new Error('invalid conflict choice');
  return annotationTransaction(async (notes, queue) => {
    const local = await requestValue(notes.get(id)); requireOwner(local, ownerId);
    const ops = await requestValue(queue.getAll()), op = findOp(ops, id), conflict = local.conflict;
    if (!conflict || !op) return local;
    if (op.request) throw Object.assign(new Error('request acknowledgement pending'), { code: 'SYNC_PENDING' });
    const other = conflict.current;
    for (const item of ops) if (item.localId === id) queue.delete(item.opId);
    if (choice === 'server' && conflict.kind !== 'local') {
      if (other) notes.put({ ...other, id, server_id: other.id, ownerId, pending: false, localRevision: revision() }); else notes.delete(id);
      return;
    }
    if (choice === 'server' && other && !other.pending) {
      notes.put({ ...other, id, ownerId, conflict: undefined, deletedLocally: false, localRevision: revision() }); return;
    }
    const selected = choice === 'server' ? other : local;
    if (choice === 'copy') {
      if (other && versioned(other) && !other.pending) notes.put({ ...other, id, server_id: other.id, ownerId, pending: false, localRevision: revision() });
      else if (other?.pending) {
        const original = { ...other, id, ownerId, conflict: undefined, localRevision: revision() };
        notes.put(original);
        const originalSid = serverId(original);
        queue.put({ opId: revision(), protocol: PROTOCOL, ownerId, localId: id, assetId: original.asset_id,
          type: !originalSid ? 'create' : original.deletedLocally ? 'delete' : 'update',
          serverId: originalSid, baseVersion: original.version, payload: createPayload(original),
          changes: draftFields(original), revision: revision(), createdAt: new Date().toISOString() });
      } else notes.delete(id);
    }
    const copy = choice === 'copy' || (!other && conflict.kind === 'server');
    const targetId = choice === 'copy' ? `offline-${revision()}` : id;
    const sid = copy ? null : (other?.server_id || other?.id || serverId(local));
    const isCreate = !sid || sid.startsWith('offline-');
    if (isCreate && choice === 'local' && conflict.desiredType === 'delete') { notes.delete(id); return; }
    const deleted = !isCreate && choice === 'local' && conflict.desiredType === 'delete';
    const row = { ...selected, id: targetId, ownerId, server_id: isCreate ? null : sid,
      version: isCreate ? undefined : other?.version, conflict: undefined, pending: true,
      deletedLocally: deleted, localRevision: revision() };
    notes.put(row);
    queue.put({ opId: revision(), protocol: PROTOCOL, ownerId, localId: targetId, assetId: row.asset_id,
      type: isCreate ? 'create' : deleted ? 'delete' : 'update', serverId: isCreate ? undefined : sid,
      baseVersion: row.version, payload: createPayload(row), changes: draftFields(row), revision: revision(), createdAt: new Date().toISOString() });
    return row;
  });
}

// Web Locks serialize live tabs. The shared IDB lease also covers browsers/tabs
// without Web Locks. An expired/frozen sender remains safe via immutable server
// receipts, CAS, and acknowledgement checks against the current request ID.
const flushes = new Map();
async function lease(ownerId, token, release = false) {
  return annotationTransaction(async (notes, queue) => {
    const key = `lease:${ownerId}`, current = await requestValue(queue.get(key));
    if (release) { if (current?.token === token) queue.delete(key); return; }
    if (current && current.token !== token && current.expiresAt > Date.now()) return false;
    queue.put({ opId: key, type: 'lease', ownerId, token, expiresAt: Date.now() + 15000 }); return true;
  }, false);
}
export function syncAnnotationOperations(ownerId, request = globalThis.fetch) {
  if (!ownerId) return Promise.resolve({ sent: 0, pending: true });
  if (flushes.has(ownerId)) return flushes.get(ownerId);
  const run = async () => {
    const token = revision(), deadline = Date.now() + 20000;
    while (!await lease(ownerId, token)) {
      if (Date.now() > deadline) return { sent: 0, pending: true, locked: true };
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    const controller = new AbortController(); let renewing = false, renewal = Promise.resolve();
    const timer = setInterval(() => {
      if (renewing) return; renewing = true;
      renewal = (async () => {
      try { if (!await lease(ownerId, token)) controller.abort(); } catch { controller.abort(); }
      finally { renewing = false; }
      })();
    }, 4000);
    let sent = 0;
    try {
      const attempted = new Set();
      for (let count = 0; count < 100 && !controller.signal.aborted; count++) {
        const ops = (await listAnnotationOps()).filter(op => op.ownerId === ownerId && (!op.conflict || op.request))
          .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
        const candidate = ops.find(op => !attempted.has(op.request?.operationId || op.opId));
        if (!candidate) break;
        if (!candidate.request && (candidate.protocol !== PROTOCOL || (candidate.type !== 'create' && !Number.isInteger(candidate.baseVersion)))) {
          let current = null;
          if (candidate.serverId) {
            const res = await request(`/api/annotations/v1?assetId=${encodeURIComponent(candidate.assetId)}&ownerId=${encodeURIComponent(ownerId)}`, { signal: controller.signal });
            if (!res.ok) break;
            current = (await res.json()).find(row => row.id === candidate.serverId) || null;
          }
          await markConflict(candidate, { current, reason: candidate.type === 'create' ? 'legacy_unconfirmed_create' : 'unknown_base_version' });
          continue;
        }
        const op = await freezeOperation(candidate.opId);
        if (!op) continue;
        attempted.add(op.request.operationId);
        const method = { create: 'POST', update: 'PATCH', delete: 'DELETE' }[op.request.type];
        const url = op.request.type === 'create' ? '/api/annotations/v1' : `/api/annotations/v1/${encodeURIComponent(op.request.serverId)}`;
        let response, body;
        try {
          response = await request(url, { method, signal: controller.signal, headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...op.request.payload, operationId: op.request.operationId, ownerId }) });
          body = await response.json();
        } catch { break; }
        if (response.status === 409 || (response.status === 404 && body?.error === 'annotation_not_found' && op.request.type === 'update')) {
          await markConflict(op, body); continue;
        }
        if (response.status === 410 && body?.error === 'operation_expired') {
          await markConflict(op, { reason: 'operation_expired' }); continue;
        }
        if (!response.ok && !(response.status === 404 && body?.error === 'annotation_not_found' && op.request.type === 'delete')) {
          if ([401, 403, 429].includes(response.status)) break;
          continue;
        }
        if (op.request.type !== 'delete' && (!body?.id || !versioned(body))) break;
        await acknowledge(op, body); sent++;
      }
      return { sent, pending: (await listAnnotationOps()).some(op => op.ownerId === ownerId) };
    } finally { clearInterval(timer); await renewal; await lease(ownerId, token, true); }
  };
  const work = globalThis.navigator?.locks?.request
    ? navigator.locks.request(`akademik:annotations:${ownerId}`, { mode: 'exclusive' }, run) : run();
  const promise = work.finally(() => flushes.delete(ownerId)); flushes.set(ownerId, promise); return promise;
}
