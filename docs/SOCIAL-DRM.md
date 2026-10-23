# Social watermarking + access control — P0 / v118 remediation

This package adds traceable downloads through the app's **Download** and
**Offline ↓** actions. The product description is **social watermarking + access control**. The reader receives
the original stream; this is not a promise that every obtainable copy is
watermarked or traceable. AES at rest belongs to P1.

## Accepted product scope — 2026-10-23

The product owner explicitly accepted the following scope for P0. This is the
technical scope to carry into sales and contract documentation:

> Platform, indirme düğmesi ve v118 sonrası yeni çevrimdışı kayıtlar için
> kullanıcı/kurum/tarih filigranı uygular. Okuyucu içi PDF/EPUB akışı oturum ve
> erişim yetkisiyle korunur; ancak bu akış teknik olarak kaydedilebilir. Her
> kopyanın izlenebilirliği veya kopyalanamazlığı garanti edilmez. Ekran görüntüsü,
> fotoğraf ve yetkili kullanıcı tarafından yeniden oluşturma kapsam dışıdır.

Explicit exclusions are the original `/file` and `/book.epub` reader streams,
offline copies saved before v118, screenshots/photos, resistance to watermark
removal and traceability of every copy. Existing offline copies are **excluded**;
this release does not force redownload or retroactively stamp/revoke them.
Users who require stamped local copies must remove and download them again.
The audited administrator exception described below remains explicit.

Market this as **“sosyal filigran + erişim kontrolü”**, rather than DRM or a
copy-prevention guarantee. A publisher requirement for stronger reader-stream
protection is a separate scoped project; no licensing, timetable or absolute
copy-protection guarantee is implied here.

## Reader-stream boundary and legacy offline copies

`GET /api/books/:id/file` and `GET /api/books/:id/book.epub` keep original,
session/grant-protected bytes and Range behavior. An authorized reader can save
or reconstruct them, including when normal download permission is disabled.
Reader grant semantics are unchanged. These streams bypass full-download tickets
and stamping: an explicit P0 limitation, not a protected distribution channel.
**Do not promise “all copies are traceable” or “all downloads are watermarked”.**
A stronger property needs a separate reader-stream design and performance tests.

New offline saves in v118 use the same two POSTs as normal downloads; no `/file`
probe or GET. Only delivered blobs are saved, tagged
`downloadProvenance: 'ticketed-download-v1'`; no token is persisted. In B2B mode,
offline saves request ordinary stamped tickets, even for administrators. Errors,
denials, rate limits and quota/actual 300 MiB violations do not save a blob.
Legacy offline blobs are preserved and cannot be retroactively stamped or
revoked. Remove and redownload them if stamped offline copies are required.

## Download contract

Both endpoints require a valid session and the existing CSRF header. Neither
endpoint accepts query parameters. Responses use `Cache-Control: no-store` and
`Referrer-Policy: no-referrer`. Raw tokens are returned only in the issuance
response and sent only in the consumption POST body; the UI creates no token URL
and stores no ticket in browser storage.

1. `POST /api/books/:workId/download-ticket`, JSON `{}`.
   Returns HTTP 201 with `{ ticket, expiresAt, expiresIn: 60 }`.
2. `POST /api/books/:workId/download`, JSON `{ "ticket": "<64 hex characters>" }`.
   Returns the PDF/EPUB attachment. Download-button code performs these steps,
   then uses the existing temporary blob download.

Legacy `GET /download` and `GET /download-ticket` are rejected. An endpoint must
not accept `?ticket=...`; arbitrary fields in the consumption body are rejected.
Integrations using the old full-download GET must adopt the POST sequence.
The reader's `/file` and `/book.epub` routes retain session, grants and Range
behavior; they do not require tickets. v116 copying/selection/notes are retained.

Tokens contain 32 cryptographically random bytes (256 bits). Only SHA-256 hashes
are stored in `download_tickets`, bound to user, tenant, asset and work. DB time
enforces the 60-second lifetime. Consumption locks the row and performs a
guarded update, checking expiry again after lock waits. At most one process can
consume a ticket. Issue/consume audit inserts commit in the same transaction as
the ticket mutation; audit failures roll it back and return an error.

Session validity, current download permission and current grants are checked
again on consumption. A ticket issued under grants requires at least one of its
original granting IDs still to authorize the book. Replacing a revoked grant
does not revive an old ticket; request a new one. Expired/replayed/wrong-user,
wrong-work/asset and revoked-permission tickets receive generic HTTP 403.

Full downloads distinguish a never-configured tenant from one whose final grant
was removed. `tenants.download_grants_required` becomes true in the grant
mutation's own transaction through a trigger; deletion cannot reset it.
Migration 013 backfills existing grant/audit history. In a configured tenant,
having no active applicable grant denies full download. This change is scoped
to downloads; the reader's existing grant interpretation remains unchanged.

Tickets are consumed **before** file rendering/streaming. A malformed file,
watermark failure, interrupted transfer or client disconnect requires a new
ticket. No failed watermark operation falls back to the original file.

## Watermark policy and the explicit admin exception

`SOCIAL_DRM_B2B=true` is the default, including Compose. In this mode an asset's
`watermark=false` never disables full-download stamps. PDF pages and supported
EPUB chapter bodies contain platform name, user UUID, tenant UUID, email and UTC
time. PDF uses canonical UUIDs and reversible ASCII Unicode escapes for email
characters that Helvetica cannot encode. PDF stamps add only 28%-opacity text;
no white rectangle, background fill or image covers original content. Crop bounds
and small-page readability checks remain; unstampable pages fail closed. A text
stamp may overlap content; blank margins cannot be assumed. EPUB identities are
XML escaped.

An administrator can explicitly request an exception when issuing a ticket:

```json
{
  "watermarkOverride": true,
  "overrideReason": "Approved clean distribution for the institution"
}
```

The reason must contain 10–500 characters. The database user role must currently
be `admin` on both issue and consume; a stale session role does not authorize an
exception. Librarian/publisher accounts cannot use it. The exception is stored
in the ticket and audited at both steps; consumption fields and URL parameters
cannot alter it. Normal download/grant permissions still apply. There is no
blanket exception attached to a book, and no admin override button in this UI.

Explicit `SOCIAL_DRM_B2B=false` enables standalone per-title watermark behavior;
it is an operator-level deployment setting. Session/grants/tickets still apply.
Database-free demo mode returns 503 for full downloads rather than issuing
unpersisted tickets.

Damaged/encrypted/unstampable files are rejected. EPUB stamping verifies the
package's actual reading-order resources, including XHTML with unusual file
extensions. Unsupported readable spine formats, including SVG, fail closed;
supporting fixed-layout content is a separate compatibility task. The generated
EPUB keeps `mimetype` first and uncompressed. This conservative policy may reject
previously downloadable malformed or unsupported EPUBs.

## Audit

- `download.ticket.issue`, `download.ticket.consume`, `download.ticket.deny`.
- `download.watermark.bypass_attempt` for rejected override/query/legacy paths.
- `download.watermark.override` with the explicit reason and issue/consume phase.
- Existing `book.download` usage event after the payload is prepared.

Audit payloads contain internal ticket UUIDs, book IDs and bounded reasons, never
the raw ticket or its hash. Anonymous/invalid-session requests remain at the
existing authentication gate. Rendering failure is audited as a denial after
consumption; a consume event does not claim successful delivery to a device.

## Request limits and automatic retention

Migration 014 adds forced-RLS counters shared across processes/sessions by
**tenant + user**:

- **10 ticket-issue attempts per 60-second window**.
- **40 authenticated requests to either download route per 60-second window**,
  including invalid methods, query parameters and CSRF failures. This gate runs
  before rejection auditing.
- Excess requests receive **429** with `Retry-After`/`retryAfter`. Counters are
  capped. `download.rate_limit` is recorded once per kind/window; further excess
  requests create no audit row. The UI shows the wait in Turkish/English.

Database-backed servers run cleanup immediately and every **60 seconds**,
deleting tickets expired for **over one hour** and limiter rows inactive for
**over one day**, at most **1,000 of each per tick**. Cleanup is tenant-scoped,
with an advisory try-lock across processes and `FOR UPDATE SKIP LOCKED`. Recent,
locked, active and other-tenant rows survive. Ticks do not overlap; failures are
retried next tick; closing the server stops its timer. Large backlogs can take
multiple ticks: retention is best effort, not a hard database-size cap. Audit
retention is separate; this worker preserves usage/security audit history.

## Migration / operations

Source v118 requires **migrations 013 and 014 before starting its server** on an existing
database. This package does not deploy or migrate production; production remains
v116 until reviewed. Back up first and run as the database administrator:

```powershell
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T db psql -v ON_ERROR_STOP=1 -U <db-admin> -d <database> -f /migrations/013-download-tickets.sql
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T db psql -v ON_ERROR_STOP=1 -U <db-admin> -d <database> -f /migrations/014-download-ticket-limits.sql
```

Migrations 013 and 014 are transactional and repeatable; fresh `db/schema.sql` includes
the ticket/limiter tables, forced tenant RLS, marker and trigger. Keep the marker on application
rollback. Tickets may be deleted once expired; a scheduled tenant-scoped purge
can keep a short diagnostic retention window, for example:

```sql
delete from download_tickets
 where tenant_id = current_setting('app.tenant_id')::uuid
   and expires_at < clock_timestamp() - interval '1 hour';
```

The worker schedules bounded cleanup automatically. The audit trail remains intact.
Do not log HTTP request/response bodies at the proxy/APM layer for these routes.

## Validation

```powershell
cd spike/app
npm run test:watermarks
npm run test:social-drm
npm run test:security
node test/citations.test.mjs
node test/epub-copy-policy.test.mjs
node test/downloads.test.mjs
node test/download-maintenance.test.mjs
```

The social-DRM integration harness owns an isolated temporary PostgreSQL 16
container and two app processes, exercises non-superuser forced RLS, and removes
its environment. It accepts no external database or target URL. Validation
results and source hashes are recorded in the
[v118 evidence manifest](security-evidence/v118-2026-10-23/manifest.json).

Final validation on 2026-10-23:

| Check | Result |
|---|---|
| Citation / EPUB copy / watermark / download / scheduler units | **17 + 7 + 14 + 15 + 2 = 55 passed** |
| Social-DRM PostgreSQL integration | **295 checks / 7 scenarios passed** |
| Existing PostgreSQL security regression | **68 checks / 3 scenarios passed** |
| Source hashes against tested app/schema/migration | Matched |
| Temporary app, DB container and directory cleanup | All passed |

[Integration results](security-evidence/v118-2026-10-23/social-drm-results.json)
cover actual PDF text and EPUB XHTML, hash-only storage, 60-second expiry,
wrong user/tenant/asset, replay, concurrent consumption on two processes,
grant/permission revocation, final-grant SQL and API deletion, admin role changes,
and raw-token/hash exclusion from audit. Failure injection verifies issue and
consume rollback when audit inserts are denied. A row-lock barrier verifies
expiry during lock wait. Migration validation covers fresh schema, reconstructing
the pre-013 layout with existing grants, backfill and repeat application, plus
the 013→014 upgrade and repeat application. v118 also covers real helper-to-HTTP
stamped PDF/EPUB delivery, two-process issue/traffic limits, capped counters,
429/Retry-After, bounded flood auditing and window recovery. Maintenance tests
cover 1,000-row batches, remaining rows, SKIP LOCKED, advisory exclusion and
age/tenant boundaries. Scheduler tests exercise startup, repetition, no overlap,
stop and recovery from error. The dense-footer PDF test compares paint operators
and verifies no added rectangle/fill/image plus translucent stamp text.
[Existing security output](security-evidence/v118-2026-10-23/security-validation.txt)
covers publisher isolation, grant SQL failure and cross-process login limits.

Independent rereview conditionally passed; the product owner accepted the
documented reader-stream and legacy-copy boundaries. Follow-up predeployment
acceptance completed on 2026-10-23: **8/8 Edge cases**, **0 page errors**,
**4/4 cleanup**, plus the production-backup clone's migration and **15 smoke
assertions**. Seven browser cases use default Edge and real IndexedDB; the eighth
uses a separately launched browser with `--disable-features=StaticStorageQuota`
and native quota override to test the admission guard. Actual transaction-level
`QuotaExceededError` and physical disk-full behavior were not established.
See the [accepted scope, results and limitations](V118-PREDEPLOY-2026-10-23.md).

Acceptance found and fixed an EPUB initialization resize race in the adapter;
its copy-policy units passed again (**7/7**) and the final browser run records
the patched engine hash. Backend/ticket/migration/watermark code is unchanged
from the historical integration evidence. No production deployment is claimed;
production HTTPS still reports **v116**, health **200 / DB**.
Historical v117 37/189/68 results remain
unchanged in their evidence folder and are superseded by v118's 55/295/68 for
this remediation. The manifest records tested source Git blobs, including
LF/CRLF normalization. Original reader-byte extraction is tested and documented
as an explicit limitation, not a closed security property.
