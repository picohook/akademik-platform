import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';
import { EpubEngine, normalizeExternalEmbeds } from '../public/epub-engine.mjs';

// @xmldom/xmldom is the parser epub.js bundles for a chapter document, so these
// fragments are real XML read the way the reader reads them rather than a
// hand-built DOM mock. It stops at the 2000-level DOM, so the traversal and
// replacement a browser provides for free are implemented over the real tree
// below (no stubs stand in for the code under test).
//
// The defect being fixed is in the catalog: ch004–ch008 and ch013 of *Scientific
// Writing for Health Research* each embed a YouTube video, and every one of them
// renders as "This content is blocked". A chapter is served as `srcdoc`, so its
// origin is opaque and no script runs inside it; CSP frame-src is 'self'; and
// embedding a third party would contact that host from the reader.
const YOUTUBE = 'https://www.youtube.com/embed/abc123?v=abc123';

function walk(node, visit) {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1 && visit(child) === false) return false;
    if (child.nodeType === 1 && walk(child, visit) === false) return false;
  }
  return true;
}

const all = (root, test_) => {
  const found = [];
  walk(root, node => { if (test_(node)) found.push(node); });
  return found;
};
const byTag = (root, tag) => all(root, node => String(node.localName).toLowerCase() === tag);
const byClass = (root, name) => all(root, node => (node.getAttribute('class') || '').split(/\s+/).includes(name));
const cards = doc => byTag(doc, 'a').filter(node => node.getAttribute('data-app-link') === 'epub-external-link');
const frames = doc => byTag(doc, 'iframe');

// xmldom 0.7 answers '' for an attribute it does not carry, as a browser does, and
// presence has to be read from the attribute map — exactly what Element.hasAttribute
// gives the code under test in a browser. closest()/replaceWith(), which the reader
// relies on, are implemented over the real tree here.
function installDomHelpers(doc) {
  const proto = doc.documentElement.constructor.prototype;
  const originalAttribute = proto.getAttribute;
  proto.getAttribute = function getAttribute(name) {
    return originalAttribute.call(this, name) ?? '';
  };
  proto.hasAttribute = function hasAttribute(name) {
    return this.attributes.getNamedItem(name) != null;
  };
  proto.closest = function closest() {
    for (let parent = this.parentNode; parent && parent.nodeType === 1; parent = parent.parentNode) {
      const has = name => parent.attributes.getNamedItem(name) != null;
      if (has('hidden') || (has('aria-hidden') && parent.getAttribute('aria-hidden') === 'true')) return parent;
    }
    return null;
  };
  proto.replaceWith = function replaceWith(node) {
    this.parentNode.replaceChild(node, this);
  };
}

function chapter(body) {
  const doc = new DOMParser().parseFromString(
    `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>${body}</body></html>`,
    'application/xhtml+xml',
  );
  installDomHelpers(doc);
  const matches = (node, selector) => {
    const simple = /^([a-z0-9-]*)((?:\[[^\]]+\])*)$/i.exec(selector.trim());
    if (!simple) return false;
    const [, tag, attributePart] = simple;
    if (tag && String(node.localName).toLowerCase() !== tag.toLowerCase()) return false;
    for (const [, name, value] of attributePart.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
      if (!node.hasAttribute(name)) return false;
      if (value !== undefined && node.getAttribute(name) !== value) return false;
    }
    return true;
  };
  // querySelector answers the first match or null — never an empty wrapper, which
  // is a truthy object the code under test would treat as a found element.
  const first = selector => all(doc, candidate => matches(candidate, selector))[0] || null;
  doc.querySelectorAll = selector => all(doc, node => selector.split(',').some(part => matches(node, part.trim())));
  doc.querySelector = first;
  doc.createElement = tag => doc.createElementNS('http://www.w3.org/1999/xhtml', tag);
  // Chapter listeners: recorded so the test can assert what the reader bound, and
  // removed when the engine disposes the chapter.
  const listeners = new Map();
  doc.listeners = listeners;
  doc.addEventListener = (type, fn) => listeners.set(type, fn);
  doc.removeEventListener = type => listeners.delete(type);
  // Real chapters expose document.body; xmldom 0.7 does not, so the getter goes on
  // the document prototype. The answer is cached: the reader asks for it on every
  // chapter event, and re-walking the tree each time is needless work.
  if (!Object.getOwnPropertyDescriptor(Object.getPrototypeOf(doc), 'body')) {
    Object.defineProperty(Object.getPrototypeOf(doc), 'body', {
      get() {
        const document = this.nodeType === 9 ? this : this.ownerDocument;
        if (!document.__body) {
          const root = document.documentElement;
          document.__body = root ? byTag(root, 'body')[0] || null : null;
        }
        return document.__body;
      },
      configurable: true,
    });
  }
  doc.defaultView = { addEventListener() {}, removeEventListener() {} };
  doc.head = byTag(doc, 'head')[0];
  return { doc, body: doc.body };
}

function chapterWithVideo(title = '') {
  const titleAttribute = title ? ` title="${title}"` : '';
  return chapter('<section><h1>Bölüm</h1>'
    + `<div class="media"><p class="center"><iframe width="560" height="315" src="${YOUTUBE}"${titleAttribute} allowfullscreen="allowfullscreen"></iframe></p></div>`
    + '<p>Video sonrası metin.</p></section>');
}

test('an external embed becomes a new-tab link card and no iframe survives', () => {
  const { doc } = chapterWithVideo('Araştırma tasarımı');
  assert.equal(normalizeExternalEmbeds(doc), 1);

  assert.equal(frames(doc).length, 0, 'an iframe was left in the chapter');
  const [card] = cards(doc);
  assert.ok(card, 'no link card was written');
  assert.equal(card.getAttribute('href'), YOUTUBE);
  assert.equal(card.getAttribute('target'), '_blank');
  // noopener/noreferrer: the destination must not get a handle on the reader, and
  // must not learn where the reader came from.
  assert.equal(card.getAttribute('rel'), 'noopener noreferrer');
  assert.equal(String(card.localName).toLowerCase(), 'a');
  // The publisher's own description is the accessible name, not an invented one.
  assert.match(card.getAttribute('aria-label'), /^Araştırma tasarımı/);
  assert.match(card.textContent, /^▶ /, 'the card is not recognisable as playable');
});

test('the wrapper that held only the embed is replaced too, leaving no empty box', () => {
  const { doc } = chapterWithVideo();
  normalizeExternalEmbeds(doc);
  // <div class="media"><p class="center"><iframe/></p></div> — both wrappers hold
  // nothing else, so the outermost one goes; the surrounding section stays.
  assert.equal(byTag(doc, 'section').length, 1);
  assert.equal(byClass(doc, 'media').length, 0, 'an empty video box was left behind');
  assert.equal(byClass(doc, 'center').length, 0, 'an empty paragraph was left behind');
  assert.match(byTag(doc, 'section')[0].textContent, /Video sonrası metin\./);
});

test('a wrapper that also holds text is kept, so no chapter text is lost', () => {
  const { doc } = chapter(`<p>Videoyu izleyin: <iframe src="${YOUTUBE}"></iframe> (3 dk)</p>`);
  normalizeExternalEmbeds(doc);
  const [paragraph] = byTag(doc, 'p');
  assert.ok(paragraph, 'the paragraph holding the sentence was removed');
  assert.match(paragraph.textContent, /Videoyu izleyin/);
  assert.match(paragraph.textContent, /\(3 dk\)/);
  assert.equal(cards(doc).length, 1);
});

test('labels fall back to the host, and a hostile title stays text', () => {
  const untitled = chapter(`<iframe src="${YOUTUBE}"></iframe>`);
  normalizeExternalEmbeds(untitled.doc);
  // No title: the host is stated, because the reader is about to leave the book.
  assert.match(cards(untitled.doc)[0].textContent, /youtube\.com/);

  const hostile = chapter('<iframe src="https://evil.example/embed" title="&lt;img src=x onerror=alert(1)&gt;"></iframe>');
  normalizeExternalEmbeds(hostile.doc);
  const [card] = cards(hostile.doc);
  assert.equal(byTag(card, 'img').length + byTag(card, 'script').length, 0, 'the title was parsed as markup');
  assert.match(card.textContent, /<img src=x onerror=alert\(1\)>/, 'the title was not kept as text');
});

test('only https destinations become links; an unusable frame still goes away', () => {
  const unusable = ['javascript:alert(1)', 'data:text/html,hi', 'file:///secret', 'http://insecure.example/embed', '//cdn.example/embed', 'about:blank'];
  for (const src of unusable) {
    const { doc } = chapter(`<iframe src="${src}" title="x"></iframe>`);
    assert.equal(normalizeExternalEmbeds(doc), 0, src);
  assert.equal(cards(doc).length, 0, src);
    assert.equal(frames(doc).length, 0, `${src}: the blank box was left to render`);
  }
});

test('running twice changes nothing: epub.js re-writes srcdoc on every resize', () => {
  const { doc } = chapterWithVideo('Tek video');
  normalizeExternalEmbeds(doc);
  normalizeExternalEmbeds(doc);
  assert.equal(cards(doc).length, 1, 'the card was nested or duplicated');
  assert.equal(cards(doc)[0].getAttribute('href'), YOUTUBE);
});

test('embeds hidden by page-break wrappers are not revealed', () => {
  // epub.js hides fragments with [hidden] to paginate. Making one visible would
  // reflow the chapter that hid it.
  const { doc } = chapter(`<p>Metin</p><div hidden="hidden"><iframe src="${YOUTUBE}"></iframe></div>`);
  assert.equal(normalizeExternalEmbeds(doc), 0);
  assert.equal(cards(doc).length, 0);
  assert.equal(frames(doc).length, 1, 'the hidden fragment was rewritten');
});

test('each rendered chapter is normalized, and the card returns after a srcdoc re-write', async () => {
  const frame = chapterWithVideo('Bölüm videosu');
  let contentHook;
  const rendition = {
    hooks: { content: { register(callback) { contentHook = callback; } } },
    on() {}, resize() {}, destroy() {},
    // epub.js hands the hook a contents object whose `body` is the chapter body it
    // currently holds; that is the node a re-write replaces.
    async display() { contentHook({ document: frame.doc, body: frame.body }); },
  };
  const book = {
    ready: Promise.resolve(), renderTo: () => rendition,
    loaded: { navigation: Promise.resolve({ toc: [] }) },
    locations: { generate: async () => {} }, destroy() {},
  };
  const previous = { win: globalThis.window, observer: globalThis.MutationObserver };
  const observers = [];
  globalThis.MutationObserver = class {
    constructor(callback) { this.callback = callback; this.options = null; observers.push(this); }
    observe(node, options) { this.options = options; this.node = node; }
    disconnect() { this.disconnected = true; }
  };
  globalThis.window = { ePub: () => book, innerWidth: 800, innerHeight: 600, addEventListener() {}, removeEventListener() {} };
  try {
    const engine = new EpubEngine({ clientWidth: 800, clientHeight: 600 }, {});
    await engine.open('fixture.epub');
    assert.equal(cards(frame.doc).length, 1, 'the content hook did not normalize the chapter');

    // The viewport observer watches <head>; the one under test must watch the body.
    const bodyObserver = observers.find(observer =>
      observer.options?.childList && observer.options?.subtree && observer.node === frame.body);
    assert.ok(bodyObserver, 'nothing watches the chapter body for a re-written srcdoc');
    // Identity, not deep equality: a DOM node graph is cyclic, and asserting
    // equality on it makes the reporter walk it forever.
    assert.ok(bodyObserver.node === frame.body, 'the observer watches the wrong node');

    // epub.js re-assigns srcdoc on pagination/resize; the frame comes back with it.
    const fresh = chapter(`<p>x</p><iframe src="${YOUTUBE}" title="b"></iframe>`);
    frame.body.appendChild(byTag(fresh.doc, 'iframe')[0]);
    assert.equal(frames(frame.doc).length, 1, 'the fixture did not bring the frame back');
    bodyObserver.callback();
    assert.equal(cards(frame.doc).length, 2, 'the card could not come back after a re-write');
    assert.equal(frames(frame.doc).length, 0);

    engine.destroy();
    assert.ok(observers.every(observer => observer.disconnected), 'an observer outlived the reader');
  } finally {
    if (previous.observer === undefined) delete globalThis.MutationObserver;
    else globalThis.MutationObserver = previous.observer;
    if (previous.win === undefined) delete globalThis.window;
    else globalThis.window = previous.win;
  }
});
