# Accessibility audit — WCAG 2.2 AA

Date: 2026-10-22  
Scope: login, catalog, modals, PDF reader, EPUB reader, notes/search/highlight UI.

## What passes

| Area | Evidence |
|---|---|
| Contrast | `muted` 5.0–5.5:1, accent 7.7:1, body 16.8:1 on paper |
| Focus visible | global `:focus-visible` outline |
| Skip link | first Tab moves to `#mainContent` |
| Login isolation | header/main/skip link are `inert` while login is open |
| Modal focus | Tab/Shift+Tab trap; Esc closes; focus returns to trigger |
| Reader focus | `role=dialog`, `aria-modal`, background inert, Tab stays inside |
| Panels | TOC/Notes `aria-expanded` + `aria-controls`; tabs `role=tablist`, arrow keys |
| Current location | `aria-current` on TOC/thumbnails; `aria-live` page/chapter label |
| Search | labelled inputs, live result status, no color-only state |
| Reduced motion | `prefers-reduced-motion: reduce` disables transitions/scroll |
| Canvas | decorative canvases `aria-hidden`; page region has an accessible label |
| EPUB | iframe has a title; reader controls are labelled |

## Latest axe fixes (v84)

- `#noteColorFilter` has an accessible name.
- Scroll regions (`tocList`, `searchResults`, `notesList`, `grantsList`, panels, page area) use `role="region"` + `tabindex="0"` so `aria-label` is allowed and Safari keyboard scrolling works.
- `#epubView` uses `role="document"`; `aria-label` is allowed.
- EPUB iframe title/`aria-label`/`lang` are applied and re-applied by a `MutationObserver` after EPUB.js re-renders.
- Hero `code` contrast raised to ink-on-sand (13:1).
- Book cards are no longer nested interactive regions: the card is static; explicit **Oku** and **Düzenle** buttons are siblings.
- Reader page canvases are `aria-hidden`; page regions have labels.

## Manual checks still required

- [ ] Screen-reader pass (NVDA/Edge, VoiceOver/Safari): login, card, reader, notes.
- [ ] Zoom to 200% and 400%: no clipped controls; reflow/responsive layout.
- [ ] High-contrast/forced-colors mode: focus rings and buttons remain visible.
- [ ] EPUB iframe content: headings, links, images and reading order.
- [ ] Automated axe/HTML validator scan.
- [ ] Keyboard-only full journey including EPUB highlight and search result navigation.

## Known gaps

- Reader focus trap cannot enter every third-party iframe control; Epub.js content is a sandboxed same-origin frame.
- Some dynamically generated toasts/validation strings may not be localized; see `PROJECT-STATE.md`.
- `aria-live` announces every page turn by design; verify it is not too noisy with a screen reader.
- PDF page text is exposed through the text layer; scanned pages without OCR have no readable text.
