# v118 — production-backup clone migration validation

**PASS**, 2026-10-23. Pinned source: `1c2ab001e60a633d1c4a3241e34b95645d34f020`.

Production was inspected and a fresh PostgreSQL custom archive was read with `default_transaction_read_only=on`. No production SQL, migrations, restarts or deployment were performed. All subsequent writes used a randomly named, labelled PostgreSQL 16 container with tmpfs data and a loopback-only port. The application used its own fixture PDF; production upload/OCR files were not copied or modified.

Private backup, intentionally excluded from Git:

- `backups/akademik-pre-v118-clone-2026-10-23T18-11-00-088Z-0f003705.dump`
- **85,323 bytes**
- SHA-256: `702fe200d563b5c897ec1022801b0beb5a8fdc2ea05761adf3d7048d3b352365`

The archive retains its original owner/ACL metadata. Only the test restore used `--no-owner --no-acl`; a separate non-superuser application role and random test credentials were provisioned in the clone. The archive contains production data and must not be published.

## Order and results

1. The archive restored successfully into the owned container. Its 17-table starting schema had the expected 001–012 feature columns/tables, with **no** `download_tickets`, `download_ticket_limits` or tenant marker. This is a schema-feature check; the project has no asserted migration-ledger proof here. [Starting schema](restored-schema-before.json).
2. Pinned migration **013**, then **014**, succeeded on the restored production data.
3. **013**, then **014**, were applied again successfully to check idempotency.
4. Both new tables had RLS **enabled and forced**. The grant-history marker column and trigger existed; **1/1** configured grant tenants was backfilled. The limiter key was `(tenant_id, user_id, kind)`.
5. Only after these checks, clone account identities/passwords were replaced, sessions/personal note/progress/audit contents cleared, and a new tenant/user/book fixture created. These sanitization and fixture changes occurred only in the clone.
6. The pinned **v118 application started after migrations**. Fifteen explicit app-smoke assertions passed: health **200 / DB**, version/build identity, login **200**, ticket **201 / 60 s**, PDF download **200**, replay **403**, correct token hash and persisted consumption. The downloaded fixture PDF was 13,313 bytes.
7. Production DB/web container ID, image, start time and restart count were unchanged. The clone app, container and temporary application files were removed: **3/3 cleanup checks passed**.

The first attempt stopped on a test-fixture UUID/text parameter-inference error after all migration checks had passed. The fixture was corrected and the **same hash-verified backup** restored into a fresh owned clone. No second production dump was taken.

## Existing rate/purge proof

The [v118 295-check report](../v118-2026-10-23/social-drm-results.json) was verified against its manifest hash. All source Git blobs in that manifest match the pinned commit. This is real PostgreSQL/two-process evidence, not only unit tests: issue **10/min**, traffic **40/min**, 429/Retry-After, bounded audit growth, window recovery, tenant advisory exclusion, SKIP LOCKED and **1000 + 5 + 1** ticket purge batches were exercised. The existing passing suite was not rerun.

The accepted social-watermark scope remains unchanged: reader streams and legacy offline blobs are outside the guarantee that new ticketed/offline downloads receive identity stamps. This clone smoke does not claim browser/IndexedDB acceptance or production capacity.

[Execution results and ordered timestamps](results.json), [hash manifest](manifest.json), [reviewable helper](clone-check-helper.mjs). The helper ran from `tmp/v118-clone-check.mjs`; the archived copy changes only its repository-root path resolution so it can run directly from this evidence folder. Both helper hashes and that relocation are recorded in the manifest.
