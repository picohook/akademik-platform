# LibRead public demo (`/demo/`)

A visitor opens https://elibrary.libedge.com/demo/ without an account and reads two public-domain NASA books in the **real reader**
(the same `index.html`, `app.js` and styles as the signed-in app), so the demo always shows the reader as it is today.

## How it works

- `GET /demo/` is `index.html` (asset tokens stamped as usual) with one extra script first in `<head>`: `/demo/shim.js`.
- `public/demo/shim.js` replaces `window.fetch` for the reader. Every `/api/…` request is answered in the browser: a fixed demo user
  (role `reader`), the two books, favourites, reading progress, and the annotation API (same version and idempotency rules as the
  server's demo mode). Anything it does not know gets a `404` and is **never forwarded**. Notes, favourites and progress live in this
  browser (`libread-public-demo:v1:state` and the reader's own IndexedDB rows owned by the demo user) and never reach the server.
- The only `/api/` requests that reach the server are the two book files, named by fixed ids, public and read-only (with `Range`):
  - `de000000-0000-4000-8000-00000000b001/book.epub` → `public/demo/earth-at-night.epub`
  - `de000000-0000-4000-8000-00000000b002/file` → `public/demo/earth-as-art.pdf`
- "Demoyu sıfırla" (the notice at the bottom right) deletes the demo's own keys and the demo user's rows; a real account's data in the
  same browser is not touched. The sign-out, password, upload and offline buttons are hidden in the demo.

## The guide

A visitor is not left to find the features alone. `public/demo/guide.js` (injected after the shim, `defer`) opens a short dialog on the first
visit, once the library is on screen: what this is, three steps, and the other tools. Each step does the real thing in the real reader and is
ticked only when the visitor really does it:

1. **Open a book** (the button opens Earth at Night; ticked when the reader opens).
2. **Keep a sentence** ("Show me" selects a real sentence so the reader's own bar appears, with a hint; ticked when a highlight or note is created).
3. **Make it comfortable** (opens the Appearance menu; ticked when anything in it is changed).

The dialog also lists search, bookmarks, notes and export, read aloud (only where the device has a voice) and the More menu, each with a
button that opens it. A "Guide n/3" button stays on screen (above the reader, above the page controls on a phone) and reopens the dialog.
Progress is kept in this browser (`libread-public-demo:v1:guide`) and cleared by "Reset demo", which also returns to the library
(`/demo/`) instead of reloading the address of the open book. The guide only clicks the reader's own buttons and reads its own elements;
it has no data of its own. Turkish and English follow the reader's language.

## The books

Earth at Night (NASA, 2019): five illustrated chapters and two source sections from the original EPUB. Earth as Art (NASA, 2012):
pages 12–22 of the 172-page PDF, unchanged. Both are public domain; see `public/demo/CREDITS.md`. The demo does not claim NASA's
partnership or endorsement. Covers: `public/covers/demo-earth-*.{jpg,png}` (listed in `covers/SOURCES.md`).

Source files and their hashes: `LibRead-Demo-01/reference/nasa/` (kept outside the repository).
`earth-at-night.epub` is that selection with one rule added to its CSS (`.demo-opening-image img { max-height: 68vh !important }`) so the
opening photo fits on the first screen next to its heading.

## Tests

`test/public-demo.browser.mjs` (43 checks): the guide on the first visit and its three steps ticking from real actions, no sign-in, two books with covers, only the two book files reach the server, a note survives a reload,
reset removes only the demo's data, PDF pages and text, 390 px, and the server side (public, read-only, ranges, everything else still
needs a session).

## Product card

The LibRead card's "Demo" button is set from the admin panel, not in code: `card_button_label=Demo`,
`card_button_url=https://elibrary.libedge.com/demo/` (the same fields LibBot uses). Set it once `/demo/` is live.
