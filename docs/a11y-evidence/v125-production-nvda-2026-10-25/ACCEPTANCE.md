# Production NVDA acceptance — v125 — 2026-10-25

**PASS — 6/6 checks, JavaScript errors 0.** Actual production config **125/10546bf**; the served `app.js` SHA-256 matches the reviewed local source. The run took place at **13:18–13:19 Europe/Istanbul**.

- NVDA **2026.2 / 2026.2.0.57664**, Edge **155.0.4283.45**.
- Actual reader-role UI login → granted PDF → generated temporary note edited/saved while the owned browser was offline → real NVDA announcement → untimed notification history → online CAS synchronization.
- Speech Viewer captured **“Not cihazda kaydedildi; eşitleme bekliyor”** from the persistent reader status region.
- After the visual toast expired, native **Enter** opened **Bildirimler**; native **Tab** reached the notification list. Actual NVDA Speech Viewer captured **“Bildirim listesi … Not cihazda kaydedildi; eşitleme bekliyor”**. Native Escape closed the modal and returned focus to its reader button.
- Only the generated temporary note was removed after synchronization. The reader account was logged out and the owned Edge profile/window closed. Normal operation/audit receipts remain.

[Raw results and isolated speech suffixes](results.json) include config, source hashes, the six checks and cleanup. [Reproduction harness](test.mjs), [native input helper](native-keys.ps1), [speech suffix helper](speech.ps1). The harness uses an ignored temporary profile; no credentials, cookies, production book text, profile or pre-existing Speech Viewer buffer is archived. NVDA was already running and was not restarted or reconfigured. The initial `unavailable` utterance is the disabled Save control, followed by the expected status; it is not a missing announcement.

No deploy, environment, migration or runtime source changes were made. This closes the v125 production **notification** acceptance gate; it does not claim a new production selection test, human audio/pronunciation assessment, full WCAG AA or ACR closure. VoiceOver and the documented publication/PDF semantic limitations remain open.
