# Reader: read aloud ("Sesli oku")

Status (2026-11-01): **implemented, not released.** It adds two browser modules and no server
route, no migration and no secret. It uses the device's own voices (Web Speech API): no text is
sent anywhere, it costs nothing and there is no quota.

## What a reader gets
- **Sesli oku** in the reader toolbar (or `Alt+Shift+L`), and **Dinle** in the selection bar to start
  from selected text. A small player appears: previous / play-pause / next sentence, speed
  (0.75x to 2x), voice, sleep timer (15, 30, 60 minutes).
- The sentence being read is **highlighted** in the page and the reader **turns pages and chapters
  by itself** (PDF page by page, EPUB chapter by chapter, scrolled into view when needed).
- The player **fades after 4 quiet seconds** so it never covers the text; pointer, touch or key brings
  it back; it stays while a keyboard user is on it. With reduced motion the fade is instant.
- The reader turning the page or jumping elsewhere **pauses** the voice (it does not talk over them);
  the place is kept. Closing the book, signing out or opening another book stops it.
- The screen is kept awake while reading (Screen Wake Lock) where the browser supports it.
- Voice and speed are remembered per device (`localStorage`, key `readAloudPrefs`); the voice per
  language. With no voice for the book's language the default voice is used and the player says so.

## Decisions
- **Allowed for every book the reader can open, including `allow_copy = false`.** The text never leaves
  the device and it is an accessibility feature. If a publisher requires otherwise this is one `if` in
  `app.js` (`raStart`).
- **Pause is "cancel and repeat the sentence on resume"**, not the engine's pause/resume, which is
  unreliable across browsers. Resuming repeats the interrupted sentence from its start.
- **A page break is a sentence break** (a sentence that continues on the next page is read as two
  pieces). Paragraphs are sentence breaks in EPUB; in PDF the text layer has no paragraph marks, so a
  heading without a full stop is read together with the sentence after it.
- Line-end hyphenation in PDFs is joined ("pro-" "gramme" is read as "programme").

## Files
- `public/read-aloud.mjs`: sentence splitting (Turkish and English abbreviations, long sentences cut at
  clause breaks, offsets kept), voice choice, the browser speech adapter, the playback controller.
  No DOM; tested with a fake engine.
- `public/read-aloud-sources.mjs`: what to read for a PDF (the text layer, which holds the OCR layer
  of scanned books) and for an EPUB (the chapter document), how a sentence is highlighted, how the
  next page or chapter is reached.
- `public/app.js`, `index.html`, `styles.css`: player, buttons, shortcut, wiring.
- `server.mjs`: the two modules are added to the static allowlist (**new client modules must be
  listed there or they are served as 404 and the app does not start**), and to `sw.js` `SHELL`.
- Tests that copy a fixed list of client files into a sandbox (`annotation-*`, `offline-*`) list the
  two modules too.

## Tests
- `test/read-aloud.test.mjs` (24): segmentation and offsets, abbreviations, long sentences, voice
  choice, and the controller on a fake engine and source: order, one highlight at a time, crossing
  segments, pause/resume repeats the sentence, next/prev, rate and voice change restart the sentence,
  stop ignores late engine events, error skipping and the three-failure stop, a stalled engine is retried
  once then reported, the sleep timer finishes the sentence, dispose.
- `test/read-aloud-ui.browser.mjs` (48 checks, real Chromium, fake `speechSynthesis`): PDF read end to
  end with automatic page turns and highlight, pause/resume, speed, voice, start from a selection, the
  reader's own page turn pauses it, controls fade and return, `Alt+Shift+L`, closing the book stops
  it; EPUB read end to end with heading, script text skipped, highlight, automatic page and chapter
  turns; the player fits a 390px screen.

## Not verified (do not assume)
- **How a real voice sounds, and which voices a given device has.** Chromium here has no voices, so a
  fake engine was used. Quality varies: Edge's "Natural" Turkish voices are good; others are robotic.
  Try it on a real Windows/Edge, Android/Chrome and iPhone/Safari before announcing it.
- **Background playback and lock-screen controls.** Media Session handlers are set, but browsers differ
  in whether a page that only uses speech synthesis gets lock-screen controls, and mobile browsers
  often stop speech when the tab is in the background. Expect "screen on" use.
- **Word-level highlighting** is not done; the unit is the sentence (boundary events are not reliable
  on all voices).
- **Chrome's long-utterance cut-off** is worked around by cutting sentences at 240 characters; it is
  not reproduced here.
- Scroll mode and the two-page view are wired (`getLayers`) but covered only by the single-page tests.
- `test/offline-edit.browser.mjs` (annotation POST 422) and `test/offline-bookmarks.browser.mjs`
  (login 500) fail on `main` as well, with or without this change.

## Switching it off
Hide the buttons by returning `false` from `createBrowserSpeech(...).supported` or remove the two
buttons from `index.html`; there is no server side to turn off.
