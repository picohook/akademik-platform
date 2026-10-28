import test from 'node:test';
import assert from 'node:assert/strict';
import { bindEpubCopyPolicy, EpubEngine } from '../public/epub-engine.mjs';

function element({ editable = false, input = false } = {}) {
  return {
    nodeType: 1,
    closest(selector) {
      if (selector === 'input, textarea' && input) return this;
      if (selector === '[contenteditable]' && editable) return this;
      return null;
    },
    getAttribute() { return ''; },
  };
}

function chapter() {
  const listeners = new Map();
  const viewListeners = new Map();
  const text = { nodeType: 3, parentElement: element() };
  const selection = { anchorNode: text, focusNode: text, isCollapsed: false, toString: () => 'Selected book text' };
  const viewport = { content: 'width=800, height=600, initial-scale=1, maximum-scale=1, user-scalable=no' };
  const doc = {
    head: {},
    querySelector(selector) { return selector === 'meta[name="viewport"]' ? viewport : null; },
    activeElement: element(),
    getSelection: () => selection,
    addEventListener(type, listener, capture) { listeners.set(type, { listener, capture }); },
    removeEventListener(type) { listeners.delete(type); },
    defaultView: {
      addEventListener(type, listener) { viewListeners.set(type, listener); },
      removeEventListener(type) { viewListeners.delete(type); },
    },
  };
  function dispatch(type, target = element()) {
    const event = {
      type, target, defaultPrevented: false, stopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopImmediatePropagation() { this.stopped = true; },
    };
    listeners.get(type)?.listener(event);
    return event;
  }
  return { doc, selection, viewport, dispatch, listeners, viewListeners };
}

test('denied chapter copy and cut are stopped in capture phase without changing selection', () => {
  const frame = chapter();
  const blocked = [];
  bindEpubCopyPolicy(frame.doc, { canCopy: () => false, onCopyBlocked: event => blocked.push(event.type) });
  for (const type of ['copy', 'cut']) {
    assert.equal(frame.listeners.get(type).capture, true);
    const event = frame.dispatch(type);
    assert.equal(event.defaultPrevented, true);
    assert.equal(event.stopped, true);
  }
  assert.deepEqual(blocked, ['copy', 'cut']);
  assert.equal(String(frame.selection), 'Selected book text');
  assert.equal(frame.selection.isCollapsed, false);
  assert.deepEqual([...frame.listeners.keys()], ['copy', 'cut', 'pointerdown']);
});

test('permission is read for every event, including policy changes after opening', () => {
  const frame = chapter();
  let allowed = true;
  bindEpubCopyPolicy(frame.doc, { canCopy: () => allowed });
  assert.equal(frame.dispatch('copy').defaultPrevented, false);
  allowed = false;
  assert.equal(frame.dispatch('copy').defaultPrevented, true);
  allowed = true;
  assert.equal(frame.dispatch('cut').defaultPrevented, false);
});

test('user text in inputs, textareas and contenteditable remains copyable', () => {
  const frame = chapter();
  bindEpubCopyPolicy(frame.doc, { canCopy: () => false });
  for (const ownText of [element({ input: true }), element({ editable: true })]) {
    assert.equal(frame.dispatch('copy', ownText).defaultPrevented, false);
    assert.equal(frame.dispatch('cut', ownText).defaultPrevented, false);
    frame.doc.activeElement = ownText;
    assert.equal(frame.dispatch('copy').defaultPrevented, false);
    frame.doc.activeElement = element();
    frame.selection.anchorNode = { nodeType: 3, parentElement: ownText };
    assert.equal(frame.dispatch('copy').defaultPrevented, false);
  }
});

test('collapsed or empty selections do not trigger a blocked-copy notification', () => {
  const frame = chapter();
  bindEpubCopyPolicy(frame.doc, { canCopy: () => false, onCopyBlocked: () => assert.fail('no book selection') });
  frame.selection.isCollapsed = true;
  assert.equal(frame.dispatch('copy').defaultPrevented, false);
  frame.selection.isCollapsed = false;
  frame.selection.toString = () => '  ';
  assert.equal(frame.dispatch('copy').defaultPrevented, false);
});

test('explicit cleanup and iframe pagehide remove handlers once', () => {
  for (const throughPagehide of [false, true]) {
    const frame = chapter();
    let disposed = 0;
    const dispose = bindEpubCopyPolicy(frame.doc, { canCopy: () => false, onDispose: () => disposed++ });
    if (throughPagehide) frame.viewListeners.get('pagehide')();
    else dispose();
    dispose();
    assert.equal(disposed, 1);
    assert.equal(frame.listeners.size, 0);
    assert.equal(frame.viewListeners.size, 0);
    assert.equal(frame.dispatch('copy').defaultPrevented, false);
  }
});

test('chapter pointerdown dismisses stale selection, parent-toolbar interaction does not', () => {
  const frame = chapter();
  const toolbarDocument = chapter();
  let deselections = 0;
  let cachedSelection = 'Selected book text';
  const dispose = bindEpubCopyPolicy(frame.doc, {
    onDeselected: () => { deselections++; cachedSelection = null; },
  });
  assert.equal(frame.listeners.get('pointerdown').capture, true);
  toolbarDocument.dispatch('pointerdown');
  assert.equal(cachedSelection, 'Selected book text');
  assert.equal(deselections, 0);
  const interaction = frame.dispatch('pointerdown');
  assert.equal(cachedSelection, null);
  assert.equal(deselections, 1);
  assert.equal(interaction.defaultPrevented, false);
  assert.equal(String(frame.selection), 'Selected book text');
  dispose();
  frame.dispatch('pointerdown');
  assert.equal(deselections, 1);
});

test('each newly rendered chapter receives policy and engine destruction removes handlers', async () => {
  const frames = [chapter(), chapter()];
  let contentHook;
  const rendition = {
    hooks: { content: { register(callback) { contentHook = callback; } } },
    on() {}, resize() {}, destroy() {},
    async display() { contentHook({ document: frames[0].doc }); },
  };
  const book = {
    ready: Promise.resolve(), renderTo: () => rendition,
    loaded: { navigation: Promise.resolve({ toc: [] }) },
    locations: { generate: async () => {} }, destroy() {},
  };
  const previousWindow = globalThis.window;
  const previousObserver = globalThis.MutationObserver;
  const observers = [];
  globalThis.MutationObserver = class {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(node) { this.node = node; }
    disconnect() { this.disconnected = true; }
  };
  globalThis.window = { ePub: () => book, innerWidth: 800, innerHeight: 600, addEventListener() {}, removeEventListener() {} };
  try {
    let blocked = 0;
    let deselected = 0;
    const engine = new EpubEngine({ clientWidth: 800, clientHeight: 600 }, {
      canCopy: () => false, onCopyBlocked: () => blocked++,
      onDeselected: () => deselected++,
    });
    await engine.open('fixture.epub');
    contentHook({ document: frames[1].doc });
    for (const frame of frames) assert.equal(frame.viewport.content, 'width=800, height=600, initial-scale=1');
    frames[1].viewport.content = 'width=320, height=420, maximum-scale=1, minimum-scale=1, user-scalable=no';
    // Found by what it watches, not by creation order: the engine may create other
    // observers for the same chapter.
    const viewportObserver = observers.find(observer => observer.node === frames[1].doc.head);
    assert.ok(viewportObserver, 'nothing watches the chapter head for a viewport re-write');
    viewportObserver.callback();
    assert.equal(frames[1].viewport.content, 'width=320, height=420');
    for (const frame of frames) assert.equal(frame.dispatch('copy').defaultPrevented, true);
    assert.equal(blocked, 2);
    for (const frame of frames) frame.dispatch('pointerdown');
    assert.equal(deselected, 2);
    frames[0].viewListeners.get('pagehide')();
    assert.equal(engine.copyPolicyDisposers.size, 1);
    // The disposed chapter's own observer must be disconnected; the chapter still
    // on screen keeps its own.
    assert.equal(observers.filter(observer => observer.node === frames[0].doc.head).every(observer => observer.disconnected), true);
    engine.destroy();
    assert.equal(engine.copyPolicyDisposers.size, 0);
    for (const frame of frames) assert.equal(frame.listeners.has('copy'), false);
    for (const frame of frames) {
      assert.equal(frame.listeners.has('pointerdown'), false);
      assert.equal(frame.listeners.has('keydown'), false);
      frame.dispatch('pointerdown');
    }
    assert.equal(deselected, 2);
    assert.ok(observers.every(observer => observer.disconnected));
  } finally {
    if (previousObserver === undefined) delete globalThis.MutationObserver;
    else globalThis.MutationObserver = previousObserver;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
