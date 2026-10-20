# Akademik Platform

An academic e-book reading and library platform: multi-tenant catalog, PDF/EPUB reader, annotations, collections, and institutional access.

> **Status:** specification stage (v1.9). A 2-week technical spike is next. This repository is **not production-ready**.

- Product & technical specification (Turkish): [`docs/PLATFORM-SPEC.md`](docs/PLATFORM-SPEC.md)
- Architecture decisions: [`docs/adr/`](docs/adr/)
- Spike plan & acceptance criteria: [`spike/README.md`](spike/README.md)

## Scope

In scope: catalog, reading, annotations, search, collections, tenants, access grants, ingestion, reporting, on-prem deployment.

Out of scope for this repository: payments, invoicing, publisher procurement, royalty settlement, pricing.

## Planned stack

| Layer | Choice |
|---|---|
| Web | Next.js, React, TypeScript, Tailwind |
| API | NestJS (modular monolith) |
| Database | PostgreSQL |
| Search | PostgreSQL FTS (OpenSearch only past a measured threshold) |
| Reader | PDF.js, Readium or epub.js |
| OCR | Tesseract + hOCR |
| Storage | S3-compatible (SeaweedFS / R2) |
| Auth | Auth.js (MVP), Keycloak (SSO) |
| Deploy | Docker Compose, Caddy |

## Repository layout

```
docs/        specification and ADRs
spike/       spike plan, fixtures, measurement notes
apps/        web and API (coming with the spike)
packages/    shared domain packages (coming)
infra/       compose, deployment, backup (coming)
```

## Security

- Never commit secrets, credentials, customer data, or licensed publisher files.
- Use `.env.example` for configuration keys; real values stay in the environment or a secret manager.
- Report security issues privately; do not open a public issue with exploit details.

## License

**All rights reserved.** This repository is public for transparency and evaluation only; it is not open source. No license is granted to copy, modify, distribute, or use the code or documents unless a separate written agreement says otherwise.

External contributions are not accepted until a contribution policy and CLA are published.
