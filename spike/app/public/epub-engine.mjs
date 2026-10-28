/* global window */
// EPUB adapter (ADR-012). UI must depend on this contract, not on epub.js
// iframe/DOM details. Keep annotations and search in our own shapes.

import { findFuzzyWord, foldChars } from './search.mjs?v=1';
import { bindEpubLinks, safeBookUrl } from './book-links.mjs';
import { t } from './i18n.mjs?v=23';

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

function isEditable(node) {
  const element = node?.nodeType === 1 ? node : node?.parentElement;
  if (!element) return false;
  if (element.closest?.('input, textarea') || element.isContentEditable) return true;
  const editable = element.closest?.('[contenteditable]');
  return !!editable && editable.getAttribute('contenteditable') !== 'false';
}

// Chapter documents are served as srcdoc, so their origin is opaque and every
// script inside is blocked. A publisher's `<iframe>` (a YouTube embed in the
// catalog's EPUB) therefore cannot render: CSP frame-src is 'self' and nothing
// would run inside the frame anyway. Widening the policy is not an option — the
// reader's contract is script-free chapters — and embedding a third-party frame
// would contact that host and set its cookies from the reader, which the privacy
// rules forbid. So an external embed becomes a link the reader can choose to
// follow, in a new tab, with no referrer.
const EXTERNAL_LINK_TARGET = 'epub-external-link';

function embedAddress(frame) {
  for (const attribute of ['src', 'data-src']) {
    const raw = String(frame.getAttribute?.(attribute) || '').trim();
    if (!raw) continue;
    // Only an absolute https address is offerable: a relative path is a bundle
    // resource a link cannot open, and a non-http scheme is never a destination.
    return /^https:\/\//i.test(raw) ? safeBookUrl(raw) : null;
  }
  return null;
}

// The frame itself goes either way. A frame that cannot render is a blank box the
// reader will try to click; one with no offerable address leaves nothing behind.
function removeEmbed(frame) {
  const root = embedRoot(frame);
  const parent = root.parentNode;
  if (parent) parent.removeChild(root);
}

// `title` is what the publisher said the frame contains, and it is already the
// iframe's accessible name — so it is reused rather than invented. A generic
// label is the fallback, and the host is derived from the URL, never trusted.
function embedLabel(frame, url) {
  const title = String(frame.getAttribute?.('title') || '').replace(/\s+/g, ' ').trim();
  if (title) return title;
  const base = 'Videoyu yeni sekmede aç';
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host ? `${base} (${host})` : base;
  } catch { return base; }
}

function externalLinkCard(doc, url, label) {
  const link = doc.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('target', '_blank');
  link.setAttribute('rel', 'noopener noreferrer');
  link.setAttribute('class', 'app-external-embed');
  link.setAttribute('data-app-link', EXTERNAL_LINK_TARGET);
  // The href is already in the accessibility tree; this only adds the fact that
  // following it leaves the reader, so the card does not look like a chapter link.
  link.setAttribute('aria-label', `${label} (${t('yeni sekmede açılır')})`);
  const text = doc.createElement('span');
  text.textContent = `▶ ${label}`;
  link.appendChild(text);
  return link;
}

const EMBED_WRAPPER = /^(p|div|figure|span|center)$/i;
const HIDDEN = '[hidden], [aria-hidden="true"]';

// One embed often sits in a paragraph of its own, and the paragraph carries the
// publisher's `text-align`/margins. Replacing the innermost element alone would
// leave an empty paragraph behind on the page, so the widest wrapper that holds
// nothing but this frame is replaced instead. `childNodes`, not `children`: a
// formatting-only wrapper is usually ` <iframe/>\n `.
function embedRoot(frame) {
  let root = frame;
  for (let depth = 0; depth < 3; depth += 1) {
    const parent = root.parentNode;
    if (!parent || parent.nodeType !== 1 || !EMBED_WRAPPER.test(parent.tagName || '')) break;
    if (parent.childNodes?.length !== 1) break;
    const hiddenAbove = typeof parent.closest === 'function' && parent.closest(HIDDEN);
    if (hiddenAbove) break;
    root = parent;
  }
  return root;
}

// Idempotent: epub.js rewrites srcdoc/innerHTML on every pagination and resize,
// so this runs again on a document that already holds cards and must not nest
// them.
export function normalizeExternalEmbeds(doc) {
  if (!doc?.querySelectorAll || !doc.createElement) return 0;
  let replaced = 0;
  for (const frame of Array.from(doc.querySelectorAll('iframe'))) {
    // Page-break wrappers hide whole fragments. Rewriting one would turn a hidden
    // video into a visible card and reflow the pagination that hid it.
    const insideHidden = typeof frame.closest === 'function' && frame.closest(HIDDEN);
    if (insideHidden) continue;
    const url = embedAddress(frame);
    if (!url) {
      // Nothing to offer, but the blank box still must not stay on the page.
      removeEmbed(frame);
      continue;
    }
    const card = externalLinkCard(doc, url, embedLabel(frame, url));
    const root = embedRoot(frame);
    if (typeof root.replaceWith === 'function') root.replaceWith(card);
    else root.parentNode?.replaceChild?.(card, root);
    replaced += 1;
  }
  return replaced;
}

// Listen inside each chapter document: clipboard events do not cross iframes.
// Keep selection available for annotations, even when copying is disallowed.
export function bindEpubCopyPolicy(doc, {
  canCopy = () => true,
  onCopyBlocked = () => {},
  onDeselected = () => {},
  onDispose = () => {},
} = {}) {
  // Parent-document pointer events cannot observe clicks inside this iframe.
  // Clear cached toolbar selections before a new chapter interaction starts;
  // a subsequent selection is delivered through rendition's selected event.
  const handlePointerDown = (event) => onDeselected(event);
  const handleCopy = (event) => {
    if (canCopy() || isEditable(event.target) || isEditable(doc.activeElement)) return;
    const selection = doc.getSelection?.() || doc.defaultView?.getSelection?.();
    if (!selection || selection.isCollapsed || !String(selection).trim()) return;
    if (isEditable(selection.anchorNode) || isEditable(selection.focusNode)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    onCopyBlocked(event);
  };
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    doc.removeEventListener('copy', handleCopy, true);
    doc.removeEventListener('cut', handleCopy, true);
    doc.removeEventListener('pointerdown', handlePointerDown, true);
    doc.defaultView?.removeEventListener('pagehide', dispose);
    onDispose();
  };
  doc.addEventListener('copy', handleCopy, true);
  doc.addEventListener('cut', handleCopy, true);
  doc.addEventListener('pointerdown', handlePointerDown, true);
  doc.defaultView?.addEventListener('pagehide', dispose, { once: true });
  return dispose;
}

export class EpubEngine {
  constructor(container, { onRelocated, onSelected, onDeselected, onSwipe, canCopy, onCopyBlocked, onSelectionTools } = {}) {
    this.container = container;
    this.onRelocated = onRelocated || (() => {});
    this.onSelected = onSelected || (() => {});
    this.onDeselected = onDeselected || (() => {});
    this.onSelectionTools = onSelectionTools || (() => {});
    this.onSwipe = onSwipe || (() => {});
    this.canCopy = canCopy || (() => true);
    this.onCopyBlocked = onCopyBlocked || (() => {});
    this.copyPolicyDisposers = new Set();
    this.book = null;
    this.rendition = null;
    this.toc = [];
    this.currentCfi = '';
    this.currentHref = '';
    this.annotations = new Map();
    this.searchHighlights = [];
    this.locationsReady = false;
    this.disposed = false;
  }

  async open(url, initialCfi) {
    const factory = window.ePub;
    if (typeof factory !== 'function') throw new Error('epub.js is not loaded');
    this.book = factory(url);
    await this.book.ready;
    const width = Math.max(320, Math.floor(this.container.clientWidth || this.container.parentElement?.clientWidth || window.innerWidth));
    const height = Math.max(420, Math.floor(this.container.clientHeight || window.innerHeight - 90));
    this.rendition = this.book.renderTo(this.container, {
      width,
      height,
      flow: 'paginated',
      spread: 'none',
      allowScriptedContent: false,
    });
    this.resizeHandler = () => {
      this.resize();
    };
    window.addEventListener('resize', this.resizeHandler);
    this.resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => this.resize())
      : null;
    this.resizeObserver?.observe(this.container);
    this.rendition.on('relocated', (location) => {
      this.currentCfi = location?.start?.cfi || this.currentCfi;
      this.currentHref = location?.start?.href || this.currentHref;
      this.onRelocated(this.getProgress());
    });
    this.rendition.on('selected', (cfiRange, contents) => {
      const text = contents?.window?.getSelection()?.toString() || '';
      if (text.trim()) this.onSelected({ cfiRange, text: text.trim(), contents });
    });
    this.rendition.hooks.content.register((contents) => {
      let start = null;
      const doc = contents.document;
      const disposeLinks = bindEpubLinks(doc, href => {
        if (!this.disposed) window.open(href, '_blank', 'noopener,noreferrer');
      });
      const handleSelectionTools = event => {
        if (event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey
            && (event.code === 'KeyH' || event.key?.toLowerCase() === 'h')) {
          event.preventDefault();
          this.onSelectionTools();
        }
      };
      doc.addEventListener('keydown', handleSelectionTools);
      // epub.js rewrites this tag on pagination/resize. Keep its dimensions,
      // but never let a publisher or the pagination engine disable text zoom.
      const allowZoom = () => {
        const viewport = doc.querySelector('meta[name="viewport"]');
        if (!viewport) return;
        const content = viewport.content.split(',').map(part => part.trim())
          .filter(part => !/^(user-scalable|maximum-scale|minimum-scale)\s*=/i.test(part)).join(', ');
        if (viewport.content !== content) viewport.content = content;
      };
      const viewportObserver = new MutationObserver(allowZoom);
      viewportObserver.observe(doc.head, { childList: true, subtree: true, attributes: true, attributeFilter: ['content'] });
      allowZoom();
      // epub.js assigns srcdoc again on every pagination/resize, which throws the
      // rewritten chapter away. Re-applying after each batch makes the cards
      // survive that, and normalizeExternalEmbeds() is idempotent so re-running it
      // over an already-normalized document costs nothing.
      normalizeExternalEmbeds(doc);
      // A chapter is served as srcdoc and epub.js replaces the whole body on every
      // pagination/resize, so only the body it hands over now can be watched. When
      // the reference moves, the next contents event observes the new one.
      const body = contents.body || doc.body;
      const embedObserver = body ? new MutationObserver(() => normalizeExternalEmbeds(doc)) : null;
      embedObserver?.observe(body, { childList: true, subtree: true });
      const dispose = bindEpubCopyPolicy(doc, {
        canCopy: () => this.canCopy(),
        onCopyBlocked: (event) => this.onCopyBlocked(event),
        onDeselected: (event) => this.onDeselected(event),
        onDispose: () => {
          disposeLinks();
          viewportObserver.disconnect();
          embedObserver?.disconnect();
          doc.removeEventListener('keydown', handleSelectionTools);
          this.copyPolicyDisposers.delete(dispose);
        },
      });
      this.copyPolicyDisposers.add(dispose);
      doc.addEventListener('touchstart', (event) => {
        if (event.touches.length !== 1 || event.target.closest('a, button, input, select, textarea')) {
          start = null;
          return;
        }
        start = { x: event.touches[0].clientX, y: event.touches[0].clientY };
      }, { passive: true });
      doc.addEventListener('touchend', (event) => {
        if (!start || !event.changedTouches.length) return;
        const dx = event.changedTouches[0].clientX - start.x;
        const dy = event.changedTouches[0].clientY - start.y;
        start = null;
        if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.4) this.onSwipe(dx < 0 ? 1 : -1);
      }, { passive: true });
    });
    await this.rendition.display(initialCfi || undefined);
    this.resize();
    const navigation = await this.book.loaded.navigation;
    this.toc = flattenToc(navigation.toc);
    this.locationsReady = await this.book.locations.generate(1200).then(() => true).catch(() => false);
    return this;
  }

  resize() {
    // renderTo() creates its manager asynchronously; ResizeObserver can run first.
    // The display completion calls resize() again once the manager is ready.
    if (this.disposed || !this.rendition?.manager) return;
    const width = Math.max(320, Math.floor(this.container.clientWidth || window.innerWidth));
    const height = Math.max(420, Math.floor(this.container.clientHeight || window.innerHeight - 90));
    if (this.lastSize && Math.abs(this.lastSize.width - width) < 2 && Math.abs(this.lastSize.height - height) < 2) return;
    this.lastSize = { width, height };
    this.rendition.resize(width, height);
  }

  destroy() {
    this.disposed = true;
    for (const dispose of this.copyPolicyDisposers) dispose();
    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (this.resizeHandler) window.removeEventListener('resize', this.resizeHandler);
    try { this.rendition?.destroy(); } catch { /* noop */ }
    try { this.book?.destroy(); } catch { /* noop */ }
    this.rendition = null;
    this.book = null;
  }

  getSelection() {
    for (const contents of this.rendition?.getContents() || []) {
      const selection = contents.window.getSelection();
      if (!selection?.rangeCount || selection.isCollapsed || !String(selection).trim()) continue;
      return { cfiRange: contents.cfiFromRange(selection.getRangeAt(0)), text: String(selection).trim(), contents };
    }
    return null;
  }

  getToc() {
    return this.toc;
  }

  getSpineCount() {
    return this.book?.spine?.spineItems?.length || this.book?.spine?.length || 0;
  }

  async goToCfi(cfi) {
    if (!this.rendition || !cfi) return;
    await this.rendition.display(cfi);
  }

  async goToHref(href) {
    if (!this.rendition || !href) return;
    const clean = (value) => {
      try {
        return decodeURIComponent(String(value || '').split('#')[0]).replace(/^\.?\//, '');
      } catch {
        return String(value || '').split('#')[0].replace(/^\.?\//, '');
      }
    };
    const target = clean(href);
    const section = (this.book?.spine?.spineItems || []).find((item) => {
      const itemHref = clean(item.href);
      return itemHref === target || itemHref.endsWith(`/${target}`) || target.endsWith(`/${itemHref}`);
    });
    await this.rendition.display(section ? section.href : href);
  }

  async goToSpineIndex(index) {
    const section = this.book?.spine?.spineItems?.[Number(index) - 1];
    if (section) await this.rendition.display(section.href);
  }

  async goToSearchHit({ href, page }) {
    if (!this.rendition) return;
    const clean = (value) => {
      try {
        return decodeURIComponent(String(value || '').split('#')[0]).replace(/^\.?\//, '');
      } catch {
        return String(value || '').split('#')[0].replace(/^\.?\//, '');
      }
    };
    const target = clean(href);
    const sections = this.book?.spine?.spineItems || [];
    let section = target
      ? sections.find((item) => {
        const itemHref = clean(item.href);
        return itemHref === target || itemHref.endsWith(`/${target}`) || target.endsWith(`/${itemHref}`);
      })
      : null;
    if (!section && target) {
      try { section = this.book.spine.get(href); } catch { /* noop */ }
    }
    if (!section) section = sections[Number(page) - 1];
    if (section) {
      await this.rendition.display(section.href);
    } else if (href) {
      await this.rendition.display(href);
    }
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

  getCurrentRange() {
    const location = this.rendition?.currentLocation?.();
    return {
      start: location?.start?.cfi || this.currentCfi || null,
      end: location?.end?.cfi || null,
      href: location?.start?.href || this.currentHref || null,
    };
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

  clearSearchHighlights() {
    if (!this.rendition) return;
    for (const cfi of this.searchHighlights) {
      try { this.rendition.annotations.remove(cfi, 'highlight'); } catch { /* noop */ }
    }
    this.searchHighlights = [];
  }

  findMatchCfi(query, { fuzzy = false } = {}) {
    if (!this.rendition || !query) return null;
    const needle = foldChars(query);
    for (const contents of this.rendition.getContents() || []) {
      const section = this.book?.spine?.spineItems?.[contents.sectionIndex];
      const doc = contents.document;
      if (!section || !doc?.body) continue;
      const walker = doc.createTreeWalker(doc.body, 4);
      let node = walker.nextNode();
      while (node) {
        const text = node.textContent || '';
        const lower = foldChars(text);
        const match = fuzzy
          ? findFuzzyWord(lower, needle)
          : (() => {
            const index = lower.indexOf(needle);
            return index >= 0 ? { index, length: needle.length } : null;
          })();
        if (match) {
          try {
            const range = doc.createRange();
            range.setStart(node, match.index);
            range.setEnd(node, match.index + match.length);
            return {
              cfi: section.cfiFromRange(range),
              node,
              index: match.index,
              length: match.length,
            };
          } catch {
            return null;
          }
        }
        node = walker.nextNode();
      }
    }
    return null;
  }

  async goToMatch(query, { fuzzy = false } = {}) {
    const match = this.findMatchCfi(query, { fuzzy });
    if (!match) return false;
    await this.rendition.display(match.cfi);
    // Some paginated layouts keep the chapter start even when the CFI target
    // is inside it; nudge the actual text node into view as a fallback.
    try {
      const contents = this.rendition.getContents()?.[0];
      const range = contents?.range?.(match.cfi);
      const rect = range?.getBoundingClientRect?.();
      const height = contents?.window?.innerHeight || 0;
      if (rect && height && (rect.top < 0 || rect.bottom > height)) {
        range.startContainer.parentElement?.scrollIntoView({ block: 'center', inline: 'center' });
      }
    } catch { /* layout fallback */ }
    return true;
  }

  highlightSearch(query, { fuzzy = false } = {}) {
    this.clearSearchHighlights();
    const needle = foldChars(query);
    if (!needle || !this.rendition) return 0;
    let count = 0;
    for (const contents of this.rendition.getContents() || []) {
      const section = this.book?.spine?.spineItems?.[contents.sectionIndex];
      const doc = contents.document;
      if (!section || !doc?.body) continue;
      const walker = doc.createTreeWalker(doc.body, 4);
      let node = walker.nextNode();
      while (node && count < 200) {
        const text = node.textContent || '';
        const lower = foldChars(text);
        let from = 0;
        let match = fuzzy
          ? findFuzzyWord(lower, needle, from)
          : (() => {
            const index = lower.indexOf(needle, from);
            return index >= 0 ? { index, length: needle.length } : null;
          })();
        while (match && count < 200) {
          try {
            const range = doc.createRange();
            range.setStart(node, match.index);
            range.setEnd(node, match.index + match.length);
            const cfi = section.cfiFromRange(range);
            this.rendition.annotations.highlight(
              cfi,
              { search: needle },
              undefined,
              'epub-search-hit',
              { fill: 'rgba(255, 150, 0, 0.45)', 'fill-opacity': '1' },
            );
            this.searchHighlights.push(cfi);
            count += 1;
          } catch { /* invalid range */ }
          from = match.index + match.length;
          match = fuzzy
            ? findFuzzyWord(lower, needle, from)
            : (() => {
              const index = lower.indexOf(needle, from);
              return index >= 0 ? { index, length: needle.length } : null;
            })();
        }
        node = walker.nextNode();
      }
    }
    return count;
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
