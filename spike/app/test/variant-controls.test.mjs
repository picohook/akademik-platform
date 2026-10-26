import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { bookRequestId, variantLabel, offlineBookKey, findOfflineVariant } from '../public/book-variants.mjs';

class Node {
  constructor(tag) { this.tagName = tag; this.children = []; this.style = {}; this.events = new Map(); this.value = ''; }
  appendChild(child) { this.children.push(child); if (child.selected) this.value = child.value; return child; }
  append(...children) { children.forEach(child => this.appendChild(child)); }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(name, handler) { this.events.set(name, handler); }
  replaceWith(next) { this.replacement = next; }
  querySelector(selector) {
    return this.children.find(child => child.className?.split(' ').includes(selector.slice(1)))
      || this.children.map(child => child.querySelector(selector)).find(Boolean) || null;
  }
  focus() { this.focused = true; }
}

const pdf = { id: 'work', asset_id: 'pdf', title: 'Book', language: 'en', format: 'pdf', publication_year: 2023 };
const epub = { ...pdf, asset_id: 'epub', format: 'epub' };
const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const code = source.slice(source.indexOf('function makeVariantPicker('), source.indexOf('function renderBooks()'));

function harness(offline = false, entries = new Map()) {
  const events = [], readerVariants = new Node('div');
  const context = vm.createContext({
    console, URL, document: { createElement: tag => new Node(tag) },
    t: value => value, getLang: () => 'en', hue: () => 0,
    bookRequestId, variantLabel, offlineBookKey, findOfflineVariant,
    state: { books: [pdf, epub], offlineMode: offline }, readerVariants,
    variantSelections: new Map(), canEditBook: () => false,
    getOfflineBook: async id => entries.get(id),
    toast: message => events.push(['toast', message]),
    saveProgress: async () => events.push(['save']),
    closeReader: async () => events.push(['close']),
    openBook: async (...args) => events.push(['open', ...args]),
    openCardBook: async book => events.push(['card-open', book]),
    renderBooks: () => events.push(['cards']),
    window: { location: { href: 'https://reader.example/?book=work&asset=pdf&page=264&cfi=old' } },
    history: { replaceState: (_state, _unused, url) => events.push(['url', url.href]) },
  });
  vm.runInContext(code, context);
  return { context, readerVariants, events };
}

test('card selector changes the selected file without opening the reader', async () => {
  const { context, events } = harness();
  const card = context.makeCard(pdf, [pdf, epub]);
  const select = card.querySelector('.variant-select');
  select.value = 'epub';
  await select.events.get('change')();
  assert.equal(events.length, 0);
  const replacement = card.replacement;
  assert.equal(replacement.querySelector('.variant-select').value, 'epub');
  await replacement.querySelector('.open-btn').events.get('click')({ stopPropagation() {} });
  assert.equal(events[0][1].asset_id, 'epub');
});

test('reader switch saves the old progress, closes it and drops incompatible page/CFI before opening', async () => {
  const { context, events, readerVariants } = harness();
  context.renderReaderVariants(pdf);
  const select = readerVariants.querySelector('.variant-select');
  select.value = 'epub';
  await select.events.get('change')();
  assert.deepEqual(events.map(event => event[0]), ['save', 'close', 'url', 'open', 'cards']);
  const url = new URL(events[2][1]);
  assert.equal(url.searchParams.get('asset'), 'epub');
  assert.equal(url.searchParams.has('page'), false);
  assert.equal(url.searchParams.has('cfi'), false);
  assert.equal(events[3][1].asset_id, 'epub');
});

test('a missing offline version leaves the current reader open and does not fetch another file', async () => {
  const { context, events, readerVariants } = harness(true);
  context.renderReaderVariants(pdf);
  const select = readerVariants.querySelector('.variant-select');
  select.value = 'epub';
  await select.events.get('change')();
  assert.deepEqual(events.map(event => event[0]), ['toast']);
  assert.equal(select.value, 'pdf');
});

test('saved offline variants open their own blob; loader selection is disabled during startup', async () => {
  const blob = new Blob(['EPUB']);
  const { context, events, readerVariants } = harness(true, new Map([['epub', { book: epub, blob }]]));
  context.renderReaderVariants(pdf, true);
  assert.equal(readerVariants.querySelector('.variant-select').disabled, true);
  context.renderReaderVariants(pdf);
  const select = readerVariants.querySelector('.variant-select');
  select.value = 'epub';
  await select.events.get('change')();
  assert.equal(events.find(event => event[0] === 'open')[2].offlineBlob, blob);
});
