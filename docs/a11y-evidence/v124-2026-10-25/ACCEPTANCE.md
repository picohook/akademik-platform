# v124 Windows accessibility acceptance — 2026-10-25

Local code **52c846c11f539b57ca3c531b72658da80c13976a**, CSS47/SW16. **Not deployed.** Production was read back as **123/e8ddb3d/production** after the local changes. No production env, migration, deployment or rollback changes were made.

Windows 25H2 build 26200.9711; Edge **155.0.4283.45**; installed NVDA **2026.2 / 2026.2.0.57664**; axe **4.13.0**. Test operator: Codex agent, actual Speech Viewer and native OS keyboard/zoom, plus Playwright. No claim of human audio/pronunciation review or independent third-party certification.

## Results

| Run | Result | Scope |
| --- | --- | --- |
| [Final source](final-source-all/results.json) | **74/74**, JS **0** | Headless 1280/640/320 CSS px, original EPUB frames, UI keyboard actions, offline reload, CAS/410, all three themes, spacing, labels and contrast/target measurements |
| [Full native matrix](native-verified/results.json) | **74/74**, JS **0** | Actual NVDA; native Edge 100/200/400%; native Windows high contrast, restored afterwards |
| [Final-source native focus](native-final-source/results.json) | **23/23**, JS **0** | Exact final runtime; original frames, native chapter announcement, 400% layout, EPUB selection-tools shortcut and bookmark panel return |
| [Final-source PDF/citation](native-pages/results.json) | **9/9**, JS **0** | Actual NVDA printed page label, Citation modal background isolation, keyboard cycle and focus return |
| [Existing unit regressions](unit-tests.tap) | **65/65** | Citation/search/downloads/maintenance/watermark/EPUB policy/retention; viewport observer rewrite/disposal added to the existing chapter-policy test |

These runs overlap; the counts are **not unique tests to be added together**. The earlier native matrix predates the last two files' small follow-ups. [Source proof](source-proof.json) names those differences; the final headless run, 23 native checks and nine page/modal checks exactly match the recorded current runtime hashes. The last follow-ups correct overlapping EPUB arrows, add a pressed-state border cue and dispose viewport/keyboard listeners. The final native bookmark return catches and verifies the arrow correction.

The final headless run has **28 clean axe scans / zero violations**; the extra negative-control scan intentionally produces missing `lang`/`alt` violations. The native final-source iframe/zoom and Citation runs also have zero unintentional violations. `incomplete` results remain in the raw files: symbol-only glyphs need foreground/background review, and transparent PDF text overlaps the canvas. [Computed theme ratios and target sizes](final-source-all/contrast-and-targets.json) and screenshot review cover the tested UI; publication imagery and semantics are not inferred from axe. Minimum measured theme text ratio is above **4.5:1**, control boundary ratio above **3:1**.

## Actual speech

| Scenario | Expected output captured |
| --- | --- |
| EPUB chapter link | “Bölüm: Chapter two” — [speech](native-final-source/chapter-change.speech.json) |
| Offline edit | “Not cihazda kaydedildi; eşitleme bekliyor” — [speech](native-verified/offline-note.speech.json) |
| CAS conflict | “Notta çakışma var; iki sürüm de korundu” — [speech](native-verified/cas-conflict.speech.json) |
| Controlled expiry | “Bu işlemin sunucu kaydı saklama süresi doldu; taslak korunuyor, yeni not olarak kaydedebilirsiniz” — [speech](native-verified/expiry.speech.json) |
| Invalid login | “E-posta veya parola hatalı.” — [speech](native-verified/login-error.speech.json) |
| PDF physical 3 / printed 1 | “Sayfa 1 (PDF 3)” — [speech](native-pages/printed-page.speech.json) |

Only new Speech Viewer suffixes after per-scenario baselines are retained. A captured `unavailable` utterance immediately after disabling the active Save button is a control-state announcement, not a missing Speech Viewer; the expected status follows it. Recorded speech proves generated output text, not pronunciation quality.

## Method and boundaries

- Final-source runs use distinct isolated application copies and fresh Edge profiles; server code/public files are copied unchanged. A bootstrap binds the fixture server to `127.0.0.1`. Generated EPUB and the repository's six-page label PDF avoid production content/DB edits. Later runs have distinct application-copy directories.
- Parent-realm axe runs against the **original iframe document and actual layout**; its timers use the parent realm. `sandbox="allow-same-origin"` is checked before/after; no `allow-scripts`, copied standalone document or content-security weakening. Injected missing alt/lang is detected, then removed/restored.
- Offline accessibility uses a synthetic PDF prepared directly in IndexedDB because demo mode requires DB-backed tickets for downloads. The browser then actually goes offline, edits, reloads, opens from the offline catalog and syncs online. This is not a new watermark/download security acceptance.
- CAS uses the real demo-server version check with a same-user API second writer. Expiry is a controlled route response, not a modified production receipt. The two drafts, keyboard decision and preservation/recovery are checked.
- Native zoom metrics include **1280/640/320 CSS px** with DPR **1.25/2.5/5**. At 400%, both UI containers and document can scroll; the PDF page itself retains its two-dimensional layout. Browser/AT windows are excluded from product focus-obscuration decisions.
- Some Chromium protocol screenshots at native zoom were blank despite a painted native window. Owned-window OS screenshots were also inspected; the selected OS captures show the Speech Viewer overlay. Browser password/translation prompts in exploratory runs were excluded as browser UI, not app failures. Final profiles disable those prompts. This distinction avoids treating a blank protocol capture as a product regression.
- Native Windows contrast was enabled temporarily and restored in `finally` to the recorded original flags; the full native report records `nativeContrastRestored: true`. Owned Edge/server processes were closed. The pre-existing NVDA session was not restarted/reconfigured. No test profiles, cookies, `.env` or full prior speech buffers are committed.

## Remaining assessment limits

**VoiceOver/Safari NOT RUN on Windows.** Native NVDA virtual-cursor selection initiation, comprehensive toast/help timing, arbitrary PDF semantic trees/reading order/image alternatives, and publication-specific fixed-layout/MathML/RTL/media are not certified. PDF/EPUB selection-tool tests prepare a Range and verify the keyboard toolbar/CFI/save path; they do not claim the missing native selection-initiation step. See the criterion-by-criterion [ACR](../../ACR.md).

The Windows UI remediation round is complete. A full-product WCAG AA declaration remains unsupported; v124 deployment is a separate operation.

## Reproduction

Run from the repository root with the app dependencies installed. Supply `PLAYWRIGHT_MODULE` as a `file:///.../playwright/index.mjs` URL and `AXE_SOURCE` as the local `axe.min.js` path if the recorded machine's npm cache differs. Edge must be installed; native speech additionally requires the existing NVDA Speech Viewer.

Copy the `.ps1` helpers from this directory into `tmp/a11y-complete/` before native runs; their markers/settings are temporary and must not be written into this evidence directory. `AUDIT_RUN` must be a fresh name. `HEADED=1` enables native zoom; `NVDA=1` enables speech assertions. Run `acceptance.mjs`, `native-focused.mjs` or `native-pages.mjs` from this directory. Output stays under `tmp/a11y-complete/<AUDIT_RUN>` and `spike/app/tmp/a11y-complete-<AUDIT_RUN>`. These harnesses do not deploy.
