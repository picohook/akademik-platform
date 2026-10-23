# Accessibility manual results — WCAG 2.2 AA

**Status: OPEN — five findings; screen-reader sign-off outstanding.**

- Date: 2026-10-23 (Europe/Istanbul).
- Frontend version: v104, stylesheet v40; repository HEAD `0db153c`.
- Release URL: `https://localhost`. Actual audit URL: `http://127.0.0.1:45841`.
- Environment: isolated local demo copy of the current application; no production data or production script injection.
- Browser / OS: Microsoft Edge 155.0.4283.45 / Windows build 26200.9711, 25H2.
- Screen reader / version: **not run**. Signed official NVDA 2026.2 portable creation did not produce a runnable copy in this session. VoiceOver was unavailable on Windows.
- Tester: Codex; browser, keyboard, rendered screenshots and DOM measurements. No human listening or screen-reader usability pass is claimed.
- Automated engine: axe-core 4.13.0 API in Edge, rather than the axe DevTools extension. WCAG 2 A/AA, 2.1 A/AA and 2.2 AA tags; color contrast enabled.
- Fixtures: repository public-domain `sample.pdf` (one page) and reflowable `sample.epub` (two chapters), uploaded only to the local demo instance.

Evidence is retained under [v104-2026-10-23](a11y-evidence/v104-2026-10-23/manifest.json), including source hashes, JSON results and screenshots. Product source files were compared byte-for-byte with the tested copy.

## Summary

| Area | Result | Evidence |
|---|---|---|
| axe, login/catalog/modals | No reported violations in login, catalog, Edit, Upload, Citation, Password, Grants and Offline modal scans. Contrast checks include manual-review items; this is not a complete contrast pass. | [Login](a11y-evidence/v104-2026-10-23/login.axe.json), [catalog](a11y-evidence/v104-2026-10-23/catalog.axe.json), modal exports in manifest |
| axe, PDF reader | **FAIL** when highlight toolbar is visible: `target-size`, serious, four nodes. Base reader, TOC, Search, Pages and Notes scans report zero violations. | [Toolbar JSON](a11y-evidence/v104-2026-10-23/pdf-highlight-toolbar.axe.json), [screenshot](a11y-evidence/v104-2026-10-23/pdf-highlight-toolbar.png) |
| axe, EPUB (include frames) | **PARTIAL**. Shell scan reports zero; direct sandboxed content scan did not complete. Standalone diagnostic of the rendered frame document finds missing HTML language; see F2 and scope note below. | [Frame DOM](a11y-evidence/v104-2026-10-23/epub-frame-document.json), [diagnostic JSON](a11y-evidence/v104-2026-10-23/epub-content-standalone.axe.json) |
| NVDA/VoiceOver login + catalog | **NOT RUN**; heading/error speech and card reading order remain unverified. | Environment note above |
| NVDA/VoiceOver PDF reader | **NOT RUN**; dialog speech, live updates and note reading remain unverified. | [Rendered note](a11y-evidence/v104-2026-10-23/pdf-note-saved.png) proves UI operation only |
| NVDA/VoiceOver EPUB iframe | **NOT RUN**; browse mode, entering/leaving the frame and pronunciation remain unverified. | [EPUB screenshot](a11y-evidence/v104-2026-10-23/epub-100.png) proves rendering only |
| 200% zoom | **FAIL**. Login error state hides submit text; Edit, Upload and Grants have controls below an unscrollable overlay. Password and populated Offline modal fit in the tested state. | [Login](a11y-evidence/v104-2026-10-23/login-error-200-native.png), [Edit](a11y-evidence/v104-2026-10-23/edit-200-clean-native.png) |
| 400% / 320 CSS px reflow | **FAIL**. Login and Edit controls are inaccessible visually; Notes covers its focused toolbar toggle. Catalog document had no horizontal overflow in the measured state. | [Login](a11y-evidence/v104-2026-10-23/login-error-400-native.png), [Edit](a11y-evidence/v104-2026-10-23/edit-400-clean-native.png), [Notes](a11y-evidence/v104-2026-10-23/reader-keyboard-notes-400-native.png) |
| Forced-colors mode | Sampled PDF button and modal input focus indicators are visible under **Edge media emulation**. A native Windows contrast-theme pass remains outstanding. | [PDF](a11y-evidence/v104-2026-10-23/pdf-forced-colors.png), [Password](a11y-evidence/v104-2026-10-23/password-forced-colors.png) |
| Offline library + offline PDF/EPUB | Local cached copies open under browser network emulation; API probes fail while PDF text and EPUB heading are present. This does not establish screen-reader accessibility offline. | [Action log](a11y-evidence/v104-2026-10-23/offline-and-login-final.actions.json), [PDF](a11y-evidence/v104-2026-10-23/offline-pdf-final.png), [EPUB](a11y-evidence/v104-2026-10-23/offline-epub-final.png) |

## Findings

Severity describes observed user impact. F1 has a completed axe violation in the original application document; F2 combines the original frame DOM with a separate diagnostic scan. F3–F5 are rendered-layout findings.

| # | WCAG SC | Severity | Screen | Expected | Actual | Owner / target |
|---|---|---|---|---|---|---|
| F1 | [2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) | Serious | PDF highlight toolbar | Pointer targets meet size or spacing requirements. | Four color buttons are 17×17 CSS px; axe measures only 18 px safe clickable space. | Project maintainer / unassigned release |
| F2 | [3.1.1](https://www.w3.org/WAI/WCAG22/Understanding/language-of-page.html) | Serious | EPUB after rendering/resizing; also observed offline | HTML content declares its primary language. | Actual frame is `text/html`, with `xml:lang="tr"` but no `html[lang]`. Standalone axe diagnostic reports `html-has-lang`. Frame title exists; frame `lang` is also absent. | Project maintainer / unassigned release |
| F3 | [1.4.4](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html), [1.4.10](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) | Serious | Login, invalid-credentials state | Enlarged controls remain visible/reachable, with vertical scrolling as needed. | At 200%, submit is y=378.15–419.25 in a 381 px viewport, hiding its label. At 400%, submit starts at y=375.75 in a 190 px viewport. Focus and document scrolling do not reveal it; fixed overlay does not scroll. | Project maintainer / unassigned release |
| F4 | 1.4.4, 1.4.10 | Serious | Edit / Upload / Grants modals | Long dialogs scroll so all fields and actions remain usable. | At 200%, Edit Save is y=546.1–583.2, Upload submit y=570.8–607.9, Grants submit y=536.8–573.9; viewport height 381. At 400%, Edit Save is y=669–706.5, viewport height 190. Overlay remains `overflow: visible`, `scrollTop: 0` after attempted scrolling. | Project maintainer / unassigned release |
| F5 | [2.4.11](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html) | Serious | Reader Notes at 320 CSS px | Focus stays visible when the panel opens. | Focus stays on `#toggleNotes` at x=218.93, y=88, 85.07×38. Notes covers x=38.4–320, y=0–190.6, entirely hiding it. Hit testing at toggle center returns `#notesList`. | Project maintainer / unassigned release |

### Reproduction and evidence

1. **F1:** Open PDF and select text. This audit created the selection with a DOM Range/mouseup event, then used the actual note/save controls. The [axe export](a11y-evidence/v104-2026-10-23/pdf-highlight-toolbar.axe.json) contains affected selectors and size/spacing results. This does not prove keyboard-only text selection.
2. **F2:** Open the reflow EPUB, resize/zoom, then inspect the current iframe document. [Captured document](a11y-evidence/v104-2026-10-23/epub-frame-document.json) records content type, language attributes and script-free HTML. [Frame observations](a11y-evidence/v104-2026-10-23/epub.actions.json) record title and sandbox.
3. **F3:** Submit invalid credentials, then use native browser zoom at 200%/400%. Focus submit and attempt document and overlay scrolling. [Measurements](a11y-evidence/v104-2026-10-23/offline-and-login-final.actions.json) and [400% measurements](a11y-evidence/v104-2026-10-23/login-400-final.actions.json) accompany the screenshots.
4. **F4:** At 200%, open Edit, Upload or Grants, focus submit and attempt scrolling; at 400%, repeat Edit. [200% Edit measurements](a11y-evidence/v104-2026-10-23/edit-200-clean.actions.json), [Upload/Grants measurements](a11y-evidence/v104-2026-10-23/keyboard-and-modal-proof.actions.json), [400% Edit measurements](a11y-evidence/v104-2026-10-23/edit-400-clean.actions.json).
5. **F5:** At 400% / 320 CSS px, open PDF, Tab from Download to Notes and press Enter. [Keyboard measurements and hit test](a11y-evidence/v104-2026-10-23/keyboard-and-modal-proof.actions.json) confirm active `#toggleNotes` with `:focus-visible` true while Notes entirely covers it. The native screenshot includes an Edge save-password bubble, which is browser UI and is not counted as a product finding. The obscured toggle center is below that bubble.

Final native zoom measurements: 1280×762 CSS px at 100%, 640×381 at 200%, 320×190 at 400%. Windows scale was 125%; DPR changed from 1.25 to 2.5 and 5. Browser shortcuts were sent to the isolated Edge window. These are browser zoom observations, not CSS zoom or device-width emulation.

## Coverage limits and remaining work

- **EPUB axe scope:** [Original export](a11y-evidence/v104-2026-10-23/epub-frames.axe.json) retains the shell scan and detached frame attempt. A subsequent sandbox-frame run did not finish; it is not counted as a pass. Scripts stayed disabled (`sandbox="allow-same-origin"`). Script-free rendered content was copied to a local document for diagnosis, **not** a full include-frames scan. Its additional `meta-viewport` finding is not counted as a confirmed product defect here: the document changed from iframe to top-level context; mobile zoom needs separate verification.
- **Contrast:** Exports retain incomplete checks, including symbol-only controls and overlapping backgrounds. Zero reported violations does not establish a full manual contrast pass.
- **EPUB renderer diagnostics:** Console output during frame/resize checks included `Cannot read properties of undefined (reading 'resize')` and CSP blocks on blob stylesheets. Audit-induced and application causes were not isolated; no additional WCAG finding is assigned, and theme/style fidelity is not signed off.
- **Keyboard/DOM observations:** Reader background became inert; closing returned focus to the opening card after asynchronous cleanup. Right Arrow changed the selected TOC tab; PDF/EPUB search results and a saved note rendered. These do not verify spoken names, live-region announcements or screen-reader reading order.
- **Offline scope:** Both final API probes failed while cached content was displayed. `navigator.onLine` was false for PDF and true for EPUB in the emulated session; this discrepancy is retained in the action log rather than treated as an application finding. OS airplane mode, cold offline restart and offline screen-reader tasks remain untested.
- The one-page PDF cannot verify multi-page announcements. Fixed-layout EPUB, EPUB link navigation, publisher image/table semantics, macOS VoiceOver and human listening were not tested.
- Assign a target release, fix F1–F5, repeat affected scans/zoom states, then complete NVDA + Edge and full iframe checks before closing this record.

## Remediation — v105 (pending retest)

These code changes target F1–F5 but are **not yet verified**; the record stays
open until the affected axe/zoom states are repeated.

| Finding | Change |
|---|---|
| F1 | Highlight color buttons are 24×24 CSS px (visual dot stays ~16 px via `background-clip: content-box`). |
| F2 | EPUB frame gets `lang` and the rendered `html` gets `lang`/`xml:lang`; re-applied on iframe `load` and relocation. |
| F3 | Login overlay scrolls; card uses auto margins so a tall error state is reachable. |
| F4 | Modal overlay scrolls; card no longer centers an oversized dialog out of reach. |
| F5 | Opening Notes moves focus to `#noteFilter`; closing returns focus to `#toggleNotes`; added a 24 px close button. |

## Sign-off

- [ ] No critical/serious axe findings — F1 remains; iframe coverage incomplete.
- [ ] Screen-reader tasks pass or are logged — not run; speech/browse tasks pending.
- [ ] No clipped controls at 200%/400% — F3/F4 remain; F5 hides focus.
- [ ] EPUB iframe title/lang/reading order checked — title/sandbox inspected; language and screen-reader work remain.
- [x] Offline library/reader checked — browser network-emulation smoke only, with limits above.
- [ ] Findings have owner and target version — maintainer role recorded; target release unassigned.
