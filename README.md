# Akademik Platform — LibEdge E-Kütüphane reader engine

The reading and library engine behind **LibEdge E-Kütüphane**: multi-tenant catalog, PDF/EPUB reader, annotations, collections, access grants and institutional interop.

> **Status:** live in production at **https://elibrary.libedge.com** (v131, deployed 2026-10-27).
> This is not a standalone SaaS. It runs as LibEdge's integrated reader; LibEdge's own account and institution management is the long-term identity source (see [Open work](#open-work-in-this-order)).

## Read this first

If you are about to change, build or deploy anything:

1. [`docs/HANDOFF-2026-10-27.md`](docs/HANDOFF-2026-10-27.md): current live state, the v131 outage and the traps that caused it.
2. [`docs/DEPLOY.md`](docs/DEPLOY.md): the only deploy procedure that is known to work ("Varyant 2").
3. [`PROJECT-STATE.md`](PROJECT-STATE.md): short running state and version history.

Do not deploy from memory or from an older README.

## What it does

- **Reader:** PDF.js (single, dual, continuous), epub.js behind an `EpubEngine` adapter ([ADR-012](docs/adr/)), thumbnails, TOC, zoom, themes and workspace backgrounds, book variants.
- **Annotations:** highlights, notes, tags, bookmarks, citations and export. Offline edits are queued and synced with idempotent operation receipts and tombstones.
- **Search:** server-side page index with diacritic folding plus exact, word, stem (TR/EN full-text search) and fuzzy (`pg_trgm`) matching.
- **Access:** tenants, groups and `grants` (all, publisher, subject, collection, title) with seat limits; copy, print and download policy; social DRM watermarking.
- **Interop:** OPDS, OAI-PMH (`oai_dc`), a COUNTER-5-shaped SUSHI report, MARC export and a usage CSV ([`docs/INTEROP.md`](docs/INTEROP.md)).
- **Offline and mobile:** installable PWA; book files are stored in IndexedDB.
- **UI:** Turkish and English. Accessibility work targets WCAG 2.2 AA ([`docs/ACCESSIBILITY.md`](docs/ACCESSIBILITY.md), [`docs/ACR.md`](docs/ACR.md)).

## Actual stack

| Layer | What runs |
|---|---|
| Server | Node.js 22, `spike/app/server.mjs` (no framework) |
| Frontend | Vanilla JS modules in `spike/app/public/`, PDF.js, epub.js |
| Database | PostgreSQL 16 with row-level security (`FORCE ROW LEVEL SECURITY` on `users` and `tenants`) |
| File storage | `STORAGE_DRIVER=local` or `r2`; production uses Cloudflare R2 |
| Runtime | Docker Compose on AWS EC2 |
| Front door | Host nginx `:80` → `127.0.0.1:3001` → web container. TLS is terminated upstream; nothing on the box listens on 443 |

The original specification ([`docs/PLATFORM-SPEC.md`](docs/PLATFORM-SPEC.md)) planned Next.js, NestJS and Keycloak. None of that has been built. The Node harness above is what ships.

## Production at a glance

The handoff document holds the current values. These are the fixed facts that people keep getting wrong:

| | |
|---|---|
| Compose project | `akademik-platform-prod` (`docker-compose.prod.yml` + `docker-compose.libedge.yml`) |
| Containers | `akademik-platform-prod-web-1`, `akademik-platform-prod-db-1`. Not `akademik-platform-web-1` |
| Image | pinned by name in `docker-compose.libedge.yml`. Build the image that line points to, or the old one keeps running |
| Env files | both `--env-file .env.production --env-file .env.r2` (on the server, never in git) |
| Restart | `up -d --no-deps web`. Never `down` (the DB gets a new IP and web falls back to `mode: demo`) |
| Caddy | off (`profiles: [proxy]`). Do not start it next to nginx |

Verify every deploy. `version` comes from env and proves nothing; check `buildSha` and the image label:

```bash
curl -s https://elibrary.libedge.com/api/config
curl -s https://elibrary.libedge.com/api/health
docker inspect <image> --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'
```

For diagnostic queries against `users` or `tenants`, connect as the `akademik` superuser. The `akademik_app` role returns empty results under RLS **without an error**.

## Local development

Demo mode (no database, in-memory data):

```bash
cd spike/app
npm install
node server.mjs
# http://localhost:3000
```

Full local stack (Postgres + web + Caddy):

```bash
cp .env.example .env
docker compose up --build
# http://localhost:8080
```

A fresh local database is seeded from `db/seed.sql` with `reader@example.edu.tr` and `librarian@example.edu.tr` (password `demo1234`). These accounts are **local only**. Production removed them with migration `017-remove-demo-users.sql`.

### Migrations

`db/migrations/001`–`017` are applied by hand with `psql -f`. There is no migration table and no runner yet, so the only proof that a migration was applied is the state of the data (see the handoff for check queries).

### Tests

From `spike/app`:

```bash
npm run test:citations
npm run test:search
npm run test:watermarks
npm run test:security     # needs Docker
npm run test:social-drm   # needs Docker
```

More tests live in `spike/app/test/`. `scripts/smoke.mjs` is the post-deploy smoke test ([`docs/SMOKE.md`](docs/SMOKE.md)).

## Open work, in this order

1. **Fail-closed access package:** `grantAllows` currently returns `true` for an empty grant list (fail-open), and `withTenant` reads `DEMO_TENANT_ID` instead of the session user's tenant. These three changes ship together, with tests: (a) a user without a grant cannot see a book, (b) a user with the right tenant and grant can, (c) an admin can. **This must be closed before any external or institutional user gets access.**
2. **Migration runner:** a `schema_migrations` table, a script that applies and records migrations in order, and a one-time backfill marking 001–017 as applied. Finish this before migration 018 is written.
3. **LibEdge sign-on (`/auth/libedge`):** a short-lived signed handoff from libedge.com so users sign in once. Blocked on 1.

Details: handoff §4.

## Repository layout

```
docs/            specification, ADRs, deploy procedure, handoff, evidence
db/              schema.sql, seed.sql (local demo data), migrations/
infra/           Caddyfile (local), Caddyfile.prod (only with --profile proxy)
scripts/         smoke test, backup/restore, R2 setup, capacity and a11y tools
spike/app/       the production server, frontend and tests
spike/           original spike plan, fixtures, OCR and measurement notes
docker-compose.yml           local stack
docker-compose.prod.yml      production base (db, web, caddy behind a profile)
docker-compose.libedge.yml   production override for elibrary.libedge.com
```

The `spike/` name is historical. `spike/app/` is the code running in production.

## Security

- PostgreSQL security integration tests: [`docs/SECURITY-TESTS.md`](docs/SECURITY-TESTS.md).
- Never commit secrets, credentials, customer data or licensed publisher files. `.env.production` and `.env.r2` stay on the server.
- Use `.env.example` for configuration keys. Real values stay in the environment or a secret manager.
- Report security issues privately. Do not open a public issue with exploit details.

## License

**All rights reserved.** This repository is public for transparency and evaluation only; it is not open source. No license is granted to copy, modify, distribute or use the code or documents unless a separate written agreement says otherwise.

External contributions are not accepted until a contribution policy and CLA are published.
