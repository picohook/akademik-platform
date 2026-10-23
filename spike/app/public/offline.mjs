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
}

async function readAll(storeName, indexName = null, key = null) {
  const db = await openDb();
  const tx = db.transaction(storeName, 'readonly');
  const store = tx.objectStore(storeName);
  const request = indexName ? store.index(indexName).getAll(key) : store.getAll();
  const value = await requestValue(request);
  await txDone(tx);
  return value || [];
}

export async function saveOfflineBook(book, blob, { downloadProvenance } = {}) {
  const entry = {
    id: book.id,
    book: {
      id: book.id,
      title: book.title,
      subtitle: book.subtitle || null,
      publisher: book.publisher || null,
      publication_year: book.publication_year || null,
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
  return value;
}

export async function deleteOfflineBook(id) {
  await write(BOOKS, (store) => store.delete(id));
}

export async function storageEstimate() {
  if (!navigator.storage?.estimate) return null;
  return navigator.storage.estimate();
}

export async function listLocalAnnotations(assetId, ownerId) {
  const rows = await readAll(ANNOTATIONS, 'asset_id', assetId);
  return ownerId === undefined ? rows : rows.filter(row => !row.ownerId || row.ownerId === ownerId);
}

export async function saveLocalAnnotation(annotation) {
  await write(ANNOTATIONS, (store) => store.put(annotation));
  return annotation;
}

export async function deleteLocalAnnotation(id) {
  await write(ANNOTATIONS, (store) => store.delete(id));
}

export async function updateLocalAnnotation(annotation) {
  await write(ANNOTATIONS, (store) => store.put(annotation));
}

export async function queueAnnotationOp(operation) {
  await write(QUEUE, (store) => store.put(operation));
}

export async function listAnnotationOps() {
  return readAll(QUEUE);
}

export async function deleteAnnotationOp(opId) {
  await write(QUEUE, (store) => store.delete(opId));
}

export async function removeQueuedCreate(localId) {
  const ops = await listAnnotationOps();
  await Promise.all(ops
    .filter((op) => op.type === 'create' && op.localId === localId)
    .map((op) => deleteAnnotationOp(op.opId)));
}

// Keep the displayed note and its outgoing operation in the same transaction.
// Network requests never run inside an IndexedDB transaction.
async function annotationTransaction(run) {
  const db = await openDb();
  const tx = db.transaction([ANNOTATIONS, QUEUE], 'readwrite');
  const done = txDone(tx);
  try {
    const result = await run(tx.objectStore(ANNOTATIONS), tx.objectStore(QUEUE));
    await done;
    return result;
  } catch (error) {
    try { tx.abort(); } catch { /* already completed */ }
    await done.catch(() => {});
    throw error;
  } finally { db.close(); }
}

export function annotationChanges(changes) {
  const result = {};
  if (Object.hasOwn(changes, 'note')) result.note = String(changes.note || '').trim() || null;
  if (Object.hasOwn(changes, 'tags')) {
    const tags = Array.isArray(changes.tags) ? changes.tags : String(changes.tags || '').split(/[;,]/);
    result.tags = [...new Set(tags.map(tag => String(tag || '').trim()).filter(Boolean))].slice(0, 20);
  }
  if (Object.hasOwn(changes, 'color')) {
    if (!['yellow', 'green', 'blue', 'pink'].includes(changes.color)) throw new Error('invalid annotation color');
    result.color = changes.color;
  }
  if (!Object.keys(result).length) throw new Error('annotation changes required');
  return result;
}

export async function saveAnnotationWithOperation(annotation, operation) {
  await annotationTransaction(async (notes, queue) => {
    notes.put(annotation);
    queue.put({ ...operation, ownerId: annotation.ownerId, revision: crypto.randomUUID() });
  });
}

export async function editLocalAnnotation(id, changes, ownerId) {
  const patch = annotationChanges(changes);
  return annotationTransaction(async (notes, queue) => {
    const local = await requestValue(notes.get(id));
    if (!local) throw new Error('local annotation missing');
    if (!ownerId || local.ownerId !== ownerId) {
      throw Object.assign(new Error('annotation owner not verified'), { code: 'ANNOTATION_OWNER_REQUIRED' });
    }
    const ops = await requestValue(queue.getAll());
    const create = ops.find(op => op.type === 'create' && op.localId === id);
    const previous = ops.find(op => op.type === 'update' && op.localId === id);
    const serverId = local.server_id || (!id.startsWith('offline-') ? id : null);
    if (!create && !serverId) throw new Error('annotation has no queued create or server id');
    const now = new Date().toISOString();
    const operation = create
      ? { ...create, payload: { ...create.payload, ...patch } }
      : { ...previous, opId: previous?.opId || `update:${id}`, type: 'update', localId: id,
        serverId, assetId: local.asset_id, changes: { ...previous?.changes, ...patch }, createdAt: previous?.createdAt || now };
    operation.ownerId = ownerId;
    operation.revision = crypto.randomUUID();
    const edited = { ...local, ...patch, pending: true, updated_at: now };
    notes.put(edited);
    queue.put(operation);
    return edited;
  });
}

export async function removeLocalAnnotationWithOperation(annotation, ownerId) {
  return annotationTransaction(async (notes, queue) => {
    if (annotation.ownerId && annotation.ownerId !== ownerId) throw new Error('annotation owner mismatch');
    const ops = await requestValue(queue.getAll());
    for (const op of ops) if (op.localId === annotation.id) queue.delete(op.opId);
    notes.delete(annotation.id);
    const serverId = annotation.server_id || (!annotation.id.startsWith('offline-') ? annotation.id : null);
    if (serverId) queue.put({ opId: crypto.randomUUID(), type: 'delete', localId: annotation.id,
      serverId, assetId: annotation.asset_id, ownerId: annotation.ownerId || ownerId,
      createdAt: new Date().toISOString(), revision: crypto.randomUUID() });
  });
}

export async function cacheServerAnnotations(assetId, rows, ownerId) {
  if (!ownerId) return listLocalAnnotations(assetId, ownerId);
  return annotationTransaction(async (notes, queue) => {
    const locals = await requestValue(notes.index('asset_id').getAll(assetId));
    const ops = await requestValue(queue.getAll());
    const deleted = new Set(ops.filter(op => op.type === 'delete' && op.ownerId === ownerId).map(op => op.serverId));
    const ids = new Set(rows.map(row => row.id));
    for (const row of rows) {
      if (deleted.has(row.id)) continue;
      const local = locals.find(item => (item.ownerId === ownerId || !item.ownerId)
        && (item.id === row.id || item.server_id === row.id));
      if (local?.pending) continue;
      notes.put({ ...row, id: local?.id || row.id, server_id: row.id, ownerId, pending: false });
    }
    for (const local of locals) {
      if (local.ownerId === ownerId && !local.pending && !ids.has(local.server_id || local.id)) notes.delete(local.id);
    }
  });
}

async function finishAnnotationOperation(operation, saved) {
  return annotationTransaction(async (notes, queue) => {
    const current = await requestValue(queue.get(operation.opId));
    const local = await requestValue(notes.get(operation.localId));
    if (operation.type === 'delete') {
      if (current?.revision === operation.revision) queue.delete(operation.opId);
      return;
    }
    if (!local) {
      // A create can finish after the user has deleted the unsent local note.
      if (operation.type === 'create') queue.put({ opId: crypto.randomUUID(), type: 'delete',
        serverId: saved.id, localId: operation.localId, ownerId: operation.ownerId,
        assetId: operation.assetId, revision: crypto.randomUUID(), createdAt: new Date().toISOString() });
      if (current?.revision === operation.revision) queue.delete(operation.opId);
      return;
    }
    if (current?.revision !== operation.revision) {
      // An edit made during POST must become PATCH, never a second POST.
      if (operation.type === 'create' && current) queue.put({ ...current, type: 'update',
        serverId: saved.id, changes: { note: local.note, tags: local.tags, color: local.color } });
      notes.put({ ...local, server_id: saved.id, pending: Boolean(current) });
      return;
    }
    notes.put({ ...saved, id: local.id, server_id: saved.id, ownerId: operation.ownerId, pending: false });
    queue.delete(operation.opId);
  });
}

let annotationFlush = null;
export function syncAnnotationOperations(ownerId, request = globalThis.fetch) {
  if (!ownerId) return Promise.resolve({ sent: 0, pending: true });
  if (annotationFlush) return annotationFlush;
  annotationFlush = (async () => {
    let sent = 0;
    const attempted = new Set();
    for (let count = 0; count < 100; count += 1) {
      const ops = (await listAnnotationOps()).filter(op => op.ownerId === ownerId)
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      const op = ops.find(item => !attempted.has(`${item.opId}:${item.revision}`));
      if (!op) break;
      attempted.add(`${op.opId}:${op.revision}`);
      const method = { create: 'POST', update: 'PATCH', delete: 'DELETE' }[op.type];
      if (!method) continue;
      const url = op.type === 'create' ? '/api/annotations' : `/api/annotations/${encodeURIComponent(op.serverId)}`;
      let response;
      try {
        response = await request(url, { method, headers: { 'content-type': 'application/json' },
          ...(op.type === 'delete' ? {} : { body: JSON.stringify({ ...(op.type === 'create' ? op.payload : op.changes), ownerId }) }) });
      } catch { break; }
      if (!response.ok && !(op.type === 'delete' && response.status === 404)) {
        if ([401, 403, 429].includes(response.status)) break;
        continue;
      }
      const saved = op.type === 'delete' ? null : await response.json();
      await finishAnnotationOperation(op, saved);
      sent += 1;
    }
    return { sent, pending: (await listAnnotationOps()).some(op => op.ownerId === ownerId) };
  })().finally(() => { annotationFlush = null; });
  return annotationFlush;
}
