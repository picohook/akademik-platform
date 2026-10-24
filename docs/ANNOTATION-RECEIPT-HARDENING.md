# Annotation receipt retention and RLS — v122 hardening

**Dağıtım güncellemesi — 2026-10-24 17:52:23 Europe/Istanbul:** Kullanıcı GO sonrası **prod v122/8b598a3**, migration **001–016**. Taze restore/016 çift uygulama, smoke **16/16**, canlı Edge **14/14**, JS hatası 0 ve ilk otomatik retention geçti. Aşağıdaki deploy yapılmadı ifadeleri önceki teknik kabul koşusunun tarihsel kapsamıdır. [v122 dağıtım kaydı](deployments/2026-10-24-v122.md).

**2026-10-24 final independent acceptance of 4300f1f: PASS.** Real PostgreSQL/app-role, two Node processes, retention cutoff, 1000+5 batch, actual v121 HTTP rollback guard and Edge 410/draft retention passed **11/11**; units **65/65**, 0 JS errors, cleanup 6/6. All previous technical blockers are closed. Prod remains v121; no production migration/deploy. [Final acceptance](ANNOTATION-RECEIPT-HARDENING-ACCEPTANCE-2026-10-24.md).

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

1. Acquires a tenant-scoped transaction advisory lock; a concurrent run returns
   `skipped` without touching rows.
2. Selects up to 1 000 expired receipt **keys once** (tenant, user, operation,
   hash, method, annotation, created_at) **without** `FOR UPDATE`.
3. Inserts tombstones for that frozen key set, then deletes receipts by the
   **same** tenant/user/operation arrays. It never performs a second time-based
   selection, so a receipt cannot cross the threshold and be deleted without its
   tombstone.
4. Tombstone INSERT uses no `RETURNING`, so maintenance does not need tombstone
   SELECT visibility.
5. Deletes tombstones older than the tombstone window.

The advisory lock makes two Node processes safe; tombstone insert and receipt
delete are in one transaction. The trigger on `annotation_operations` rejects an
insert whose operation key is in an active tombstone, which protects a writable
v121 rollback even though v121 does not know the tombstone protocol.

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
  A v121 rollback can still create **new** operations, but an insert for a key in
  an active tombstone is rejected by the DB trigger and its transaction rolls
  back. v121 returns a generic 500 for that case, not 410. It does not get the
  user-scoped defense; re-deploy v122 to restore it.

`annotation_operation_tombstones` is user-selectable, tenant-insertable and
tenant-deletable for maintenance.

## Migration

Apply before starting the v122 server:

```powershell
.\scripts\backup.ps1
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T db psql -v ON_ERROR_STOP=1 -U akademik -d akademik -f /migrations/016-annotation-receipt-retention.sql
```

Do **not** drop migration 016 on rollback. v120/v121 servers can still write
receipts for keys that have no tombstone, but a tombstoned key is rejected by the
trigger and cannot recreate a deleted note. Re-deploy v122 to restore user-scoped
RLS and the 410 response.

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
- Unit suite 65/65 (the three retention tests included).
- Migration must be applied on a restored production copy before deployment;
  run a create/PATCH/DELETE receipt replay and a forced 410 path there.
- Browser/Edge retention expiry is not practical to wait for; test by setting
  retention to 1 day and inserting an old row, or by calling the maintenance
  function against a seeded test DB.
