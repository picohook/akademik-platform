# Spike measurements

Record the exact file, browser, cache state, and network profile for every row. A measurement without context is not a measurement.

## Files

| ID | File | Size | Pages | Text layer | Notes |
|---|---|---|---|---|---|
| P1 | `fixtures/p1-digital.pdf` | 50 MB | | yes | born-digital |
| P2 | `fixtures/p2-scanned.pdf` | 300 MB | | no (OCR) | scanned |
| P3 | `fixtures/p3-images.pdf` | 500 MB | | mixed | image-heavy |
| T1 | `fixtures/t1-target-digital.pdf` | | | yes | target book |
| T2 | `fixtures/t2-target-scanned.pdf` | | | no (OCR) | target book |

The repository ships only `sample.pdf` (public test file) until real files arrive.

## Results

| Metric | Threshold | P1 | P2 | P3 | T2 | Pass? |
|---|---|---|---|---|---|---|
| Cold first page (s, 20 Mbps) | < 2 | | | | | |
| Browser RSS (MB) | < 500 | | | | | |
| Page turn p95 (ms) | < 300 | | | | | |
| Highlight alignment (px @ 100%) | ±3 | | | | | |
| Annotation reload | 100% | | | | | |
| Re-anchor after v2 | ≥ 90% | | | | | |
| Search precision@10 (10 queries) | ≥ 0.70 | | | | | |
| 50 concurrent, error rate | 0 | | | | | |
| 50 concurrent, p95 (s) | < 2 | | | | | |

## Search queries (Turkish + English)

1. implant komplikasyonları
2. peri-implantitis
3. implant kaybı
4. sinir hasarı
5. estetik komplikasyon
6. dental implant complications
7. risk factors
8. diagnosis and treatment
9. önleme
10. vaka

## Decision

- PDF architecture: client-first / server fallback:
- Re-anchor algorithm result:
- Revised MVP estimate:
- Open risks:
- ADR: `docs/adr/0001-pdf-architecture.md`
