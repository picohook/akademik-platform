# OCR spike (tesseract.js)

Runs OCR over the synthetic scan pages and writes text, hOCR and a CER estimate.

For a real local PDF, use `prepare-pdf.mjs` from the repository root. It uses installed local models only, writes reader-compatible `page-NNN.hocr` files and a review-required report, and refuses existing output files. Explicit region order is available for columns; full-page OCR alone can interleave them. See [the publication preparation runbook](../../docs/PUBLICATION-ACCESSIBILITY.md). This is a workstation workflow, not an automatic upload/production service or a WCAG certificate.

```bash
npm install --ignore-scripts     # --ignore-scripts avoids the opencollective postinstall
node ocr.mjs \
  --images ../fixtures/scan-pages \
  --truth ../fixtures/scan-truth.json \
  --lang tur \
  --out ../fixtures/ocr-output.json \
  --hocr-dir ../fixtures/hocr \
  --limit 3
```

The first run downloads `tur` / `eng` traineddata; later runs are offline.

## Language choice

Use **one language per book**: `--lang tur` for Turkish titles, `--lang eng` for English. Do **not** use `tur+eng` for Turkish titles: Tesseract's English model wins on bold Latin-looking words and ASCII-fies them (`Diş` → `Dis`, `Hekimliğinde` → `Hekimliginde`). Test the title line after any language change.

## Output

- `ocr-output.json` — per page: text, confidence, CER, seconds, hOCR size.
- `hocr/*.hocr` — word boxes (`ocrx_word` with `bbox` and `x_wconf`).

## Notes

- Raw CER is inflated by table rows, page numbers and the footer, which are not in the ground-truth text. Body paragraphs are visually near-exact; a region-aware CER is the next measurement improvement.
- The synthetic scan is clean digital text rendered to an image. Real scans will be worse; treat these numbers as an upper bound.
- hOCR boxes are in image pixels; the viewer must scale them by `renderedWidth / imageWidth` before drawing overlays.
