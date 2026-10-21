# Smoke test

## API

Against the dev stack:

```powershell
node scripts/smoke.mjs http://localhost:8080
```

Against the pilot:

```powershell
node scripts/smoke.mjs https://localhost
```

The script checks health/config, anonymous rejection, login (reader + librarian), CSRF, annotation create/patch/delete (with tags), reader upload 403, search endpoint, and logout for both accounts. It creates and deletes its own annotation; no other data is changed. Both sessions are logged out at the end, so repeated runs do not consume the seat limit.

Expected: `16 checks passed`.

## Browser checklist

Run in Chrome and Edge; repeat mobile width once.

### Login / catalog

- [ ] Login screen; reader and librarian both work.
- [ ] Wrong password shows an error.
- [ ] Reader sees no **+ Kitap ekle** / **Düzenle**.
- [ ] Librarian sees both.
- [ ] Logout returns to login; reload keeps session.
- [ ] Open the same account in 3 browser profiles, then a 4th login shows the seat-limit message; log one out and retry.

### Reader

- [ ] Open a 600+ page PDF; first page renders; loading overlay disappears.
- [ ] Page input jumps; next/previous works.
- [ ] TOC opens; null-TOC book shows page list.
- [ ] Thumbnails render lazily; click jumps and highlights the page.
- [ ] Fit width / fit page percentages look sensible; rotate; fullscreen.
- [ ] Theme light → sepia → dark; thumbnails and page follow.
- [ ] Select text; live highlight appears; save; highlight persists after reload.
- [ ] Right-click/copy has spaces in OCR pages.
- [ ] Search finds a phrase; Enter/Shift+Enter and ↑/↓ move between results; all hits are marked.
- [ ] **Tam kelime** narrows results (no substring hits); **Bulanık** tolerates a typo; stemmed rows show `· kök`.
- [ ] Notes: text/color filter, tags, date, edit, delete; clicking a note jumps and **keeps the panel open on desktop**.
- [ ] Citation: APA/MLA/Chicago/IEEE/BibTeX; missing-author warning; copy.
- [ ] Single → spread (▥): right page selectable; notes land on the right page.
- [ ] Spread → scroll (≣): lazy pages, active page/URL updates, TOC/search/note jump into the scroll view.
- [ ] Exit scroll → single page restores normally.

### EPUB

- [ ] Upload `sample.epub` from `spike/app/public/seed/`; card shows **EPUB** and no page count.
- [ ] Open it: EPUB renders in the reader; PDF zoom/fit/scroll controls are hidden.
- [ ] TOC entries jump; theme button changes the EPUB; next/prev works.
- [ ] Reload the page: progress resumes at the saved CFI.
- [ ] EPUB download is rejected with 501 for now (watermarking not implemented).

### Accessibility

- [ ] Login: Tab reaches email/password/submit; focus ring visible; app behind is inert.
- [ ] Open Düzenle/Atıf/Parola: Tab cycles inside the dialog; Shift+Tab wraps; Esc closes and focus returns to the trigger.
- [ ] TOC tabs support ←/→ and `aria-selected` updates.
- [ ] TOC/thumbnail active item has `aria-current`.
- [ ] Skip link appears on first Tab and moves to `#mainContent`.
- [ ] Page changes announce through `pageLabel` (screen reader).

### Regression checks

- [ ] `/api/health` is `db`, `/api/config` has the expected brand.
- [ ] No CSP errors in the console.
- [ ] No uncaught errors after 20 page turns and one scroll session.
- [ ] Memory after 100 pages is roughly flat (see `spike/measurement.md`).
