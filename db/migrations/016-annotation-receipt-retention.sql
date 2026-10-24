-- Annotation receipt retention and user-scoped RLS. Apply after 015 as DB admin.
begin;

-- Full receipts include note content. Keep them for a bounded window, then
-- replace them with a small, content-free tombstone so an old client cannot
-- recreate a deleted note or apply the same operation twice.
alter table annotation_operations
  add column if not exists created_at timestamptz not null default now();
create index if not exists annotation_operations_created
  on annotation_operations (tenant_id, created_at);

create table if not exists annotation_operation_tombstones (
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  operation_id uuid not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  method text not null check (method in ('POST', 'PATCH', 'DELETE')),
  annotation_id uuid not null,
  created_at timestamptz not null,
  purged_at timestamptz not null default now(),
  primary key (tenant_id, user_id, operation_id)
);
create index if not exists annotation_operation_tombstones_purged
  on annotation_operation_tombstones (tenant_id, purged_at);

-- Receipt reads and writes are scoped to the authenticated user. The setting is
-- transaction-local and is set by the annotation mutation path. Maintenance
-- deletes remain tenant-scoped so the retention job can run without a user.
drop policy if exists annotation_operations_tenant on annotation_operations;
drop policy if exists annotation_operations_user_select on annotation_operations;
drop policy if exists annotation_operations_user_insert on annotation_operations;
drop policy if exists annotation_operations_tenant_delete on annotation_operations;
create policy annotation_operations_user_select on annotation_operations
  for select using (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    and (
      nullif(current_setting('app.user_id', true), '') is null
      or user_id = nullif(current_setting('app.user_id', true), '')::uuid
      or current_setting('app.maintenance', true) = 'on'
    )
  );
create policy annotation_operations_user_insert on annotation_operations
  for insert with check (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    and (
      nullif(current_setting('app.user_id', true), '') is null
      or user_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  );
create policy annotation_operations_tenant_delete on annotation_operations
  for delete using (tenant_id = current_setting('app.tenant_id', true)::uuid);
grant select, insert, delete on annotation_operations to akademik_app;

alter table annotation_operation_tombstones enable row level security;
alter table annotation_operation_tombstones force row level security;
drop policy if exists annotation_operation_tombstones_user_select on annotation_operation_tombstones;
drop policy if exists annotation_operation_tombstones_tenant_insert on annotation_operation_tombstones;
drop policy if exists annotation_operation_tombstones_tenant_delete on annotation_operation_tombstones;
create policy annotation_operation_tombstones_user_select on annotation_operation_tombstones
  for select using (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    and (
      nullif(current_setting('app.user_id', true), '') is null
      or user_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  );
create policy annotation_operation_tombstones_tenant_insert on annotation_operation_tombstones
  for insert with check (tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy annotation_operation_tombstones_tenant_delete on annotation_operation_tombstones
  for delete using (tenant_id = current_setting('app.tenant_id', true)::uuid);
grant select, insert, delete on annotation_operation_tombstones to akademik_app;

-- A v120/v121 server does not know about tombstones. Block its receipt INSERT
-- for an expired operation so its surrounding transaction rolls back instead of
-- recreating a deleted note. v122 normally returns 410 before reaching this.
create or replace function reject_expired_annotation_operation() returns trigger language plpgsql as $$
begin
  if exists (
    select 1 from annotation_operation_tombstones
     where tenant_id = new.tenant_id
       and user_id = new.user_id
       and operation_id = new.operation_id
  ) then
    raise exception 'annotation operation expired' using errcode = 'P0001';
  end if;
  return new;
end
$$;
drop trigger if exists annotation_operations_tombstone_guard on annotation_operations;
create trigger annotation_operations_tombstone_guard
  before insert on annotation_operations
  for each row execute function reject_expired_annotation_operation();

commit;
