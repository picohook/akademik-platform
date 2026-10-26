# Initial OA catalog import

Operator-only tool: `spike/app/import-catalog.mjs`.

- Default mode is preflight: validates the exact original 2026-10-23 manifest hash,
  11 work records and 11 reader-file hashes/sizes (122,355,349 bytes). No R2/DB writes.
- `--apply --tenant UUID` explicitly imports to the chosen existing tenant, never
  global NULL scope and never changes grants. Retains source catalog metadata,
  contributor roles, license/attribution, asset languages and edition-specific years.
- One work per stable book ID. D2L has two separate asset/edition records under
  one work. `metadata.asset_variants` contains language/format/year/title mapping.
- The Turing Way is metadata-only without a fabricated reader file. Source ZIPs
  are not uploaded. All imported records retain `catalog_status: draft` metadata.
- IMPORTANT: existing UI does not enforce draft visibility or provide the new
  version selectors yet. Keep this pilot accessible only over the SSH tunnel.
  Complete version selection, license display and reader acceptance before exposure.
- Existing import records are skipped only if catalog fingerprint and stored asset
  identity/checksum/size match. Conflicting records fail instead of being overwritten.
- PostgreSQL advisory lock serializes this cohort per tenant. All catalog writes
  use one transaction. Failed pre-commit imports clean up newly written objects.
  An ambiguous COMMIT preserves files for inspection, avoiding broken DB references.
- Indexing is a separate acceptance step after import; this tool does not run OCR
  or indexing in the transaction. Keep input copies until catalog/reader validation.
- `assets.watermark=false` preserves the content preference; the existing B2B
  deployment setting may still stamp downloads. No new copy/download/print restrictions.

Run against the deployed R2 image without rebuilding/restarting the live web app:

```sh
sudo docker compose --env-file .env.production \
  -f docker-compose.prod.yml -f docker-compose.libedge.yml \
  run --rm -T --no-deps \
  -v /home/ubuntu/oa-incoming:/incoming:ro \
  -v "$PWD/spike/app/import-catalog.mjs:/app/import-catalog.mjs:ro" \
  web node import-catalog.mjs
```

Before `--apply`, take a DB backup and validate restoration in an isolated DB.
Apply adds `--apply --tenant 11111111-1111-1111-1111-111111111111` only for the
current isolated LibEdge pilot tenant. Do not use that UUID for another installation.

Validation: 6 local importer tests passed (preflight tampering, multi-asset work,
idempotence, rollback cleanup, uncertain-commit safety and scoped IDs). Real package
preflight passed for all 11 reader files. PostgreSQL+R2 import has NOT RUN.
