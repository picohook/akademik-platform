# v127 — reviewed OCR preparation and source-language reading

**PASS for the tested local scope.** Code **fbeed6e6fefcad00f13ddb80b98b91fb9ef67351**, frontend127/CSS49/SW19. Production remains **v126/90c7b72**, v125 rollback preserved. No deploy, env, migration or production-content changes.

Date: **2026-10-25 Europe/Istanbul**. Real NVDA **2026.2 / 2026.2.0.57664**, Edge **155.0.4283.45**, axe **4.13.0**; installed local Tesseract eng/tur models. [Model/engine provenance](model-proof.json). Human listening and real VoiceOver/Safari **NOT RUN**.

## Implemented

- The reader preserves the supplied hOCR paragraph order and word/paragraph language. ISO model names `eng`/`tur` normalize to `en`/`tr`; root language survives the staged text-layer commit. Invalid coordinates fail safely; page-local words exclude other page elements. Only newly created text/paragraph elements are adopted, not source scripts/HTML/IDs.
- [PDF source checker](../../../scripts/a11y-pdf-check.mjs): per-page text, source structure, missing Figure/Formula alternatives and optional hOCR availability. Subsets are marked incomplete. Reports are **review flags**, not accessibility/AA decisions.
- [Local PDF OCR tool](../../../spike/ocr/prepare-pdf.mjs): PDF → rendered image → real local Tesseract → `page-NNN.hocr`, with language, source hashes, confidence and review-required report. Models are not downloaded. Existing outputs are not overwritten. This runs on an operator workstation; it is not a new production service/dependency or automatic upload gate.
- An explicit normalized reading-region plan can define header/left/right order. The tool crops only those supplied regions and translates OCR boxes back to the full page. Overlap is rejected. Region PSM is an explicit operator choice. Source headings/math/table structure and figure meaning are not inferred.

## Actual results

| Run | Result | Meaning |
| --- | --- | --- |
| [Browser + real NVDA](native-final/results.json) | **26/26**, JS0 | Existing tagged-PDF safeguards plus actual generated OCR, source order/language/paragraphs/coordinates, invalid hOCR, offline module, native OCR reading/selection/copy/highlight |
| [Existing regression matrix](regression-final/results.json) | **74/74**, JS0 | PDF/EPUB, forms, focus, offline notes, CAS/expiry, themes and responsive/iframe checks |
| [Real OCR/tool checks](ocr-tools/results.json) | **10/10** | Real PDF rendering and Tesseract eng/tur, source flags/sampling, region order, no overwrite, no model-download fallback, overlap rejection |
| [Unit regressions](unit-tests.tap) | **65/65**, 0 fail | Existing citation/search/download/maintenance/watermark/EPUB policy/retention |

**34 clean axe scans, 0 violations**: six targeted and 28 regression scans. Intentional iframe missing-alt/lang negative control is separate and restores its fixture. Raw incomplete/manual entries remain. Counts overlap; they are not summed as unique journeys. Native 200/400% OS zoom and high contrast were not repeated in this run; older version-specific evidence remains historical.

[Source proof](source-proof.json) verifies exact final runtime files for both browser runs and records tool-source hashes. [Summary](summary.json). Known demo-password text in serialized axe/AX artifacts is redacted; no real credentials, cookies, profiles, pre-existing speech buffer or publisher documents are archived. Owned demo servers/browsers were closed.

## Reading-order proof and OCR limitations

The [initial worker-default OCR](initial-default-OCR-interleaved.txt) interleaved columns. The final tool explicitly uses PSM3 for full-page OCR; [its full-page result](ocr-tools/english-text.txt) reads this clean sample in column order too. Both results are retained: OCR settings matter, and neither an automatic success on this sample nor a previous failure establishes order for other publications. The [explicit plan](ocr-tools/reading-regions.json) independently yields [header → complete left column → right column](ocr-tools/ordered-text.txt); this is the output tested in the reader. OCR was performed on actual cropped source pixels; recognized words were not replaced with expected ground truth. [Generated image](ocr-tools/columns-scan.png), [image-only PDF](ocr-tools/columns-scan.pdf), [hOCR](ocr-tools/eng-ordered/page-001.hocr), [reader screenshot](native-final/ocr-english.png).

Actual [NVDA column speech](native-final/ocr-columns.speech.json) contains **LEFT COLUMN**, then **“This is the end of the left”**, then **RIGHT COLUMN**, then the right-column ending, in that order. The actual [Turkish speech](native-final/ocr-turkish.speech.json) includes **“Türkçe okuma örneği”**, **“Diş hekimliğinde araştırma”** and **“İnsan denetimi gereklidir”**. Speech Viewer verifies generated speech text; it does not stand in for a human pronunciation/listening assessment.

[Native selection speech](native-final/ocr-selection.speech.json) shows actual NVDA native selection of **OCR**. Native Alt+Shift+H/Tab/Enter copied matching text and created a highlight. No DOM Range injection was used for this targeted native selection. The separate general regression uses an injected selection fixture for toolbar testing and labels that scope.

OCR language/paragraphs are source information, not guaranteed correctness. These are clean synthetic Windows/Arial samples, not a real scanned-book error-rate benchmark. Geometry was checked at default orientation, including translated right-column boxes and a nonzero source origin; rotated OCR geometry is not a general support claim. Untagged PDF without a reviewed sidecar still follows its original stream order. hOCR is not embedded in the original/downloaded PDF. Cached JS modules do not imply offline availability of OCR sidecars; these reader OCR checks are online on an isolated fixture server.

## Remaining ACR work

[Publication review and commands](../../PUBLICATION-ACCESSIBILITY.md) now provide an actionable path for a **specific** publication's OCR/order preparation. Each real publication still needs text-completeness/order/alternative review. Missing publisher descriptions and complex table/math semantics are not generated. [Real Mac acceptance](../../A11Y-VOICEOVER-ACCEPTANCE.md) has 12 explicit NOT RUN rows. Human listening remains open. No full WCAG AA or universal publication-accessibility claim.

## Reproduction

[Tool/fixture harness](ocr-tools-test.mjs) uses the installed app/PDF/canvas and OCR dependencies plus preinstalled models. Run with a fresh `OCR_RUN` from repo root; tests use only generated PDFs. [Browser harness](browser.mjs), [regression](regression.mjs), [source fixture helper](fixtures.mjs), [native input](native-keys.ps1), [speech suffix capture](speech.ps1). Copy helpers to `tmp/a11y-v127`; set `OCR_EVIDENCE` to the freshly generated tool directory and use a fresh `AUDIT_RUN`. `HEADED=1 NVDA=1` enables real NVDA; `PLAYWRIGHT_MODULE`/`AXE_SOURCE` can override local tool paths. Static old tagged fixtures are referenced from the archived v125/v126 evidence. This workflow has no production login or deploy commands.
