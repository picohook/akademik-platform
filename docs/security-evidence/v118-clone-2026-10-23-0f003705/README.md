# Superseded fixture-only attempt

The production backup restore, starting 001–012 schema checks, migrations 013/014 and both repeat/idempotency checks succeeded. This attempt stopped before app startup on the helper's own fixture INSERT: one `$1` parameter was reused as both UUID and slug text. No application or migration fix was needed.

The fixture SQL was corrected. The original backup was reused with the same SHA-256; no second production dump was taken. A fresh owned clone completed successfully: [final PASS record](../v118-clone-2026-10-23-4223bd70/README.md).

This failed attempt is retained for traceability and does not supersede the final passing run. Its clone/container/files were cleaned up.
