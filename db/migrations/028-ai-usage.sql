-- 028 - daily AI usage counters for the selection explain/summarise feature
--
-- Why a table: the free-quota rule (docs/LIBEDGE-READER-AI-PLAN.md) needs a counter that
-- survives restarts and is reserved atomically, so parallel requests cannot spend past
-- the cap. One row per (UTC day, scope, subject):
--
--   scope 'global', subject '-'      all users together, the real spending cap
--   scope 'user',   subject <uuid>   one user's daily allowance
--
-- A reservation is one INSERT .. ON CONFLICT DO UPDATE .. WHERE used + 1 <= limit; the
-- conflicting row is locked for the duration of the statement, so concurrent requests
-- queue on it and exactly `limit` of them win. The server runs the global and the user
-- reservation in one transaction and rolls both back if either is refused.
--
-- Deliberately NO tenant policy, like sso_consumed_jti (021): the global row belongs to
-- no tenant by definition. The table holds counts only - no selected text, no answer.
-- Applied by db/migrate.mjs: no begin/commit, no psql meta-commands, idempotent.

create table if not exists ai_usage_daily (
  day     date    not null,
  scope   text    not null check (scope in ('global', 'user')),
  subject text    not null,
  used    integer not null default 0 check (used >= 0),
  primary key (day, scope, subject)
);

comment on table ai_usage_daily is
  'Daily AI request counters (UTC day). Reserved atomically by the app; counts only, no content.';

grant select, insert, update, delete on ai_usage_daily to akademik_app;
