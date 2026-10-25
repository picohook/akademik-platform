# Production NVDA acceptance — v124 — 2026-10-25

**PASS.** Production config **124/52c846c**; the served `app.js` hash matches the reviewed local source. Actual reader-role UI login → granted production PDF → temporary note edited/saved while browser offline → real NVDA readerStatus announcement → online synchronization. Only the generated acceptance note was removed; the test account was logged out and the owned browser closed.

- NVDA **2026.2 / 2026.2.0.57664**; Edge version is in [raw results](results.json).
- Captured Speech Viewer text: **“Not cihazda kaydedildi; eşitleme bekliyor”**.
- Reader status: `role=status`, `aria-live=polite`, `aria-atomic=true`, inside the active reader.
- **JS errors: 0.** Online sync and temporary-note cleanup passed.
- No deploy, environment or migration changes. Normal audit/operation receipts from the authorized test actions remain.

NVDA was initially stopped and was started for this test; no NVDA configuration file was edited. Early setup attempts did not reach login or create notes. The successful helper locates Speech Viewer by NVDA process and exact window name, then retains only the suffix after the test baseline. The `unavailable` utterance precedes the expected status when Save becomes disabled; it is not a missing Speech Viewer.

This is one real production offline-note announcement acceptance, not a complete ACR or full WCAG AA claim. Existing VoiceOver, native selection-initiation, timing and publication-semantic limits remain. No production PDF content, account password, cookies, profile or old Speech Viewer buffer is included.
