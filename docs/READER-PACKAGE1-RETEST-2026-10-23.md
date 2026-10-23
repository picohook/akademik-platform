# Reader package 1 — v110/v112 independent retest

**Historical decision: HOLD for v112 (20/21). Superseded by the [final v113 retest](READER-PACKAGE1-V113-RETEST-2026-10-23.md): 21/21, package 1 ACCEPTED.**

| Tested version | Source | Outcome |
|---|---|---|
| v110 | `81a5fc5c152390a66a2cd2c79d39a8a79587a752` | 17/19. Account/book settings and English labels pass. Percentage-based bookmark matching misses the earlier reflow case and deletes an earlier bookmark from a different, nearby page. |
| v112 | `d0e01c9ccffb22329d6adee3ed9fa08991a4c3f2` | 20/21. Panel-selected bookmark return/removal and nearby distinct bookmarks now pass. Directly opening Notes still loses the star for a visible saved bookmark. |

The v110 run began at documentation commit `3907c6e`, whose application files
match `81a5fc5`. The working tree changed during that run; the retained isolated
snapshot was subsequently checked against `git archive 81a5fc5`, normalizing only
CRLF for the comparison. v112 was tested directly from an immutable
`git archive d0e01c9`, so concurrent working-tree changes cannot affect its result.

- Environment: Windows, real headless Edge 155.0.4283.45 through Playwright,
  1440×1000 viewport, isolated demo server.
- [v110 evidence and source validation](reader-evidence/v110-2026-10-23/manifest.json),
  [v110 cases](reader-evidence/v110-2026-10-23/results.json).
- [v112 evidence and source hashes](reader-evidence/v112-2026-10-23/manifest.json),
  [all 21 cases](reader-evidence/v112-2026-10-23/results.json),
  [browser harness](reader-evidence/v112-2026-10-23/browser-harness.mjs).

## R1 — remaining v112 failure: opening Notes clears the active bookmark

Reproduction uses the retained [short reflow fixture](reader-evidence/v112-2026-10-23/long-fixture.epub),
which contains 75 added paragraphs in chapter 1:

1. Open the book at 100% and move to the next rendered page.
2. Add a bookmark at `epubcfi(/6/2!/4/50/1:0)` (paragraph 21). Direct ★ removal
   and re-adding at the same location pass.
3. Open Notes without selecting a different reading location. The saved
   paragraph remains visible in the narrower reader area, but the page-start
   CFI becomes `epubcfi(/6/2!/4/36/1:0)`.
4. The toolbar changes to ☆ / `aria-pressed="false"`. Expected: the visible
   saved bookmark remains active through this layout change.

[Screenshot](reader-evidence/v112-2026-10-23/bookmark-notes-resized.png) shows
the saved bookmark at 30%, the current page at 20%, and paragraph 21 still on
screen. The failing case `bookmark-active-through-notes-resize` records the DOM
range projected through the iframe into the actual clipped parent viewport:
approximately x=61, y=459, visible=true, star=false. Equal page-start CFIs are
not required by the test.

Cause: `openEpubBook()`'s `onRelocated` callback still clears `activeBookmarkId`
when saved/current percentages differ by more than 1.5 points. Reflow alone
changes 30% to 20% in this fixture. The active-id correction handles explicitly
selecting the bookmark in Notes, which passes, but it does not cover this direct
panel-opening path.

Recommended follow-up: preserve the active bookmark while its saved CFI remains
inside the visible start/end CFI range during resize, theme or font changes.
Keep intentional page/chapter navigation separate; the distinct-nearby-bookmark
test now passes and should stay covered. Percentage proximity is not a reliable
test of whether two reading positions are the same.

## Passing v112 coverage

- **R2:** A sets 120%/dark; B in the same browser sees 100%/light; A returns to
  120%/dark. Existing global keys containing 180%/dark are ignored.
- Font size is book-specific: A's second book inherits 120%, can be changed to
  150%, and both books retain their respective sizes on reopening.
- Close/reopen and reload preserve font size and theme.
- EPUB bookmark creation, direct toggle removal, panel deletion, panel return
  from another chapter and reopening, and removal after panel-selected return.
- Two different visible pages at the same rounded 0% remain separate bookmarks;
  the earlier record is not deleted. This uses a [longer-book fixture](reader-evidence/v112-2026-10-23/adjacent-fixture.epub)
  with a short rendered chapter and long second chapter, keeping the percentage
  difference small without burdening the current view with thousands of nodes.
- New labels distinguish two bookmarks by chapter, percentage and #1/#2.
  [Label screenshot](reader-evidence/v112-2026-10-23/bookmark-distinct-labels.png).
- English UI displays `Bookmark` without forced uppercase; Markdown export
  contains the translated bookmark label.
  [Screenshot](reader-evidence/v112-2026-10-23/english-bookmark.png),
  [export](reader-evidence/v112-2026-10-23/english-notes.md).
- PDF page bookmarks remain functional and asset-specific. EPUB highlights and
  bookmarks coexist. Offline bookmark creation remains excluded, while offline
  note creation still queues normally.

## Dev refresh and observed production state

The reviewer rebuilt/recreated **only** the `akademik-platform` development web
container from v110. Dev health returned 200 / db, the HTML served v110, and
uploads/OCR bind to `data/dev-uploads` and `data/dev-ocr`.
[Dev verification](reader-evidence/v112-2026-10-23/dev-restart-v110.json) records
identical production image, start time, restart count and health before/after.

The read-only production check observed **v110 / CSS v42**. Served HTML, app.js
and CSS match the isolated v110 snapshot byte-for-byte.
[HTTPS observation](reader-evidence/v112-2026-10-23/production-version-observation.json).
The separately recorded [v110 deployment](deployments/2026-10-23-v110.md) predates
the reviewer's dev refresh. No production deployment, restart or rollback was
performed in this retest. The user's v112 deployment condition was not met.

## Scope

These are browser acceptance checks with demo storage, not PostgreSQL restart
persistence, annotation account-isolation tests, a full WCAG assessment, native
mobile testing or cold offline startup. The source snapshots and artifact hashes
are retained. Console resize/blob-style diagnostics remain available in each
evidence manifest; they were not assigned as new findings here.

The implementing author should fix the remaining R1 resize path; then repeat
the affected tests against the final release commit before deploying.
