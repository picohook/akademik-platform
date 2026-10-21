/* global window */
// EPUB adapter (ADR-012). UI must depend on this contract, not on epub.js
// iframe/DOM details. Keep annotations and search in our own shapes.

const THEMES = {
  light: { body: { background: '#ffffff', color: '#222222' } },
  sepia: { body: { background: '#f3ead7', color: '#3b3225' } },
  dark: { body: { background: '#1b1a17', color: '#ece5d8' } },
};

function flattenToc(items, level = 0) {
  const result = [];
  for (const item of items || []) {
    result.push({
      label: String(item.label || '').trim(),
      href: item.href || '',
      level,
    });
    if (item.subitems?.length) result.push(...flattenToc(item.subitems, level + 1));
  }
  return result;
}

function normalize(value) {
  return String(value || '').toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim();
}

export class EpubEngine {
  constructor(container, { onRelocated } = {}) {
    this.container = container;
    this.onRelocated = onRelocated || (() => {});
    this.book = null;
    this.rendition = null;
    this.toc = [];
    this.currentCfi = '';
    this.currentHref = '';
    this.annotations = new Map();
    this.locationsReady = false;
    this.disposed = false;
  }

  async open(url, initialCfi) {
    const factory = window.ePub;
    if (typeof factory !== 'function') throw new Error('epub.js is not loaded');
    this.book = factory(url);
    await this.book.ready;
    this.rendition = this.book.renderTo(this.container, {
      width: '100%',
      height: '100%',
      flow: 'paginated',
      spread: 'auto',
      allowScriptedContent: false,
    });
    this.rendition.on('relocated', (location) => {
      this.currentCfi = location?.start?.cfi || this.currentCfi;
      this.currentHref = location?.start?.href || this.currentHref;
      this.onRelocated(this.getProgress());
    });
    await this.rendition.display(initialCfi || undefined);
    const navigation = await this.book.loaded.navigation;
    this.toc = flattenToc(navigation.toc);
    this.locationsReady = await this.book.locations.generate(1200).then(() => true).catch(() => false);
    return this;
  }

  destroy() {
    this.disposed = true;
    try { this.rendition?.destroy(); } catch { /* noop */ }
    try { this.book?.destroy(); } catch { /* noop */ }
    this.rendition = null;
    this.book = null;
  }

  getToc() {
    return this.toc;
  }

  async goToCfi(cfi) {
    if (!this.rendition || !cfi) return;
    await this.rendition.display(cfi);
  }

  async goToHref(href) {
    if (!this.rendition || !href) return;
    await this.rendition.display(href);
  }

  async next() {
    await this.rendition?.next();
  }

  async prev() {
    await this.rendition?.prev();
  }

  getCurrentCfi() {
    return this.currentCfi;
  }

  getProgress() {
    const percent = this.locationsReady && this.currentCfi
      ? Math.round(this.book.locations.percentageFromCfi(this.currentCfi) * 100)
      : 0;
    return {
      cfi: this.currentCfi,
      href: this.currentHref,
      percent: Number.isFinite(percent) ? percent : 0,
    };
  }

  async search(query, { limit = 50 } = {}) {
    const needle = normalize(query);
    if (!needle || !this.book) return [];
    const results = [];
    const sections = this.book.spine.spineItems || [];
    for (const section of sections) {
      if (results.length >= limit) break;
      try {
        await section.load(this.book.load.bind(this.book));
        const text = section.document?.body?.textContent || '';
        const index = normalize(text).indexOf(needle);
        if (index >= 0) {
          results.push({
            href: section.href,
            cfi: this.currentCfi,
            snippet: text.slice(Math.max(0, index - 45), index + needle.length + 45).trim(),
          });
        }
      } finally {
        try { section.unload(); } catch { /* noop */ }
      }
    }
    return results;
  }

  addAnnotation({ id, cfiRange, color = '#ffc700', note = '' }) {
    if (!this.rendition || !cfiRange) return;
    this.annotations.set(id, cfiRange);
    this.rendition.annotations.add(
      'highlight',
      cfiRange,
      { id, note },
      undefined,
      'app-epub-highlight',
      { fill: color, 'fill-opacity': '0.32', 'mix-blend-mode': 'multiply' },
    );
  }

  updateAnnotation({ id, color }) {
    const cfiRange = this.annotations.get(id);
    if (!cfiRange || !color) return;
    this.rendition.annotations.remove(cfiRange, 'highlight');
    this.rendition.annotations.add(
      'highlight',
      cfiRange,
      { id },
      undefined,
      'app-epub-highlight',
      { fill: color, 'fill-opacity': '0.32', 'mix-blend-mode': 'multiply' },
    );
  }

  removeAnnotation(id) {
    const cfiRange = this.annotations.get(id);
    if (!cfiRange || !this.rendition) return;
    this.rendition.annotations.remove(cfiRange, 'highlight');
    this.annotations.delete(id);
  }

  setTheme(theme) {
    if (!this.rendition) return;
    const name = `app-${theme}`;
    this.rendition.themes.register(name, THEMES[theme] || THEMES.light);
    this.rendition.themes.select(name);
  }

  setFontSize(percent) {
    this.rendition?.themes.fontSize(`${Math.min(200, Math.max(70, percent))}%`);
  }
}
