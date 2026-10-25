# LibEdge private R2 storage

This is a storage integration, not a completed LibEdge SSO or multi-tenant rollout.
The existing application login/session/CSRF/grant rules remain in place. Keep the
AWS pilot on loopback/SSH until identity integration and acceptance are complete.

## Configuration and compatibility

- `STORAGE_DRIVER=local` (default): existing local development and on-prem behavior.
- `STORAGE_DRIVER=r2`: requires `DATABASE_URL`, `R2_ENDPOINT`, `R2_BUCKET`,
  `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`; `R2_PREFIX` defaults to `libedge`.
- Books uploaded or CLI-ingested under R2 are stored privately in R2. DB keys
  explicitly start with `r2://PREFIX/`. These are internal keys, not public URLs.
- Existing unprefixed keys (including the seed fixture) stay local. No automatic
  migration or remote-to-local fallback. Keep bucket and prefix stable: changing
  either does not move existing objects. Local-only installations cannot read R2 keys.
- Authentication/grants are checked before reader streaming and ticketed downloads.
  Bytes are proxied by the app; range requests remain supported, including suffixes.
  Bucket credentials and public/presigned URLs are never sent to the browser.
- New uploads are validated using a local staging file, then put in R2 before the
  DB transaction commits. Temporary files are removed after processing. A failed
  DB write triggers object cleanup; ambiguous network failures can leave orphans.
  Local OCR sidecars and existing backup scripts remain local; this change does
  not migrate sidecars or create bucket backups. Configure separate R2 backup policy.
- Search index and ticketed watermarked downloads use the storage adapter too.
  The same 300 MiB limit applies; full indexing/stamping still needs memory. A
  1 GiB EC2 pilot has not been capacity-qualified for large concurrent documents.
- Delete removes DB rows first, as before. Object deletion failures are logged as
  orphan cleanup requirements; there is no durable retry queue in this change.
- Application rollback must retain R2-aware storage code once R2 books are loaded.
  The old local-only image cannot deliver new R2 books. Do not delete DB volumes.

## AWS pilot steps

1. Create a private R2 bucket, e.g. `libedge-books`. Keep public URL/custom-domain
   access disabled. Create S3 API credentials with Object Read & Write scoped to
   this bucket only. No browser-side R2 CORS/public access is needed.
2. On the SSH server, from repo root, run `bash scripts/configure-r2.sh`.
   Enter secrets only at its hidden prompts. `.env.r2` is gitignored and mode 600.
   Do not print/commit it or share `docker compose config` output containing secrets.
3. Build the chosen reviewed source commit:
   `sudo docker build -t akademik-platform:libedge-r2 ./spike/app`.
   Check disk space first and preserve the previous image.
4. Probe without changing the running web service:
   `sudo docker compose --env-file .env.production -f docker-compose.prod.yml -f docker-compose.libedge.yml run --rm --no-deps web node scripts/check-r2.mjs`.
   It tests put/read/range/delete with one random object, then deletes it.
5. Only after PASS:
   `sudo docker compose --env-file .env.production -f docker-compose.prod.yml -f docker-compose.libedge.yml up -d --no-deps --no-build web`.
   Do not append the old `docker-compose.aws.yml` or start Caddy.
6. Verify `curl -fsS http://127.0.0.1:3001/api/health`, then use the existing SSH
   tunnel. Upload an isolated test PDF and EPUB, read/range/index/download/delete
   them and confirm R2 storage + staging cleanup before importing real books.
7. Use the pinned R2-aware source for subsequent releases. Do not update all of
   main blindly, and do not infer readiness from `/api/health`: it checks DB mode,
   not live R2 permissions. Migration changes must be reviewed independently.

The 11-book metadata/rights import, LibEdge identity bridge, shared catalog grants,
publication covers and source OCR sidecars require separate acceptance.

## Validation

`cd spike/app && node --test test/storage.test.mjs test/storage-http.test.mjs test/social-watermark.test.mjs`

23 tests passed locally: storage mock/client contracts and HTTP range behavior,
local application login/upload/read/delete/CSRF regression, and existing watermark
unit tests. The R2 tests use an injected S3 client; real R2 and PostgreSQL+R2
end-to-end acceptance have NOT RUN. `npm audit --omit=dev`: 0 vulnerabilities at
implementation time. No AWS deployment or real credentials were used in development.
