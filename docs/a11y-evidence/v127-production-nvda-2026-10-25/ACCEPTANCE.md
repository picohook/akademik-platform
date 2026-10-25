# Production NVDA acceptance — v127 — 2026-10-25

**PASS — 7/7 checks, JavaScript errors 0.** Production **127/fbeed6e**; served `app.js` and `ocr-layer.mjs` SHA-256 match the reviewed source. Actual session: **15:54 Europe/Istanbul**. NVDA **2026.2 / 2026.2.0.57664**, Edge **155.0.4283.45**.

Actual librarian UI login → temporary generated **image-only Turkish PDF** uploaded normally → its genuine local Tesseract `tur` hOCR placed in a new, uniquely identified asset directory in the existing OCR bind mount → session/grant-controlled production manifest and hOCR route return the exact source bytes → native Enter opens reader → native Ctrl+Home / d / Down navigates with real NVDA.

Speech Viewer captured:

- **“Türkçe okuma örneği”**
- **“Diş hekimliğinde araştırma Öğrenci notları ve kaynaklar”**
- **“İnsan denetimi gereklidir.”**

Reader text-layer language is **tr**, with **3 source paragraphs / 13 OCR words**. [Raw results](results.json) include exact speech suffix, reader AX, source/fixture hashes, seven checks and cleanup. [Harness](test.mjs), [native input](native-keys.ps1), [speech capture](speech.ps1). The [source PDF](../v127-2026-10-25/ocr-tools/turkish-scan.pdf) and [real OCR output](../v127-2026-10-25/ocr-tools/tur/page-001.hocr) are generated acceptance fixtures, not publisher material. No synthetic speech, DOM Range, mocked OCR route or substituted renderer was used.

**Cleanup passed:** hOCR content hash verified before unlink; only its newly created, now-empty UUID directory removed with nonrecursive `rmdir`. Only the generated book was deleted after title/uploader checks and absence confirmed. Account logged out; owned Edge closed. Normal audit/usage/progress records remain. No existing book/sidecar was edited.

Preparation encountered NVDA menu/focus issues before production login/content creation. The same installed NVDA was restarted normally using `nvda_noUIAccess.exe`. [Viewer setup helper](open-viewer-console.ps1) invokes only `import speechViewer; speechViewer.activate()` in NVDA's own console, then closes the console; it opens a GUI window and **does not supply speech text**. The captured speech comes from native navigation of the production reader. Only speech after the baseline is archived. No NVDA startup/config file, OS security setting, app runtime, deploy, env, migration or rollback image was changed.

This closes the requested **production Turkish OCR reading** gate. Column order, selection/copy/highlight and general regression remain supported by their separate local v127 evidence; they were not re-run as production cases here. VoiceOver/Safari, human pronunciation/listening and real publication accuracy/alternatives remain open. **ACR open; no full WCAG AA claim.**
