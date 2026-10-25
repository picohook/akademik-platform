# Accessibility test plan — WCAG 2.2 AA

Current runtime/production: **v127 / fbeed6e**, CSS49/SW19. [Actual catalog findings](a11y-evidence/v127-catalog-2026-10-25/REVIEW.md) and [user-confirmed targeted Turkish listening](a11y-evidence/v127-human-listening-2026-10-25/ACCEPTANCE.md) are current. [Real Mac/VoiceOver acceptance](A11Y-VOICEOVER-ACCEPTANCE.md) is NOT RUN because the user has no Mac access. [Publication review](PUBLICATION-ACCESSIBILITY.md) remains per document. Older version-specific checklists below are historical.

## 1. axe DevTools (automated)

Install the **axe DevTools** extension in Edge or Chrome. Open `https://localhost/?v=122` (prod) or `http://localhost:8080/?v=122` (dev).

Run **Scan all of my page** on:

1. Login screen.
2. Catalog (logged in as librarian).
3. Edit modal, Upload modal, Citation modal, Password modal, Access grants modal, **Offline books** modal.
4. PDF reader: TOC, Search, Pages, Notes, highlight bar.
5. EPUB reader: TOC, search, EPUB content.
6. **Offline reader** with a downloaded PDF and EPUB.

Expected: **no critical or serious issues**. Minor/moderate findings are logged in the PR/issue.

For EPUB content, audit the **original rendered frame document**, preserving sandbox and CSP. The audit engine must be present in that execution context; referencing parent-window axe or copying the frame into a standalone page is not a complete include-frames run. Current v122 attempts time out in the sandbox and are **BLOCKED**, not a pass or a confirmed WCAG defect. Keep script permissions unchanged. If an extension cannot complete its include-frames run, retain that limitation and manually inspect headings, links, tables, language and reading order with NVDA.

Do not inject audit scripts into production; use the isolated pinned local audit copy.

## 2. Screen reader

Use **NVDA + Edge** on Windows (free) or **VoiceOver + Safari** on macOS.

### Login
- Heading is announced; email/password have names; error is announced.
- Tab order: email → password → submit → language toggle.

### Catalog
- One `h1`; cards read title, publisher, subjects, actions.
- “Add book” and “Access” buttons announce their purpose.

### Reader
- Opening a book announces a dialog; background is not reachable.
- Page/chapter changes are announced (`aria-live`).
- TOC tabs announce selected state; arrows change tabs.
- Search status announces result count; results are buttons with page/chapter.
- Notes and highlights are readable; delete button has a name.
- Closing returns focus to the card that opened the reader.

### EPUB
- The iframe is announced with its title; content headings/links are readable in browse mode.
- Keyboard can reach the EPUB content and return to reader controls.
- TOC/search jumps move the reading position.

Record: task, expected, actual, severity (critical/serious/moderate/minor).

## 3. Zoom and reflow

Test at **200% browser zoom** and **400% at 1280px wide** (≈320 CSS px):

- Login, catalog, reader top bar, TOC panel, notes, modals.
- No horizontal page scroll except the PDF/EPUB viewport.
- No controls clipped or overlapping; icon buttons remain reachable.
- Text does not require two-dimensional scrolling.
- Focus ring visible at every zoom level.

Use DevTools device toolbar at 320×640 and 1280×720.

## 4. EPUB iframe specifics

- `iframe` has a title and `lang` matching the book language (v80 sets this).
- EPUB content: `html[lang]`, heading order, image `alt`, table headers, link text.
- `allowScriptedContent` remains false (untrusted publisher scripts do not run).
- Fixed-layout EPUBs: zoom/reflow expectations differ; document as a known limitation.
- Test one reflow EPUB and one fixed-layout EPUB if available.

## 5. Sign-off

- [ ] axe: no critical/serious on all screens.
- [ ] NVDA + Edge: S01–S12 actual observations recorded; failures/not-run cases explicit. VoiceOver remains separate.
- [ ] 200%/400% zoom: no clipped controls.
- [ ] EPUB iframe: title/lang/reading order checked.
- [ ] Findings fixed or logged with owner and target version.

Evidence: screenshot/recording per finding, axe JSON export, browser/OS versions.


## Latest assessment — v124 / 2026-10-25

The Windows/NVDA UI round and local remediation are recorded in [the acceptance](a11y-evidence/v124-2026-10-25/ACCEPTANCE.md) and [current ACR](ACR.md). Production remains v123. Real VoiceOver, arbitrary publication accessibility, native AT selection initiation and comprehensive timing are explicit scope limits; no full AA declaration. Older version-specific checklists above are historical.


## Latest follow-up — v125 / 2026-10-25

Native selection initiation and transient-message timing were tested and remediated in the local v125 candidate. [NVDA workflow](A11Y-NVDA-V125.md), [evidence and PDF limitations](a11y-evidence/v125-2026-10-25/ACCEPTANCE.md), [current ACR](ACR.md). Production remains v124; no deploy this round. Earlier version-specific open checklists are historical. VoiceOver, human listening and PDF semantic-structure/publication remediation remain.

## Latest follow-up — v126 / 2026-10-25

The source-tagged PDF heading/formula-description omission is fixed and verified in local **90c7b72**: [19 targeted checks with actual NVDA, 74 regressions and source proof](a11y-evidence/v126-2026-10-25/ACCEPTANCE.md). H1/H2/source language, formula alternatives, ownership uniqueness, spread/scroll/zoom/rotation, decode/OCR fallback, controlled old-book race, offline module cache and native copy/highlight passed. Production remains v125; migration none. VoiceOver, human listening, untagged reading order, OCR/text alternatives and broader publication/math accessibility remain open.

## Latest follow-up — v127 / 2026-10-25

Local OCR source-language/paragraph fix and workstation inspection/preparation tools: [26 browser/native NVDA checks, 10 real OCR/tool cases, 74 regressions](a11y-evidence/v127-2026-10-25/ACCEPTANCE.md). A specific scan can receive reviewed hOCR in explicit column order; source paragraphs/language and native copy/highlight were verified. No generic repair/AA decision. VoiceOver, human listening and each publication's alternatives/completeness remain open. Prod v126, no deploy/env/migration changes this round.
