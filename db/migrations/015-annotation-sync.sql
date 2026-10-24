-- Apply as DB administrator before starting v121. Additive; retain on rollback.
begin;
alter table annotations add column if not exists version integer not null default 1;
create or replace function bump_annotation_version() returns trigger language plpgsql as $$
begin
  new.version = old.version + 1;
  new.updated_at = now();
  return new;
end
$$;
drop trigger if exists annotations_version on annotations;
create trigger annotations_version before update on annotations
  for each row execute function bump_annotation_version();

-- Receipts intentionally survive annotation deletion and have no expiry: an
-- arbitrarily old offline retry must not recreate a previously deleted note.
create table if not exists annotation_operations (
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  operation_id uuid not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  method text not null check (method in ('POST', 'PATCH', 'DELETE')),
  annotation_id uuid not null,
  response_status integer not null,
  response_body jsonb not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id, operation_id)
);
alter table annotation_operations enable row level security;
alter table annotation_operations force row level security;
drop policy if exists annotation_operations_tenant on annotation_operations;
create policy annotation_operations_tenant on annotation_operations
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);
grant select, insert on annotation_operations to akademik_app;
commit;
