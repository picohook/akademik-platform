# Spike — 14 days

Goal: decide the PDF architecture, validate annotation re-anchoring and Turkish search, and calibrate the MVP estimate.

Full specification: [`../docs/PLATFORM-SPEC.md`](../docs/PLATFORM-SPEC.md) — sections 6.1, 6.4, 24, 26.1, 28.8.

## Inputs (blockers)

1. Three POC PDFs: 50 MB digital, 300 MB scanned, 500 MB image-heavy.
2. At least two target books: one born-digital (text layer), one scanned (hOCR + highlight alignment).
3. Usage permission: publisher approval or public domain.

The scaffold can be built with a public-domain PDF. **Measurement does not start until the inputs above exist.**

## Plan

| Day | Work | Output |
|---|---|---|
| D1 | Repo, Compose (web + postgres + minio), upload, auth stub, seed | `docker compose up` works |
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

## Rules

- A passing scaffold is **not** a passing spike.
- No secrets, no publisher files, no customer data in this repository.
- Measurements are recorded with the exact file, browser, cache state, and network profile.
