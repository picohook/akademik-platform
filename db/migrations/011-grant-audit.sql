-- 011 — grant audit trail.
-- Run as the database owner:
--   docker compose exec db psql -U akademik -d akademik -f /migrations/011-grant-audit.sql

create table if not exists grant_audit (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  grant_id uuid,
  action text not null check (action in ('create', 'revoke', 'update')),
  actor_user_id uuid references users(id) on delete set null,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index if not exists grant_audit_tenant_time on grant_audit (tenant_id, created_at desc);

alter table grant_audit enable row level security;
alter table grant_audit force row level security;
drop policy if exists grant_audit_tenant on grant_audit;
create policy grant_audit_tenant on grant_audit
  using (tenant_id = current_setting('app.tenant_id', true)::uuid);
grant select, insert on grant_audit to akademik_app;
