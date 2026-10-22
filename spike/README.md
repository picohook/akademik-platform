# Spike — 14 days

Goal: decide the PDF architecture, validate annotation re-anchoring and Turkish search, and calibrate the MVP estimate.

Full specification: [`../docs/PLATFORM-SPEC.md`](../docs/PLATFORM-SPEC.md) — sections 6.1, 6.4, 24, 26.1, 28.8.

## Inputs (blockers)

1. Three POC PDFs: 50 MB digital, 300 MB scanned, 500 MB image-heavy.
2. At least two target books: one born-digital (text layer), one scanned (hOCR + highlight alignment).
3. Usage permission: publisher approval or public domain.

The scaffold can be built with a public-domain PDF. **Measurement does not start until the inputs above exist.**

Until a real scanned book arrives, `spike/tools/make_scan.py` generates an image-only synthetic scan for OCR/hOCR/highlight-alignment correctness. It is not a 300/500 MB performance fixture. OCR is in [`ocr/`](ocr/README.md).

## Login

The reader is behind a session cookie. Demo credentials: `reader@example.edu.tr` (read-only) or `librarian@example.edu.tr` (upload/edit) / `demo1234`. Set a real `SESSION_SECRET` before deployment; the compose default is dev-only.

For an existing database, apply `db/migrations/002-users-password.sql`, `003-librarian-user.sql`, `004-session-version.sql`, `005-annotation-tags.sql`, `006-access-policies.sql`, `007-user-sessions.sql`, `008-page-search.sql`, `009-epub-pages.sql`, `010-grant-scope-key.sql`, and `011-grant-audit.sql`; fresh volumes get the users and columns from `schema.sql`/`seed.sql`.

Auth hardening: login is limited to 8 failures per IP / 15 minutes; mutating requests use a double-submit CSRF token (`akademik_csrf`); responses set CSP, `X-Frame-Options`, `nosniff`, and related headers. `POST /api/password` changes the password, `POST /api/logout-all` increments `users.session_version` and revokes other sessions. Sessions created before the CSRF change must log in again. MFA/SSO and audit events are still open.

## Plan

| Day | Work | Output |
|---|---|---|
| D1 | Repo, Compose (web + postgres), upload, auth stub, seed | `docker compose up` works |
| D2 | PDF.js viewer + range requests; load 50 MB | First page renders |
| D3 | Cold first page + memory measurement; highlight UI start | Metric row 1 |
| D4 | Annotation `anchor jsonb` persisted; reload test | Highlight in place after reload |
| D5 | Postgres FTS + 10 queries + manual precision | Precision table |
| D6–D7 | 300 MB scanned: Tesseract `tur`, 10 pages, hOCR, CER; highlight alignment | CER + alignment tolerance |
| D8 | Cold first page + memory for 500 MB | Metric row 3 |
| D9 | Version swap: same PDF v2; re-anchor via `text_quote`; shifted v3 for orphan test | Re-anchor result |
| D10 | Grant stub (allow/deny + reason) + locked title screen | Flow complete |
| D11 | 50 concurrent readers (Locust/k6) | Error rate |
| D12 | Close gaps, re-measure | — |
| D13–D14 | Decision note (2 pages): pass/fail, re-anchor, precision, revised estimate | ADR-001 |

## Pass/fail thresholds

| Metric | Threshold | If it fails |
|---|---|---|
| 500 MB cold first page | < 2 s @ 20 Mbps | Server-side page image/overlay fallback |
| Browser RSS | < 500 MB | Same fallback |
| Scanned highlight alignment | ±3 px at 100% zoom | hOCR quality / render layer revision |
| Annotation reload | 100% in place | Anchor schema revision |
| Version re-anchor | ≥ 90% correct; rest orphaned | Reopen C-01 algorithm |
| Search precision@10 (10 queries) | ≥ 0.70 | Turkish stemmer fallback plan |
| 50 concurrent readers | No errors; p95 < 2 s | Scale note + capacity plan |

## Run

### Demo mode (no database)

```bash
cd spike/app
npm install
node server.mjs
# http://localhost:3000
```

Without `DATABASE_URL`, the server uses in-memory demo data (one sample work). Catalog, reader, search, annotations, and progress work; nothing persists.

### Docker (Postgres + Caddy)

```bash
cp .env.example .env        # change passwords
docker compose up --build
# http://localhost:8080
```

This mode runs the same app with `DATABASE_URL`, applies `db/schema.sql` and `db/seed.sql`, and stores the database in the `pgdata` volume. Object storage is not wired yet; the seed PDF is served from the image.

### Deep link

`/?book=33333333-3333-3333-3333-333333333333` opens the sample book directly.

### Citation tests

```bash
cd spike/app
npm run test:citations
```

Covers six records × APA/MLA/Chicago/IEEE/BibTeX, including Turkish characters, editors, editions, DOI, and missing metadata.

### EPUB spike

`public/epub-spike.html` loads the vendored epub.js build, opens `public/seed/sample.epub`, and exercises TOC, CFI/progress, themes, font size, and section search through the `EpubEngine` adapter (ADR-012).

```bash
python spike/tools/make_epub.py   # regenerate the fixture
# open http://localhost:8080/epub-spike.html
```

This page is a spike, not the catalog reader; it is public and uses the sample fixture only.

### Reader performance

Open the reader with `?perf=1` to show the small perf panel (`PDF yükleme`, first page, average/max render, JS heap). From the console:

```js
__readerPerf()          // current metrics
await __readerStress(20) // render 20 consecutive pages and return metrics
```

Use the 697-page Oral Radiology and 1,164-page Nursing Research records. This panel is diagnostic; it is not part of the normal UI.

### In-book search index
The reader searches the per-page text index. On an existing database, apply the migration and build the index once:

```bash
docker compose exec db psql -U akademik -d akademik -f /migrations/001-asset-pages.sql
docker compose exec web node index-text.mjs --all
```

To rebuild existing EPUB indexes after an extractor change, add `--force`: `node index-text.mjs --all --force`.

New uploads are indexed in the background. If the API reports `indexed: false`, the browser falls back to the slower client-side page cache.

### Add your own PDFs

**From the browser:** open `http://localhost:8080`, click **+ Kitap ekle**, choose a PDF and fill in title/language/publisher/subjects. The file is copied to `data/uploads/` and the catalog refreshes.

**Bulk/CLI:**

```bash
mkdir -p incoming
# copy PDFs into incoming/ (do not commit them)
docker compose up -d --build
docker compose exec web node ingest.mjs /app/incoming --publisher "Yayıncı" --subjects "Diş Hekimliği;Implantoloji"
```

Single file with metadata:

```bash
docker compose exec web node ingest.mjs /app/incoming/kitap.pdf \
  --title "Kitap Adı" --publisher "Yayıncı" --year 2026 --language tr \
  --subjects "Hukuk;Kamu Hukuku"
```

Dry run (reads PDFs, prints size/pages/hash; no database, no writes):

```bash
docker compose exec web node ingest.mjs /app/incoming --dry-run
```

Files are copied to `data/uploads/` on the host and served by the app. The `incoming/` and `data/` folders are gitignored.

### Fix metadata

Ingest uses the filename as the title and defaults to `tr`. Correct it with the work id from `/api/books`:

```bash
docker compose exec web node edit.mjs <work-id> \
  --title "Oral Radiology: Principles and Interpretation" \
  --subtitle "7th edition" --language en --publisher "Mosby" --year 2013 --pages 697 \
  --subjects "Radiology;Dentistry"
```

## Rules

- A passing scaffold is **not** a passing spike.
- No secrets, no publisher files, no customer data in this repository.
- Measurements are recorded with the exact file, browser, cache state, and network profile.
