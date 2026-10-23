-- Social DRM: one-use, user/asset/tenant-bound download tickets. Run as DB owner.
begin;
-- A lasting marker distinguishes never-configured tenants from tenants whose
-- final grant was deleted. Set it in the grant mutation's own transaction.
alter table tenants add column if not exists download_grants_required boolean not null default false;
update tenants t set download_grants_required = true
 where exists (select 1 from grants g where g.tenant_id = t.id)
    or exists (select 1 from grant_audit a where a.tenant_id = t.id);
create or replace function remember_download_grant_policy() returns trigger language plpgsql as $$
begin
  if TG_OP <> 'INSERT' then
    update tenants set download_grants_required = true where id = OLD.tenant_id and not download_grants_required;
  end if;
  if TG_OP <> 'DELETE' then
    update tenants set download_grants_required = true where id = NEW.tenant_id and not download_grants_required;
  end if;
  return null;
end
$$;
drop trigger if exists remember_download_grant_policy on grants;
create trigger remember_download_grant_policy after insert or update or delete on grants
  for each row execute function remember_download_grant_policy();
create table if not exists download_tickets (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  work_id uuid not null references works(id) on delete cascade,
  grant_ids uuid[] not null default '{}',
  watermark_override boolean not null default false,
  override_reason text,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  check (expires_at > created_at and expires_at <= created_at + interval '60 seconds'),
  check ((watermark_override and override_reason is not null and length(trim(override_reason)) between 10 and 500)
      or (not watermark_override and override_reason is null))
);
create index if not exists download_tickets_expiry on download_tickets (tenant_id, expires_at);
alter table download_tickets enable row level security;
alter table download_tickets force row level security;
drop policy if exists download_tickets_tenant on download_tickets;
create policy download_tickets_tenant on download_tickets
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);
grant select, insert, update, delete on download_tickets to akademik_app;
commit;
