import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { safeBookUrl, destinationPage, annotationBox, renderPdfLinks, bindEpubLinks } from '../public/book-links.mjs';

class Node {
  constructor(tag, doc) { this.tagName = tag; this.ownerDocument = doc; this.children = []; this.style = {}; this.events = new Map(); }
  appendChild(node) { this.children.push(node); node.parent = this; }
  get childElementCount() { return this.children.length; }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(type, fn) { this.events.set(type, fn); }
  querySelector(selector) { return this.children.find(node => node.className === selector.slice(1)) || null; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
}
const container = () => { const doc = { createElement: tag => new Node(tag, doc) }; return new Node('div', doc); };
const viewport = { width: 300, height: 400, convertToViewportRectangle: rect => [rect[0], 400 - rect[1], rect[2], 400 - rect[3]] };
const event = () => ({ preventDefault() { this.prevented = true; } });

test('external URL allowlist rejects executable/local URLs, embedded credentials and control characters', () => {
  for (const value of ['javascript:alert(1)', 'data:text/html,hi', 'file:///secret', 'blob:https://example.com/id', 'ftp://example.com', 'https://user:pass@example.com', 'https://example.com/\npath', '/relative']) assert.equal(safeBookUrl(value), null, value);
  assert.equal(safeBookUrl('https://doi.org/10.1000/test'), 'https://doi.org/10.1000/test');
  assert.equal(safeBookUrl('mailto:author@example.com'), 'mailto:author@example.com');
  assert.equal(safeBookUrl('//example.com/paper'), 'https://example.com/paper');
});

test('rectangle conversion clips to the page and ignores missing/nonfinite/empty geometry', () => {
  assert.deepEqual(annotationBox([10, 20, 40, 30], viewport), { left: 10, top: 370, width: 30, height: 10 });
  assert.deepEqual(annotationBox([-10, 20, 40, 30], viewport), { left: 0, top: 370, width: 40, height: 10 });
  for (const rect of [null, [], [0, 0, 0, 0], [0, NaN, 10, 10], [400, 0, 410, 10]]) assert.equal(annotationBox(rect, viewport), null);
});

test('destination resolution handles the first page, named references and invalid/out-of-range targets', async () => {
  const pdf = { numPages: 3, getDestination: async name => name === 'chapter' ? [{ num: 5 }, { name: 'Fit' }] : null, getPageIndex: async () => 2 };
  assert.equal(await destinationPage(pdf, [0, {}]), 1);
  assert.equal(await destinationPage(pdf, 'chapter'), 3);
  for (const dest of ['missing', [-1], [3], [], null, [null]]) assert.equal(await destinationPage(pdf, dest), null);
});

test('PDF link overlay exposes safe external anchors and internal page buttons, without forms/scripts', async () => {
  const host = container(), navigated = [];
  const annotations = [
    { subtype: 'Link', rect: [10, 10, 40, 20], url: 'https://example.com/' },
    { subtype: 'Link', rect: [10, 40, 40, 50], dest: [0, {}] },
    { subtype: 'Link', rect: [10, 70, 40, 80], url: 'javascript:alert(1)' },
    { subtype: 'Widget', rect: [10, 90, 40, 100], url: 'https://example.com/' },
  ];
  await renderPdfLinks({ page: { getAnnotations: async () => annotations }, pdf: { numPages: 5 }, viewport, container: host, isCurrent: () => true, onNavigate: page => navigated.push(page) });
  const layer = host.querySelector('.pdf-link-layer');
  assert.equal(layer.children.length, 2);
  const [external, internal] = layer.children;
  assert.equal(external.tagName, 'a');
  assert.equal(external.target, '_blank');
  assert.equal(external.rel, 'noopener noreferrer');
  assert.equal(external.referrerPolicy, 'no-referrer');
  assert.equal(external.style.top, '380px');
  assert.equal(internal.tagName, 'button');
  await internal.events.get('click')(event());
  assert.deepEqual(navigated, [1]);
});

test('stale annotation reads and delayed destinations cannot change a new page/book', async () => {
  let current = true, resolveAnnotations, resolveDest;
  const host = container(), navigated = [];
  const pending = renderPdfLinks({ page: { getAnnotations: () => new Promise(resolve => { resolveAnnotations = resolve; }) }, pdf: { numPages: 2 }, viewport, container: host, isCurrent: () => current, onNavigate: page => navigated.push(page) });
  current = false;
  resolveAnnotations([{ subtype: 'Link', rect: [10, 10, 30, 30], url: 'https://example.com/' }]);
  await pending;
  assert.equal(host.children.length, 0);
  current = true;
  await renderPdfLinks({ page: { getAnnotations: async () => [{ subtype: 'Link', rect: [10, 10, 30, 30], dest: 'chapter' }] }, pdf: { numPages: 2, getDestination: () => new Promise(resolve => { resolveDest = resolve; }) }, viewport, container: host, isCurrent: () => current, onNavigate: page => navigated.push(page) });
  const click = host.children[0].children[0].events.get('click')(event());
  current = false;
  resolveDest([1, {}]);
  await click;
  assert.deepEqual(navigated, []);
});

test('EPUB leaves chapter fragments to epub.js, opens safe external links and blocks unsafe schemes', () => {
  const listeners = new Map(), opened = [];
  const doc = { addEventListener: (type, fn, capture) => { assert.equal(capture, true); listeners.set(type, fn); }, removeEventListener: type => listeners.delete(type) };
  const dispose = bindEpubLinks(doc, href => opened.push(href));
  const click = (href, type = 'click', button = 0) => {
    const ev = { type, button, target: { closest: () => ({ getAttribute: () => href }) }, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
    listeners.get(type)(ev); return ev;
  };
  for (const href of ['#note-1', '../chapter2.xhtml#part']) assert.equal(click(href).prevented, undefined);
  assert.equal(click('https://example.com/paper').prevented, true);
  assert.equal(click('mailto:author@example.com').prevented, true);
  for (const href of ['javascript:alert(1)', 'data:text/html,hi', 'file:///secret', 'java\tscript:alert(1)']) assert.equal(click(href).prevented, true);
  click('https://example.com/', 'auxclick', 2);
  assert.deepEqual(opened, ['https://example.com/paper', 'mailto:author@example.com']);
  dispose();
  assert.equal(listeners.size, 0);
});

test('real PDF annotations retain correct crop/zoom/rotation geometry and named destinations', async () => {
  const source = await PDFDocument.create();
  const first = source.addPage([300, 400]), second = source.addPage([300, 400]);
  first.setCropBox(50, 40, 200, 300);
  const external = source.context.register(source.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [60, 50, 90, 70], A: { S: 'URI', URI: PDFString.of('https://doi.org/10.1000/test') } }));
  const internal = source.context.register(source.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [100, 100, 130, 120], Dest: PDFString.of('chapter') }));
  first.node.set(PDFName.of('Annots'), source.context.obj([external, internal]));
  source.catalog.set(PDFName.of('Dests'), source.context.obj({ chapter: [second.ref, PDFName.of('Fit')] }));
  const pdf = await getDocument({ data: new Uint8Array(await source.save()), isEvalSupported: false }).promise;
  try {
    const page = await pdf.getPage(1), annotations = await page.getAnnotations();
    assert.equal(annotations[0].url, 'https://doi.org/10.1000/test');
    assert.equal(await destinationPage(pdf, annotations[1].dest), 2);
    assert.deepEqual(annotationBox(annotations[0].rect, page.getViewport({ scale: 2 })), { left: 20, top: 540, width: 60, height: 40 });
    const rotated = annotationBox(annotations[0].rect, page.getViewport({ scale: 2, rotation: 90 }));
    assert.deepEqual(rotated, { left: 20, top: 20, width: 40, height: 60 });
    const host = container();
    await renderPdfLinks({ page, pdf, viewport: page.getViewport({ scale: 2, rotation: 90 }), container: host, isCurrent: () => true, onNavigate: () => {} });
    assert.equal(host.children[0].children.length, 2);
  } finally { await pdf.destroy(); }
});
