-- 010 — publisher/subject grant keys and lookup index.
-- Run as the database owner:
--   docker compose exec db psql -U akademik -d akademik -f /migrations/010-grant-scope-key.sql

alter table grants add column if not exists scope_key text;
create index if not exists grants_subject_active on grants (tenant_id, subject_type, subject_id, status, valid_to);
