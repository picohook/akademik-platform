# Publication remediation checklist — Mayenit article

**Status:** open remediation list, not an accessibility conformance decision.
**Source:** live catalog review 2026-10-25; production reader v127.
**Asset:** `ca9ef7bb-2bdb-4f81-bb65-a922393e21b5`
**Original SHA-256:** `6ef24df5cc72de3c2bf4ea7d78b9f4c4d907ff9834216d64808f2790ad19babc`
**Pages:** 17 physical pages; language `en`; no OCR sidecar was needed for this text PDF.

This list is for the publisher/content owner. The platform can verify the result but
must not invent figure descriptions, table headers, or heading semantics.

## 0. Freeze and ownership

- [ ] Preserve the current published PDF unchanged; work on a copy.
- [ ] Record the source file name, version, owner and approval date.
- [ ] Confirm who may change the PDF: publisher, author, or production vendor.
- [ ] Keep the original hash in the change record; do not silently replace the live file.
- [ ] Obtain a new hash after remediation and attach it to the delivery.

## 1. Document structure and headings

The review found `H1/H2` only on PDF page 1; pages 2–17 have no source heading
roles, although page 2 has a visible section heading.

- [ ] Apply real heading tags to every visible section/subsection.
- [ ] Use a consistent hierarchy: `H1` document title, `H2` major sections,
      `H3` subsections; do not skip levels for visual size.
- [ ] Keep heading text identical to the visible heading.
- [ ] Do not tag running headers, page numbers or decorative rules as headings.
- [ ] Check the tag tree/outline page by page, especially page 2.
- [ ] Verify NVDA `H`/`Shift+H` reaches each heading in order.

Acceptance: all body section headings are exposed as headings with correct level;
no visible heading is only a font style.

## 2. Figures and alternatives

Source scan: **23 Figure tags; 20 have no Alt and no referenced text alternative**.
The 20 are **review flags**, not 20 automatic failures: some may be decorative.

| PDF page | Figure flags |
| ---: | ---: |
| 2 | 1 |
| 4 | 1 |
| 5 | 2 |
| 6 | 1 |
| 7 | 2 |
| 8 | 1 |
| 9 | 5 |
| 10 | 1 |
| 11 | 1 |
| 12 | 5 |
| **Total** | **20** |

For each flagged figure:

- [ ] Decide: **informative** or **decorative/artifact**.
- [ ] If decorative: mark as Artifact; do not give it a misleading description.
- [ ] If informative: add a concise source description that states what the reader
      needs to know, not “Figure 3” or a duplicate of the caption.
- [ ] If the figure carries data (graph, micrograph, scheme, SEM panel), provide a
      long description or an accessible equivalent table/text; do not put the
      entire data table only in Alt.
- [ ] Keep the caption as visible text; link the figure to its caption where the
      authoring tool supports it.
- [ ] If the figure is a licence/logo mark, retain the licence text separately and
      classify the mark as Artifact.
- [ ] Do not claim an alternative is “verified” until a subject-matter reviewer
      has read it against the figure.

Log each decision in the appendix (page, figure number, informative/decorative,
Alt text, long description location, reviewer).

## 3. Tables

Source scan: **4 Table tags on pages 6, 9, 11 and 13; 165 `TD`; 0 `TH`**.

For each table:

- [ ] Add a table caption or accessible name that identifies its content.
- [ ] Mark header cells as `TH`; set column scope and row scope where applicable.
- [ ] For multi-level headers, make each header cell’s scope explicit and verify
      the reading order.
- [ ] Do not use merged data cells as a substitute for headers.
- [ ] Mark layout tables as Artifact, or convert them to tagged content; do not
      expose a layout grid as a data table.
- [ ] Check empty cells and footnotes: keep them associated with the correct row.
- [ ] Verify in NVDA table commands: table dimensions, header announcement,
      row/column navigation.
- [ ] If a table is an image, provide an accessible data equivalent; OCR text alone
      is not a table structure.

Log per table: page, caption, header map, scope method, checker result, NVDA result.

## 4. Reading order and artifacts

- [ ] Verify the tag/reading order page by page (17 pages), not only visually.
- [ ] Confirm the article body is single-column; do not split continuous prose into
      artificial columns.
- [ ] Mark headers, footers, page numbers, rules and non-informative decorations as
      Artifacts.
- [ ] Keep figure/table captions adjacent to their referent in reading order.
- [ ] Check page 9’s multi-panel SEM area: panel labels and explanatory text must
      be ordered meaningfully; do not treat panels as separate prose columns.
- [ ] Confirm no text is duplicated by a hidden alternate layer.
- [ ] Confirm selection/copy still produces the visible text once.

## 5. Language and metadata

- [ ] Set the document language to `en` (or per section where different).
- [ ] Set language on non-English passages and on foreign-language Alt text.
- [ ] Fill document title, author, subject and keywords; avoid empty metadata.
- [ ] Keep the article’s citation metadata consistent with the catalog record.
- [ ] Remove placeholder ISBN/licence data if present (the demo record has already
      been corrected separately).

## 6. Verification before delivery

- [ ] Run a PDF/UA structure checker (PAC, axesPDF or equivalent) and retain the
      report; resolve structural errors, not only warnings.
- [ ] Run `node scripts/a11y-pdf-check.mjs <corrected.pdf>` and retain the JSON.
- [ ] Re-scan all 17 pages; confirm the 20 prior flags are adjudicated.
- [ ] Confirm 4 tables now expose `TH`/scope and captions.
- [ ] Open the corrected PDF in the v127 reader and test with NVDA **2026.2**:
  - [ ] `H` heading navigation
  - [ ] figure description speech
  - [ ] table dimensions/headers
  - [ ] native selection → copy → highlight
- [ ] Compare the new hash to the original; record both.
- [ ] Do not overwrite the live asset until the publisher signs off.

## 7. Delivery package

- [ ] Corrected PDF.
- [ ] Change log (page, tag, figure/table, before/after).
- [ ] Figure alternative appendix.
- [ ] Table header/scope map.
- [ ] Checker report and new SHA-256.
- [ ] NVDA/reader test evidence.
- [ ] Reviewer name and date.

## 8. Acceptance and limits

This checklist is complete when:

- every one of the 20 figure flags has a documented decision;
- all 4 tables have headers, scope and captions;
- body headings exist with a consistent hierarchy;
- reading order and artifacts pass the selected checker and NVDA spot checks;
- the publisher signs the change log.

It does **not** establish full WCAG 2.2 AA, PDF/UA certification, VoiceOver/Safari
support, human pronunciation quality, or correctness of the scientific content.
Those remain separate acceptance items.

## Appendix — figure/table log template

```text
Page:
Figure/Table:
Visible caption:
Informative / decorative:
Alt text (if informative):
Long description / equivalent (location):
Header cells / scope (tables):
Reviewer:
Date:
Checker result:
NVDA result:
```
