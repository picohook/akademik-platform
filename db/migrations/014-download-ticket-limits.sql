-- Shared per-user download limits. Apply after migration 013 as DB administrator.
begin;
create table if not exists download_ticket_limits (
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('issue', 'traffic')),
  window_start timestamptz not null,
  request_count integer not null check (request_count > 0),
  notified boolean not null default false,
  primary key (tenant_id, user_id, kind)
);
create index if not exists download_ticket_limits_expiry on download_ticket_limits (tenant_id, window_start);
alter table download_ticket_limits enable row level security;
alter table download_ticket_limits force row level security;
drop policy if exists download_ticket_limits_tenant on download_ticket_limits;
create policy download_ticket_limits_tenant on download_ticket_limits
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);
grant select, insert, update, delete on download_ticket_limits to akademik_app;
commit;
