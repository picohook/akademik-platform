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
