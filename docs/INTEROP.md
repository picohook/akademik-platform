# Interop endpoints

All endpoints below require the normal session cookie (same-origin) and a librarian/admin role where noted.

## OPDS 1.2 acquisition feed

```text
GET /opds
```

- `application/atom+xml;profile=opds-catalog;kind=acquisition`
- Includes title, UUID, author, language, publisher, subjects and an acquisition link (`/file` for PDF, `/book.epub` for EPUB).
- Honors the caller’s active grants.
- Session cookie works for browser use. For third-party e-readers, set in the server environment:
  - `OPDS_API_KEY` — shared secret
  - `OPDS_USER_EMAIL` — the reader account whose grants the feed uses
  Then call `/opds?api_key=...` or send `Authorization: Bearer ...`.
- Without a session or valid token, the feed returns **401**. The API key does not bypass grants; it is evaluated as `OPDS_USER_EMAIL`.

## MARC21 export

```text
GET /api/books/:id/marc
```

- Librarian/admin only; honors book access.
- Minimal MARC fields: `001`, `040`, `100`, `245`, `260`, `650`, `856`.
- It is not a full MARC21 validation; map to the library’s ILS profile before production import.

## OAI-PMH

```text
GET /oai?verb=Identify
GET /oai?verb=ListMetadataFormats
GET /oai?verb=ListRecords&metadataPrefix=oai_dc
GET /oai?verb=GetRecord&metadataPrefix=oai_dc&identifier=oai:akademik:<work-uuid>
```

- Public metadata endpoint; set `OAI_TOKEN` in production and append `&token=...`.
- `oai_dc` only; no resumption tokens (small catalogs).
- Restricted assets are excluded from the feed.

## COUNTER/SUSHI (minimal)

```text
GET /sushi?report=IR&begin_date=2026-01-01&end_date=2026-01-31&customer_id=...
```

- Returns a COUNTER-5-shaped `ReportResponse` with `Total_Item_Requests`.
- Set `SUSHI_API_KEY`; callers append `&api_key=...`.
- Usage comes from `audit_events` (`book.view`, `book.download`); only events after this release exist.
- **Not COUNTER 5 certified**: no SUSHI request envelope, exception codes, item investigations, DR/PR/TR reports or 90-day rolling limits.

## Usage CSV (not COUNTER/SUSHI)

```text
GET /api/reports/usage.csv
```

- Librarian/admin only.
- Per title: publisher, language, distinct readers, progress rows, average percent, annotation count.
- **Not COUNTER 5 compliant**; it is an operational report. COUNTER/SUSHI needs a release/usage schema, item investigations and report formats.

## Not implemented

- Certified COUNTER 5 / full SUSHI envelope.
- Resumption tokens and sets in OAI-PMH.
- OPDS authentication for third-party e-readers.
- Bulk MARC import/export.
