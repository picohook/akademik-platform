-- 008 — per-language full-text and folded text indexes for page search.
-- Run as the database owner:
--   docker compose exec db psql -U akademik -d akademik -f /migrations/008-page-search.sql

alter table asset_pages add column if not exists text_tsv tsvector
  generated always as (to_tsvector('turkish', coalesce(text_content, ''))) stored;

alter table asset_pages add column if not exists text_tsv_en tsvector
  generated always as (to_tsvector('english', coalesce(text_content, ''))) stored;

alter table asset_pages add column if not exists text_fold text
  generated always as (translate(lower(coalesce(text_content, '')), 'çğıöşü', 'cgiosu')) stored;

alter table asset_pages add column if not exists text_words text
  generated always as (
    ' ' || regexp_replace(
      regexp_replace(
        translate(lower(coalesce(text_content, '')), 'çğıöşü', 'cgiosu'),
        '[^[:alnum:] ]+', ' ', 'g'
      ),
      ' +', ' ', 'g'
    ) || ' '
  ) stored;

create index if not exists asset_pages_tsv on asset_pages using gin (text_tsv);
create index if not exists asset_pages_tsv_en on asset_pages using gin (text_tsv_en);
create index if not exists asset_pages_fold_trgm on asset_pages using gin (text_fold gin_trgm_ops);
create index if not exists asset_pages_words_trgm on asset_pages using gin (text_words gin_trgm_ops);
