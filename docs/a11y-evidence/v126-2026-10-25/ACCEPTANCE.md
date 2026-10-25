# v126 — source PDF headings and formula alternatives

**PASS for the tested Windows/NVDA scope. Local candidate only**, code **90c7b727e50d41def50486bd621789a39cdb8826**, frontend126/CSS49/SW18. Production stays **v125/10546bf**, with the existing v124 rollback. No deploy, environment, migration or production-content changes were made.

Date: **2026-10-25 Europe/Istanbul**. Edge **155.0.4283.45**, NVDA **2026.2 / 2026.2.0.57664**, axe **4.13.0**. Actual native OS keyboard and NVDA Speech Viewer; no human audio/pronunciation review.

## Change and limits

The reader now asks PDF.js for marked text and the source structure tree. A structure layer uses `aria-owns` to connect source heading/paragraph/group nodes to the **actual selectable text**, following the installed pinned PDF.js viewer's approach. It creates no duplicate hidden text document and infers no headings, reading order or mathematical markup from font size/coordinates.

PDF `Formula` with source alternate text is exposed as an atomic image alternative. A PDF textual description is **not MathML**: applying `role=math` made NVDA/MathCAT report invalid math during development. The final code uses the actual source description, and the final real NVDA run explicitly rejects that error. Without alternate text, the original formula text stays available in a generic group; no explanation is invented. Interactive mathematical exploration is not provided by this PDF change.

Marked-content IDs are unique per rendered layer; ownership is scoped to the current text container. Duplicate/missing/outside references cannot own another page's text. Text/structure are committed together after rendering, with document/render guards; a delayed old-book structure response cannot overwrite the next book. Decode failure preserves ordinary text. OCR text has no matching PDF marked-content IDs, so no unrelated PDF structure is applied to it.

The new module is in the static allowlist and SW18 offline shell. Single page, spread, scroll, zoom/rotation and close/reset paths were checked. The [render screenshot](native-final/tagged-render.png) contains only a generated fixture.

## Results

| Run | Result | Scope |
| --- | --- | --- |
| [Targeted browser and actual NVDA](native-final/results.json) | **19/19**, JS0 | Roles/ownership, language, spread/scroll/zoom/rotation, malformed IDs, decode fallback, controlled cross-book race, OCR, offline module cache; native heading/formula speech and selection/copy/highlight |
| [Existing regression matrix](regression-final/results.json) | **74/74**, JS0 | PDF/EPUB, modals, keyboard/focus, note/bookmark, offline reload/sync, CAS/controlled expiry, responsive/themes, iframe |
| [Unit regressions](unit-tests.tap) | **65/65**, 0 fail | Existing citation/search/download/maintenance/watermark/EPUB policy/retention tests |

**32 clean axe scans, 0 violations**: four targeted and 28 regression scans. The intentional iframe missing-alt/lang negative control is separate; it detects the expected failures and restores the fixture. Raw manual/incomplete entries remain. Counts overlap; they are not a sum of distinct user journeys. The regression matrix uses viewport reflow/forced-colors emulation in this run; native zoom/high-contrast results from v125 were not re-run or relabelled as new v126 results.

[Source proof](source-proof.json) verifies that both archived browser runs match the final runtime files exactly. [Summary](summary.json). Known demo fixture password text in serialized axe/AX artifacts is redacted; no real account credentials, cookies, profiles or old Speech Viewer history are archived. All owned browsers/demo servers were closed.

## Actual NVDA evidence

From [tagged-roles.speech.json](native-final/tagged-roles.speech.json):

> Tagged PDF heading … heading … level 1
>
> graphic … x squared plus y squared equals z squared

No `Invalid math` utterance. Native H jumps to the source heading. [AX snapshot](native-final/tagged.aria.yml) and [AX tree](native-final/tagged.ax.json) show a single heading and one paragraph instance; no duplicate text document.

NVDA native selection mode was enabled with **NVDA+Shift+F10**. H → Home → Shift+Ctrl+Right twice selected **“Tagged PDF ”** in the actual text layer. [Selection speech](native-final/tagged-select.speech.json). Native Alt+Shift+H → Tab/Enter copied the same text and saved a highlight. No injected DOM Range was used for this targeted native selection. The separate general regression harness uses an injected selection fixture for toolbar checks and does not claim native selection for that fixture.

## Reproduction

[Targeted harness](test.mjs), [regression harness](regression.mjs), [multi-page fixture generator](fixtures.mjs), [native input](native-keys.ps1), [speech suffix capture](speech.ps1). Run from the repo root with app dependencies, Playwright/axe and installed NVDA/Speech Viewer; module paths can be overridden with `PLAYWRIGHT_MODULE` and `AXE_SOURCE`. Copy harnesses/helpers to `tmp/a11y-v126`, use a fresh `AUDIT_RUN`; `HEADED=1 NVDA=1` enables native acceptance. Helpers refuse input unless the owned Edge profile is foreground and save only speech after the baseline. The source fixture is included as [tagged-structure.pdf](tagged-structure.pdf); the source-path copy under the archived v125 evidence remains available to the harness.

## Remaining ACR scope

The observed **tagged heading/formula-description omission is fixed for these source-tagged samples**. Untagged column reading order, scans without text/OCR alternatives, incomplete publisher tagging/alternatives, VoiceOver/Safari, human pronunciation and advanced publication/math exploration remain outside this closure. No full WCAG AA or universal publication-accessibility claim.
