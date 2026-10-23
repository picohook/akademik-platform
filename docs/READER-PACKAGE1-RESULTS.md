# Reader package 1 — independent acceptance review

**Status: HOLD — 12/14 checks pass; two findings remain open.**

- Date: 2026-10-23, Europe/Istanbul.
- Tested commit: `b8adce970a5d319f2a1e39a106c4b04f28dbd7aa`, frontend v109 / CSS v41.
- Browser: real Microsoft Edge 155.0.4283.45, headless through Playwright, Windows, 1440×1000 viewport.
- Application: isolated local demo copy; eight source files match the working tree byte-for-byte before and after the run. No application source was changed by the reviewer.
- Fixtures: repository sample PDF and a public-domain sample EPUB extended to 75 additional paragraphs, so a bookmark can be tested within a chapter rather than only at its beginning.
- Production was not changed; the reported live release remains v106.
- [Manifest/source hashes](reader-evidence/v109-2026-10-23/manifest.json), [all 14 cases](reader-evidence/v109-2026-10-23/results.json), [EPUB fixture](reader-evidence/v109-2026-10-23/long-fixture.epub), [browser harness](reader-evidence/v109-2026-10-23/browser-harness.mjs).

## Findings

### R1 — P2: returning to an EPUB bookmark loses its active state

**Observed:** the bookmarked text is displayed correctly after a panel jump,
but the toolbar shows ☆. Clicking it creates a second bookmark in the displayed
page instead of removing the existing bookmark.

Reproduction with the retained fixture:

1. Open the EPUB at 100%, move to the next rendered page, and add a bookmark.
   The saved point is `epubcfi(/6/2!/4/50/1:0)` (paragraph 21); the button shows ★.
2. Open Notes, navigate to chapter 2 through the TOC, and click the saved
   bookmark in Notes. Reopening the book and selecting the bookmark also
   reproduces this condition.
3. Notes reduces the viewport width. The rendered page starts at
   `epubcfi(/6/2!/4/36/1:0)`, while the saved paragraph remains visible.
   The button reports `aria-pressed="false"` and displays ☆.
4. Click the toolbar bookmark button. The bookmark count changes **1 → 2**;
   both `/4/50/1:0` and `/4/36/1:0` remain stored.

Evidence: [before](reader-evidence/v109-2026-10-23/returned-bookmark-before-toggle.png),
[after](reader-evidence/v109-2026-10-23/returned-bookmark-after-toggle.png),
[CFIs and record counts](reader-evidence/v109-2026-10-23/returned-bookmark-toggle.json).

Cause: `bookmarkForEpubCfi()` in `spike/app/public/app.js:1457` compares the saved
CFI only with the current page-start CFI. Reflow changes the page boundary.
`toggleBookmark()` then treats the existing, visible bookmark as absent.

Recommended correction: identify the active bookmark using the displayed CFI
range or the bookmark explicitly selected for navigation. Keep exact saved
anchors; do not replace them with guessed page numbers. Retest with Notes open,
after a font-size change, and after reopening. Direct add/remove without a
layout change already passes.

The return test does **not** require equal page-start CFIs. It resolves the saved
CFI to its DOM range and projects that range through the iframe into the clipped
parent viewport. The saved paragraph is visible at approximately x=61, y=459;
navigation itself passes. The failed interaction is active-state/removal.

### R2 — P2: preferences persist globally in the browser

**Observed:** font size and theme survive close/reopen and reload, but do not
meet the agreed book-or-user scope. Both use unqualified localStorage keys:

- `readerEpubFontSize` (`app.js:1494`, `app.js:1507`).
- `readerTheme` (`app.js:1203`; this global theme behavior predates v109).

Set 120% and sepia as the librarian, log out, and open the same book as the
reader in the same browser. The second user inherits 120% and sepia. No book or
user identifier scopes either preference. This is an acceptance-scope gap, not
a claim that the new font-size persistence fails or an annotation-security finding.

Recommended correction: namespace the existing preferences by stable user ID or
book/asset ID, with an explicit fallback for offline use. Retest reopening and
reload, then switching books/users. No new typography controls are required.

## Passing coverage

- EPUB bookmark visibility, CFI creation, direct ★ removal, and panel listing.
- Navigation to the saved text from another chapter and after reopening.
- 120% font size and sepia theme persist on close/reopen and reload; computed
  body font is 19.2 px and background is `rgb(243, 234, 215)`.
- Panel deletion works; highlights/notes coexist with bookmarks.
- PDF bookmark creation/removal remains page-based; the EPUB/PDF note panels
  contain only the corresponding asset's records.
- Offline bookmark creation stays excluded: no queue entry is added and the UI
  explains that adding is unavailable offline. Offline EPUB note creation still
  queues a normal create operation.

## Scope and handoff

The run uses demo storage, so it establishes browser/reload behavior rather than
PostgreSQL persistence across server restarts or account isolation of annotations.
Text selection for the note checks uses a DOM Range and mouseup event, followed
by the real note/save controls. It does not establish human text-selection
usability, screen-reader behavior, mobile behavior or cold offline startup.

[Console diagnostics](reader-evidence/v109-2026-10-23/browser-console.json)
retain EPUB resize errors and blocked blob stylesheet messages also seen in
earlier reader audits; they were not isolated as new v109 findings.

The implementing author should address R1/R2 in a follow-up commit. The
independent reviewer should repeat the affected cases before closing package 1.
No deployment was performed as part of this review.

## v110 remediation (pending retest)

- **R1:** EPUB bookmark matching now accepts an exact CFI **or** the same
  `href` with a progress difference of ≤1.5 percentage points, choosing the
  nearest bookmark. Opening Notes should no longer create a duplicate
  immediately; the star should remain active after returning to the bookmark.
- **R2:** EPUB font size is stored per **user + book**
  (`readerEpubFontSize:<userId>:<bookId>`), with a per-user fallback. Theme is
  stored per **user** (`readerTheme:<userId>`). The old browser-global keys are
  no longer read, so a second account in the same browser starts at defaults.
- **Translation:** notes get their bookmark suffix from `t('Yer imi')`; the
  uppercase-only CSS transform was removed, so English renders “Bookmark”
  instead of “YER IMI”.
- Status remains **HOLD** until the independent reviewer repeats the affected
  cases.
