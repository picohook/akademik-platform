# Mobile and PWA

## What ships

- `manifest.webmanifest` + 180/192/512 PNG icons; installable as a standalone PWA.
- `sw.js` caches the **app shell** (`/`, styles, app modules, icons) and serves it offline.
- API, PDF/EPUB uploads and OCR files are **not** cached by the service worker.
- Book files can be downloaded explicitly to **IndexedDB** (card ↓); the header **Çevrimdışı** modal opens/deletes them. Offline books reopen from the local blob, with local page/CFI progress.
- Offline highlights/notes are stored in IndexedDB and queued; on reconnect they are POSTed to `/api/annotations`, and offline deletes are queued as DELETE operations. There is no multi-device conflict resolution yet: last successful sync wins.
- Static JS/CSS use network-first with cache fallback, so a new deploy is picked up on the next online load.
- Touch swipe on the PDF/EPUB page area: horizontal swipe >55px moves one page (or one EPUB section).
- ≤600px: reader toolbar wraps, non-essential PDF controls are hidden, tap targets are at least 38px, form font is 16px (avoids iOS focus zoom), TOC/notes panels are 88vw overlays.

## Install

Serve over HTTPS (or localhost). Open the app in Chrome/Edge → install icon in the address bar; Android Chrome → “Add to Home screen”; iOS Safari → Share → “Add to Home Screen”.

The service worker registers automatically on secure origins. To force an update after a deploy:

1. Close all app tabs.
2. Reopen the app online once.
3. DevTools → Application → Service Workers → **Update** / **Unregister** if testing.

## Test matrix

- iPhone Safari: login, catalog, open PDF, pinch browser zoom, swipe page, TOC overlay, notes overlay, close.
- Android Chrome: same, plus install prompt and standalone launch.
- 320×640: no horizontal page scroll; toolbar controls reachable.
- 768×1024: catalog grid, reader toolbar.
- Offline: app shell opens; API calls fail with the normal error, no stale book data.

## Known limitations

- No offline book/PDF/EPUB cache (would need quota/storage UX).
- No native app; PWA only.
- EPUB fixed-layout behaves differently from reflow; test both.
- Swipe in EPUB only inside the EPUB iframe; links/buttons suppress it.
