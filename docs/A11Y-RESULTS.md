# Accessibility manual results — WCAG 2.2 AA

**Status: OPEN — v122 NVDA baseline recorded; F6 reader status announcements fixed in local v123 candidate. Broader screen-reader, visual and iframe sign-off remain open.**

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


### S01 partial speech observation — 2026-10-24

On the reported Edge **155.0.4283.45 (64-bit)** / NVDA **2026.2 (2026.2.0.57664)** environment, the user first reported “okuyor, alert”, then clarified “okuyor tüm mesajı”. **Login-error announcement subcheck: PASS (user-reported)** — the full error message is spoken. No verbatim error-message transcript, recording or independent agent speech run was supplied; automatic timing versus navigation-triggered reading was not separately reported. This does not establish the rest of S01: heading/field names, password privacy and successful login still need observations. S01 is **IN PROGRESS** and the overall ACR stays OPEN; criterion-wide statuses and historical evidence manifests are unchanged.


### S01 field names, password privacy and successful login — 2026-10-24

The user answered “evet” to the combined check of Tab navigation through email/password/submit, correctly spoken field names, hidden password characters and successful login with the correct password. These three subchecks are **PASS (user-reported)** on the previously reported NVDA/Edge versions. Together with the prior full-error announcement, this advances S01; heading speech has not yet been confirmed, so S01 remains **IN PROGRESS**. No criterion-wide conformance status or production code changed.


### S02 search announcement and book action — 2026-10-24

The user answered “evet” when asked whether catalog search-result changes are announced and whether tabbing to the Read button speaks the book title and action understandably. **Both subchecks PASS (user-reported)** on the reported NVDA/Edge environment. Heading navigation, filtering and opening the result have not yet been confirmed; S02 remains **IN PROGRESS**. No criterion-wide conformance or independent speech-test claim is made.


## NVDA Speech Viewer + keyboard acceptance — 2026-10-25

**Scoped result: 16/16 keyboard/focus checks passed; overall ACR remains OPEN.** Same pinned v122/8b598a3 runtime, Edge 155.0.4283.45 and the user-reported installed NVDA 2026.2. The PDF subrun occurred 2026-10-24 19:25–19:26 Europe/Istanbul; modal/EPUB subruns occurred 2026-10-25. Speech Viewer transcripts are actual NVDA output, not a human audio/pronunciation evaluation.

- PDF 4/4: reader dialog/name, 38 forward and 38 reverse steps without escaping, actual native Tab boundaries and return focus on close.
- Six modal baselines: actual spoken dialog names, keyboard containment, closing and return focus. First Escape generated no DOM event in four input dialogs; second reached the application and closed them. The failed chained first attempt is retained; later steps in that invalid state were not product findings.
- EPUB 6/6 scoped functional/keyboard checks: dialog/frame metadata, 66 forward/reverse steps with frame entry and no escape, native frame exit, actual NVDA reading of heading/paragraph/table/link/footnote text, native chapter link and close/return. The original programmatic-focus link case was superseded only by an actual native Tab-to-link and Enter run with verified web-document focus and trusted click.
- **Chapter-change announcement remains UNVERIFIED:** Chapter two rendered, but its title was not in the capture; only “dialog Okuyucu” was captured. No full page-change announcement PASS is inferred.
- The stale PDF deep link, harness variable error and refused foreground input diagnostics are retained separately. Translation was disabled only in the final dedicated test profile to remove browser UI interference. Temporary input-thread attachment is detached immediately; OS keys are refused unless the exact owned Edge process is foreground.
- Publisher scripts stayed disabled; no sandbox/CSP/product code change. Source hashes match all 14 deployed runtime files. Owned browsers/local fixture servers were closed; NVDA was started with its existing settings and left available for the ongoing user session. Unrelated pre-dialog desktop-focus text was excluded from the published PDF-open transcript; no prior Speech Viewer history was published.

[Summary](a11y-evidence/v122-nvda-2026-10-25/summary.json), [PDF](a11y-evidence/v122-nvda-2026-10-25/pdf-2026-10-24/results.json), [modals](a11y-evidence/v122-nvda-2026-10-25/modals/results.json), [EPUB](a11y-evidence/v122-nvda-2026-10-25/epub/results.json), [native chapter link](a11y-evidence/v122-nvda-2026-10-25/link/results.json). S10–S12 screen-reader workflows, full Notes speech, shortcut/browse-mode checks, pronunciation, native contrast/current visual checks and full iframe axe remain open. VoiceOver/Safari is NOT RUN.


## F6 — reader status announcements and v123 remediation — 2026-10-25

Three v122 UI operations worked (offline edit/sync, actual CAS conflict and controlled 410 draft preservation), but none of the expected messages appeared in actual NVDA Speech Viewer captures, including a repeated six-second wait. Only Save unavailable / reader dialog output was captured. A temporary persistent polite status region inside the reader was then announced in the same NVDA session. This supports a real reader announcement failure in the tested environment. The old toast is outside the modal and hidden between messages; the diagnostic changed lifecycle and location together, so their individual contributions were not isolated.

**Local candidate v123, e8ddb3d07b6ac07863739de5c0e1ea681666ee97:** persistent visually hidden status inside reader, delayed update after UI focus changes, repeated-conflict deduplication, explicit expiry explanation, close/book reset and delayed-message owner/asset guard. Visual toast is hidden from assistive tech only while its message is mirrored into the reader, avoiding duplicate announcements. CSS46 / SW15. No migration or production-env change.

**Actual NVDA 3/3:** offline pending, conflict and explicit operation-expired/draft-preserved explanation. **Targeted regression 4/4:** expiry spoken again, filter causes zero repeated status mutations, rendered axe reports zero violations (contrast review items remain), close clears announcement and returns focus. The expiry scenario deliberately intercepts HTTP 410 in the local page; it is not another production purge test. CAS is real in-memory server version enforcement, with a same-user API second writer. State UI triggers used pointer actions; this is not a full keyboard journey or human pronunciation pass.

[Baseline/control](a11y-evidence/v122-nvda-2026-10-25/summary.json), [candidate/source proof](a11y-evidence/v123-live-status-2026-10-25/summary.json), [speech captures](a11y-evidence/v123-live-status-2026-10-25/speech/results.json), [regressions](a11y-evidence/v123-live-status-2026-10-25/regression/results.json). Raw candidate results inherited a v122 harness scope label; version=123 and 14 source hashes identify the tested candidate, and the summary corrects that metadata without changing raw outcomes.

**No deploy.** Docker read-only inspection failed because the Linux engine named pipe was missing; current production health was not re-certified. Last deployment is v122. Full ACR still OPEN, including chapter-name announcement, full Notes/shortcut/browse-mode and offline reload/bookmark coverage, visual checks, full iframe axe and VoiceOver.


## Remediation and Windows assessment — v124 — 2026-10-25

Local candidate only: CSS47/SW16; production remains v123/e8ddb3d. No env, DB migration, build/up or rollback change. [Acceptance and raw evidence](a11y-evidence/v124-2026-10-25/ACCEPTANCE.md), [NVDA task outcomes](A11Y-NVDA-V124.md), [criterion decisions](ACR.md).

Fixed: EPUB viewport zoom restriction (including engine resize rewrites); chapter speech/deduplication; icon names; footer/modal background isolation; single-character shortcut opt-out and modifier handling; keyboard selection tool launcher inside the reader dialog; bookmark/note/toolbar focus restoration; narrow-reader controls/panel scrolling; light/sepia/dark contrast and control borders; note action target sizes/native position buttons; note deletion confirmation; EPUB previous/next arrow overlap.

Real NVDA speaks chapter, offline pending, CAS, explicit expiry and login alert. Original sandbox iframe scans use its actual DOM/layout with unchanged allow-same-origin; injected missing lang/alt negative control fails as expected, then is restored. Native Edge 100/200/400%, native Windows high contrast (restored in finally), text spacing and 320 CSS px were checked. Unit regressions 65/65. Browser/JS results and source provenance are in the acceptance record.

**Scope stays explicit:** Native AT text-selection initiation, all message timing, VoiceOver/Safari and arbitrary publication semantics/content are not certified by these runs. ACR is a bounded assessment, not a full AA declaration.


## v125 follow-up — 2026-10-25

Local candidate **10546bfb91c643ffa1a0ebc8aa8f28b72d824874**, CSS48/SW17; prod remains v124/52c846c. [Evidence and known limitations](a11y-evidence/v125-2026-10-25/ACCEPTANCE.md).

Real NVDA Native Selection (NVDA+Shift+F10) created both PDF and EPUB selections without DOM Range injection. Copy text matched the clipboard and a highlight was created via keyboard. Logical-key fallback handles code-less keyboard events. Transient toast/help is available through untimed notification history, including inside forms; snapshots stay stable during reading, form fields/focus survive, completed background forms stay closed and account/auth changes clear the history.

Native EPUB table/image alternative/MathML speech was captured; RTL language/direction and one fixed-layout two-page fixture worked. Three negative PDF diagnostics are intentionally retained: tagged H1/Formula is not mapped to reader roles, untagged columns have a different text order and image-only PDF has no OCR/text alternative. These are limitations, not conformance passes. ACR updated accordingly; no full AA declaration.

## v126 source PDF structure — 2026-10-25

Local candidate **90c7b727e50d41def50486bd621789a39cdb8826**, CSS49/SW18; production **v125/10546bf** is unchanged. [Acceptance, native speech and raw results](a11y-evidence/v126-2026-10-25/ACCEPTANCE.md).

Source H1/H2/paragraph structure now owns the actual PDF.js marked text. NVDA H navigation announces level 1; the source Formula alternate text is spoken as an atomic graphic alternative without invalid-math warnings. Raw formula text remains selectable; no source MathML/heading/order is invented. Actual native selection → copy → highlight passed without injected Range. Layer IDs are page/render-specific, missing/duplicate references are contained, and controlled delayed old-book structure cannot overwrite the next document. OCR/untagged/decode failures retain text fallback.

Targeted **19/19**, regression **74/74**, units **65/65**; **32 clean axe scans/0 violations**, JS0. Native 200/400% zoom/high-contrast was not re-run; existing evidence remains version-scoped. All content is generated/isolated demo data. No deploy/env/migration changes. The tagged heading/formula-description omission closes in the local v126 candidate; untagged column order, OCR-less scans, publication alternatives, VoiceOver, advanced math exploration and human listening remain. ACR stays open.

## v127 reviewed OCR preparation — 2026-10-25

Local candidate **fbeed6e6fefcad00f13ddb80b98b91fb9ef67351**, CSS49/SW19; prod v126 stays unchanged. [Acceptance, source/model proof and raw speech](a11y-evidence/v127-2026-10-25/ACCEPTANCE.md). hOCR source paragraphs and language are retained. Workstation tools inspect PDF source facts and prepare real local OCR, with explicit ordered regions available; no automatic publication/AA gate is implemented.

Actual Tesseract eng/tur **10/10**; browser/NVDA **26/26**, regression **74/74**, units **65/65**; **34 clean axe/0 violations**, JS0. Native NVDA reads complete left column before right, preserves Turkish text and creates a real selection/copy/highlight without injected Range. Both initial interleaved worker-default output and final PSM3/explicit-region successes are documented. Clean synthetic samples do not establish error rates for real scans. Geometry was checked at default orientation; rotated OCR is not covered. hOCR is separate from original/downloaded PDF and is not automatically bundled offline.

[Publication review runbook](PUBLICATION-ACCESSIBILITY.md) and [12-row real Mac test template](A11Y-VOICEOVER-ACCEPTANCE.md) are prepared. VoiceOver/human listening remain NOT RUN; publisher descriptions, actual book completeness/order and complex publication semantics require review. ACR stays open; no full AA claim.
