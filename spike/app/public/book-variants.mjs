// A work is the catalog identity; an asset is the reading/annotation identity.
const text = (value, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback;

export function normalizeBookVariant(book) {
  const details = book.metadata?.asset_variants?.[book.asset_id] || {};
  return {
    ...book,
    work_title: book.work_title || book.title,
    title: text(details.title, book.title),
    subtitle: details.title && details.title !== (book.work_title || book.title) ? null : book.subtitle,
    language: text(details.language, book.language || 'tr').toLowerCase(),
    format: book.format || 'pdf',
    edition: text(book.edition, text(details.edition)),
    publication_year: book.publication_year ?? details.year ?? null,
  };
}

export function bookRequestId(book) {
  return book.asset_id || book.id;
}

export const offlineBookKey = bookRequestId;

export function groupBookVariants(books, preferredLanguage = 'tr', selections = new Map()) {
  const groups = new Map();
  for (const row of books) {
    const book = normalizeBookVariant(row);
    if (!groups.has(book.id)) groups.set(book.id, []);
    const variants = groups.get(book.id);
    if (!variants.some(item => bookRequestId(item) === bookRequestId(book))) variants.push(book);
  }
  return [...groups].map(([id, variants]) => {
    const selected = variants.find(book => bookRequestId(book) === selections.get(id))
      || variants.find(book => book.language.split('-')[0] === preferredLanguage)
      || variants[0];
    return { book: selected, variants };
  });
}

export function variantLabel(book, locale = 'tr') {
  let language = book.language || 'tr';
  try { language = new Intl.DisplayNames([locale], { type: 'language' }).of(language); } catch { /* raw language code */ }
  return [language, String(book.format || 'pdf').toUpperCase(), book.publication_year, book.edition]
    .filter(Boolean).join(' · ');
}

export function locationMatchesBook(params, book) {
  const id = params.get('book');
  return (id === book.id || id === book.asset_id)
    && (!params.has('asset') || params.get('asset') === bookRequestId(book));
}

export function bookFromLocation(books, params) {
  return books.find(book => locationMatchesBook(params, book)) || null;
}

// Legacy entries were keyed by work ID. Only reuse them for their actual asset.
export async function findOfflineVariant(book, getEntry) {
  const id = offlineBookKey(book);
  let stored = await getEntry(id);
  if (!stored && id !== book.id) stored = await getEntry(book.id);
  return stored && stored.book?.asset_id === book.asset_id ? stored : null;
}
