// Cover pictures for the catalogue.
//
// 1. A cover an editor uploaded (works.metadata.cover = { version, ratio }) is fetched from the book's own cover
//    endpoint, which applies the same access check as the book.
// 2. Otherwise the local covers of the LibEdge Open Academic Collection (from the design package, see
//    covers/SOURCES.md) are found by title; ids are never used. Everything is served from this site.
// A book with neither keeps the typographic cover. `note` is shown on the cover when it is not the book's own
// front cover.

const COVERS = [
  { match: /go-gn research methods/i, file: 'real-book-01.webp', ratio: 0.70789 },
  { match: /guide to responsible research/i, file: 'real-book-02.webp', ratio: 0.66372 },
  { match: /research methods and statistics with jamovi/i, file: 'publisher-book-03.webp', ratio: 0.66133 },
  { match: /derin öğrenmeye dalış/i, file: 'publisher-book-07-en.webp', ratio: 0.80062, note: ['İngilizce baskı kapağı', 'English edition cover'] },
  { match: /dive into deep learning/i, file: 'publisher-book-07-en.webp', ratio: 0.80062 },
  { match: /open science training handbook/i, file: 'catalogue-book-06.svg', ratio: 0.70588, note: ['Temsili kapak', 'Catalogue placeholder'] },
  { match: /scientific writing for health research/i, file: 'catalogue-book-05.svg', ratio: 0.70588, note: ['Temsili kapak', 'Catalogue placeholder'] },
  { match: /automated machine learning/i, file: 'real-book-08.webp', ratio: 0.64309 },
  { match: /^linear algebra\b/i, file: 'real-book-09.webp', ratio: 0.81081 },
  { match: /discrete mathematics/i, file: 'real-book-10.webp', ratio: 0.6993 },
  { match: /forall\s*x/i, file: 'real-book-11.webp', ratio: 0.625 },
];

export function coverFor(book) {
  const uploaded = book?.metadata?.cover;
  if (uploaded?.version && book.id) {
    const ratio = Number(uploaded.ratio);
    return { src: `/api/books/${encodeURIComponent(book.id)}/cover?v=${encodeURIComponent(uploaded.version)}`, ratio: ratio > 0.2 && ratio < 5 ? ratio : 0.706, note: null };
  }
  const title = String(book?.title || '').trim();
  const hit = COVERS.find((entry) => entry.match.test(title));
  return hit ? { src: `/covers/${hit.file}`, ratio: hit.ratio, note: hit.note || null } : null;
}
