# Accessibility Conformance Report — draft

**Not a certificate.** This is a draft ACR-style summary for procurement
discussions. It is not a completed VPAT and does not claim full WCAG 2.2 AA
conformance.

- Product: Akademik Platform web reader
- Version: v113 / CSS v42
- Date: 2026-10-23
- Standards: WCAG 2.2 Level A/AA; WAI-ARIA 1.2 where applicable
- Scope: login, catalog, modals, PDF reader, EPUB reader, notes/search,
  highlights and the offline library
- Methods: axe-core 4.13 in Edge and jsdom, keyboard/zoom checks, DOM/layout
  measurements, source review; **no completed NVDA or VoiceOver pass**
- Evidence: [A11Y-RESULTS.md](A11Y-RESULTS.md),
  [ACCESSIBILITY.md](ACCESSIBILITY.md),
  [a11y-evidence/](a11y-evidence/)

## Status vocabulary

- **Supports** — verified for the tested screens/state.
- **Partially Supports** — some functions meet the criterion, others do not or
  remain unverified.
- **Does Not Support** — a known failure.
- **Not Applicable** — no relevant content.
- **Not Evaluated** — not tested; no claim.

## Selected criteria

| WCAG SC | Level | Status | Notes |
|---|---|---|---|
| 1.1.1 Non-text Content | A | Partially Supports | Reader controls have names; publisher EPUB/PDF images and alt text depend on source files and were not exhaustively audited. Scanned PDFs without OCR have no text layer. |
| 1.3.1 Info and Relationships | A | Partially Supports | Landmarks, headings, tabs, dialogs and form labels are present; full EPUB content semantics remain source-dependent and iframe coverage is incomplete. |
| 1.3.2 Meaningful Sequence | A | Partially Supports | Reader order is verified for tested fixtures; fixed-layout EPUB and complex publisher tables are not covered. |
| 1.4.3 Contrast (Minimum) | AA | Partially Supports | Automated checks on tested screens pass; symbol-only controls and overlapping backgrounds still need a manual contrast pass. |
| 1.4.4 Resize Text | AA | Supports | Login, Edit, Upload and Grants controls are reachable at 200% and 400% zoom in the v105/v106 retest. |
| 1.4.10 Reflow | AA | Partially Supports | 320 CSS px checks pass for login/modals/catalog; full reader content at 400% and fixed-layout EPUB are not fully covered. |
| 1.4.11 Non-text Contrast | AA | Not Evaluated | No complete manual pass. |
| 2.1.1 Keyboard | A | Partially Supports | Catalog, modals, PDF controls, notes and shortcuts are keyboard-operated; EPUB iframe content and third-party publisher semantics are not fully verified. |
| 2.1.2 No Keyboard Trap | A | Supports | Modal/reader focus traps release with Escape and return focus. |
| 2.4.3 Focus Order | A | Supports | Tested login/catalog/reader/modals use a logical order. |
| 2.4.7 Focus Visible | AA | Supports | Global `:focus-visible` outline; checked in normal and forced-colors emulation. |
| 2.4.11 Focus Not Obscured (Minimum) | AA | Supports | Notes focus no longer sits under the panel; Escape/close return focus to the toggle (v106, 10/10). |
| 2.5.8 Target Size (Minimum) | AA | Supports | Small controls are at least 24×24 CSS px (v105). |
| 3.1.1 Language of Page | A | Partially Supports | App language is set; EPUB frame `html[lang]` is applied on load/relocation (v105), but a full iframe audit is outstanding. |
| 3.2.1 On Focus | A | Supports | No context change on focus in tested screens. |
| 3.2.2 On Input | A | Supports | Inputs do not auto-submit; search/filter changes are explicit. |
| 3.3.1 Error Identification | A | Partially Supports | Login/upload/grant errors are text and announced; some dynamic messages remain Turkish-only. |
| 3.3.2 Labels or Instructions | A | Supports | Form controls have visible labels/accessible names in tested screens. |
| 4.1.2 Name, Role, Value | A | Supports | axe reports zero violations for tested static states; controls use native elements or correct roles. |
| 4.1.3 Status Messages | AA | Partially Supports | Toasts and result counts use live regions; screen-reader announcement quality is unverified. |

## Known gaps / not evaluated

- **NVDA + Edge** and **VoiceOver + Safari** passes were not run. Human
  listening, browse-mode reading order and spoken error/live-region quality are
  unverified.
- Complete **EPUB iframe** axe run did not finish; frame title/lang/sandbox were
  inspected separately.
- Native Windows high-contrast/forced-colors pass is incomplete (Edge media
  emulation only).
- Fixed-layout EPUB, MathML, RTL, tables and publisher image semantics were not
  audited.
- Offline reader was tested with network emulation, not OS airplane mode or a
  cold offline restart.
- Mobile screen readers, 500 MB image-only PDFs and audio/TTS are out of scope.

## Contact

Accessibility owner: project maintainer. Provide this draft with the linked
evidence; do not present it as a certification or a completed VPAT.
