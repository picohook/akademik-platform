-- 002 — local password login for the scaffold.
-- Demo credentials: reader@example.edu.tr / demo1234
-- Run as the database owner:
--   docker compose exec db psql -U akademik -d akademik -f /migrations/002-users-password.sql

alter table users add column if not exists password_hash text;

-- RLS is FORCEd; set the demo tenant for the update.
select set_config('app.tenant_id', '11111111-1111-1111-1111-111111111111', false);

update users
   set password_hash = 'scrypt$8a902e4df4422ec1c41787ca6b7e9405$b3feb3659d89ab122f020c7cb35366d4d6170ee3b4c3f99e739ad338a6fc2e743e5301660090079291d7409a67bc2dc2c4f5870b346b0dd95b13cd5dd0b9d876'
 where email = 'reader@example.edu.tr';
