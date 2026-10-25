# v123 — production NVDA acceptance — 2026-10-25

**PASS — requested production NVDA gate only. ACR stays OPEN.**

| Field | Result |
| --- | --- |
| Endpoint / config | https://localhost / 123 / e8ddb3d |
| Account | Actual reader-role login through the UI |
| NVDA | 2026.2 (2026.2.0.57664), running Speech Viewer PID 26052 |
| Edge | 155.0.4283.45 |
| Scenario | Production PDF note edited/saved with browser offline, then reconnected and synced |
| Input | Actual OS Tab/Enter to Save; no mocked HTTP response in this run |
| readerStatus | role=status, aria-live=polite, aria-atomic=true; inside reader |
| Actual speech | Not cihazda kaydedildi; eşitleme bekliyor |
| JS runtime exceptions | 0 (Playwright pageerror) |
| Completed (Europe/Istanbul) | 2026-10-25 04:01:36 |
| Cleanup | Generated note deleted, test login logged out, owned browser closed |

The expected message is present both in readerStatus mutations/text and in actual NVDA Speech Viewer output. This is a real NVDA engine observation, not a human pronunciation or VoiceOver evaluation. The reader was already displaying the PDF when browser network emulation was turned off; this verifies offline **note save**, not a full cold offline book download/restart.

Only a unique generated annotation was created, edited and deleted. Existing notes/books were not edited. Normal operation receipts remain under retention policy. Env/migration/deploy and rollback were not changed; the v122 rollback was not touched or re-certified. Dedicated Edge used its own profile and a local-CA exception; OS trust/NVDA settings were unchanged.

The user's production smoke16/health/restart claims were not repeated here, in keeping with the requested NVDA-only scope. This run verifies config and served app SHA, UI login, the requested reader announcement, sync and cleanup. It does not close the ACR or constitute an independent code review.

[Raw result](987d17cc-d1bd-4e87-a104-c9d33b9e1005/results.json) · [manifest](987d17cc-d1bd-4e87-a104-c9d33b9e1005/manifest.json).
