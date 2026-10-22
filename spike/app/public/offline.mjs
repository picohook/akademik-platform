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

export async function saveOfflineBook(book, blob) {
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

export async function listLocalAnnotations(assetId) {
  return readAll(ANNOTATIONS, 'asset_id', assetId);
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
