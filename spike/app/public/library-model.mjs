// Shared by the HTTP catalogue and its browser controls. Turkish ordering is
// deliberate even when the interface language is English.
const collator = new Intl.Collator('tr', { sensitivity: 'base', numeric: true });
export const SORTS = ['', 'title-asc', 'title-desc', 'newest', 'author-asc'];

export function authorName(book) {
  const authors = book.metadata?.authors;
  return (Array.isArray(authors) ? authors : []).map(author => {
    if (typeof author === 'string') return author;
    return author && [author.family, author.given].filter(Boolean).join(', ');
  }).filter(Boolean).join('; ');
}

export function sortBooks(books, sort = '') {
  const result = [...books];
  const title = (a, b) => collator.compare(a.title || '', b.title || '') || collator.compare(a.id, b.id);
  if (sort === 'title-asc') result.sort(title);
  if (sort === 'title-desc') result.sort((a, b) => -title(a, b));
  if (sort === 'author-asc') result.sort((a, b) => {
    const left = authorName(a), right = authorName(b);
    return Number(!left) - Number(!right) || collator.compare(left, right) || title(a, b);
  });
  if (sort === 'newest') result.sort((a, b) => {
    const date = book => Date.parse(book.created_at) || 0;
    const year = book => Number(book.publication_year) || new Date(date(book)).getUTCFullYear();
    return year(b) - year(a) || date(b) - date(a) || title(a, b);
  });
  return result;
}

export function filterBooks(books, { language = '', publisher = '', from = '', to = '' } = {}) {
  return books.filter(book => (!language || book.language === language)
    && (!publisher || book.publisher === publisher)
    && (!from || (book.publication_year != null && Number(book.publication_year) >= Number(from)))
    && (!to || (book.publication_year != null && Number(book.publication_year) <= Number(to))));
}
