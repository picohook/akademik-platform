-- 004 — session revocation and password change support.
-- Run as the database owner:
--   docker compose exec db psql -U akademik -d akademik -f /migrations/004-session-version.sql

alter table users add column if not exists session_version int not null default 0;
