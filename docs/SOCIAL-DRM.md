# Social DRM + access control — P0 / v117

This package adds traceable full-file downloads. It is **social DRM + access
control**; it does not prevent a reader from extracting a stream, editing an
EPUB ZIP, removing PDF marks, or taking screenshots. AES at rest belongs to P1.

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
characters that Helvetica cannot encode. EPUB identities are XML escaped.

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

## Migration / operations

Source v117 requires **migration 013 before starting its server** on an existing
database. This package does not deploy or migrate production; production remains
v116 until reviewed. Back up first and run as the database administrator:

```powershell
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T db psql -v ON_ERROR_STOP=1 -U <db-admin> -d <database> -f /migrations/013-download-tickets.sql
```

Migration 013 is transactional and repeatable; fresh `db/schema.sql` includes the
same table, forced tenant RLS, marker and trigger. Keep the marker on application
rollback. Tickets may be deleted once expired; a scheduled tenant-scoped purge
can keep a short diagnostic retention window, for example:

```sql
delete from download_tickets
 where tenant_id = current_setting('app.tenant_id')::uuid
   and expires_at < clock_timestamp() - interval '1 day';
```

The app does not schedule this purge. The separate audit trail remains intact.
Do not log HTTP request/response bodies at the proxy/APM layer for these routes.

## Validation

```powershell
cd spike/app
npm run test:watermarks
npm run test:social-drm
npm run test:security
node test/citations.test.mjs
node test/epub-copy-policy.test.mjs
```

The social-DRM integration harness owns an isolated temporary PostgreSQL 16
container and two app processes, exercises non-superuser forced RLS, and removes
its environment. It accepts no external database or target URL. Validation
results and source hashes are recorded in the
[v117 evidence manifest](security-evidence/v117-2026-10-23/manifest.json).

Final validation on 2026-10-23:

| Check | Result |
|---|---|
| Citation / v116 EPUB copy policy / watermark units | **17 + 7 + 13 = 37 passed** |
| Social-DRM PostgreSQL integration | **189 checks / 5 scenarios passed** |
| Existing PostgreSQL security regression | **68 checks / 3 scenarios passed** |
| Source hashes against tested app/schema/migration | Matched |
| Temporary app, DB container and directory cleanup | All passed |

[Integration results](security-evidence/v117-2026-10-23/social-drm-results.json)
cover actual PDF text and EPUB XHTML, hash-only storage, 60-second expiry,
wrong user/tenant/asset, replay, concurrent consumption on two processes,
grant/permission revocation, final-grant SQL and API deletion, admin role changes,
and raw-token/hash exclusion from audit. Failure injection verifies issue and
consume rollback when audit inserts are denied. A row-lock barrier verifies
expiry during lock wait. Migration validation covers fresh schema, reconstructing
the pre-013 layout with existing grants, backfill and repeat application.
[Existing security output](security-evidence/v117-2026-10-23/security-validation.txt)
covers publisher isolation, grant SQL failure and cross-process login limits.

Static peer review found and closed the last-grant deletion and EPUB spine/body
coverage issues. **Independent review is pending.** No new full browser
acceptance test or production deployment is claimed by this package. The earlier
160-check integration run preceded these fixes and is superseded by the final
189-check report. The manifest records the tested source Git blobs for checking
the resulting commit, including LF/CRLF normalization.
