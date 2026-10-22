-- 012 — user groups for group-scoped grants.
-- Run as the database owner:
--   docker compose exec db psql -U akademik -d akademik -f /migrations/012-groups.sql

create table if not exists user_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create table if not exists user_group_members (
  group_id uuid not null references user_groups(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  primary key (group_id, user_id)
);

alter table user_groups enable row level security;
alter table user_groups force row level security;
alter table user_group_members enable row level security;
alter table user_group_members force row level security;

drop policy if exists user_groups_tenant on user_groups;
create policy user_groups_tenant on user_groups
  using (tenant_id = current_setting('app.tenant_id', true)::uuid);

drop policy if exists user_group_members_tenant on user_group_members;
create policy user_group_members_tenant on user_group_members
  using (exists (
    select 1 from user_groups g
     where g.id = group_id
       and g.tenant_id = current_setting('app.tenant_id', true)::uuid
  ));

grant select, insert, update, delete on user_groups to akademik_app;
grant select, insert, delete on user_group_members to akademik_app;
