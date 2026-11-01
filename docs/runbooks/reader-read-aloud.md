# Reader: read aloud ("Sesli oku")

Status (2026-11-01): **v142 is live** (sentence following); word following and page-furniture skipping are in the next release. It adds two browser modules and no server
route, no migration and no secret. It uses the device's own voices (Web Speech API): no text is
sent anywhere, it costs nothing and there is no quota.

## What a reader gets
- **Sesli oku** in the reader toolbar (or `Alt+Shift+L`), and **Dinle** in the selection bar to start
  from selected text. A small player appears: previous / play-pause / next sentence, speed
  (0.75x to 2x), voice, sleep timer (15, 30, 60 minutes).
- The sentence being read is **marked** in the page (light) and the **word being spoken** is marked on top of it
  (stronger), and the reader **turns pages and chapters by itself** (PDF page by page, EPUB chapter by
  chapter, scrolled into view when needed).
- **Page numbers, running headers and footers, footnotes and note references are skipped** (one switch in the
  player, on by default, remembered per device). See "Page furniture" below.
- The player **fades after 4 quiet seconds** so it never covers the text; pointer, touch or key brings
  it back; it stays while a keyboard user is on it. With reduced motion the fade is instant.
- The reader turning the page or jumping elsewhere **pauses** the voice (it does not talk over them);
  the place is kept. Closing the book, signing out or opening another book stops it.
- The screen is kept awake while reading (Screen Wake Lock) where the browser supports it.
- Voice and speed are remembered per device (`localStorage`, key `readAloudPrefs`); the voice per
  language. With no voice for the book's language the default voice is used and the player says so.

## How the marking works
- It uses the **CSS Custom Highlight API** (`::highlight(ra-sentence)`, `::highlight(ra-word)`): a marker over a
  DOM Range that adds no element and changes no text, so the PDF text layer and the book are untouched. The
  mark is exactly the sentence or word. The first version marked whole PDF text fragments (usually whole
  lines), which is why a sentence that began mid-line lit up two full lines.
- **Which word:** the voice's `boundary` events (`charIndex`) are used when the engine sends them. If none
  arrives within half a second of the start, the words are **paced from the speed of speech**: milliseconds
  per character, learned from the sentences already read with this voice and speed (starting at 62 ms),
  so a voice without boundary events still gets a reasonable, if less exact, word marker. A real boundary
  event cancels the estimate at once. Words whose time has already passed are not flashed one after the other.
- Where the Highlight API does not exist (Chrome before 105, Safari before 17.2, Firefox before 140) the
  reader falls back to marking the text fragments of the sentence and does not follow words.
- EPUB chapters are iframes; each gets its own small `<style>` for the two markers and its own highlight registry.
  A new chapter is a new iframe, so marks never leak between chapters.

## Page furniture
- **PDF:** a short text in the top or bottom tenth of a page is left out when it is a page number (`12`,
  `Page 12`, `12 / 300`, `xiv`) or when the same text (digits ignored) sits in an edge band on at least two of
  the pages around it. The neighbouring pages are read from the file (`getTextContent`), so they need not be
  drawn. A title that appears once in the band is still read.
- **EPUB:** page-break markers, `doc-pageheader`/`doc-pagefooter`, footnotes, endnotes, note references and in-chapter
  `nav` are left out. `epub:type` is matched both as an XHTML namespaced attribute and as a plain HTML
  attribute (both occur). A plain `<header>` is kept: it usually holds the chapter title.
- Heuristic for PDF: an unusual layout (two columns, side notes) can be misjudged either way; turn the switch off.

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
- `test/read-aloud.test.mjs` (34): word and page-number helpers, spoken-text map, DOM points, word following (boundary events, paced estimate, learned pace, nothing after pause or stop), segmentation and offsets, abbreviations, long sentences, voice
  choice, and the controller on a fake engine and source: order, one highlight at a time, crossing
  segments, pause/resume repeats the sentence, next/prev, rate and voice change restart the sentence,
  stop ignores late engine events, error skipping and the three-failure stop, a stalled engine is retried
  once then reported, the sleep timer finishes the sentence, dispose.
- `test/read-aloud-ui.browser.mjs` (71 checks, real Chromium, fake `speechSynthesis` that also sends word boundaries): the sentence mark is exactly the sentence (including one that starts mid-line and wraps), words are followed in order across two lines, words still advance with boundary events switched off, page numbers/headers/footers/footnotes skipped and read again when the switch is off, PDF read end to
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
- **Which real voices send word boundary events.** The browser test fakes them. Voices that do not (several
  online voices) use the paced estimate, which can drift from the audio by a word or two on long sentences.
  Check on Edge (Natural voices), Chrome on Android and Safari on iPhone.
- **Page-furniture detection on real books** beyond the test fixtures.
- **Chrome's long-utterance cut-off** is worked around by cutting sentences at 240 characters; it is
  not reproduced here.
- Scroll mode and the two-page view are wired (`getLayers`) but covered only by the single-page tests.
- `test/offline-edit.browser.mjs` (annotation POST 422) and `test/offline-bookmarks.browser.mjs`
  (login 500) fail on `main` as well, with or without this change.

## Switching it off
Hide the buttons by returning `false` from `createBrowserSpeech(...).supported` or remove the two
buttons from `index.html`; there is no server side to turn off.
