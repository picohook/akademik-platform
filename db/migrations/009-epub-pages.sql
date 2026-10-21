-- 009 — EPUB chapter text index.
-- Run as the database owner:
--   docker compose exec db psql -U akademik -d akademik -f /migrations/009-epub-pages.sql

alter table asset_pages add column if not exists locator text;

alter table asset_pages drop constraint if exists asset_pages_source_check;
alter table asset_pages
  add constraint asset_pages_source_check check (source in ('pdf', 'ocr', 'epub'));
