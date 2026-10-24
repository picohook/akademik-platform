# Annotation receipt retention and RLS — v122 hardening

**2026-10-24 independent review: HOLD.** Real restored-PostgreSQL app-role purge fails (privilege/RLS), and writable v121 rollback can replay tombstoned POSTs into duplicate notes. Prod remains v121; migration 016 was applied only to an isolated backup copy. [Findings and evidence](ANNOTATION-RECEIPT-HARDENING-REVIEW-2026-10-24.md). The design claims below predate that verification.

This package closes the two v121 follow-ups:

1. `annotation_operations` retained full note content forever.
2. Receipt RLS was tenant-only; the application filtered by user.

It is additive and does not change the annotation protocol, IndexedDB version or
client request shapes.

## Retention policy

Defaults (configurable):

| Data | Default | Contains note text? |
|---|---:|---|
| Full operation receipt | 90 days | Yes |
| Content-free tombstone | 365 days | No |

- `ANNOTATION_RECEIPT_RETENTION_DAYS` (1–3650)
- `ANNOTATION_TOMBSTONE_RETENTION_DAYS` (between receipt retention and 3650)

The maintenance job runs once after 60 seconds and then every 6 hours. It:

1. Locks up to 1 000 expired receipt rows with `FOR UPDATE SKIP LOCKED`.
2. Copies only `operation_id`, request hash, method, annotation id and timestamps
   to `annotation_operation_tombstones`.
3. Deletes the full receipt, including its note response body.
4. Deletes tombstones older than the tombstone window.

`SKIP LOCKED` makes two Node processes safe to run concurrently. The tombstone
insert and receipt delete are in one transaction.

If an offline client retries a purged operation:

- same operation key + same payload → **410 `operation_expired`**;
- same key + different payload → **409 `idempotency_key_reused`**;
- client marks a conflict and preserves the local draft; the user can save it as
  a new note or remove the local draft.

After the tombstone window an extremely old retry can no longer be proven; this
is a documented limit. Keep tombstone retention longer than any supported
offline period.

## User-scoped RLS

`annotation_operations` select/insert now use the transaction-local
`app.user_id` setting, set by the annotation mutation path:

```sql
select set_config('app.user_id', $1, true);
```

- Normal v122 requests: receipt rows are readable/writable only for that user.
- Maintenance delete remains tenant-scoped.
- `app.maintenance = 'on'` allows the retention job to select rows.
- If `app.user_id` is unset or empty, the policy falls back to tenant scope. This
  is required for a v120/v121 rollback: those servers do not set the new setting.
  A v121 rollback therefore works with migration 016, but does not get the new
  user-scoped defense. Re-deploy v122 to restore it.

`annotation_operation_tombstones` is user-selectable, tenant-insertable and
tenant-deletable for maintenance.

## Migration

Apply before starting the v122 server:

```powershell
.\scripts\backup.ps1
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T db psql -v ON_ERROR_STOP=1 -U akademik -d akademik -f /migrations/016-annotation-receipt-retention.sql
```

Do **not** drop migration 016 on rollback. v120/v121 servers can still write
receipts because of the unset-user fallback; re-deploy v122 to restore
user-scoped RLS and the purge job.

## Operational checks

```sql
-- Full receipts and their age
select count(*), min(created_at), max(created_at) from annotation_operations;

-- Content-free tombstones
select count(*), min(purged_at), max(purged_at) from annotation_operation_tombstones;

-- Rows due for the next run
select count(*) from annotation_operations
 where created_at < now() - interval '90 days';
```

Alerting: table growth, purge errors in the web log (`[annotations] retention
failed`), and any `410 operation_expired` increase after a long offline period.

## Not solved by this package

- Full end-to-end encryption of receipts or note content.
- Legal retention periods per institution; the env values are defaults, not a
  compliance certification.
- Exactly-once delivery over an unreliable network; the receipt protocol gives
  at-most-once DB effect per operation key.
- Recovering an operation older than the tombstone window.

## Validation

- `node --check` on server, sync module, offline module and reader.
- Unit suite 64/64 (the two retention tests included).
- Migration must be applied on a restored production copy before deployment;
  run a create/PATCH/DELETE receipt replay and a forced 410 path there.
- Browser/Edge retention expiry is not practical to wait for; test by setting
  retention to 1 day and inserting an old row, or by calling the maintenance
  function against a seeded test DB.
