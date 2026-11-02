// Local cover images for the LibEdge Open Academic Collection (from the design package, see docs/library-designs.md).
// There is no cover column in the catalogue yet, so a cover is found by the work's title; ids are never used.
// Every file is served from /covers/ (nothing is fetched from another site). A book without an entry keeps the
// typographic cover. `note` is shown on the cover when it is not the book's own front cover.

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
  const title = String(book?.title || '').trim();
  const hit = COVERS.find((entry) => entry.match.test(title));
  return hit ? { src: `/covers/${hit.file}`, ratio: hit.ratio, note: hit.note || null } : null;
}
