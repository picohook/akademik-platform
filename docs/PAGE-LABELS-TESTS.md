# Printed page-label acceptance fixtures

These fixtures test PDF `/PageLabels` handling without changing application code.

| File | Pages | `/PageLabels` | Expected `getPageLabels()` |
|---|---:|---|---|
| `spike/app/test/fixtures/page-labels.pdf` | 6 | `[0 << /S /r >> 2 << /S /D /St 1 >>]` | `i, ii, 1, 2, 3, 4` |
| `spike/app/test/fixtures/page-labels-none.pdf` | 6 | absent | `null` |

Regenerate:

```powershell
node scripts/make-page-label-pdf.mjs
```

## Acceptance

Upload both as librarian, then open each book.

1. **Labelled PDF**
   - Physical PDF page 1 displays `i`; page 2 `ii`; page 3 `1`; page 6 `4`.
   - Next/previous, TOC, search result, bookmark and URL navigation still land on
     the correct **physical** page.
   - Citation for physical page 3 uses `1`, not `3`; for page 6 uses `4`.
   - Two-page view shows the two printed labels in order.
2. **Unlabelled PDF**
   - Every page displays the explicit fallback **“PDF sayfası N”**; never a bare
     `N` that could be mistaken for a printed page.
   - Citation must not silently present `N` as a printed page; use the explicit
     fallback or leave the page field empty with a warning.
3. **Mixed/partial labels**
   - If the label array is shorter than `numPages` or an entry is empty, that
     page falls back to “PDF sayfası N”; no nearest-label guessing.
4. **Round-trip**
   - Reload and reopen: labels remain stable; progress and annotations still key
     on physical page numbers.

PDF.js check:

```powershell
cd spike/app
node --input-type=module -e "import {readFile} from 'node:fs/promises'; import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs'; const d=new Uint8Array(await readFile('test/fixtures/page-labels.pdf')); const p=await getDocument({data:d,isEvalSupported:false}).promise; console.log(await p.getPageLabels());"
```


## Implementation handoff — v114

Status: implementation and code/unit review complete. The four requested browser acceptance checks passed in real Edge; see the recorded run below.
The author ran the citation/page-label unit suite: **15/15 passed**.

- Page labels are loaded through PDF.js getPageLabels(); valid entries survive
  null, non-string, blank or missing entries elsewhere in the array.
- UI labels, TOC, thumbnails, search results, note labels and Markdown exports
  use the same mapping. Physical page indices remain in navigation, URLs,
  progress and annotation anchors (including JSON export).
- Citation opens with the current label, or explicitly PDF sayfası N / PDF page N.
  The user can edit it or enter a range. Custom labels such as A-1 remain intact.
- BibTeX keeps its existing book-record behavior and explicitly warns that it
  omits the page locator. EPUB receives no inferred printed-page mapping.
- App version is 114; service-worker shell cache is v6. No migration or production
  deployment was performed by the implementing author.

Reviewer: use the fixtures and acceptance cases above; include null/short label
arrays, label-less book switching, TR/EN, two-page/scroll views, offline PDF
opening, and PDF/EPUB bookmark regressions. This handoff is not a browser PASS.


## Real browser acceptance — v114 — 2026-10-23

**4/4 requested checks passed**, Microsoft Edge 155.0.4283.45, headless
through Playwright on Windows, 1440 x 1000. The implementing author ran this
browser check after the separate AI's code/unit review; this is not a claim of
an independent 21-case browser run.

1. Repository page-labels.pdf: physical page 3 displays **Sayfa 1 (PDF 3)**;
   citation locator is **1**, while the URL retains physical page **3**.
2. Physical pages 1 and 2 display **i** and **ii**, and citations use those labels.
3. Repository page-labels-none.pdf: all six pages display **PDF sayfası N** and
   the citation explicitly retains that physical-page description.
4. Real partial-label PDF: PDF.js returns **i, ii, blank, 2, 3, 4**. Only physical
   page 3 uses fallback; the other five pages retain their labels and citations.

Evidence: [results](reader-evidence/v114-2026-10-23/results.json),
[source/artifact hashes](reader-evidence/v114-2026-10-23/manifest.json),
[browser harness](reader-evidence/v114-2026-10-23/browser-harness.mjs),
[blank-label fixture](reader-evidence/v114-2026-10-23/page-labels-partial.pdf),
[mapped citation](reader-evidence/v114-2026-10-23/mapped-page3-citation.png),
[blank-page fallback](reader-evidence/v114-2026-10-23/partial-page3-citation.png),
[next valid label](reader-evidence/v114-2026-10-23/partial-page4-citation.png).

The run used an isolated demo server and a fresh browser context with service
workers blocked. Nine application files were copied, compared by SHA256 and
verified unchanged after the run; no product code was modified for the tests.
The narrow run does not establish offline cold startup, PostgreSQL persistence,
full reader regression or WCAG conformance. Null/short array cases remain covered
by the 15/15 unit suite; the actual PDF fixture uses a blank string from PDF.js.

The four requested browser acceptance conditions are closed. Production was not
changed; the recorded live release remains v113. No deployment is claimed.
