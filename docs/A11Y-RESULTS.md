# Accessibility manual results — WCAG 2.2 AA

**Status: OPEN — v122 audit refreshed; NVDA + Edge actual speech observations and complete iframe sign-off remain outstanding. Historical F1–F5 targeted passes remain below.**

The initial summary/findings below are the v104 baseline; current verification is recorded under **Retest — v105** and **Retest — v106**.

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
- F1–F5 have passed the targeted v105/v106 retests below. Complete NVDA + Edge and full iframe checks before closing the overall record.

## Remediation — v105

These code changes target F1–F5. The retest below verifies F1–F4 and records
the remaining F5 Escape behavior; the overall record stays open.

| Finding | Change |
|---|---|
| F1 | Highlight color buttons are 24×24 CSS px (visual dot stays ~16 px via `background-clip: content-box`). |
| F2 | EPUB frame gets `lang` and the rendered `html` gets `lang`/`xml:lang`; re-applied on iframe `load` and relocation. |
| F3 | Login overlay scrolls; card uses auto margins so a tall error state is reachable. |
| F4 | Modal overlay scrolls; card no longer centers an oversized dialog out of reach. |
| F5 | Opening Notes moves focus to `#noteFilter`; closing returns focus to `#toggleNotes`; added a 24 px close button. |

## Retest — v105 (`90ed1a2`) — 2026-10-23

**Deployment gate: HOLD.** Four findings pass the targeted retest; F5 opening
focus and close-button behavior pass, but Escape fails the expected close/focus
return path. No production deployment was attempted. A read-only HTTPS check
confirmed production still serves `app.js?v=104` and `styles.css?v=40`.

- Local URL: `http://127.0.0.1:47660/?v=105`; isolated demo copy with current product files verified byte-for-byte.
- Browser: Edge 155.0.4283.45. Native browser zoom: 1280×762 / DPR 1.25 at 100%, 640×381 / DPR 2.5 at 200%, 320×190 / DPR 5 at 400%.
- Evidence: [manifest](a11y-evidence/v105-2026-10-23/manifest.json), [all 15 measured cases](a11y-evidence/v105-2026-10-23/results.json), [production version check](a11y-evidence/v105-2026-10-23/production-version.json).
- Screenshots capture the actual rendered viewport through CDP without a clip rectangle; this avoids the previous screenshot cropping and browser password-bubble issues.

| Finding | Retest result | Measurement / evidence |
|---|---|---|
| F1 | **PASS** | All four highlight color targets measure 24×24 CSS px. Real Edge axe-core 4.13.0 scan with the toolbar open: **0 violations**; color-contrast review items remain. [JSON](a11y-evidence/v105-2026-10-23/pdf-highlight-toolbar.axe.json), [screenshot](a11y-evidence/v105-2026-10-23/pdf-highlight-toolbar.png). |
| F2 | **PASS for the tested reflow EPUB language** | Initial load, 200%, 400%, return to 100%, and chapter 2: iframe `lang`, rendered `html[lang]` and `xml:lang` all equal `tr`. Title stays `EPUB içeriği`; sandbox stays `allow-same-origin` without scripts. [Chapter 2](a11y-evidence/v105-2026-10-23/epub-chapter-2.png); detailed frame attributes in results JSON. |
| F3 | **PASS** | Invalid-login submit is reachable by Tab and wheel scrolling at both zoom levels. Overlay uses `overflow-y: auto`; no horizontal overlay overflow. At 400%, wheel scrollTop 267.6 puts submit at y=108.15–149.65 inside the 190 px viewport. [200%](a11y-evidence/v105-2026-10-23/login-error-200.png), [400%](a11y-evidence/v105-2026-10-23/login-error-400.png). |
| F4 | **PASS** | Edit, Upload and Grants pass at both 200% and 400%. Keyboard focus, wheel scrolling and individual control focus checks reach every visible input/select/button; no horizontal overlay overflow. Measurements below. |
| F5 | **PARTIAL** | Keyboard activation focuses visible `#noteFilter`. Close button and `n` close path restore visible `#toggleNotes`. Escape in the focused filter only blurs to BODY; second Escape closes without restoring focus. [Open](a11y-evidence/v105-2026-10-23/notes-open-400.png), [button close](a11y-evidence/v105-2026-10-23/notes-closed-400.png), [first Escape](a11y-evidence/v105-2026-10-23/notes-escape-400.png). |

### F4 — final modal measurements

The initial form can extend below the viewport; unlike v104, its overlay now
scrolls. Every listed submit control is fully visible after keyboard focus and
wheel scrolling. The results JSON also records individual field reachability.

| Modal | Zoom / viewport height | Overlay scrollTop after keyboard focus | Submit y range after keyboard focus | Screenshot |
|---|---|---|---|---|
| Edit | 200% / 381 px | 240 | 306.10–343.20 | [Edit 200%](a11y-evidence/v105-2026-10-23/edit-200.png) |
| Upload | 200% / 381 px | 264.8 | 306.00–343.10 | [Upload 200%](a11y-evidence/v105-2026-10-23/upload-200.png) |
| Grants | 200% / 381 px | 261.6 | 275.20–312.30 | [Grants 200%](a11y-evidence/v105-2026-10-23/grants-200.png) |
| Edit | 400% / 190 px | 540 | 129.00–166.50 | [Edit 400%](a11y-evidence/v105-2026-10-23/edit-400.png) |
| Upload | 400% / 190 px | 510.8 | 129.00–166.50 | [Upload 400%](a11y-evidence/v105-2026-10-23/upload-400.png) |
| Grants | 400% / 190 px | 677.6 | 97.90–135.40 | [Grants 400%](a11y-evidence/v105-2026-10-23/grants-400.png) |

### F5 — remaining Escape path

Reproduction at 400% / 320 CSS px, with an empty Notes filter:

1. Tab from Download to Notes, then Enter. Focus becomes `#noteFilter`, with `:focus-visible` true; y=61–92.25 is unobscured in the 190 px viewport. The original opening-focus overlap is fixed.
2. Shift+Tab three times reaches the new 24×24 close button. Enter closes Notes and restores unobscured, visible focus to `#toggleNotes` at y=88–126. This path passes.
3. Enter reopens Notes and focuses `#noteFilter`. **First Escape** leaves `notesPanel.hidden=false` and moves focus to `BODY`, with `:focus-visible=false`.
4. **Second Escape** sets `notesPanel.hidden=true`, but focus remains `BODY`; the toggle does not regain focus.

The `n` shortcut was also checked from a non-input control: opening focuses the
filter; closing from the close button restores the toggle. Typing `n` inside an
input is not treated as a shortcut requirement.

Cause confirmed in `spike/app/public/app.js`: the `if (typing)` branch at line
3526 blurs the input and returns before the Notes Escape handler. On second
Escape, `setNotesOpen(false)` reaches line 1394 with BODY focused, so the
`notesPanel.contains(document.activeElement)` condition prevents focus return.

**Follow-up:** route Notes Escape from its filter through the common close
path before the typing early return, and verify focus restoration. Owner:
project maintainer; target patch not assigned. This is a remaining interaction
acceptance issue; the original F5 opening-focus observation now passes. No new
WCAG conformance verdict is inferred from the Escape behavior alone.

**v106 remediation (verified below):** when the typing branch receives Escape
and the event target is inside `#notesPanel`, it now calls `setNotesOpen(false)`
before returning. That closes the panel and restores focus to `#toggleNotes`
because the active element is still the filter when the close runs. Escape from
other inputs keeps the old blur behavior.

This retest does not claim NVDA/VoiceOver, complete iframe axe coverage, native
forced-colors, offline v105, or full WCAG AA sign-off. Earlier v104 measurements
remain above as the historical baseline. [Browser diagnostics](a11y-evidence/v105-2026-10-23/browser-console.json)
are retained separately; no additional defect was assigned from console output.

## Retest — v106 (`cf25965`) — 2026-10-23

**F5: PASS. Deployment gate: PASS.** All five requested interactions pass at
100% and native 400% browser zoom (10/10 checks). F1–F4 retain their v105
targeted passes; the complete WCAG record remains open.

- Tested source: `cf25965962518a68526ab3e4f7e703d5fd0a84a5`, extracted with `git archive` into an isolated demo copy. The working branch advanced during testing; subsequent versions are outside this release.
- Local URL: `http://127.0.0.1:63402/?v=106`; Edge 155.0.4283.45 / Windows. Native zoom measured 1280×762 CSS px / DPR 1.25 at 100%, and 320×190 / DPR 5 at 400%.
- Evidence: [manifest and source hashes](a11y-evidence/v106-2026-10-23/manifest.json), [10 measured cases](a11y-evidence/v106-2026-10-23/results.json), [browser diagnostics](a11y-evidence/v106-2026-10-23/browser-console.json). Source bytes in the demo copy match the pinned archive.

| Interaction, repeated at 100% and 400% | Result | Observation |
|---|---|---|
| PDF → Notes | **PASS** | Keyboard activation focuses unobscured `#noteFilter` with `:focus-visible`. At 400%, its y range is 61–92.25 in the 190 px viewport. [Open at 400%](a11y-evidence/v106-2026-10-23/notes-open-400.png). |
| One Escape from the filter | **PASS** | Notes closes, the reader stays open, and visible, unobscured focus returns to `#toggleNotes`; the event is prevented. At 400%, the toggle is x=218.93, y=88, 85.07×38 CSS px. [After one Escape](a11y-evidence/v106-2026-10-23/notes-single-escape-400.png). |
| Second Escape | **PASS** | The reader closes and visible focus returns to the opening catalog button. [Reader closed](a11y-evidence/v106-2026-10-23/reader-closed-400.png). |
| `n` → close button | **PASS** | `n` opens Notes and focuses the filter; Shift+Tab three times reaches the 24 px close button. Enter closes Notes and restores visible focus to the toggle. [Button close](a11y-evidence/v106-2026-10-23/notes-button-close-400.png). |
| Escape in an input outside Notes | **PASS** | Focused `#pageInput` only blurs to BODY; the reader remains open, Notes remains closed, and the input value is unchanged. The event is not prevented. [Outside input](a11y-evidence/v106-2026-10-23/outside-input-blur-400.png). |

This closes the targeted F1–F5 findings, including the remaining F5 Escape
acceptance issue. It does not establish NVDA/VoiceOver usability, a complete
EPUB include-frames axe pass, native Windows contrast themes, or full WCAG AA
conformance. The v104 and v105 observations above remain historical evidence.

Production now serves the pinned v106 release: health `healthy`, restarts 0,
HTTPS asset hashes match the tested source, and smoke checks pass 16/16.
[Separate deployment record](deployments/2026-10-23-v106.md).

## Sign-off

- [ ] No critical/serious axe findings — targeted v105 highlight-toolbar scan passes; full iframe coverage remains incomplete.
- [ ] Screen-reader tasks pass or are logged — not run; speech/browse tasks pending.
- [x] Targeted login / Edit / Upload / Grants controls reachable at 200%/400% — v105 retest passes.
- [ ] EPUB iframe title/lang/reading order checked — v105 title/lang/sandbox pass; screen-reader reading order remains unverified.
- [ ] Offline library/reader checked for v105 — only the v104 baseline smoke was performed.
- [x] Targeted F1–F5 findings closed — F1–F4 verified in v105; F5 Escape and focus behavior verified in v106 (10/10).
- [x] v106 deployment gate — F5 retest passed; [production deployed and verified](deployments/2026-10-23-v106.md), smoke 16/16.


## v122 current audit and NVDA preparation — 2026-10-24

Pinned source **8b598a3**, CSS45/SW14; actual deployed image hashes match all 14 runtime files. Product owner selected **Windows / NVDA + Edge**. The current audit uses an isolated unchanged demo copy with generated reflow EPUB, no customer data and no production audit-script injection. A transport bootstrap limits the server to loopback; DATABASE_URL is empty and social watermark enforcement is disabled in this fixture-only demo, so these runs do not establish production DB/DRM behavior.

- **10 rendered Edge/axe scans completed, 0 reported violations:** login, login-error, catalog, Upload, Password, Grants, Offline empty modal, PDF reader, PDF Notes and EPUB shell. Contrast incomplete items remain; zero violations is not a full contrast pass.
- **1 targeted keyboard/DOM pass:** Notes filter -> one Escape -> panel closes and focus returns to toggle. This is not a spoken-focus pass.
- **2 original-frame scans BLOCKED:** chapter one and two both timed out at 15 seconds. Direct evaluation and CDP isolated-world evaluation were tried on the original sandboxed documents without enabling publisher scripts; shell or standalone scans are not substituted as full iframe coverage. Frame language/title/sandbox metadata was checked before the incomplete scan, but this does not complete an iframe audit.
- Browser JS errors **0**. Owned browser and local server stopped; production remains v122.
- The first harness toggled the already-open wide-screen Notes panel closed, then incorrectly attempted to focus the hidden filter. That fixture/setup failure is retained separately; corrected setup passes without product changes. This is not a reopened F5 product finding.
- A signed NV Access 2026.2 portable creation attempt in a new workspace folder did not finish within the bounded 45 seconds and yielded no executable. Only that spawned installer was stopped; no NVDA installation/startup setting changed. No real NVDA speech pass is claimed. VoiceOver/Safari was unavailable and remains NOT RUN.

Two observations are queued for the real NVDA session rather than declared WCAG failures: six reader icon controls have glyph primary AX names and descriptive title text in AX descriptions; the footer/Shortcuts remains in the AX tree while main is inert. Verify announcement clarity and modal browse-mode isolation in S04/S05.

[Summary](a11y-evidence/v122-2026-10-24/summary.json), [final results](a11y-evidence/v122-2026-10-24/final/results.json), [first attempt](a11y-evidence/v122-2026-10-24/first-attempt/results.json), [manual S01–S12 form](A11Y-NVDA-V122.md), [55-criterion ACR draft](ACR.md). **Overall record stays OPEN; no WCAG AA conformance or completed VPAT is asserted.**


### Manual environment reported — 2026-10-24

The product owner reports Edge **155.0.4283.45 (Official build), 64-bit** and NVDA **2026.2 (2026.2.0.57664)** on the selected Windows environment. This is user-reported environment metadata, not a completed speech observation. Windows version, voice/language configuration and the actual S01 login-error announcement were not supplied. S01 remains **NOT RUN / result not reported**; no PASS or FAIL inferred. Historical automated evidence and manifests are unchanged.
