// What "Sesli oku" reads, per book type. Each source turns what the reader is showing into
// sentences, highlights the sentence being spoken, and knows how to reach the text after it
// (next page, next chapter). The playback logic itself is in read-aloud.mjs.
//
// Both sources read the text that is already on the screen (the PDF text layer, which holds the
// OCR layer for scanned books, and the EPUB document). Nothing is fetched from the server.

import { splitSentences } from './read-aloud.mjs';

const ACTIVE_CLASS = 'ra-active';
const MAX_EMPTY_PAGES = 6;

const isLower = (text) => {
  const first = String(text).trimStart().match(/\p{L}/u)?.[0];
  return Boolean(first) && first === first.toLocaleLowerCase('tr') && first !== first.toLocaleUpperCase('tr');
};

// First sentence that ends after `offset`, or 0.
function sentenceIndexAt(sentences, offset) {
  if (!Number.isFinite(offset) || offset < 0) return 0;
  const found = sentences.findIndex((s) => s.end > offset);
  return found < 0 ? 0 : found;
}

// A selection is found again in the page text by its first words, whitespace-flexibly.
function findSelectionOffset(text, selected) {
  const words = String(selected || '').trim().split(/\s+/).filter(Boolean).slice(0, 6);
  if (!words.length) return -1;
  const escaped = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  try { return text.search(new RegExp(escaped.join('\\s+'), 'u')); } catch { return -1; }
}

// The text as it is spoken (whitespace collapsed, trimmed) and, for each spoken character, its index in the raw
// stretch. A word the voice reports (by spoken index) can then be turned back into a place on the page.
export function spokenWithMap(raw) {
  const map = [];
  let text = '';
  let gap = -1;
  const source = String(raw ?? '');
  for (let i = 0; i < source.length; i += 1) {
    if (/\s/.test(source[i])) { if (text && gap < 0) gap = i; continue; }
    if (gap >= 0) { text += ' '; map.push(gap); gap = -1; }
    text += source[i];
    map.push(i);
  }
  return { text, map };
}

// The CSS Custom Highlight API: a marker over a Range that does not touch the page's DOM (no spans added to
// the PDF text layer, no wrapping inside the book). One highlight for the sentence, a stronger one for the word.
// Where it is not available (older Safari and Firefox) the reader keeps the coarser highlight of whole text
// fragments and does not follow words.
export function createHighlighter(win, doc) {
  const registry = win?.CSS?.highlights;
  const supported = Boolean(registry && typeof win.Highlight === 'function' && doc);
  const put = (name, range) => {
    if (!supported) return;
    if (!range) registry.delete(name);
    else registry.set(name, new win.Highlight(range));
  };
  return { supported, sentence: (range) => put('ra-sentence', range), word: (range) => put('ra-word', range) };
}

export const HIGHLIGHT_CSS = '::highlight(ra-sentence){background-color:rgba(255,196,0,0.30)}::highlight(ra-word){background-color:rgba(255,140,0,0.65)}';
function ensureHighlightStyle(doc) {
  if (doc.querySelector('style[data-ra]')) return;
  const style = doc.createElement('style');
  style.setAttribute('data-ra', '');
  style.textContent = HIGHLIGHT_CSS;
  (doc.head || doc.documentElement).appendChild(style);
}

// ---- page furniture: page numbers, running headers and footers ----------------------------

const ROMAN = /^[ivxlcdm]{1,8}$/i;
// "12", "- 12 -", "Page 12", "Sayfa 12", "12 / 300", "xiv": a page number on its own.
export function isPageNumberText(text) {
  const t = String(text || '').trim().replace(/^[-–—·•\s]+|[-–—·•\s]+$/g, '');
  if (!t || t.length > 24) return false;
  if (/^\d{1,5}$/.test(t)) return true;
  if (/^(?:page|pg|p|sayfa|s)\.?\s*\d{1,5}(?:\s*(?:\/|of|\|)\s*\d{1,5})?$/i.test(t)) return true;
  if (/^\d{1,5}\s*(?:\/|of)\s*\d{1,5}$/i.test(t)) return true;
  return ROMAN.test(t);
}

// The same running title with a different page number must compare equal: digits become "#".
export function normalizeBandText(text) {
  const t = String(text || '').toLocaleLowerCase('tr').replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 100 || !/[\p{L}#]/u.test(t)) return '';
  return t;
}

// ---- PDF ---------------------------------------------------------------------------------

// Leaf text spans of a pdf.js / OCR text layer, in reading order.
function leafSpans(layer) {
  return [...layer.querySelectorAll('span')].filter((el) => !el.querySelector('span') && (el.textContent || '').trim());
}

// Joins spans into one string and remembers which span holds which characters. A word split by a
// hyphen at a line end is joined again ("pro-" + "gramme" -> "programme") so it is read as a word.
export function textFromSpans(spans) {
  let text = '';
  const map = [];
  for (const el of spans) {
    const raw = el.textContent || '';
    const piece = raw.replace(/\u00ad/g, '');
    if (!piece.trim()) continue;
    if (text) {
      if (/\p{L}[-‐‑]$/u.test(text) && isLower(piece)) {
        text = text.slice(0, -1);
        map[map.length - 1].end = text.length;
      } else {
        text += ' ';
      }
    }
    const start = text.length;
    text += piece;
    map.push({ el, start, end: text.length, raw: raw === piece ? null : raw });
  }
  return { text, map };
}

function textNodeOf(el) {
  for (const child of el.childNodes) if (child.nodeType === 3) return child;
  return null;
}
// Index in the span's raw text of its k-th kept character (soft hyphens were taken out of the joined text).
function rawIndex(entry, k) {
  if (!entry.raw) return k;
  let seen = 0;
  for (let i = 0; i < entry.raw.length; i += 1) {
    if (entry.raw[i] === '\u00ad') continue;
    if (seen === k) return i;
    seen += 1;
  }
  return entry.raw.length;
}
// A DOM point for an offset in the joined page text. A start in the gap between two spans moves to the next
// span, an end to the previous one.
export function domPoint(map, offset, isEnd) {
  let entry = null;
  if (isEnd) {
    for (let i = map.length - 1; i >= 0; i -= 1) if (map[i].start < offset) { entry = map[i]; break; }
  } else {
    entry = map.find((candidate) => candidate.end > offset) || null;
  }
  if (!entry) return null;
  const node = textNodeOf(entry.el);
  if (!node) return null;
  const inside = Math.min(Math.max(offset - entry.start, 0), entry.end - entry.start);
  return { node, offset: Math.min(rawIndex(entry, inside), node.nodeValue.length) };
}

// getLayers(page): the text layer element(s) showing that page, once rendered ([] if none).
// showPage(page): navigate there. step(): pages shown together (1, or 2 in the two-page view).
// skipChrome(): leave out page numbers and running headers/footers. getBandTexts(page): the text items in the top
// and bottom tenth of a page (used to find what repeats from page to page without drawing those pages).
const BAND = 0.1;
export function createPdfSource({ lang, getPage, getNumPages, getLayers, showPage, step = () => 1, getSelectionText = () => '', reveal = () => {}, skipChrome = () => false, getBandTexts = async () => [], highlighter = createHighlighter(globalThis, globalThis.document) }) {
  const bands = new Map();
  async function bandSet(page) {
    if (!bands.has(page)) {
      let items = [];
      try { items = await getBandTexts(page); } catch { items = []; }
      bands.set(page, new Set(items.map(normalizeBandText).filter(Boolean)));
    }
    return bands.get(page);
  }
  // Short texts that sit in a page edge band on at least two of the pages around this one.
  async function repeatedAround(page) {
    const counts = new Map();
    for (const other of [page - 2, page - 1, page + 1, page + 2]) {
      if (other < 1 || other > getNumPages()) continue;
      for (const text of await bandSet(other)) counts.set(text, (counts.get(text) || 0) + 1);
    }
    return new Set([...counts].filter(([, n]) => n >= 2).map(([text]) => text));
  }
  function withoutFurniture(layer, spans, repeated) {
    const box = layer.getBoundingClientRect();
    if (!box.height) return spans;
    return spans.filter((el) => {
      const rect = el.getBoundingClientRect();
      const inBand = rect.bottom <= box.top + box.height * BAND || rect.top >= box.top + box.height * (1 - BAND);
      if (!inBand) return true;
      const text = el.textContent || '';
      return !(isPageNumberText(text) || repeated.has(normalizeBandText(text)));
    });
  }

  function build(page, layers, selectedText, repeated) {
    const spans = layers.flatMap((layer) => {
      const own = leafSpans(layer);
      return skipChrome() ? withoutFurniture(layer, own, repeated) : own;
    });
    const { text, map } = textFromSpans(spans);
    const sentences = splitSentences(text, lang());
    if (!sentences.length) return null;
    const doc = map[0]?.el.ownerDocument;
    const units = sentences.map((sentence) => {
      const touched = map.filter((m) => m.start < sentence.end && m.end > sentence.start).map((m) => m.el);
      const spoken = spokenWithMap(text.slice(sentence.start, sentence.end));
      const exact = highlighter.supported && Boolean(doc) && spoken.text === sentence.text && spoken.map.length > 0;
      const abs = (i) => sentence.start + spoken.map[i];
      const rangeOf = (from, to) => {
        const a = domPoint(map, from, false);
        const b = domPoint(map, to, true);
        if (!a || !b) return null;
        const range = doc.createRange();
        range.setStart(a.node, a.offset);
        range.setEnd(b.node, b.offset);
        return range;
      };
      const unit = {
        text: sentence.text,
        activate() {
          const range = exact ? rangeOf(abs(0), abs(spoken.map.length - 1) + 1) : null;
          if (range) highlighter.sentence(range);
          else for (const el of touched) el.classList.add(ACTIVE_CLASS);
          if (touched[0]) reveal(touched[0]);
        },
        deactivate() {
          if (exact) { highlighter.sentence(null); highlighter.word(null); }
          for (const el of touched) el.classList.remove(ACTIVE_CLASS);
        },
      };
      if (exact) unit.word = (word) => highlighter.word(word ? rangeOf(abs(word.start), abs(word.end - 1) + 1) : null);
      return unit;
    });
    const offset = selectedText ? findSelectionOffset(text, selectedText) : -1;
    const startIndex = offset >= 0 ? sentenceIndexAt(sentences, offset) : 0;
    // the sentence holding the last character of the selection (a selection can run past the page: then the page is read to its end)
    const endOffset = offset >= 0 ? offset + String(selectedText).trim().length - 1 : -1;
    const endIndex = offset < 0 ? -1 : (sentences.some((sentence) => sentence.end > endOffset) ? sentenceIndexAt(sentences, endOffset) : units.length - 1);
    return { label: `p. ${page}`, page, units, startIndex, endIndex };
  }

  async function from(page, selectedText) {
    let current = page;
    for (let tries = 0; tries < MAX_EMPTY_PAGES && current <= getNumPages(); tries += 1) {
      const layers = await getLayers(current);
      const repeated = layers.length && skipChrome() ? await repeatedAround(current) : new Set();
      const segment = layers.length ? build(current, layers, tries === 0 ? selectedText : '', repeated) : null;
      if (segment) return segment;
      current += Math.max(1, step());
      if (current <= getNumPages()) await showPage(current);
    }
    return null;
  }

  return {
    lang,
    start: (origin) => from(getPage(), origin?.type === 'selection' ? (origin.text || getSelectionText()) : ''),
    async next(segment) {
      const target = segment.page + Math.max(1, step());
      if (target > getNumPages()) return null;
      await showPage(target);
      return from(target, '');
    },
    dispose() {},
  };
}

// ---- EPUB --------------------------------------------------------------------------------

const BLOCK = 'p,div,li,h1,h2,h3,h4,h5,h6,blockquote,td,th,figcaption,section,article,aside,pre,dd,dt,caption,header,footer';
const SKIP = 'script,style,noscript,svg,math,head,[hidden],[aria-hidden="true"]';

// Text of a chapter document as one string, with a newline between blocks, and the text nodes
// with their offsets so a sentence can be turned back into a DOM Range.
// With skipFurniture, page-break markers, page headers/footers, footnotes, note references and in-chapter
// navigation (all marked up by the publisher) are left out. A plain <header> is NOT left out: it usually holds the title.
// epub:type is a namespaced attribute when the chapter is parsed as XHTML (matched by [*|type]) and a plain
// attribute literally named "epub:type" when it is parsed as HTML (matched by [epub\:type]); both occur.
const FURNITURE = [
  ...['pagebreak', 'footnote', 'endnote', 'noteref'].flatMap((kind) => [`[*|type~="${kind}"]`, `[epub\\:type~="${kind}"]`]),
  '[role="doc-pagebreak"]', '[role="doc-pageheader"]', '[role="doc-pagefooter"]',
  '[role="doc-footnote"]', '[role="doc-endnote"]', '[role="doc-noteref"]',
  'nav',
].join(',');
export function chapterText(doc, skipFurniture = false) {
  const walker = doc.createTreeWalker(doc.body, 4);
  const nodes = [];
  let text = '';
  let lastBlock = null;
  let node = walker.nextNode();
  while (node) {
    const parent = node.parentElement;
    const value = node.nodeValue || '';
    if (value.trim() && parent && !parent.closest(SKIP) && !(skipFurniture && parent.closest(FURNITURE))) {
      const block = parent.closest(BLOCK);
      if (text && block !== lastBlock) text += '\n';
      lastBlock = block;
      nodes.push({ node, start: text.length, end: text.length + value.length });
      text += value;
    }
    node = walker.nextNode();
  }
  return { text, nodes };
}

function locate(nodes, offset, preferEnd) {
  for (let i = 0; i < nodes.length; i += 1) {
    const n = nodes[i];
    if (preferEnd ? offset > n.start && offset <= n.end : offset >= n.start && offset < n.end) return { node: n.node, offset: offset - n.start };
  }
  const last = nodes[nodes.length - 1];
  return last ? { node: last.node, offset: preferEnd ? last.end - last.start : 0 } : null;
}

// engine: the EpubEngine. guard(fn): runs fn marked as "our own navigation" so the reader does not
// mistake it for the user turning the page.
export function createEpubSource({ getEngine, lang, guard = (fn) => fn(), skipChrome = () => false }) {
  const highlightStyle = { fill: '#ffc400', 'fill-opacity': '0.38' };

  function contentsFor(engine, sectionIndex) {
    const all = engine.rendition?.getContents?.() || [];
    if (sectionIndex === undefined) {
      const byHref = all.find((c) => engine.book?.spine?.spineItems?.[c.sectionIndex]?.href === engine.currentHref);
      return byHref || all[0] || null;
    }
    return all.find((c) => c.sectionIndex === sectionIndex) || null;
  }

  function isVisible(engine, cfi) {
    try {
      const Cfi = window.ePub?.CFI;
      const where = engine.rendition.currentLocation();
      if (!Cfi || !where?.start?.cfi || !where?.end?.cfi) return true; // cannot tell: do not turn pages blindly
      const compare = new Cfi();
      return compare.compare(where.start.cfi, cfi) <= 0 && compare.compare(cfi, where.end.cfi) <= 0;
    } catch { return true; }
  }

  function buildSegment(engine, contents, origin) {
    const doc = contents?.document;
    if (!doc?.body) return null;
    const { text, nodes } = chapterText(doc, skipChrome());
    const docLang = (doc.documentElement.getAttribute('lang') || doc.documentElement.getAttribute('xml:lang') || '').toLowerCase().split('-')[0];
    const sentences = splitSentences(text, docLang || lang());
    if (!sentences.length) return null;
    const section = engine.book.spine.spineItems[contents.sectionIndex];
    const highlighter = createHighlighter(contents.window, doc);
    if (highlighter.supported) ensureHighlightStyle(doc);
    const units = sentences.map((sentence) => {
      const spoken = spokenWithMap(text.slice(sentence.start, sentence.end));
      const exact = spoken.text === sentence.text && spoken.map.length > 0;
      const abs = (i) => sentence.start + spoken.map[i];
      const from = exact ? abs(0) : sentence.start;
      const to = exact ? abs(spoken.map.length - 1) + 1 : sentence.end;
      const rangeOf = (a0, b0) => {
        const a = locate(nodes, a0, false);
        const b = locate(nodes, b0, true);
        if (!a || !b) return null;
        const range = doc.createRange();
        range.setStart(a.node, a.offset);
        range.setEnd(b.node, b.offset);
        return range;
      };
      let cfi = null; // the page-overlay highlight, used only where the Highlight API is not available
      const unit = {
        text: sentence.text,
        lang: docLang || undefined,
        async activate() {
          const range = rangeOf(from, to);
          if (!range) return;
          const where = section.cfiFromRange(range);
          if (!isVisible(engine, where)) await guard(() => engine.rendition.display(where));
          if (highlighter.supported) { highlighter.sentence(range); return; }
          cfi = where;
          engine.rendition.annotations.highlight(cfi, {}, null, 'ra-sentence', highlightStyle);
        },
        deactivate() {
          if (highlighter.supported) { highlighter.sentence(null); highlighter.word(null); return; }
          if (!cfi) return;
          const mark = cfi;
          cfi = null;
          try { engine.rendition.annotations.remove(mark, 'highlight'); } catch { /* the chapter was replaced */ }
        },
      };
      if (highlighter.supported && exact) unit.word = (word) => highlighter.word(word ? rangeOf(abs(word.start), abs(word.end - 1) + 1) : null);
      return unit;
    });

    let startIndex = 0;
    let endIndex = -1;
    try {
      let probe = null;
      if (origin?.type === 'selection') {
        const range = contents.window.getSelection()?.rangeCount ? contents.window.getSelection().getRangeAt(0) : null;
        probe = range ? { node: range.startContainer, offset: range.startOffset } : null;
      } else if (origin?.type !== 'chapter-start' && engine.getCurrentRange().start) {
        const range = contents.range(engine.getCurrentRange().start);
        const first = nodes.find((n) => range.comparePoint(n.node, 0) >= 0);
        probe = first ? { node: first.node, offset: range.startContainer === first.node ? range.startOffset : 0 } : null;
      }
      const hit = probe && nodes.find((n) => n.node === probe.node);
      if (hit) startIndex = sentenceIndexAt(sentences, hit.start + probe.offset);
      if (hit && origin?.type === 'selection') {
        const range = contents.window.getSelection().getRangeAt(0);
        const inside = nodes.filter((n) => range.intersectsNode(n.node));
        const last = inside[inside.length - 1];
        if (last) {
          let end = last.start + (last.node === range.endContainer ? range.endOffset : last.end - last.start);
          // a selection that runs to the end of a paragraph also takes the indentation and line break after the sentence; those belong to no sentence
          while (end > 0 && /\s/.test(text[end - 1])) end -= 1;
          endIndex = sentences.some((sentence) => sentence.end >= end) ? sentenceIndexAt(sentences, Math.max(0, end - 1)) : units.length - 1;
        }
      }
    } catch { startIndex = 0; endIndex = -1; }

    return { label: section?.href || '', sectionIndex: contents.sectionIndex, units, startIndex, endIndex };
  }

  return {
    lang,
    async start(origin) {
      const engine = getEngine();
      if (!engine?.rendition) return null;
      const contents = contentsFor(engine);
      return contents ? buildSegment(engine, contents, origin) : null;
    },
    async next(segment) {
      const engine = getEngine();
      if (!engine?.rendition) return null;
      const spine = engine.book.spine.spineItems;
      for (let i = segment.sectionIndex + 1, tries = 0; i < spine.length && tries < MAX_EMPTY_PAGES; i += 1, tries += 1) {
        if (spine[i].linear === false || spine[i].linear === 'no') continue;
        await guard(() => engine.rendition.display(spine[i].href));
        const contents = contentsFor(engine, i);
        const built = contents ? buildSegment(engine, contents, { type: 'chapter-start' }) : null;
        if (built) { built.startIndex = 0; return built; }
      }
      return null;
    },
    dispose() {},
  };
}
