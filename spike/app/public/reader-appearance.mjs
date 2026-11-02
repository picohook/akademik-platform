// Reading settings of an EPUB: the typeface, the line spacing and the width of the text. Pure functions, so the
// choices can be checked without a browser; app.js stores them and epub-engine.mjs applies the rules.
//
// 'default' keeps what the publisher set: a book is never restyled until its reader chooses to.

export const FONTS = {
  default: null,
  serif: 'Georgia, "Times New Roman", serif',
  sans: 'system-ui, -apple-system, "Segoe UI", Arial, sans-serif',
};
export const LINES = ['default', '1.5', '1.75', '2'];
export const MEASURES = ['auto', 'narrow', 'medium', 'wide'];
export const DEFAULT_TYPOGRAPHY = Object.freeze({ font: 'default', line: 'default', measure: 'auto' });

const pick = (value, allowed, fallback) => (typeof value === 'string' && allowed.includes(value) ? value : fallback);

// Anything read from storage is untrusted: unknown values fall back to the defaults, one key at a time.
export function normalizeTypography(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    font: pick(source.font, Object.keys(FONTS), DEFAULT_TYPOGRAPHY.font),
    line: pick(source.line, LINES, DEFAULT_TYPOGRAPHY.line),
    measure: pick(source.measure, MEASURES, DEFAULT_TYPOGRAPHY.measure),
  };
}

export const isDefaultTypography = (typography) => {
  const value = normalizeTypography(typography);
  return Object.keys(DEFAULT_TYPOGRAPHY).every((key) => value[key] === DEFAULT_TYPOGRAPHY[key]);
};

const TEXT_SELECTOR = 'body, p, li, blockquote, td, th, dd, dt, figcaption, span, div';

// The style rules for the book's own document; an empty object when nothing is overridden. The width is not
// here: it is the width of the reading pane, which the page sets.
export function typographyRules(typography) {
  const value = normalizeTypography(typography);
  const rule = {};
  if (FONTS[value.font]) rule['font-family'] = `${FONTS[value.font]} !important`;
  if (value.line !== 'default') rule['line-height'] = `${value.line} !important`;
  return Object.keys(rule).length ? { [TEXT_SELECTOR]: rule } : {};
}

export function loadTypography(storage, key) {
  try {
    return normalizeTypography(JSON.parse(storage.getItem(key) || 'null'));
  } catch {
    return { ...DEFAULT_TYPOGRAPHY };
  }
}

export function saveTypography(storage, key, typography) {
  try {
    if (isDefaultTypography(typography)) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(normalizeTypography(typography)));
  } catch { /* private mode: the choice lasts for this visit only */ }
}

// The bookmarks of a book as a file: where each one is and, for a reader's own notes, nothing else is added.
// `place` turns an annotation into the label the reader sees (a page, or a chapter and a position).
export function bookmarksExport(book, annotations, format, { place, now = new Date() } = {}) {
  const bookmarks = annotations.filter((item) => item.color === 'bookmark');
  const label = (item) => (typeof place === 'function' ? place(item) : '') || '—';
  if (format === 'json') {
    return {
      type: 'application/json',
      body: JSON.stringify({
        exported_at: now.toISOString(),
        book: { id: book.id, title: book.title, subtitle: book.subtitle || null, publisher: book.publisher || null, publication_year: book.publication_year || null, asset_id: book.asset_id },
        bookmarks: bookmarks.map((item) => ({ id: item.id, place: label(item), anchor: item.anchor, created_at: item.created_at || null })),
      }, null, 2),
    };
  }
  const lines = [`# ${book.title}`, '', [book.publisher, book.publication_year].filter(Boolean).join(' · '), '', `## ${bookmarks.length}`, ''];
  for (const item of bookmarks) lines.push(`- ${label(item)}`);
  return { type: 'text/markdown;charset=utf-8', body: `${lines.join('\n')}\n` };
}
