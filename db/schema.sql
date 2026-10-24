-- Akademik Platform — scaffold schema (PostgreSQL 16)
-- Tenant isolation is enforced with RLS; the app sets app.tenant_id per connection.
-- Platform-wide catalog rows may have tenant_id = NULL.

create extension if not exists pg_trgm;

create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status text not null default 'active',
  download_grants_required boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  email text not null,
  display_name text not null,
  role text not null default 'reader' check (role in ('admin','librarian','publisher','reader')),
  password_hash text,
  session_version int not null default 0,
  max_sessions int not null default 3,
  created_at timestamptz not null default now(),
  unique (tenant_id, email)
);

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

create table if not exists works (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  content_type text not null default 'monograph'
    check (content_type in ('monograph','edited_volume','chapter','journal','journal_issue','article','conference_paper','thesis','report','standard','dataset')),
  title text not null,
  subtitle text,
  language text not null default 'tr',
  abstract text,
  subjects text[] not null default '{}',
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists works_title_trgm on works using gin (title gin_trgm_ops);
create index if not exists works_subjects on works using gin (subjects);

create table if not exists editions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  work_id uuid not null references works(id) on delete cascade,
  publisher text,
  publication_year int,
  edition text,
  isbn13 text,
  doi text,
  handle text,
  license_uri text,
  license_note text,
  rights_note text,
  created_at timestamptz not null default now()
);

create table if not exists assets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  edition_id uuid not null references editions(id) on delete cascade,
  format text not null check (format in ('pdf','epub')),
  storage_key text not null,
  page_count int,
  text_content text,
  quality_score int,
  source_system text,
  source_id text,
  source_url text,
  source_checksum text,
  harvested_at timestamptz,
  access_status text not null default 'open' check (access_status in ('open','restricted','embargoed')),
  allow_copy boolean not null default true,
  allow_download boolean not null default true,
  allow_print boolean not null default true,
  watermark boolean not null default true,
  created_at timestamptz not null default now(),
  search_vector tsvector generated always as (to_tsvector('turkish', coalesce(text_content, ''))) stored
);
create index if not exists assets_search_gin on assets using gin (search_vector);
create unique index if not exists assets_source_unique on assets (source_system, source_id) where source_system is not null and source_id is not null;

create table if not exists asset_pages (
  asset_id uuid not null references assets(id) on delete cascade,
  tenant_id uuid references tenants(id) on delete cascade,
  page_no int not null check (page_no > 0),
  text_content text not null default '',
  text_search text not null default '',
  source text not null default 'pdf' check (source in ('pdf','ocr','epub')),
  locator text,
  updated_at timestamptz not null default now(),
  text_tsv tsvector generated always as (to_tsvector('turkish', coalesce(text_content, ''))) stored,
  text_tsv_en tsvector generated always as (to_tsvector('english', coalesce(text_content, ''))) stored,
  text_fold text generated always as (translate(lower(coalesce(text_content, '')), 'çğıöşü', 'cgiosu')) stored,
  text_words text generated always as (
    ' ' || regexp_replace(
      regexp_replace(translate(lower(coalesce(text_content, '')), 'çğıöşü', 'cgiosu'), '[^[:alnum:] ]+', ' ', 'g'),
      ' +', ' ', 'g'
    ) || ' '
  ) stored,
  primary key (asset_id, page_no)
);
create index if not exists asset_pages_search_trgm on asset_pages using gin (text_search gin_trgm_ops);
create index if not exists asset_pages_tsv on asset_pages using gin (text_tsv);
create index if not exists asset_pages_tsv_en on asset_pages using gin (text_tsv_en);
create index if not exists asset_pages_fold_trgm on asset_pages using gin (text_fold gin_trgm_ops);

create table if not exists collections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  title text not null,
  slug text not null,
  description text,
  visibility text not null default 'tenant' check (visibility in ('public','tenant','private')),
  created_at timestamptz not null default now(),
  unique (tenant_id, slug)
);

create table if not exists collection_items (
  collection_id uuid not null references collections(id) on delete cascade,
  work_id uuid not null references works(id) on delete cascade,
  position int not null default 0,
  primary key (collection_id, work_id)
);

create table if not exists grants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  subject_type text not null check (subject_type in ('tenant','group','user')),
  subject_id uuid not null,
  scope_type text not null check (scope_type in ('all','publisher','subject','collection','title')),
  scope_id uuid,
  scope_key text,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  seat_limit int,
  source text not null default 'manual' check (source in ('subscription','trial','purchase','manual')),
  status text not null default 'active' check (status in ('pending','active','expired','revoked')),
  created_at timestamptz not null default now()
);

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

create table if not exists annotations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  anchor jsonb not null,
  color text not null default 'yellow',
  note text,
  selected_text text,
  tags text[] not null default '{}',
  status text not null default 'active' check (status in ('active','orphaned')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists annotations_asset on annotations (asset_id);
create index if not exists annotations_anchor_gin on annotations using gin (anchor);

create table if not exists reading_progress (
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  anchor jsonb not null,
  percent numeric(5,2) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, asset_id)
);

create table if not exists import_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued','scanning','validating','extracting','ocr','review','completed','failed','cancelled')),
  payload jsonb not null default '{}',
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

create table if not exists audit_events (
  id bigserial primary key,
  tenant_id uuid references tenants(id) on delete set null,
  actor_id uuid,
  action text not null,
  object_type text,
  object_id uuid,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- Row-level security: every tenant-scoped table is filtered by app.tenant_id.
alter table works enable row level security;
alter table editions enable row level security;
alter table assets enable row level security;
alter table asset_pages enable row level security;
alter table collections enable row level security;
alter table grants enable row level security;
alter table grant_audit enable row level security;
alter table user_groups enable row level security;
alter table user_group_members enable row level security;
alter table annotations enable row level security;
alter table reading_progress enable row level security;
alter table tenants enable row level security;
alter table users enable row level security;
alter table user_sessions enable row level security;
alter table download_tickets enable row level security;
alter table download_ticket_limits enable row level security;

-- The application connects as the table owner; without FORCE, the owner bypasses RLS.
alter table works force row level security;
alter table editions force row level security;
alter table assets force row level security;
alter table asset_pages force row level security;
alter table collections force row level security;
alter table grants force row level security;
alter table grant_audit force row level security;
alter table user_groups force row level security;
alter table user_group_members force row level security;
alter table annotations force row level security;
alter table reading_progress force row level security;
alter table tenants force row level security;
alter table users force row level security;
alter table user_sessions force row level security;
alter table download_tickets force row level security;
alter table download_ticket_limits force row level security;

create policy works_tenant on works
  using (tenant_id is null or tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy editions_tenant on editions
  using (tenant_id is null or tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy assets_tenant on assets
  using (tenant_id is null or tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy asset_pages_tenant on asset_pages
  using (tenant_id is null or tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy collections_tenant on collections
  using (tenant_id is null or tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy grants_tenant on grants
  using (tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy grant_audit_tenant on grant_audit
  using (tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy user_groups_tenant on user_groups
  using (tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy user_group_members_tenant on user_group_members
  using (exists (
    select 1 from user_groups g
     where g.id = group_id
       and g.tenant_id = current_setting('app.tenant_id', true)::uuid
  ));
create policy annotations_tenant on annotations
  using (tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy progress_tenant on reading_progress
  using (tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy tenants_self on tenants
  using (id = current_setting('app.tenant_id', true)::uuid);
create policy users_tenant on users
  using (tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy user_sessions_tenant on user_sessions
  using (tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy download_tickets_tenant on download_tickets
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy download_ticket_limits_tenant on download_ticket_limits
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- The app must not connect as the table owner or a superuser, otherwise RLS is bypassed.
-- Scaffold-only credentials; rotate before any real deployment.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'akademik_app') then
    create role akademik_app login password 'akademik_app_dev';
  end if;
end
$$;

grant usage on schema public to akademik_app;
grant select, insert, update, delete on all tables in schema public to akademik_app;
grant usage, select on all sequences in schema public to akademik_app;

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

-- Receipts preserve idempotency; full note content is retained for a bounded
-- window, then replaced by a content-free tombstone (migration 016).
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
create index if not exists annotation_operations_created
  on annotation_operations (tenant_id, created_at);
alter table annotation_operations enable row level security;
alter table annotation_operations force row level security;
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
alter table annotation_operation_tombstones enable row level security;
alter table annotation_operation_tombstones force row level security;
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
grant select, insert, delete on annotation_operations to akademik_app;
grant select, insert, delete on annotation_operation_tombstones to akademik_app;

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
