# Reader single-GET delivery

User-observed baseline on EC2 (2026-10-26): catalog DB query 9 ms; R2 HEAD
222 ms; separate R2 first-64-KiB GET 398 ms. This does not measure total browser
opening time or explain catalog UI delay. Root page/health on EC2 were 1–2 ms.

For valid R2 reader requests, `storage.open()` uses one GetObjectCommand and
returns its stream and response metadata together. No prior HEAD request,
public URL, cache or authorization change. Range syntax, Content-Range,
Content-Length and upstream status are checked before sending bytes. Invalid
ranges can still use HEAD to supply the total size for a 416 response. Existing
local assets still use filesystem metadata. Full buffered downloads/indexing
retain their bounded read path; this optimization targets reader streaming.

Validation: 31 local tests passed (storage, local HTTP/session/CSRF regression,
watermark and importer tests). New contracts prove one GET / zero HEAD for full,
closed, open-ended and suffix requests, and stream destruction on invalid
upstream metadata. Real R2/HTTP/browser acceptance for this revision is pending.

Build separately, preserving the running/rollback image:

```sh
sudo docker build -t akademik-platform:libedge-r2-fast ./spike/app
sudo env LIBEDGE_IMAGE=akademik-platform:libedge-r2-fast docker compose \
  --env-file .env.production -f docker-compose.prod.yml -f docker-compose.libedge.yml \
  run --rm --interactive=false --no-deps web node scripts/measure-reader-storage.mjs
```

The read-only probe compares legacy HEAD+GET to single-GET for 64 KiB, three
runs, validates byte counts/status, and prints only timing/counts. The paired
probe is not a controlled cold-cache benchmark or browser opening measurement.

After probe PASS, deploy using the same `LIBEDGE_IMAGE` environment override
with `up -d --no-deps --no-build web`, then check health and real reader files.
Until accepted, retain `akademik-platform:libedge-r2` for rollback. No migration,
content re-import or changes to R2 credentials are required. Record the selected
image in the deployment config after acceptance; the shell override is per-call.
