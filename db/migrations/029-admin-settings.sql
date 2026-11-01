-- 029 - runtime settings and an audit trail for changes made in the admin panel
--
-- Why: the AI switch and its limits were environment variables, so changing one meant editing
-- a file on the server and restarting the container. The administrator can now change them in
-- the reader. Secrets (the Cloudflare token, the account id, the model name) stay in the
-- environment and are never stored here or shown in the panel.
--
--   app_settings      one JSON document per key ('ai' today). The app validates it against hard
--                     ceilings in code, so a stored value can lower a limit freely but cannot
--                     raise it past the ceiling that keeps the feature inside the free quota.
--   admin_audit_log   append-only record of who changed what. It stores the old and new
--                     settings (limits and collection ids), never request content.
--
-- Deliberately NO tenant policy, like ai_usage_daily (028): these are platform settings that
-- belong to the deployment, and the app only lets the platform administrator write them.
-- Applied by db/migrate.mjs: no begin/commit, no psql meta-commands, idempotent.

create table if not exists app_settings (
  key        text primary key check (key ~ '^[a-z][a-z0-9_.-]{0,63}$'),
  value      jsonb       not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table if not exists admin_audit_log (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  actor      uuid        not null,
  action     text        not null check (length(action) between 1 and 64),
  detail     jsonb       not null default '{}'::jsonb
);

create index if not exists admin_audit_log_at_idx on admin_audit_log (at desc);

comment on table app_settings is
  'Platform settings edited in the admin panel (validated by the app against hard ceilings). No secrets.';
comment on table admin_audit_log is
  'Append-only record of admin panel changes: actor, action, old and new settings. No request content.';

-- The app may read and write settings and append to the log; it can never edit or delete a log row.
grant select, insert, update on app_settings to akademik_app;
grant select, insert on admin_audit_log to akademik_app;
grant usage on sequence admin_audit_log_id_seq to akademik_app;
