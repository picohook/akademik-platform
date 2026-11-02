import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_SENTENCE_CHARS, RATES, createReadAloud, pickVoice, splitSentences, voicesFor, wordAt, wordRanges } from '../public/read-aloud.mjs';
import { domPoint, isPageNumberText, normalizeBandText, spokenWithMap } from '../public/read-aloud-sources.mjs';

// Read aloud: segmentation, voice choice and the playback controller, against a fake speech engine
// and a fake source. The DOM-bound parts (PDF text layer, EPUB iframes) are covered in
// test/read-aloud-ui.browser.mjs.
//   node --test test/read-aloud.test.mjs

// ---- segmentation ------------------------------------------------------------------------

test('sentences keep exact offsets into the original string', () => {
  const text = 'Birinci cümle burada.  İkinci cümle de burada!\nÜçüncü satır?';
  const parts = splitSentences(text, 'tr');
  assert.equal(parts.length, 3);
  for (const part of parts) assert.equal(text.slice(part.start, part.end).replace(/\s+/g, ' ').trim(), part.text);
});

test('Turkish and English abbreviations and initials do not end a sentence', () => {
  assert.deepEqual(splitSentences('Prof. Dr. Ayşe Yılmaz konuştu. Sonra gitti.', 'tr').map((s) => s.text), ['Prof. Dr. Ayşe Yılmaz konuştu.', 'Sonra gitti.']);
  assert.deepEqual(splitSentences('Kaynaklar, vb. bir sürü kitap içerir. Bitti.', 'tr').map((s) => s.text), ['Kaynaklar, vb. bir sürü kitap içerir.', 'Bitti.']);
  assert.deepEqual(splitSentences('See Fig. 3 for details. Then stop.', 'en').map((s) => s.text), ['See Fig. 3 for details.', 'Then stop.']);
  assert.deepEqual(splitSentences('The work of J. Smith is cited. It matters.', 'en').map((s) => s.text), ['The work of J. Smith is cited.', 'It matters.']);
});

test('a paragraph break is always a sentence break', () => {
  const parts = splitSentences('A heading without a full stop\nThen the first sentence. And the second one.', 'en').map((s) => s.text);
  assert.equal(parts[0], 'A heading without a full stop');
  assert.equal(parts.length, 3);
});

test('a very long sentence is cut at clause breaks, never mid-word, and loses no text', () => {
  const clause = 'bu uzun cümlenin bir parçası olan oldukça ağır bir yan cümle';
  const long = `${Array.from({ length: 9 }, () => clause).join(', ')}.`;
  assert.ok(long.length > MAX_SENTENCE_CHARS * 2);
  const parts = splitSentences(long, 'tr');
  assert.ok(parts.length >= 3);
  for (const part of parts) assert.ok(part.text.length <= MAX_SENTENCE_CHARS + 2, `piece of ${part.text.length}`);
  assert.equal(parts.map((p) => p.text).join(' ').replace(/\s+/g, ' '), long.replace(/\s+/g, ' '));
  for (const part of parts) assert.ok(!/\s$/.test(part.text) && !/^\s/.test(part.text));
});

test('punctuation-only and empty pieces are dropped', () => {
  assert.deepEqual(splitSentences('•\n\n— — —\nReal text here.', 'en').map((s) => s.text), ['Real text here.']);
  assert.deepEqual(splitSentences('', 'en'), []);
  assert.deepEqual(splitSentences(null, 'en'), []);
});

// ---- voices ------------------------------------------------------------------------------

const VOICES = [
  { voiceURI: 'tr-local', name: 'Tolga', lang: 'tr-TR', localService: true, default: false },
  { voiceURI: 'tr-natural', name: 'Microsoft Emel Online (Natural) - Turkish', lang: 'tr-TR', localService: false },
  { voiceURI: 'en-1', name: 'Samantha', lang: 'en-US', localService: true, default: true },
  { voiceURI: 'en-underscore', name: 'Android English', lang: 'en_GB', localService: true },
];

test('voices are matched by base language, including the Android underscore form', () => {
  assert.deepEqual(voicesFor(VOICES, 'tr').map((v) => v.voiceURI).sort(), ['tr-local', 'tr-natural']);
  assert.deepEqual(voicesFor(VOICES, 'en').map((v) => v.voiceURI).sort(), ['en-1', 'en-underscore']);
  assert.deepEqual(voicesFor(VOICES, 'de'), []);
});

test('the natural/online voice wins by default, a remembered voice wins over that, and none means null', () => {
  assert.equal(pickVoice(VOICES, 'tr', '').voiceURI, 'tr-natural');
  assert.equal(pickVoice(VOICES, 'tr', 'tr-local').voiceURI, 'tr-local');
  assert.equal(pickVoice(VOICES, 'tr', 'en-1').voiceURI, 'tr-natural', 'a remembered voice of another language is ignored');
  assert.equal(pickVoice(VOICES, 'de', ''), null);
  assert.equal(pickVoice([], 'tr', ''), null);
});

// ---- controller --------------------------------------------------------------------------

// A fake engine that completes an utterance only when the test says so.
function fakeSpeech() {
  const spoken = [];
  const engine = {
    spoken,
    cancelled: 0,
    getVoices: () => VOICES,
    speak(text, options, handlers) {
      const record = { text, options, handlers, cancelled: false };
      spoken.push(record);
      return { cancel: () => { record.cancelled = true; engine.cancelled += 1; } };
    },
    finish(i = spoken.length - 1) { spoken[i].handlers.onstart?.(); spoken[i].handlers.onend?.(); },
    begin(i = spoken.length - 1) { spoken[i].handlers.onstart?.(); },
    boundary(i, charIndex, name = 'word') { spoken[i].handlers.onboundary?.({ name, charIndex }); },
    end(i = spoken.length - 1) { spoken[i].handlers.onend?.(); },
    fail(i = spoken.length - 1, code = 'synthesis-failed') { spoken[i].handlers.onerror?.(code); },
  };
  return engine;
}

function fakeSource(segments, { lang = 'en' } = {}) {
  const log = [];
  const makeSegment = (texts, label, startIndex, endIndex) => ({
    label, startIndex, endIndex,
    units: texts.map((text, i) => ({
      text,
      activate() { log.push(`on:${label}:${i}`); },
      deactivate() { log.push(`off:${label}:${i}`); },
      word(range) { log.push(range ? `word:${text.slice(range.start, range.end)}` : 'word:none'); },
    })),
  });
  let cursor = 0;
  return {
    log,
    lang: () => lang,
    async start(origin) { cursor = 0; log.push(`start:${origin.type}`); return makeSegment(segments[0], 'S0', origin.startIndex, origin.endIndex); },
    async next() { cursor += 1; log.push(`next:${cursor}`); return segments[cursor] ? makeSegment(segments[cursor], `S${cursor}`) : null; },
    dispose() { log.push('dispose'); },
  };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));
async function settle() { for (let i = 0; i < 6; i += 1) await tick(); }

function manualTimers() {
  const timers = new Map();
  let id = 0;
  return {
    setTimer: (fn, ms) => { id += 1; timers.set(id, { fn, ms }); return id; },
    clearTimer: (handle) => timers.delete(handle),
    fire(match) { for (const [key, timer] of [...timers]) if (!match || match(timer)) { timers.delete(key); timer.fn(); } },
    pending: () => [...timers.values()],
    fireByDelay(limit = Infinity) {
      for (;;) {
        const next = [...timers].filter(([, t]) => t.ms <= limit).sort((a, b) => a[1].ms - b[1].ms)[0];
        if (!next) return;
        timers.delete(next[0]);
        next[1].fn();
      }
    },
  };
}

test('it reads every sentence in order, crosses into the next segment, and stops at the end', async () => {
  const speech = fakeSpeech();
  const source = fakeSource([['One.', 'Two.'], ['Three.']]);
  const states = [];
  const player = createReadAloud({ speech, source, onChange: (s) => states.push(s.status) });
  await player.start({ type: 'view' });
  await settle();
  assert.deepEqual(speech.spoken.map((s) => s.text), ['One.']);
  speech.finish(); await settle();
  speech.finish(); await settle();
  speech.finish(); await settle();
  assert.deepEqual(speech.spoken.map((s) => s.text), ['One.', 'Two.', 'Three.']);
  assert.equal(player.state().status, 'idle');
  assert.equal(player.state().finished, true);
  // exactly one sentence is highlighted at any moment: every `on` is followed by its `off` before the next `on`
  let open = 0;
  for (const entry of source.log) {
    if (entry.startsWith('on:')) { open += 1; assert.equal(open, 1, 'two sentences highlighted at once'); }
    if (entry.startsWith('off:')) open -= 1;
  }
  assert.equal(open, 0, 'the last highlight was removed');
});

test('the engine receives language, rate and the best voice', async () => {
  const speech = fakeSpeech();
  const player = createReadAloud({ speech, source: fakeSource([['Merhaba dünya.']], { lang: 'tr' }), initial: { rate: 1.5 } });
  await player.start();
  await settle();
  const options = speech.spoken[0].options;
  assert.equal(options.lang, 'tr');
  assert.equal(options.rate, 1.5);
  assert.equal(options.voice.voiceURI, 'tr-natural');
});

test('start can begin in the middle of a segment (reading from a selection)', async () => {
  const speech = fakeSpeech();
  const source = fakeSource([['A.', 'B.', 'C.']]);
  const player = createReadAloud({ speech, source });
  await player.start({ type: 'selection', text: 'B', startIndex: 1 });
  await settle();
  assert.equal(speech.spoken[0].text, 'B.');
});

test('reading a selection stops after the sentence that holds its end, and does not go on to the next page', async () => {
  const speech = fakeSpeech();
  const source = fakeSource([['A.', 'B.', 'C.', 'D.'], ['E.']]);
  const player = createReadAloud({ speech, source });
  await player.start({ type: 'selection', text: 'B C', startIndex: 1, endIndex: 2 });
  await settle();
  for (let i = 0; i < 4; i += 1) { speech.finish(); await settle(); }
  assert.deepEqual(speech.spoken.map((s) => s.text), ['B.', 'C.']);
  assert.equal(player.state().status, 'idle');
  assert.equal(source.log.some((line) => line.startsWith('next:')), false, 'the next page is not asked for');
});

test('reading the view, with no selection, still runs on to the following page', async () => {
  const speech = fakeSpeech();
  const source = fakeSource([['A.'], ['B.']]);
  const player = createReadAloud({ speech, source });
  await player.start({ type: 'view' });
  await settle();
  for (let i = 0; i < 4; i += 1) { speech.finish(); await settle(); }
  assert.deepEqual(speech.spoken.map((s) => s.text), ['A.', 'B.']);
});

test('pause cancels speech and resume repeats the SAME sentence, not the next', async () => {
  const speech = fakeSpeech();
  const player = createReadAloud({ speech, source: fakeSource([['One.', 'Two.']]) });
  await player.start(); await settle();
  player.pause(); await settle();
  assert.equal(player.state().status, 'paused');
  assert.equal(speech.spoken[0].cancelled, true);
  speech.finish(0); await settle(); // a late event from the cancelled utterance must change nothing
  assert.equal(speech.spoken.length, 1);
  player.resume(); await settle();
  assert.deepEqual(speech.spoken.map((s) => s.text), ['One.', 'One.']);
  assert.equal(player.state().status, 'playing');
});

test('toggle plays, pauses and resumes', async () => {
  const speech = fakeSpeech();
  const player = createReadAloud({ speech, source: fakeSource([['One.']]) });
  player.toggle(); await settle();
  assert.equal(player.state().status, 'playing');
  player.toggle(); await settle();
  assert.equal(player.state().status, 'paused');
  player.toggle(); await settle();
  assert.equal(player.state().status, 'playing');
});

test('next and prev move one sentence; prev at the start stays at the start', async () => {
  const speech = fakeSpeech();
  const player = createReadAloud({ speech, source: fakeSource([['A.', 'B.', 'C.']]) });
  await player.start(); await settle();
  await player.next(); await settle();
  await player.next(); await settle();
  assert.deepEqual(speech.spoken.map((s) => s.text), ['A.', 'B.', 'C.']);
  await player.prev(); await settle();
  assert.equal(speech.spoken.at(-1).text, 'B.');
  await player.prev(); await player.prev(); await player.prev(); await settle();
  assert.equal(speech.spoken.at(-1).text, 'A.');
  assert.equal(player.state().index, 0);
});

test('next while paused moves the marker but stays paused', async () => {
  const speech = fakeSpeech();
  const player = createReadAloud({ speech, source: fakeSource([['A.', 'B.']]) });
  await player.start(); await settle();
  player.pause();
  await player.next(); await settle();
  assert.equal(player.state().status, 'paused');
  assert.equal(player.state().index, 1);
  assert.equal(speech.spoken.length, 1, 'nothing is spoken while paused');
  player.resume(); await settle();
  assert.equal(speech.spoken.at(-1).text, 'B.');
});

test('next at the end of a segment fetches the following one', async () => {
  const speech = fakeSpeech();
  const source = fakeSource([['A.'], ['Next page.']]);
  const player = createReadAloud({ speech, source });
  await player.start(); await settle();
  await player.next(); await settle();
  assert.equal(speech.spoken.at(-1).text, 'Next page.');
  assert.ok(source.log.includes('next:1'));
});

test('changing the rate restarts the current sentence at the new speed, once', async () => {
  const speech = fakeSpeech();
  const player = createReadAloud({ speech, source: fakeSource([['One.', 'Two.']]) });
  await player.start(); await settle();
  player.setRate(2); await settle();
  assert.equal(speech.spoken.length, 2);
  assert.deepEqual(speech.spoken.map((s) => [s.text, s.options.rate]), [['One.', 1], ['One.', 2]]);
  player.setRate(2); await settle();
  assert.equal(speech.spoken.length, 2, 'the same rate does nothing');
  player.setRate(3); await settle();
  assert.equal(speech.spoken.length, 2, 'a rate outside the offered list is ignored');
  assert.deepEqual([...RATES], [0.75, 1, 1.25, 1.5, 2]);
});

test('changing the voice restarts the sentence with that voice', async () => {
  const speech = fakeSpeech();
  const player = createReadAloud({ speech, source: fakeSource([['Merhaba.']], { lang: 'tr' }) });
  await player.start(); await settle();
  player.setVoice('tr-local'); await settle();
  assert.equal(speech.spoken.at(-1).options.voice.voiceURI, 'tr-local');
});

test('stop silences, removes the highlight and ignores late engine events', async () => {
  const speech = fakeSpeech();
  const source = fakeSource([['One.', 'Two.']]);
  const player = createReadAloud({ speech, source });
  await player.start(); await settle();
  player.stop(); await settle();
  assert.equal(player.state().status, 'idle');
  assert.equal(speech.spoken[0].cancelled, true);
  assert.ok(source.log.includes('off:S0:0'));
  speech.finish(0); await settle();
  assert.equal(speech.spoken.length, 1, 'a late `end` from the old utterance must not start the next sentence');
});

test('a source with no text ends quietly with a reason, and starting twice does not double-speak', async () => {
  const speech = fakeSpeech();
  const empty = { lang: () => 'en', start: async () => ({ units: [] }), next: async () => null };
  const player = createReadAloud({ speech, source: empty });
  assert.equal(await player.start(), false);
  assert.equal(player.state().error, 'no_text');
  const player2 = createReadAloud({ speech, source: fakeSource([['A.']]) });
  await Promise.all([player2.start(), player2.start()]);
  await settle();
  assert.equal(speech.spoken.filter((s) => s.text === 'A.').length, 1, 'only the latest start speaks');
});

test('an utterance error skips that sentence; three in a row stop with an error', async () => {
  const speech = fakeSpeech();
  const player = createReadAloud({ speech, source: fakeSource([['A.', 'B.', 'C.', 'D.', 'E.', 'F.']]) });
  await player.start(); await settle();
  speech.fail(); await settle();
  assert.equal(speech.spoken.at(-1).text, 'B.', 'one failure: skipped');
  speech.finish(); await settle();
  assert.equal(speech.spoken.at(-1).text, 'C.');
  speech.fail(); await settle();
  speech.fail(); await settle();
  speech.fail(); await settle();
  assert.equal(player.state().status, 'paused');
  assert.equal(player.state().error, 'speech_failed');
});

test('our own cancellation is not counted as a failure', async () => {
  const speech = fakeSpeech();
  const player = createReadAloud({ speech, source: fakeSource([['A.', 'B.']]) });
  await player.start(); await settle();
  for (let i = 0; i < 5; i += 1) speech.fail(0, 'interrupted');
  speech.fail(0, 'canceled');
  await settle();
  assert.equal(player.state().status, 'playing');
  assert.equal(player.state().error, '');
});

test('an engine that never answers is retried once, then reported (no endless silent run)', async () => {
  const speech = fakeSpeech();
  const timers = manualTimers();
  const player = createReadAloud({ speech, source: fakeSource([['A.', 'B.']]), setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  await player.start(); await settle();
  timers.fire(); await settle();
  assert.equal(speech.spoken.length, 2, 'retried the same sentence');
  assert.equal(speech.spoken[1].text, 'A.');
  timers.fire(); await settle();
  assert.equal(player.state().status, 'paused');
  assert.equal(player.state().error, 'speech_stalled');
});

test('the sleep timer lets the current sentence finish, then stops', async () => {
  const speech = fakeSpeech();
  const timers = manualTimers();
  let clock = 1_000;
  const player = createReadAloud({ speech, source: fakeSource([['A.', 'B.', 'C.']]), setTimer: timers.setTimer, clearTimer: timers.clearTimer, now: () => clock });
  await player.start(); await settle();
  player.setSleep(15);
  assert.equal(player.state().sleepAt, clock + 15 * 60_000);
  timers.fire((t) => t.ms === 15 * 60_000); await settle();
  assert.equal(player.state().status, 'playing', 'still finishing the sentence');
  speech.finish(); await settle();
  assert.equal(player.state().status, 'idle');
  assert.equal(speech.spoken.length, 1, 'no further sentence is started');
  player.setSleep(0);
  assert.equal(player.state().sleepAt, 0);
});

test('dispose stops and releases the source', async () => {
  const speech = fakeSpeech();
  const source = fakeSource([['A.']]);
  const player = createReadAloud({ speech, source });
  await player.start(); await settle();
  player.dispose();
  assert.equal(player.state().status, 'idle');
  assert.ok(source.log.includes('dispose'));
});

// ---- page furniture ----------------------------------------------------------------------

test('page numbers on their own are recognised, sentences and years in text are not', () => {
  for (const yes of ['12', ' 12 ', '- 12 -', '— 12 —', 'Page 12', 'page 12', 'Sayfa 12', 's. 12', 'p. 3', '12 / 300', '12 of 300', 'xiv', 'IV']) assert.equal(isPageNumberText(yes), true, yes);
  for (const no of ['', 'Chapter 12', '1999 was a good year', 'Table 3', 'Fig. 2', 'Introduction', 'A very long running header that is plainly not a page number at all']) assert.equal(isPageNumberText(no), false, no);
});

test('the same running title on different pages compares equal, different titles do not', () => {
  assert.equal(normalizeBandText('Annual Review 2026 - 12'), normalizeBandText('Annual Review 2026 - 13'));
  assert.equal(normalizeBandText('  Annual   Review '), 'annual review');
  assert.notEqual(normalizeBandText('Chapter One'), normalizeBandText('Chapter Two'));
  assert.equal(normalizeBandText(''), '');
  assert.equal(normalizeBandText('•'), '');
  assert.equal(normalizeBandText('x'.repeat(101)), '', 'a long text is a sentence, not furniture');
  assert.equal(normalizeBandText('12'), '#', 'a bare page number is just "#"');
});

// ---- following words ---------------------------------------------------------------------

test('words are found with apostrophes and hyphens kept inside, digits included', () => {
  const text = "It's a well-known 2026 fact.";
  assert.deepEqual(wordRanges(text).map((w) => text.slice(w.start, w.end)), ["It's", 'a', 'well-known', '2026', 'fact']);
  assert.deepEqual(wordRanges(''), []);
});

test('a boundary index inside a word or at its first letter points at that word; between words at the next', () => {
  const text = 'Hello brave new world.';
  assert.deepEqual(wordAt(text, 0), { start: 0, end: 5 });
  assert.deepEqual(wordAt(text, 8), { start: 6, end: 11 });
  assert.deepEqual(wordAt(text, 5), { start: 6, end: 11 }, 'a space points at the next word');
  assert.equal(wordAt(text, 40), null);
  assert.equal(wordAt(text, -1), null);
  assert.equal(wordAt(text, undefined), null);
});

test('spoken text maps back to the raw text, collapsed whitespace and all', () => {
  const raw = '  Hello \n  brave   world. ';
  const { text, map } = spokenWithMap(raw);
  assert.equal(text, 'Hello brave world.');
  assert.equal(map.length, text.length);
  for (let i = 0; i < text.length; i += 1) if (text[i] !== ' ') assert.equal(raw[map[i]], text[i], 'char ' + i);
  assert.equal(raw[map[0]], 'H');
  assert.equal(raw[map[map.length - 1]], '.');
  assert.deepEqual(spokenWithMap('   '), { text: '', map: [] });
});

test('a DOM point is found in the right span, gaps move forward for a start and back for an end', () => {
  const span = (value, start, raw = null) => ({ el: { childNodes: [{ nodeType: 3, nodeValue: raw ?? value }] }, start, end: start + value.length, raw });
  const map = [span('Hello', 0), span('world', 6)]; // "Hello world": a joining space at 5
  assert.equal(domPoint(map, 2, false).offset, 2);
  assert.equal(domPoint(map, 8, false).offset, 2);
  assert.equal(domPoint(map, 5, false).offset, 0, 'a start in the gap moves to the next span');
  assert.equal(domPoint(map, 5, true).offset, 5, 'an end in the gap moves back to the end of the previous span');
  assert.equal(domPoint(map, 11, true).offset, 5);
  assert.equal(domPoint(map, 99, false), null);
  const soft = [span('programme', 0, 'pro\u00adgramme')]; // a soft hyphen in the DOM text, not in the joined text
  assert.equal(domPoint(soft, 3, false).offset, 4, 'offsets skip the soft hyphen');
  assert.equal(domPoint(soft, 9, true).offset, 10);
});

test('the voice\'s word boundaries drive the word, and nothing is guessed while they arrive', async () => {
  const speech = fakeSpeech();
  const source = fakeSource([['Hello brave new world.']]);
  const timers = manualTimers();
  const player = createReadAloud({ speech, source, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  await player.start(); await settle();
  speech.begin(0);
  speech.boundary(0, 0);
  speech.boundary(0, 6);
  speech.boundary(0, 12);
  timers.fireByDelay(); await settle(); // the 500 ms "no boundary yet?" timer must have been cancelled by the first boundary
  speech.boundary(0, 16);
  const words = source.log.filter((e) => e.startsWith('word:')).map((e) => e.slice(5));
  assert.deepEqual(words, ['none', 'Hello', 'brave', 'new', 'world']);
  speech.boundary(0, 5, 'sentence');
  assert.equal(source.log.filter((e) => e.startsWith('word:')).length, words.length, 'a sentence boundary is not a word');
});

test('a voice that sends no boundaries gets words paced from the speed of speech', async () => {
  const speech = fakeSpeech();
  const source = fakeSource([['aaaa bbbb cccc dddd.']]);
  const timers = manualTimers();
  let clock = 0;
  const player = createReadAloud({ speech, source, setTimer: timers.setTimer, clearTimer: timers.clearTimer, now: () => clock, initial: { msPerChar: 50 } });
  await player.start(); await settle();
  speech.begin(0);
  const words = () => source.log.filter((e) => e.startsWith('word:')).map((e) => e.slice(5));
  clock = 500;
  timers.fire((t) => t.ms === 500); // nothing arrived after half a second: estimate. 20 chars x 50 ms = 1000 ms in all
  timers.fire((t) => t.ms === 0);
  assert.deepEqual(words(), ['none', 'cccc'], 'at 500 ms the third word (due at 10/20 of 1000 ms) is current; earlier ones are not flashed');
  timers.fire((t) => t.ms === 250);
  assert.deepEqual(words(), ['none', 'cccc', 'dddd'], 'the last word 250 ms later (due at 15/20 of 1000 ms)');
});

test('the pace is learned: after one sentence the next is estimated from how long that took', async () => {
  const speech = fakeSpeech();
  const source = fakeSource([['aaaa bbbb cccc dddd.', 'eeee ffff gggg hhhh.']]);
  const timers = manualTimers();
  let clock = 0;
  const player = createReadAloud({ speech, source, setTimer: timers.setTimer, clearTimer: timers.clearTimer, now: () => clock, initial: { msPerChar: 100 } });
  await player.start(); await settle();
  clock = 10; speech.begin(0); // (a real clock is never 0)
  clock = 410; // 20 chars in 400 ms = 20 ms a char; the default of 100 was far too slow
  speech.end(0); await settle();
  clock = 1000; speech.begin(1);
  clock = 1700; // 700 ms into the second sentence
  timers.fire((t) => t.ms === 500);
  timers.fire((t) => t.ms === 0);
  const words = source.log.filter((e) => e.startsWith('word:')).map((e) => e.slice(5));
  // learned pace (100 + 20) / 2 = 60 ms a char, 20 chars = 1200 ms: "gggg" is due at 10/20 x 1200 = 600 ms, so it is the
  // current word at 700 ms. On the unlearned 100 ms a char it would still be "ffff" (due at 500 ms, gggg at 1000 ms).
  assert.equal(words[words.length - 1], 'gggg', 'the pace of the first sentence was used: ' + words.join(','));
});

test('after pause or stop no late boundary or timer moves the highlight', async () => {
  const speech = fakeSpeech();
  const source = fakeSource([['Hello brave new world.']]);
  const timers = manualTimers();
  const player = createReadAloud({ speech, source, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  await player.start(); await settle();
  speech.begin(0);
  speech.boundary(0, 0);
  player.pause(); await settle();
  const before = source.log.length;
  speech.boundary(0, 6);
  timers.fireByDelay();
  assert.equal(source.log.length, before, 'nothing after pause');
  player.stop(); await settle();
  speech.boundary(0, 12);
  assert.equal(source.log.filter((e) => e === 'word:brave').length, 0);
});
