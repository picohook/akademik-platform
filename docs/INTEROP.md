# Interop endpoints

All endpoints below require the normal session cookie (same-origin) and a librarian/admin role where noted.

## OPDS 1.2 acquisition feed

```text
GET /opds
```

- `application/atom+xml;profile=opds-catalog;kind=acquisition`
- Includes title, UUID, author, language, publisher, subjects and an acquisition link (`/file` for PDF, `/book.epub` for EPUB).
- Honors the caller’s active grants.
- OPDS clients that cannot send a browser cookie need a proxy/API-key front; Basic auth is not implemented.

## MARC21 export

```text
GET /api/books/:id/marc
```

- Librarian/admin only; honors book access.
- Minimal MARC fields: `001`, `040`, `100`, `245`, `260`, `650`, `856`.
- It is not a full MARC21 validation; map to the library’s ILS profile before production import.

## Usage CSV (not COUNTER/SUSHI)

```text
GET /api/reports/usage.csv
```

- Librarian/admin only.
- Per title: publisher, language, distinct readers, progress rows, average percent, annotation count.
- **Not COUNTER 5 compliant**; it is an operational report. COUNTER/SUSHI needs a release/usage schema, item investigations and report formats.

## Not implemented

- OAI-PMH.
- COUNTER 5 / SUSHI server.
- OPDS authentication for third-party e-readers.
- Bulk MARC import/export.
