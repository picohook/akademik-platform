-- Akademik Platform — scaffold schema (PostgreSQL 16)
-- Tenant isolation is enforced with RLS; the app sets app.tenant_id per connection.
-- Platform-wide catalog rows may have tenant_id = NULL.

create extension if not exists pg_trgm;

create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  email text not null,
  display_name text not null,
  role text not null default 'reader' check (role in ('admin','librarian','publisher','reader')),
  created_at timestamptz not null default now(),
  unique (tenant_id, email)
);

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
  source text not null default 'pdf' check (source in ('pdf','ocr')),
  updated_at timestamptz not null default now(),
  primary key (asset_id, page_no)
);
create index if not exists asset_pages_search_trgm on asset_pages using gin (text_search gin_trgm_ops);

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
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  seat_limit int,
  source text not null default 'manual' check (source in ('subscription','trial','purchase','manual')),
  status text not null default 'active' check (status in ('pending','active','expired','revoked')),
  created_at timestamptz not null default now()
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
alter table annotations enable row level security;
alter table reading_progress enable row level security;
alter table tenants enable row level security;
alter table users enable row level security;

-- The application connects as the table owner; without FORCE, the owner bypasses RLS.
alter table works force row level security;
alter table editions force row level security;
alter table assets force row level security;
alter table asset_pages force row level security;
alter table collections force row level security;
alter table grants force row level security;
alter table annotations force row level security;
alter table reading_progress force row level security;
alter table tenants force row level security;
alter table users force row level security;

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
create policy annotations_tenant on annotations
  using (tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy progress_tenant on reading_progress
  using (tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy tenants_self on tenants
  using (id = current_setting('app.tenant_id', true)::uuid);
create policy users_tenant on users
  using (tenant_id = current_setting('app.tenant_id', true)::uuid);

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
