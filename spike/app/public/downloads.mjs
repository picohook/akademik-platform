import { bookRequestId } from './book-variants.mjs';
import { saveOfflineBook as persistOfflineBook, storageEstimate as estimateStorage } from './offline.mjs';

export const MAX_OFFLINE_BYTES = 300 * 1024 * 1024;

function failure(code, message) {
  return Object.assign(new Error(message), { code });
}

async function requireSuccess(response) {
  if (response.ok) return;
  const payload = await response.json().catch(() => ({}));
  const error = failure('DOWNLOAD_FAILED', payload.error || `HTTP ${response.status}`);
  error.status = response.status;
  if (response.status === 429) {
    const retryAfter = Number(payload.retryAfter ?? response.headers.get('retry-after'));
    error.retryAfter = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter) : 60;
  }
  throw error;
}

async function boundedBlob(response, maxBytes) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    throw failure('DOWNLOAD_TOO_LARGE', 'download exceeds offline size limit');
  }
  if (!Number.isFinite(maxBytes) || !response.body?.getReader) {
    const blob = await response.blob();
    if (blob.size > maxBytes) throw failure('DOWNLOAD_TOO_LARGE', 'download exceeds offline size limit');
    return blob;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw failure('DOWNLOAD_TOO_LARGE', 'download exceeds offline size limit');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new Blob(chunks, { type: response.headers.get('content-type') || '' });
}

// Raw ticket values live only in these POST request/response bodies. Both normal
// downloads and offline saves use the same server authorization/stamping path.
export async function fetchDownloadBlob(book, { fetch: request = globalThis.fetch, maxBytes = Infinity } = {}) {
  if (!book?.id || book.allow_download === false) {
    throw failure('DOWNLOAD_DISABLED', 'download disabled for this title');
  }
  const endpoint = `/api/books/${encodeURIComponent(bookRequestId(book))}`;
  const options = { method: 'POST', headers: { 'content-type': 'application/json' }, cache: 'no-store', referrerPolicy: 'no-referrer' };
  const issued = await request(`${endpoint}/download-ticket`, { ...options, body: '{}' });
  await requireSuccess(issued);
  const { ticket } = await issued.json();
  if (typeof ticket !== 'string' || !/^[0-9a-f]{64}$/.test(ticket)) {
    throw failure('DOWNLOAD_FAILED', 'invalid download ticket response');
  }
  const response = await request(`${endpoint}/download`, { ...options, body: JSON.stringify({ ticket }) });
  await requireSuccess(response);
  const expected = book.format === 'epub' ? 'application/epub+zip' : 'application/pdf';
  if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== expected) {
    await response.body?.cancel();
    throw failure('DOWNLOAD_FAILED', 'unexpected download content type');
  }
  return boundedBlob(response, maxBytes);
}

export async function saveOfflineDownload(book, {
  fetch: request = globalThis.fetch,
  saveOfflineBook = persistOfflineBook,
  storageEstimate = estimateStorage,
  maxBytes = MAX_OFFLINE_BYTES,
} = {}) {
  const blob = await fetchDownloadBlob(book, { fetch: request, maxBytes });
  const estimate = await storageEstimate();
  if (estimate?.quota && (estimate.usage || 0) + blob.size > estimate.quota * 0.95) {
    throw failure('OFFLINE_QUOTA', 'insufficient offline storage');
  }
  return saveOfflineBook(book, blob, { downloadProvenance: 'ticketed-download-v1' });
}
