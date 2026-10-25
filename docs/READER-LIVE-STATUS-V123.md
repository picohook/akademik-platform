# Reader status announcements — v123 production acceptance

Code: e8ddb3d07b6ac07863739de5c0e1ea681666ee97. **Live v123**; migration unchanged. See [verified production record](deployments/2026-10-25-v123.md).

NVDA 2026.2 / Edge 155 baseline: three successful reader operations produced no expected status speech, even after six seconds. An always-present status region inside the active reader was announced.

The fix adds that persistent region, clears/reschedules repeated messages after focus updates, deduplicates conflict notifications, speaks the specific expiry explanation, and clears pending messages on close/book switch. Delayed delivery checks current owner and asset. Visual toast is excluded from AT while the reader region mirrors it. CSS46/SW15 ensures the future shell update gets the new markup/style/script.

Validation: actual NVDA **3/3**, targeted regressions **4/4**, syntax/diff checks clean. Expiry a11y scenario uses controlled HTTP 410; CAS is a real demo-server conflict. No production DB/migration/env edits. Docker engine unavailable prevented production inspection/smoke; no deploy was attempted.

[Evidence](a11y-evidence/v123-live-status-2026-10-25/summary.json), [ACR](ACR.md). Full ACR remains open; an independent review and any future deploy are separate steps.


## Historical code review and deployment gate — 2026-10-25

The user reports **code review PASS** for e8ddb3d. This closes only the reader live-status implementation review, not the ACR. The reviewer did not independently run NVDA/VoiceOver; the recorded browser/speech evidence is from the implementing agent.

Docker became reachable during a read-only check (server 29.9.2). Compose reported the existing v122 web and DB healthy, and the v122-8b598a3 rollback image was present. The subsequent fresh-backup/build command was **rejected by the user before process creation**. It did not run; no new backup/build, image switch, env edit, migration or deploy occurred. v123 remains **deploy pending**. Existing v122 backups/images are retained.

When deployment is authorized, use the reviewed pinned e8ddb3d source, preserve v122 rollback, perform app-only build/up, require smoke 16/16 and config 123, and verify at least one real reader NVDA offline/conflict/410 scenario. No migration is required. Broader ACR work remains open.


## Current state — 2026-10-25

The earlier rejected command did not deploy anything. A later, separate deployment is now recorded: production **123/e8ddb3d**, smoke **16/16**, healthy/restart **0**, preserved v122 rollback. Actual production NVDA acceptance is committed in **e2d2146**, deployment documentation in **273bd95**. This supersedes historical “deploy pending” statements above.

The next Windows accessibility work produced a local **v124** candidate, not a deployment. [Current ACR](ACR.md) and [Windows acceptance](A11Y-NVDA-V124.md) distinguish tested UI/fixtures from VoiceOver, publication semantics, native AT selection setup and timing gaps.
