# Reader package 1 — v113 final independent retest

**Decision: ACCEPTED — 21/21 checks pass. R1 and R2 are closed for package 1.**

- Tested source: `f572f3c23d64066ab3081ba7a4f4592558e7a00f`, frontend v113 / CSS v42.
- Environment: Windows, real headless Microsoft Edge 155.0.4283.45 through Playwright, 1440×1000 viewport.
- Method: immutable `git archive f572f3c`, isolated local demo server, the same 21 acceptance cases used for v112. Eight application source hashes match the archive and remain unchanged after the run.
- Started: 2026-10-23 13:03:27 UTC (16:03:27 Europe/Istanbul).
- [All cases](reader-evidence/v113-2026-10-23/results.json), [source/artifact hashes](reader-evidence/v113-2026-10-23/manifest.json), [browser harness](reader-evidence/v113-2026-10-23/browser-harness.mjs).

## R1 — visible bookmark state: PASS

The formerly failing Notes-opening case now passes. The saved CFI is
`epubcfi(/6/2!/4/50/1:0)` (paragraph 21); after Notes opens, the rendered page
starts at `epubcfi(/6/2!/4/36/1:0)`. The saved text remains visible at x=61,
y=459.25, and the bookmark button retains `aria-pressed="true"`.
[Screenshot](reader-evidence/v113-2026-10-23/bookmark-notes-resized.png).

Closing Notes also passes the visibility-conditional check: in this run the
saved target moves outside the clipped viewport, so its star correctly clears.
The test does not require equal page-start and saved CFIs.

Returning from another chapter and after reopening displays the saved text.
Toggling the returned bookmark removes the existing record, **1 → 0**, without
creating a duplicate. Two distinct pages at the same rounded progress percentage
remain separate bookmarks, with different chapter/percent/#index labels.
[Return/removal evidence](reader-evidence/v113-2026-10-23/returned-bookmark-toggle.json),
[distinct-position evidence](reader-evidence/v113-2026-10-23/adjacent-bookmark-toggle.json).

## R2 and regression coverage: PASS

- Font size and theme survive close/reopen and reload.
- User A's 120%/dark preferences do not transfer to user B, who receives 100%/light. A's preferences return after logging in again; legacy browser-global keys are ignored.
- Different books retain 120% and 150%; a previously unopened book inherits only the same user's last font-size preference.
- English panel labels and Markdown export use `Bookmark` without forced uppercase.
- EPUB bookmark creation, direct removal, panel deletion, and coexistence with highlights pass. PDF bookmarks stay page-based and asset-specific.
- Offline bookmark creation remains excluded and adds no operation; offline EPUB note creation still queues normally.

## Scope and production

This closes package 1's browser acceptance gate. It does not establish
PostgreSQL restart persistence, annotation account isolation, cold offline
startup, native mobile support or WCAG screen-reader conformance. Text selection
uses a DOM Range followed by the application's real note/save controls.
[Console diagnostics](reader-evidence/v113-2026-10-23/browser-console.json) retain
the previously observed resize/blob-style messages; this is not a claim of a
clean browser console.

The existing [v113 deployment record](deployments/2026-10-23-v113.md) records
production deployment before this final review and a separate 16/16 smoke run.
The independent reviewer did not deploy, restart or modify production in this
retest; no new production verification is claimed here.

The next agreed reader package is PDF printed page labels and citation mapping:
use `/PageLabels` when present, otherwise explicitly show `PDF sayfası N` and
never infer a printed-page offset.
