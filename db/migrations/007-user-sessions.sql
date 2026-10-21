-- 007 — concurrent session / seat limit.
-- Run as the database owner:
--   docker compose exec db psql -U akademik -d akademik -f /migrations/007-user-sessions.sql

alter table users add column if not exists max_sessions int not null default 3;

create table if not exists user_sessions (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  tenant_id uuid references tenants(id) on delete cascade,
  ip text,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists user_sessions_user on user_sessions (user_id, last_seen_at);

alter table user_sessions enable row level security;
alter table user_sessions force row level security;

drop policy if exists user_sessions_tenant on user_sessions;
create policy user_sessions_tenant on user_sessions
  using (tenant_id = current_setting('app.tenant_id', true)::uuid);

grant select, insert, update, delete on user_sessions to akademik_app;
