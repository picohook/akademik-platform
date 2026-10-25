# Reader status announcements — v123 candidate

Code: e8ddb3d07b6ac07863739de5c0e1ea681666ee97. **Not deployed.** Last deployment v122; migration unchanged.

NVDA 2026.2 / Edge 155 baseline: three successful reader operations produced no expected status speech, even after six seconds. An always-present status region inside the active reader was announced.

The fix adds that persistent region, clears/reschedules repeated messages after focus updates, deduplicates conflict notifications, speaks the specific expiry explanation, and clears pending messages on close/book switch. Delayed delivery checks current owner and asset. Visual toast is excluded from AT while the reader region mirrors it. CSS46/SW15 ensures the future shell update gets the new markup/style/script.

Validation: actual NVDA **3/3**, targeted regressions **4/4**, syntax/diff checks clean. Expiry a11y scenario uses controlled HTTP 410; CAS is a real demo-server conflict. No production DB/migration/env edits. Docker engine unavailable prevented production inspection/smoke; no deploy was attempted.

[Evidence](a11y-evidence/v123-live-status-2026-10-25/summary.json), [ACR](ACR.md). Full ACR remains open; an independent review and any future deploy are separate steps.
