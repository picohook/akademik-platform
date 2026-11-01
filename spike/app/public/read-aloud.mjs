// Read aloud ("Sesli oku"): sentence segmentation, the playback controller and the
// browser speech adapter. No DOM here: the book-specific parts (which text, how a sentence is
// highlighted, how the next page or chapter is reached) live in read-aloud-sources.mjs and are
// handed in as a `source`, so everything below can be tested with a fake speech engine.
//
// Speech runs on the device (Web Speech API). No text is sent anywhere.

// ---- segmentation ------------------------------------------------------------------------

// A sentence this long is cut at a clause break: Chrome silently stops very long utterances.
export const MAX_SENTENCE_CHARS = 240;

const ABBREVIATIONS = new Set([
  // Turkish
  'dr', 'prof', 'doç', 'yrd', 'arş', 'öğr', 'gör', 'uzm', 'av', 'bkz', 'vb', 'vs', 'vd', 'örn', 'yy', 'no', 'sn', 'sf', 'cilt', 'cad', 'mah', 'sok', 'tel', 'çev', 'ed', 'hz',
  // English
  'mr', 'mrs', 'ms', 'st', 'jr', 'sr', 'fig', 'figs', 'eq', 'eqs', 'vol', 'vols', 'pp', 'ch', 'cf', 'al', 'etc', 'eds', 'approx', 'dept', 'inc', 'ltd', 'e.g', 'i.e', 'u.s', 'ca',
]);

const hasLetterOrDigit = (text) => /[\p{L}\p{N}]/u.test(text);

function endsWithAbbreviation(text) {
  const match = text.trimEnd().match(/(?:^|[\s(\["'“‘])([\p{L}]{1,6}(?:\.[\p{L}]{1,3})?)\.$/u);
  if (!match) return false;
  const word = match[1].toLocaleLowerCase('tr');
  if (ABBREVIATIONS.has(word)) return true;
  return /^\p{Lu}$/u.test(match[1]); // an initial: "J. Smith"
}

function startsLowercase(text) {
  const first = text.trimStart().match(/[\p{L}]/u)?.[0];
  if (!first) return false;
  return first === first.toLocaleLowerCase('tr') && first !== first.toLocaleUpperCase('tr');
}

function rawSegments(text, lang) {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    try {
      const segmenter = new Intl.Segmenter(lang || 'en', { granularity: 'sentence' });
      return [...segmenter.segment(text)].map((part) => ({ start: part.index, end: part.index + part.segment.length }));
    } catch { /* unknown locale: fall through */ }
  }
  const parts = [];
  const pattern = /[^.!?…\n]+(?:[.!?…]+["'”’)\]]*|\n+|$)/gu;
  let match = pattern.exec(text);
  while (match) {
    parts.push({ start: match.index, end: match.index + match[0].length });
    match = pattern.exec(text);
  }
  return parts;
}

function cutLong(text, start, end) {
  const pieces = [];
  let from = start;
  while (end - from > MAX_SENTENCE_CHARS) {
    const window = text.slice(from, from + MAX_SENTENCE_CHARS);
    let cut = Math.max(window.lastIndexOf('; '), window.lastIndexOf(': '), window.lastIndexOf(', '), window.lastIndexOf(' — '), window.lastIndexOf(' – '));
    if (cut < MAX_SENTENCE_CHARS / 3) cut = window.lastIndexOf(' ');
    if (cut < 1) cut = MAX_SENTENCE_CHARS - 1;
    pieces.push({ start: from, end: from + cut + 1 });
    from += cut + 1;
  }
  pieces.push({ start: from, end });
  return pieces;
}

// Returns [{ text, start, end }] where start/end are offsets into the ORIGINAL string, so a
// caller that built the string from DOM nodes can map a sentence back to its nodes.
export function splitSentences(input, lang = 'en') {
  const text = String(input ?? '');
  const merged = [];
  for (const part of rawSegments(text, lang)) {
    const piece = text.slice(part.start, part.end);
    const prev = merged[merged.length - 1];
    // A split after an abbreviation or an initial, or before a lowercase start, is not a sentence end.
    if (prev && !/\n\s*$/.test(text.slice(prev.start, prev.end)) && (endsWithAbbreviation(text.slice(prev.start, prev.end)) || startsLowercase(piece))) {
      prev.end = part.end;
    } else {
      merged.push({ ...part });
    }
  }
  const out = [];
  for (const part of merged) {
    for (const piece of cutLong(text, part.start, part.end)) {
      const raw = text.slice(piece.start, piece.end);
      const spoken = raw.replace(/\s+/g, ' ').trim();
      if (!spoken || !hasLetterOrDigit(spoken)) continue;
      out.push({ text: spoken, start: piece.start, end: piece.end });
    }
  }
  return out;
}

// ---- words -------------------------------------------------------------------------------

const WORD = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;
export function wordRanges(text) {
  const out = [];
  for (const match of String(text ?? '').matchAll(WORD)) out.push({ start: match.index, end: match.index + match[0].length });
  return out;
}

// The word a speech boundary event points at: the one that contains charIndex, else the next one.
export function wordAt(text, charIndex) {
  const index = Number(charIndex);
  if (!Number.isFinite(index) || index < 0) return null;
  const words = wordRanges(text);
  return words.find((w) => index >= w.start && index < w.end) || words.find((w) => w.start >= index) || null;
}

// ---- voices ------------------------------------------------------------------------------

const baseLang = (value) => String(value || '').toLowerCase().replace('_', '-').split('-')[0];

export function voicesFor(voices, lang) {
  const want = baseLang(lang);
  return (voices || []).filter((voice) => baseLang(voice.lang) === want);
}

function voiceScore(voice) {
  const name = String(voice.name || '').toLowerCase();
  let score = 0;
  if (/natural|neural|online/.test(name)) score += 3;
  if (/enhanced|premium|siri/.test(name)) score += 2;
  if (voice.default) score += 1;
  if (voice.localService === false) score += 1;
  return score;
}

// The preferred voice if it still exists and speaks the language, else the best-scored one, else null.
export function pickVoice(voices, lang, preferredURI) {
  const candidates = voicesFor(voices, lang);
  if (!candidates.length) return null;
  const chosen = candidates.find((voice) => voice.voiceURI === preferredURI);
  if (chosen) return chosen;
  return [...candidates].sort((a, b) => voiceScore(b) - voiceScore(a) || String(a.name).localeCompare(String(b.name)))[0];
}

// ---- browser speech adapter --------------------------------------------------------------

export function createBrowserSpeech(win = globalThis) {
  const synth = win.speechSynthesis;
  const Utterance = win.SpeechSynthesisUtterance;
  const supported = Boolean(synth && Utterance);
  // Chrome can garbage-collect an utterance that is still speaking and never fire `end`; hold it.
  const alive = new Set();
  return {
    supported,
    getVoices: () => (supported ? synth.getVoices() : []),
    onVoicesChanged(callback) {
      if (!supported) return () => {};
      synth.addEventListener?.('voiceschanged', callback);
      return () => synth.removeEventListener?.('voiceschanged', callback);
    },
    speak(text, { lang, rate = 1, voice } = {}, handlers = {}) {
      const utterance = new Utterance(text);
      if (lang) utterance.lang = lang;
      utterance.rate = rate;
      if (voice) utterance.voice = voice;
      alive.add(utterance);
      const done = () => alive.delete(utterance);
      utterance.onstart = () => handlers.onstart?.();
      utterance.onend = () => { done(); handlers.onend?.(); };
      utterance.onerror = (event) => { done(); handlers.onerror?.(event?.error || 'error'); };
      utterance.onboundary = (event) => handlers.onboundary?.({ name: event?.name, charIndex: event?.charIndex, charLength: event?.charLength });
      synth.speak(utterance);
      return { cancel: () => { done(); synth.cancel(); } };
    },
    cancel() { if (supported) synth.cancel(); },
  };
}

// ---- controller --------------------------------------------------------------------------

export const RATES = Object.freeze([0.75, 1, 1.25, 1.5, 2]);
const SILENT_ERRORS = new Set(['canceled', 'cancelled', 'interrupted']);
const MAX_CONSECUTIVE_FAILURES = 3;

// source: {
//   lang(): 'tr' | 'en' | ...
//   start(origin): Promise<segment | null>      origin = { type: 'view' } | { type: 'selection', text }
//   next(segment): Promise<segment | null>      the text after this segment (next page or chapter)
//   dispose?()
// }
// segment: { label, units: [{ text, lang?, activate(): Promise|void, deactivate(): void }] }
export function createReadAloud({
  speech, source, onChange = () => {}, setTimer = setTimeout, clearTimer = clearTimeout, now = Date.now,
  voices = () => speech.getVoices?.() || [], initial = {},
} = {}) {
  let generation = 0;
  let segment = null;
  let index = 0;
  let handle = null;
  let watchdog = null;
  let failures = 0;
  let retried = false;
  let sleepTimer = null;
  let stopAfterCurrent = false;
  // Word following. Engines that report word boundaries drive it exactly; for the rest the words are
  // paced from how long a character takes this voice at this speed, learned from the sentences already read.
  let wordTimers = [];
  let boundarySeen = false;
  let startedAt = 0;
  let msPerChar = Number(initial.msPerChar) > 0 ? Number(initial.msPerChar) : 62;
  const state = {
    status: 'idle', // idle | loading | playing | paused
    index: 0, count: 0, label: '',
    rate: RATES.includes(initial.rate) ? initial.rate : 1,
    voiceURI: initial.voiceURI || '',
    sleepAt: 0, error: '', finished: false, lang: '',
  };
  const emit = () => onChange({ ...state });
  const set = (patch) => { Object.assign(state, patch); emit(); };

  const unit = () => segment?.units[index] || null;
  let lit = null; // the unit currently highlighted, so it is switched off exactly once
  const clearWatchdog = () => { if (watchdog) { clearTimer(watchdog); watchdog = null; } };
  const deactivate = () => {
    const current = lit;
    lit = null;
    try { current?.deactivate?.(); } catch { /* the page may be gone */ }
  };
  const clearWordTimers = () => { for (const timer of wordTimers) clearTimer(timer); wordTimers = []; };
  const silence = () => {
    clearWatchdog();
    clearWordTimers();
    const current = handle;
    handle = null;
    try { current?.cancel(); } catch { /* engine already stopped */ }
  };
  const halt = (patch) => {
    generation += 1;
    silence();
    deactivate();
    stopAfterCurrent = false;
    set({ ...patch });
  };

  async function speakCurrent(token) {
    const current = unit();
    if (!current) return;
    try { await current.activate?.(); } catch { /* highlighting is best effort */ }
    if (token !== generation) { try { current.deactivate?.(); } catch { /* noop */ } return; }
    lit = current;
    const lang = current.lang || source.lang?.() || 'en';
    const voice = pickVoice(voices(), lang, state.voiceURI);
    if (state.status === 'loading') set({ status: 'playing' });
    set({ index, count: segment.units.length, lang });
    const budget = 6000 + (current.text.length * 150) / state.rate;
    watchdog = setTimer(() => {
      if (token !== generation) return;
      silence();
      failures += 1;
      if (!retried && failures < MAX_CONSECUTIVE_FAILURES) { retried = true; speakCurrent(token); return; }
      halt({ status: 'paused', error: 'speech_stalled' });
    }, budget);
    boundarySeen = false;
    startedAt = 0;
    try { current.word?.(null); } catch { /* noop */ }
    const estimateWords = () => {
      if (token !== generation || boundarySeen || !current.word) return;
      const words = wordRanges(current.text);
      const total = (current.text.length * msPerChar) / state.rate;
      const elapsed = now() - startedAt;
      const dueAt = (word) => (word.start / current.text.length) * total;
      // words whose time has already passed are not flashed one after the other: only the current one is shown
      let first = 0;
      words.forEach((word, i) => { if (dueAt(word) <= elapsed) first = i; });
      for (const word of words.slice(first)) {
        wordTimers.push(setTimer(() => { if (token === generation && !boundarySeen) { try { current.word(word); } catch { /* noop */ } } }, Math.max(0, dueAt(word) - elapsed)));
      }
    };
    handle = speech.speak(current.text, { lang, rate: state.rate, voice }, {
      onstart: () => {
        if (token !== generation) return;
        clearWatchdog();
        startedAt = now();
        if (current.word) wordTimers.push(setTimer(estimateWords, 500)); // no boundary event by then: estimate
      },
      onboundary: (event) => {
        if (token !== generation || !current.word) return;
        if (event?.name && event.name !== 'word') return;
        boundarySeen = true;
        clearWordTimers();
        const word = wordAt(current.text, event?.charIndex);
        if (word) { try { current.word(word); } catch { /* noop */ } }
      },
      onend: () => {
        if (token !== generation) return;
        clearWatchdog();
        if (!boundarySeen && startedAt) {
          const spent = now() - startedAt;
          if (spent > 300 && current.text.length > 10) msPerChar = Math.min(200, Math.max(20, Math.round((msPerChar + (spent * state.rate) / current.text.length) / 2)));
        }
        clearWordTimers();
        failures = 0; retried = false;
        advance(token);
      },
      onerror: (code) => {
        if (token !== generation || SILENT_ERRORS.has(String(code))) return;
        clearWatchdog();
        failures += 1;
        if (failures >= MAX_CONSECUTIVE_FAILURES) { halt({ status: 'paused', error: 'speech_failed' }); return; }
        advance(token);
      },
    });
  }

  async function advance(token) {
    if (token !== generation) return;
    deactivate();
    if (stopAfterCurrent) { stopAfterCurrent = false; halt({ status: 'idle', sleepAt: 0 }); return; }
    if (index + 1 < segment.units.length) {
      index += 1;
      speakCurrent(token);
      return;
    }
    set({ status: 'loading' });
    let following = null;
    try { following = await source.next(segment); } catch { following = null; }
    if (token !== generation) return;
    if (!following?.units?.length) { halt({ status: 'idle', finished: true, index: 0 }); return; }
    segment = following;
    index = 0;
    set({ label: segment.label || '', count: segment.units.length });
    speakCurrent(token);
  }

  async function start(origin = { type: 'view' }) {
    halt({ status: 'loading', error: '', finished: false });
    const token = generation;
    let first = null;
    try { first = await source.start(origin); } catch { first = null; }
    if (token !== generation) return false;
    if (!first?.units?.length) { halt({ status: 'idle', error: 'no_text' }); return false; }
    segment = first;
    index = Number.isInteger(first.startIndex) && first.startIndex >= 0 && first.startIndex < first.units.length ? first.startIndex : 0;
    failures = 0;
    retried = false;
    set({ label: segment.label || '', count: segment.units.length });
    speakCurrent(token);
    return true;
  }

  function pause() {
    if (state.status !== 'playing' && state.status !== 'loading') return;
    // Cancel rather than engine pause(): pause/resume is unreliable across browsers. Resume
    // speaks the current sentence again from its start.
    generation += 1;
    silence();
    set({ status: 'paused' });
  }

  function resume() {
    if (state.status !== 'paused' || !segment) return;
    generation += 1;
    set({ status: 'loading', error: '' });
    failures = 0;
    retried = false;
    speakCurrent(generation);
  }

  const toggle = () => (state.status === 'playing' || state.status === 'loading' ? pause() : (state.status === 'paused' ? resume() : start()));

  function stop() {
    clearTimer(sleepTimer);
    sleepTimer = null;
    halt({ status: 'idle', index: 0, count: 0, label: '', error: '', sleepAt: 0 });
    segment = null;
  }

  async function jump(delta) {
    if (!segment || state.status === 'idle') return;
    const resumeAfter = state.status === 'playing' || state.status === 'loading';
    generation += 1;
    const token = generation;
    silence();
    deactivate();
    if (delta < 0) {
      index = Math.max(0, index - 1);
    } else if (index + 1 < segment.units.length) {
      index += 1;
    } else {
      set({ status: 'loading' });
      let following = null;
      try { following = await source.next(segment); } catch { following = null; }
      if (token !== generation) return;
      if (!following?.units?.length) { speakIfResuming(token, resumeAfter); return; }
      segment = following;
      index = 0;
      set({ label: segment.label || '', count: segment.units.length });
    }
    speakIfResuming(token, resumeAfter);
  }
  function speakIfResuming(token, resumeAfter) {
    failures = 0;
    retried = false;
    if (resumeAfter) { set({ status: 'loading' }); speakCurrent(token); return; }
    set({ status: 'paused', index, count: segment.units.length });
    const marked = unit();
    Promise.resolve(marked?.activate?.()).then(() => { lit = marked; }).catch(() => {});
  }

  function restartCurrent() {
    if (state.status !== 'playing' || !segment) return;
    generation += 1;
    silence();
    deactivate();
    speakCurrent(generation);
  }

  function setRate(value) {
    const rate = Number(value);
    if (!RATES.includes(rate) || rate === state.rate) return;
    set({ rate });
    restartCurrent();
  }

  function setVoice(voiceURI) {
    set({ voiceURI: String(voiceURI || '') });
    restartCurrent();
  }

  // Minutes from now; the sentence being read is finished first. 0 or null clears it.
  function setSleep(minutes) {
    clearTimer(sleepTimer);
    sleepTimer = null;
    const m = Number(minutes);
    if (!(m > 0)) { set({ sleepAt: 0 }); return; }
    const at = now() + m * 60_000;
    set({ sleepAt: at });
    sleepTimer = setTimer(() => {
      sleepTimer = null;
      if (state.status === 'playing' || state.status === 'loading') { stopAfterCurrent = true; set({ sleepAt: 0 }); } else { set({ sleepAt: 0 }); }
    }, m * 60_000);
  }

  function dispose() {
    stop();
    try { source.dispose?.(); } catch { /* noop */ }
  }

  return { state: () => ({ ...state }), start, pause, resume, toggle, stop, next: () => jump(1), prev: () => jump(-1), setRate, setVoice, setSleep, dispose };
}
