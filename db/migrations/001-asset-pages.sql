-- 001 — per-page text index for in-book search.
-- Run as the database owner (the compose `db` service defaults to `akademik`):
--   docker compose exec db psql -U akademik -d akademik -f /migrations/001-asset-pages.sql

create extension if not exists pg_trgm;

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

alter table asset_pages enable row level security;
alter table asset_pages force row level security;

drop policy if exists asset_pages_tenant on asset_pages;
create policy asset_pages_tenant on asset_pages
  using (tenant_id is null or tenant_id = current_setting('app.tenant_id', true)::uuid);

grant select, insert, update, delete on asset_pages to akademik_app;
