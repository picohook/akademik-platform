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

The script checks health/config, anonymous rejection, login (reader + librarian), CSRF, annotation create/patch/delete (with tags), reader upload 403, search endpoint, and logout. It creates and deletes its own annotation; no other data is changed.

Expected: `15 checks passed`.

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
- [ ] Notes: text/color filter, tags, date, edit, delete; clicking a note jumps and **keeps the panel open on desktop**.
- [ ] Citation: APA/MLA/Chicago/IEEE/BibTeX; missing-author warning; copy.
- [ ] Single → spread (▥): right page selectable; notes land on the right page.
- [ ] Spread → scroll (≣): lazy pages, active page/URL updates, TOC/search/note jump into the scroll view.
- [ ] Exit scroll → single page restores normally.

### Regression checks

- [ ] `/api/health` is `db`, `/api/config` has the expected brand.
- [ ] No CSP errors in the console.
- [ ] No uncaught errors after 20 page turns and one scroll session.
- [ ] Memory after 100 pages is roughly flat (see `spike/measurement.md`).
