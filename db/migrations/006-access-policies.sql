-- 006 — per-asset copy/download/print/watermark policy.
-- Run as the database owner:
--   docker compose exec db psql -U akademik -d akademik -f /migrations/006-access-policies.sql

alter table assets add column if not exists allow_copy boolean not null default true;
alter table assets add column if not exists allow_download boolean not null default true;
alter table assets add column if not exists allow_print boolean not null default true;
alter table assets add column if not exists watermark boolean not null default true;
