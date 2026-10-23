# v118 PDF watermark visual acceptance — 2026-10-23

Actual PDF.js canvas renders were opened and visually inspected. The watermark adds text at alpha 0.28; the previous white rectangle is absent.

| Controlled fixture | Visual observation |
| --- | --- |
| Dense text PDF, 200% render | Original references at the bottom remain readable. No white block removes the text. Faint watermark letters still overlap some reference lines. |
| Image-only PDF, 200% render | Original raster text remains readable, with the same faint overlay and no opaque backdrop. |
| Small page with nonzero CropBox, 300% render | Original text and watermark remain inside the crop. User and tenant UUIDs remain visible; the Unicode email uses documented ASCII Unicode escapes and wraps. |
| Unreadably tiny 5×5 PDF | Delivery fails closed instead of returning an unstamped file. |

The image-only fixture is a PDF containing a raster of the controlled text fixture, with no original PDF text layer. It exercises image-based delivery without redistributing customer content. It is a scan surrogate; this does not establish real-scanner quality, OCR quality, or acceptance for all publications.

The comparisons are actual rendered images, not text-extraction previews. The adjacent `render-proof.json` records renderer, source SHA-256, fixture hashes and original-dark-pixel preservation checks. The latter detect the previous opaque-paint failure; they do not replace visual inspection or claim zero visual interference. Transparent stamp text still overlaps content where the page has no spare footer margin.

- [Dense text comparison](dense-text-comparison.png)
- [Image-only comparison](image-only-scan-surrogate-comparison.png)
- [Small cropped page and Unicode comparison](small-crop-unicode-comparison.png)
- [Machine-readable rendering proof](render-proof.json)

Original/stamped PDF and full-page PNG files are retained alongside the comparisons. Rendering uses PDF.js and the installed native canvas; Adobe Reader, printing and device-specific behavior were not tested here. The separate watermark unit suite covers every-page identity and PDF/EPUB policy checks.

To reproduce, run from the repository root with the existing app dependencies installed:

```powershell
node docs/reader-evidence/v118-predeploy-2026-10-23/visual/reproduce.mjs
```

No application source, production data or deployment was changed by this visual acceptance.
