-- 005 — annotation tags for note filtering.
-- Run as the database owner:
--   docker compose exec db psql -U akademik -d akademik -f /migrations/005-annotation-tags.sql

alter table annotations add column if not exists tags text[] not null default '{}';
