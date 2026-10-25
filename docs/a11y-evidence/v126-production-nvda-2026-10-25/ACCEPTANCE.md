# Production NVDA acceptance — v126 — 2026-10-25

**PASS — 6/6 checks, JavaScript errors 0.** Production config **126/90c7b72**. Served `app.js` and `pdf-structure.mjs` SHA-256 hashes match the reviewed source. Actual run: **14:40–14:41 Europe/Istanbul**.

- NVDA **2026.2 / 2026.2.0.57664**, Edge **155.0.4283.45**.
- Actual **librarian** UI login → temporary generated tagged PDF uploaded through the normal API → native Enter opens the production reader → actual NVDA Ctrl+Home / H / Down navigation. No injected selection Range, local substitute renderer or synthetic speech.
- Speech Viewer captured **“Tagged PDF heading … heading … level 1”**.
- It also captured **“graphic … x squared plus y squared equals z squared”** from the source Formula alternate text. No `Invalid math` utterance. This is a textual alternative, not interactive MathML.
- The real reader AX snapshot has one H1 heading, paragraph and named image alternative. This production check does not repeat local H2/spread/selection tests.
- Cleanup passed: only the generated fixture book was deleted after checking its unique test title and uploader; absence confirmed. Account logged out; owned Edge closed. Normal audit/usage records remain. No existing books were modified.

[Results, exact speech suffix and source hashes](results.json). [Reproduction harness](test.mjs), [native keyboard helper](native-keys.ps1), [speech capture](speech.ps1), [normal-session Speech Viewer helper](open-viewer.ps1). The controlled source is the existing [tagged PDF fixture](../v126-2026-10-25/tagged-structure.pdf), SHA-256 `c5f3ca0c2cc04b2975038e5e3dcf840b636b647437ea33a42d4bd8813f69441b`.

The initial NVDA UIAccess session blocked automation focus/speech access. Before any production login/upload, it was replaced with the **same installed version's `nvda_noUIAccess.exe`**, and Speech Viewer was opened from NVDA Tools. No NVDA configuration file, automatic-start option or OS security setting was edited. The actual acceptance used this real NVDA process; setup failures are not counted as application test results. Speech capture retains only the suffix after the test baseline, not old history. No real password/cookies/profile or unrelated publication text is archived.

No deploy, environment, migration, application code or rollback-image changes. **ACR remains open**: untagged reading order, missing OCR/text alternatives, publisher semantics/alternatives, VoiceOver/Safari and human listening remain outside this narrow production acceptance. No full WCAG AA claim.
