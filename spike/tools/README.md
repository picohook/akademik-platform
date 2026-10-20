# Tools

## `make_scan.py`

Generates a **synthetic scanned PDF**: image-only pages, mild skew, speckles, JPEG artifacts and no text layer. It exercises the OCR, hOCR and highlight-alignment path before a real scanned book is available.

```bash
python make_scan.py --pages 20 --dpi 250 --out ../fixtures/synthetic-scan-20p.pdf
```

Requires Pillow. In this workspace the bundled Python has it; on another machine use any Python with `Pillow` installed.

**Limitations**

- Clean digital text rendered to an image is easier for OCR than a real scan.
- It does not reproduce book curvature, bleed-through, stamps or handwriting.
- File size is small (≈2.7 MB for 20 pages at 250 dpi); it is not a 300/500 MB performance fixture.

Use it for pipeline correctness (page images, OCR, hOCR coordinates, highlight geometry). For the 300/500 MB performance thresholds, a real scanned book is still required.
