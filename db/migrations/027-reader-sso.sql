-- 027 - reader-side SSO: the session row, its audit trail, and the sweep that
--       keeps the audit trail inside its retention window
--
-- Contract: docs/contracts/libedge-elibrary-v1.md @ e4b12f4, sections 2.1-2.6, 3.1,
-- 7.5, 11 (12, 14, 15, 17).
--
-- What is NOT here, because 021 already did it:
--
--   * `sso_consumed_jti (jti text primary key, expires_at timestamptz not null)` and
--     its expiry index exist since 021 (contract 3.1, step 9 of 2.3), together with
--     the grant to akademik_app and the deliberate absence of a tenant policy. The
--     replay guard is therefore already in place; only the reader code was missing.
--   * `users.status` and `users.libedge_user_id` (3.1) exist since 021.
--
-- What is added:
--
--   1. libedge_sessions - one row per SSO sign-in. The trusted session cookie carries
--      the tenant, but the row is what says how long the session may live, and it is
--      the row that a revocation deletes. FORCE RLS with a tenant policy, in the 026
--      nullif form, so a read without a bound tenant returns nothing rather than
--      raising 22P02 or, worse, matching another tenant's row.
--   2. sso_auth_events - contract 7.5 (`sso.login`, `sso.reject` + reason). No e-mail,
--      no token, no claims: an audit row must not become a second copy of the token.
--      The IP is there because a rejected handoff is the thing an operator needs to
--      see, and it is personal data - hence the 90-day retention that this file's
--      function and the timer in server.mjs enforce.
--   3. app.sso_auth_events_purge(interval) - the maintenance pattern of 024: the
--      sweep runs outside any request, so it cannot list tenants, and the app role
--      must not be able to delete audit rows by hand.
--
-- Files applied by db/migrate.mjs must not contain begin/commit and must not use
-- psql meta-commands; the runner wraps each file in one transaction with its
-- registry row. Idempotent throughout, so a --baseline mistake cannot duplicate.

set local row_security = off;

-- ---------------------------------------------------------------------------
-- Sessions (contract 2.3 step 11, 2.5, 2.6)
-- ---------------------------------------------------------------------------

create table if not exists libedge_sessions (
  session_id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  -- Kept beside user_id rather than joined from users: the row has to explain itself
  -- in an audit after the user row is gone.
  libedge_user_id text not null,
  ctx text not null check (ctx in ('institution','individual','staff')),
  inst text,
  -- The jti that opened this session. Unique, so one handoff token can never be
  -- turned into two live sessions even if the consumed-jti write were lost.
  jti text not null unique,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- Absolute end (contract 2.5): now + LIBEDGE_SSO_SESSION_HOURS at sign-in. Never
  -- extended by activity, which is the difference between "12 hours" and "12 hours
  -- after the last click".
  expires_at timestamptz not null,
  revoked_at timestamptz,
  -- `inst` is present exactly when the context is institutional (contract 2.2).
  check ((ctx = 'institution') = (inst is not null))
);

create index if not exists libedge_sessions_user on libedge_sessions (user_id, expires_at);
create index if not exists libedge_sessions_tenant on libedge_sessions (tenant_id, expires_at);
create index if not exists libedge_sessions_expiry on libedge_sessions (expires_at);

-- ---------------------------------------------------------------------------
-- Audit (contract 7.5), 90-day retention
-- ---------------------------------------------------------------------------

create table if not exists sso_auth_events (
  id bigserial primary key,
  at timestamptz not null default now(),
  outcome text not null check (outcome in ('login','reject')),
  -- A closed set, because a free-text reason is where a token ends up by accident.
  reason text check (reason in (
    'invalid_signature','bad_issuer','bad_audience','expired','not_yet_valid',
    'bad_claims','bad_role','bad_context','state_mismatch','replayed',
    'unknown_tenant','tenant_inactive','account_disabled','membership_revoked',
    'user_disabled','session_store_unavailable'
  )),
  ctx text,
  libedge_user_id text,
  session_id uuid,
  ip text,
  -- A rejection without a reason is not an audit row, and a login with one is a
  -- contradiction; the constraint states both rather than trusting the writer.
  check ((outcome = 'reject') = (reason is not null))
);

create index if not exists sso_auth_events_at on sso_auth_events (at);
create index if not exists sso_auth_events_user on sso_auth_events (libedge_user_id, at);

-- ---------------------------------------------------------------------------
-- Retention sweep (contract 7.5: 90 days)
-- ---------------------------------------------------------------------------
--
-- Same shape as app.maintenance_tenants() (024): SECURITY DEFINER, search_path
-- pinned, one narrow purpose, EXECUTE only for akademik_app. `sso_auth_events` has no
-- tenant of its own, so there is no policy to satisfy here; what the definer buys is
-- that DELETE rights are not handed to the app role directly - a role that can
-- `delete from sso_auth_events` can destroy the record of its own rejected logins.
--
-- The interval is a parameter, not a constant in the function: retention is a policy
-- and the caller states it. It is validated here so that a NULL or a negative
-- interval cannot delete the whole table, which would be one bad argument away from
-- losing every audit row.

create or replace function app.sso_auth_events_purge(retain interval)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, app
as $$
declare
  removed integer;
begin
  if retain is null or retain < interval '1 day' then
    raise exception 'retention must be at least 1 day, got %',
      coalesce(retain::text, 'null') using errcode = '22023';
  end if;
  delete from public.sso_auth_events where at < now() - retain;
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function app.sso_auth_events_purge(interval) from public;
grant execute on function app.sso_auth_events_purge(interval) to akademik_app;

-- ---------------------------------------------------------------------------
-- Access under RLS
-- ---------------------------------------------------------------------------
--
-- libedge_sessions is tenant-scoped personal data (who signed in where, when), so it is
-- FORCEd like users and grants, and read through the same binding. The policy spells the
-- binding as nullif(current_setting('app.tenant_id', true), '')::uuid - the 026 form -
-- so an unbound connection reads nothing instead of raising 22P02.
--
-- That is the whole point of the tenant in the cookie. The reader cannot look a session
-- up by session_id alone: RLS runs first, and an unbound read returns zero rows. It
-- takes the tenant from the *signed* cookie, binds it, and only then reads. The
-- alternative - a policy that lets the lookup span tenants, or a SECURITY DEFINER
-- function that returns "the session with this id, whichever tenant" - would be a way
-- to read any tenant's sessions from any other tenant's request. There is no such path
-- in this file, and there is a test that a session id from another tenant reads zero.
--
-- `using` and `with check` are both tenant-scoped, and the same policy is installed for
-- all commands: unlike the catalogue tables in 022 there is no global row to protect,
-- every row belongs to one tenant, and the app both inserts and deletes (sign-out,
-- revocation) inside its own tenant only.

alter table libedge_sessions enable row level security;
alter table libedge_sessions force row level security;

drop policy if exists libedge_sessions_tenant on libedge_sessions;
create policy libedge_sessions_tenant on libedge_sessions
  for all to akademik_app
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- sso_auth_events is written on every attempt, including attempts that failed before a
-- tenant was known (a bad signature, an unknown tenant), so it carries no tenant policy
-- and no tenant column. It is append-only for the app role: SELECT and INSERT, no
-- UPDATE, no DELETE. Deleting is app.sso_auth_events_purge's job and nobody else's -
-- the audit of a rejected login must not be editable by the code that rejected it.
--
-- The target row is the smallest one that answers "did this handoff fail, and why":
-- outcome, reason, ctx, the opaque LibEdge user id, the session if one was created, and
-- the IP. No e-mail, no token, no claims - a token in an audit table is a token with a
-- longer life than the one the contract gives it.

grant select, insert on sso_auth_events to akademik_app;
grant usage on sequence sso_auth_events_id_seq to akademik_app;

grant select, insert, update, delete on libedge_sessions to akademik_app;

-- 021 granted sso_consumed_jti already. Restated so that this file is the one place a
-- reader has to look to know what the SSO path may touch, and so a re-grant cannot be
-- lost to a later revoke-all on the schema.
grant select, insert, delete on sso_consumed_jti to akademik_app;

-- ---------------------------------------------------------------------------
-- Expected afterwards
-- ---------------------------------------------------------------------------
--
-- Both tables exist and are empty; libedge_sessions is FORCEd and carries exactly one
-- policy; the audit table is append-only for the app role.

select
  to_regclass('public.libedge_sessions') is not null as sessions,
  to_regclass('public.sso_auth_events') is not null as events,
  (select relrowsecurity and relforcerowsecurity
     from pg_class where oid = 'public.libedge_sessions'::regclass) as sessions_forced,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'libedge_sessions') as sessions_policies,
  has_table_privilege('akademik_app', 'sso_auth_events', 'delete') as app_can_delete_audit,
  has_function_privilege('akademik_app', 'app.sso_auth_events_purge(interval)', 'execute')
    as app_can_purge;
