# v125 — native selection, notifications and publication samples

**Local candidate only.** Code **10546bfb91c643ffa1a0ebc8aa8f28b72d824874**, CSS48/SW17. Production readback remains **124/52c846c/production**. No production environment, migrations, deployment or rollback image changes.

Date: **2026-10-25 Europe/Istanbul**. Operator: Codex agent using actual NVDA Speech Viewer and OS keyboard commands, plus isolated Edge/DOM/axe tests. NVDA **2026.2 / 2026.2.0.57664**, Edge **155.0.4283.45**, axe **4.13.0**. No human audio/pronunciation review or independent third-party certification.

## Results and source provenance

| Run | Result | Scope |
| --- | --- | --- |
| [Native acceptance](native-proof-final/results.json) | **6/6**, JS0 | Actual native PDF/EPUB selection → clipboard match → highlight; EPUB table/image alternative/MathML speech |
| [Existing regression matrix](regression-proof-final/results.json) | **74/74**, JS0 | Login/catalog/modals/readers/offline/CAS/expiry, themes and reflow |
| [Content and notice cases](content-proof-final/results.json) | **14/14**, JS0 | Untimed history, nested forms, async completion, account isolation and publication diagnostics |
| [Native notice zoom](notification-layout-final/results.json) | **6/6**, JS0 | Actual 100/200/400% zoom; keyboard scrolling; three axe scans |
| [Unit regressions](unit-tests.tap) | **65/65** | Citation/search/downloads/maintenance/watermark/EPUB policy/retention |

Counts overlap and must not be added as unique tests. [Source proof](source-proof.json) verifies that the first three browser runs exactly match the final runtime. The zoom run uses identical final HTML/CSS; its only source difference is subsequent notification logic, covered by the final content/regression runs.

There are **34 clean axe scans / zero violations** across regression, content and notice zoom. The additional missing-alt/lang negative-control scan intentionally detects violations and restores the fixture. Raw `incomplete` entries are retained; zero axe violations is not a blanket conformance result. The negative PDF diagnostics below are **limitations detected**, not accessible-document passes.

## Real native selection — no injected Range

NVDA's native selection mode was enabled with **NVDA+Shift+F10**. NVDA browse navigation found the document text; Home and Shift+Ctrl+Right selected it. Browser Selection was only **read**, never created with `Range`/`addRange` by the test. Alt+Shift+H opened the application tools, native Tab/Enter copied the text and saved a highlight.

- EPUB selection: **“Reader accessibility ”**. Speech Viewer: “Reader selected”, “accessibility selected”. [Speech](native-proof-final/epub-select.speech.json).
- PDF selection: **“Visual ”** in the PDF text layer. Speech Viewer: “Visual selected”. [Speech](native-proof-final/pdf-select.speech.json).
- Clipboard text matched each native selection; the saved highlight appeared in Notes.
- Some OS/assistive automation keyboard events have an empty `KeyboardEvent.code`; the app now also recognizes the logical H key. This is an input compatibility fix, not a claim that physical keyboards always omit code.
- The help text now explains NVDA's native selection command. Installed NVDA 2026.2 User Guide, **Native Selection Mode**, was consulted; this run applies to this NVDA/Edge combination, not all AT/browser versions.

## Notification timing

The transient toast still disappears after 2.6 seconds, but its text is also available through **Bildirimler** in login, footer, reader and forms. The last 200 notices remain in memory until user clear, reload, sign-out or account/auth change. No DB, localStorage or cross-device notification archive was added.

- An open history is a stable reading snapshot: a new async message cannot replace the entry being read. New notices are available on reopening.
- History opened from a form preserves the fields, selection of the original dialog and return focus. If that form finishes saving in the background, closing history does not reopen a completed form.
- Clear and account-change paths remove text from the DOM; an old suspended form is not restored on an account change. Peer-tab account change and anonymous access were tested.
- The list is keyboard-focusable and scrollable at native 400% zoom. The first scroll probe sampled before the browser's keyboard-scroll animation completed; the corrected measurement waits for scrolling and passes.
- A transient informational message now has an untimed alternative. Search/render debounce and URL revocation timers do not impose a reading/input deadline. The current server session TTL is seven days, longer than the 20-hour exception; ticket/lease/retention timers are not manual user response windows in these flows. See [W3C timing guidance](https://www.w3.org/WAI/WCAG22/Understanding/timing-adjustable.html). This bounded UI assessment is not a decision about every publisher's license/access policy.

The Chromium protocol screenshot can be blank at native zoom despite correct layout and a painted app. Native geometry/keyboard/axe results were supplemented with an actual owned-window OS pixel review. A fresh exact-source visual-check report is included; its screenshot is not retained because an AT overlay exposed prior unrelated speech. Blank protocol captures are diagnostic artifacts, not evidence of a blank product UI.

## Publication samples — successes and limits

| Sample | Observed result | Meaning |
| --- | --- | --- |
| [Semantic EPUB](content-proof-final/semantic-academic.epub) | Heading/table/caption/header relationships preserved; image alternative spoken; MathML formula spoken | Positive synthetic sample; not every publisher document |
| RTL chapter in the same EPUB | `lang=ar`, `dir=rtl` and computed RTL direction retained; root en and Turkish part preserved | Metadata/layout pass; Arabic pronunciation not evaluated |
| [Fixed-layout EPUB](content-proof-final/fixed-layout.epub) | Two pre-paginated pages rendered and TOC navigation worked | No general fixed-layout/reflow/DRM conformance claim |
| [Tagged PDF](content-proof-final/tagged-structure.pdf) | Source contains H1 and Formula structure, but the viewer exposes **0 heading / 0 math roles** | **Confirmed reader semantic-structure gap** |
| [Untagged columns](content-proof-final/untagged-columns.pdf) | DOM reads RIGHT SECOND → LEFT FIRST; visual order is left → right | Untagged stream order is not authoritative visual reading order |
| [Image-only PDF](content-proof-final/image-only.pdf) | No source text or OCR layer in this fixture | Requires accessible source/OCR/text alternatives; the fixture is not accessible |

Actual NVDA output includes table dimensions and headers, **“Right triangle with sides a, b and c”**, and **“x squared plus y squared is equal to z squared”**. [Speech](native-proof-final/academic-semantics.speech.json). Interactive MathCAT exploration and human pronunciation are outside this check.

Source PDF structure and rendered results are recorded together in [the semantic comparison](content-proof-final/tagged-pdf-semantics.json). No heuristic repair or inferred page/reading order is advertised. These findings are retained in the [current ACR](../../ACR.md); full WCAG AA is not claimed.

## Reproduction and cleanup

All fixtures were generated, then uploaded only to loopback demo application copies. No production content was used. `fixtures.mjs` creates the EPUB/PDF samples. The included harnesses require the app dependencies plus local Playwright and axe; override `PLAYWRIGHT_MODULE` with a file URL and `AXE_SOURCE` with the local axe path as needed.

Run from the repository root. Copy the `.ps1` helpers and `fixtures.mjs` into `tmp/a11y-v125/`; set a fresh `AUDIT_RUN`. Use `HEADED=1` for `native-proof.mjs`/`layout-only.mjs` and the existing real Speech Viewer; run `regression.mjs` or `content.mjs` headless. Temporary output/profile/application copies remain under ignored `tmp` paths, excluded from the Docker context. Test Edge/server processes were closed. No cookies, profiles, old speech buffer, env files or credentials are committed.

**Remaining:** VoiceOver/Safari, human listening, robust PDF semantic structure/reading order and publication-specific alternatives. The native selection and message-timing tasks are closed for this tested Windows scope; v125 deployment is separate.
