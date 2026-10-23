# Quiet Scholar — reader UI concept

Static, dependency-free prototype for the reader redesign. It does not touch
`spike/app/public/app.js` and is not wired into the application.

Open directly in a browser:

```text
design/reader-concept.html
```

Or serve the repo root and open `/design/reader-concept.html`.

## What it demonstrates

- Two-level chrome: identity/page context, then reading controls.
- Persistent printed page label: **Sayfa 125 (PDF 137)**.
- Theme **popover** (Light/Sepia/Dark) instead of a cycling button.
- Zoom **segmented control** with an explicit `100%` reset.
- Bookmark as a real toggle (`aria-pressed`).
- Notes / Bookmarks / Highlights tabs.
- Selection toolbar: Copy, Copy with citation, Highlight, Note.
- Mobile: simplified top bar, bottom action bar, TOC/Notes as sheets.
- 24–36 px desktop targets, 44 px mobile targets, visible focus, reduced motion.

## Intentional limits

- Dummy book/page content; no PDF.js or EPUB engine.
- Clipboard/citation actions show local toasts, not server calls.
- No backend, authentication, offline storage or real annotations.
- This is a direction check before integrating into the reader.
