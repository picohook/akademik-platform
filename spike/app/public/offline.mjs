// IndexedDB storage for downloaded books. Files never go through the service
// worker cache; this keeps quota usage explicit and lets the reader open blobs
// without a server round-trip.
const DB_NAME = 'akademik-offline';
const DB_VERSION = 1;
const STORE = 'books';

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
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
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).put(entry);
  await txDone(tx);
  return entry;
}

export async function listOfflineBooks() {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readonly');
  const entries = await requestValue(tx.objectStore(STORE).getAll());
  await txDone(tx);
  return (entries || []).map(({ blob, ...entry }) => ({ ...entry, hasBlob: Boolean(blob) }));
}

export async function getOfflineBook(id) {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readonly');
  const value = await requestValue(tx.objectStore(STORE).get(id));
  await txDone(tx);
  return value;
}

export async function deleteOfflineBook(id) {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).delete(id);
  await txDone(tx);
}

export async function storageEstimate() {
  if (!navigator.storage?.estimate) return null;
  return navigator.storage.estimate();
}
