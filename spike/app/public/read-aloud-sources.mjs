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
    const piece = (el.textContent || '').replace(/­/g, '');
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
    map.push({ el, start, end: text.length });
  }
  return { text, map };
}

// getLayers(page): the text layer element(s) showing that page, once rendered ([] if none).
// showPage(page): navigate there. step(): pages shown together (1, or 2 in the two-page view).
export function createPdfSource({ lang, getPage, getNumPages, getLayers, showPage, step = () => 1, getSelectionText = () => '', reveal = () => {} }) {
  function build(page, layers, selectedText) {
    const spans = layers.flatMap(leafSpans);
    const { text, map } = textFromSpans(spans);
    const sentences = splitSentences(text, lang());
    if (!sentences.length) return null;
    const units = sentences.map((sentence) => {
      const touched = map.filter((m) => m.start < sentence.end && m.end > sentence.start).map((m) => m.el);
      return {
        text: sentence.text,
        activate() {
          for (const el of touched) el.classList.add(ACTIVE_CLASS);
          if (touched[0]) reveal(touched[0]);
        },
        deactivate() { for (const el of touched) el.classList.remove(ACTIVE_CLASS); },
      };
    });
    const offset = selectedText ? findSelectionOffset(text, selectedText) : -1;
    return { label: `p. ${page}`, page, units, startIndex: offset >= 0 ? sentenceIndexAt(sentences, offset) : 0 };
  }

  async function from(page, selectedText) {
    let current = page;
    for (let tries = 0; tries < MAX_EMPTY_PAGES && current <= getNumPages(); tries += 1) {
      const layers = await getLayers(current);
      const segment = layers.length ? build(current, layers, tries === 0 ? selectedText : '') : null;
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
export function chapterText(doc) {
  const walker = doc.createTreeWalker(doc.body, 4);
  const nodes = [];
  let text = '';
  let lastBlock = null;
  let node = walker.nextNode();
  while (node) {
    const parent = node.parentElement;
    const value = node.nodeValue || '';
    if (value.trim() && parent && !parent.closest(SKIP)) {
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
export function createEpubSource({ getEngine, lang, guard = (fn) => fn() }) {
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
    const { text, nodes } = chapterText(doc);
    const docLang = (doc.documentElement.getAttribute('lang') || doc.documentElement.getAttribute('xml:lang') || '').toLowerCase().split('-')[0];
    const sentences = splitSentences(text, docLang || lang());
    if (!sentences.length) return null;
    const section = engine.book.spine.spineItems[contents.sectionIndex];
    const units = sentences.map((sentence) => {
      let from = sentence.start;
      let to = sentence.end;
      while (from < to && /\s/.test(text[from])) from += 1;
      while (to > from && /\s/.test(text[to - 1])) to -= 1;
      let cfi = null;
      return {
        text: sentence.text,
        lang: docLang || undefined,
        async activate() {
          const a = locate(nodes, from, false);
          const b = locate(nodes, to, true);
          if (!a || !b) return;
          const range = doc.createRange();
          range.setStart(a.node, a.offset);
          range.setEnd(b.node, b.offset);
          cfi = section.cfiFromRange(range);
          if (!isVisible(engine, cfi)) await guard(() => engine.rendition.display(cfi));
          engine.rendition.annotations.highlight(cfi, {}, null, 'ra-sentence', highlightStyle);
        },
        deactivate() {
          if (!cfi) return;
          const mark = cfi;
          cfi = null;
          try { engine.rendition.annotations.remove(mark, 'highlight'); } catch { /* the chapter was replaced */ }
        },
      };
    });

    let startIndex = 0;
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
    } catch { startIndex = 0; }

    return { label: section?.href || '', sectionIndex: contents.sectionIndex, units, startIndex };
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
