-- Personal library shelf. Applied by db/migrate.mjs in its own transaction.
create table if not exists book_favorites (
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  work_id uuid not null references works(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, work_id)
);
create index if not exists book_favorites_tenant_user on book_favorites (tenant_id, user_id);
alter table book_favorites enable row level security;
alter table book_favorites force row level security;
drop policy if exists book_favorites_owner on book_favorites;
create policy book_favorites_owner on book_favorites
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
     and user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
     and user_id = nullif(current_setting('app.user_id', true), '')::uuid);
grant select, insert, delete on book_favorites to akademik_app;
