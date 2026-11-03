// A passage sent from the reader to the research board's inbox. The board checks every field, so
// this builds exactly the shape it accepts: limits, link forms and the cover path are the board's.

const MAX_TEXT = 2000;

const clip = (value, max) => String(value ?? '').trim().slice(0, max);

function authorNames(book) {
  const authors = Array.isArray(book?.metadata?.authors) ? book.metadata.authors : [];
  const names = [];
  for (const author of authors) {
    const name = typeof author === 'string'
      ? author
      : [author?.given, author?.family].filter(Boolean).join(' ') || author?.name || '';
    const trimmed = clip(name, 200);
    if (trimmed) names.push(trimmed);
    if (names.length === 20) break;
  }
  return names;
}

export function boardQuoteText(raw) {
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim();
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1).trimEnd()}…` : text;
}

// book: the reader's book row; selection: { text, page } for a PDF or { text, cfiRange, chapter }
// for an EPUB; assetId: the id the reader puts in its own address (bookRequestId).
export function boardQuotePayload(book, selection, { origin, assetId }) {
  const text = boardQuoteText(selection?.text);
  if (!text || !book?.id || !origin) return null;
  const link = new URL('/', origin);
  link.searchParams.set('book', book.id);
  if (assetId) link.searchParams.set('asset', assetId);
  const page = Number.isInteger(selection.page) && selection.page > 0 && selection.page <= 100000 ? selection.page : null;
  if (page) link.searchParams.set('page', String(page));
  else if (typeof selection.cfiRange === 'string' && selection.cfiRange && selection.cfiRange.length <= 300) link.searchParams.set('cfi', selection.cfiRange);
  const payload = {
    source: 'elibrary',
    work_id: book.id,
    title: clip(book.title, 500) || 'Başlıksız kaynak',
    authors: authorNames(book),
    subjects: (Array.isArray(book.subjects) ? book.subjects : []).map((subject) => clip(subject, 200)).filter(Boolean).slice(0, 8),
    publisher: clip(book.publisher, 200),
    language: clip(book.language, 16),
    cover_url: null,
    reader_url: link.href,
    text,
    locator: clip(selection.chapter, 300),
  };
  if (assetId) payload.asset_id = assetId;
  const year = Number(book.publication_year);
  if (Number.isInteger(year) && year > 0 && year < 10000) payload.year = year;
  if (page) payload.page = page;
  const cover = book.metadata?.cover;
  if (cover && /^\d{1,16}$/.test(String(cover.version ?? ''))) {
    payload.cover_url = new URL(`/api/books/${encodeURIComponent(book.id)}/cover?v=${cover.version}`, origin).href;
  }
  return payload;
}
