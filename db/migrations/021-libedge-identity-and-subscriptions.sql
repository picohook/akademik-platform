-- 021 - LibEdge <-> E-Kutuphane integration: identity, membership, subscription
--
-- Contract: docs/contracts/libedge-elibrary-v1.md @ b15f8b5, section 3.1.
-- Schema only. No data is moved and no existing row is touched.
--
-- The point of these tables is that they exist independently of `users`. LibEdge
-- is the source of truth for who a person is and whether they may read; the
-- reader only applies that. So a disabled account or a revoked membership has to
-- be recorded even when no user row exists yet - otherwise a person who never
-- signed in could be re-enabled by the next sync, and a revocation that arrived
-- before the first login would simply be lost.
--
-- `revision` is what makes that safe against reordering. LibEdge increments it on
-- every change and the higher revision wins; a late "active" can therefore never
-- undo a newer "disabled" (contract 2.5, acceptance test 18).
--
-- Everything here is additive: new tables, new nullable columns, new indexes.
-- The 13 existing works and their access are unchanged by this file.
--
-- Read as a whole with 022: that file adds the akademik_catalog role, the
-- publish function and withdrawn_at. Neither file moves a single work to the
-- global catalogue - that is 023, gated on the approved list in contract 4.4.
--
-- Files applied by db/migrate.mjs must not contain begin/commit and must not use
-- psql meta-commands: the runner wraps each file in one transaction together with
-- its registry row. `set local row_security = off` is the guard: Postgres accepts
-- it from the table owner and rejects it for akademik_app, so running this as the
-- app role fails loudly instead of silently matching no rows.

set local row_security = off;

-- ---------------------------------------------------------------------------
-- Account and membership status, keyed by LibEdge user id (contract 3.1)
-- ---------------------------------------------------------------------------

create table if not exists libedge_accounts (
  libedge_user_id text primary key,
  status text not null default 'active' check (status in ('active','disabled')),
  revision bigint not null,
  changed_at timestamptz not null default now()
);

create table if not exists libedge_memberships (
  tenant_id uuid not null references tenants(id),
  libedge_user_id text not null,
  status text not null default 'active' check (status in ('active','revoked')),
  revision bigint not null,
  changed_at timestamptz not null default now(),
  primary key (tenant_id, libedge_user_id)
);

-- ---------------------------------------------------------------------------
-- Bridge idempotency (contract 5.6). POST bodies repeat on retry; the stored
-- response is what a replay returns, so the write must not be attempted twice.
-- ---------------------------------------------------------------------------

create table if not exists bridge_idempotency (
  idem_key text primary key,
  endpoint text not null,
  request_sha256 text not null,
  response jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists bridge_idempotency_created on bridge_idempotency (created_at);

-- ---------------------------------------------------------------------------
-- Tenant <-> LibEdge context (contract 3.2)
-- ---------------------------------------------------------------------------

alter table tenants add column if not exists libedge_kind text
  check (libedge_kind in ('institution','individual','staff'));
alter table tenants add column if not exists libedge_ref text;

-- A context identifies at most one tenant. Partial, so the many tenants without
-- a LibEdge context (there are none today, but nothing requires one) do not
-- collide on (null, null).
create unique index if not exists tenants_libedge
  on tenants (libedge_kind, libedge_ref) where libedge_kind is not null;

-- ---------------------------------------------------------------------------
-- Users: the LibEdge id and a status that can be set before the row exists
-- ---------------------------------------------------------------------------

alter table users add column if not exists libedge_user_id text;
alter table users add column if not exists status text not null default 'active'
  check (status in ('active','disabled'));

-- (tenant, libedge_user_id) is the identity LibEdge uses. Partial so the users
-- that predate the bridge and carry no LibEdge id do not collide.
create unique index if not exists users_libedge
  on users (tenant_id, libedge_user_id) where libedge_user_id is not null;

-- ---------------------------------------------------------------------------
-- Applied subscription state (contract 5.4)
-- ---------------------------------------------------------------------------

create table if not exists libedge_subscription_sync (
  source_id        text primary key,             -- 'institution:123' | 'individual:456'
  tenant_id        uuid not null references tenants(id),
  subject_type     text not null check (subject_type in ('tenant','user')),
  subject_user_id  text,                          -- LibEdge user id when subject_type='user'
  revision         bigint not null,
  payload_sha256   text not null,
  status           text not null check (status in ('active','suspended','cancelled')),
  lease_until      timestamptz,
  applied_at       timestamptz not null default now(),
  request_summary  jsonb not null,
  -- A suspended or cancelled subscription has no lease: access is over and is
  -- not waiting on one to expire.
  check ((status = 'active') = (lease_until is not null))
);
create index if not exists libedge_subscription_sync_lease
  on libedge_subscription_sync (lease_until) where status = 'active';

-- Which subscription granted this row. Nullable: manual grants stay manual, and
-- the staff tenant's 'all' grant (020) is not an entitlement.
alter table grants add column if not exists subscription_source_id text
  references libedge_subscription_sync(source_id);

-- ---------------------------------------------------------------------------
-- SSO replay guard (contract 2.3, step 9)
-- ---------------------------------------------------------------------------

create table if not exists sso_consumed_jti (
  jti text primary key,
  expires_at timestamptz not null
);
create index if not exists sso_consumed_jti_expiry on sso_consumed_jti (expires_at);

-- ---------------------------------------------------------------------------
-- Access to the new tables under RLS
-- ---------------------------------------------------------------------------
--
-- Membership and subscription rows say who may read which tenant's catalogue, so
-- they are tenant-scoped and FORCEd like users and grants: FORCE means the policy
-- binds the table owner too, so no role is quietly exempt.
--
-- libedge_accounts and sso_consumed_jti have no tenant of their own - an account
-- spans contexts, and a jti is a token, not a tenant's data - so they carry no
-- tenant policy here. Only the bridge and SSO paths reach them (022 grants that),
-- and the caller has already been authenticated by then.
--
-- bridge_idempotency is keyed by an opaque key and holds the response body the
-- bridge produced. It is never listed for a user, so the policy checks that a
-- tenant is bound rather than comparing it: current_setting with missing_ok
-- returns NULL when nothing is bound, NULL <> '' is NULL, and the row is denied.
-- That is the intended fail-closed behaviour, not an accident of NULL handling.

alter table libedge_memberships force row level security;
alter table libedge_subscription_sync force row level security;
alter table bridge_idempotency force row level security;

create policy libedge_memberships_tenant on libedge_memberships
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

create policy libedge_subscription_sync_tenant on libedge_subscription_sync
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

create policy bridge_idempotency_bridge on bridge_idempotency
  using (coalesce(current_setting('app.tenant_id', true), '') <> '')
  with check (coalesce(current_setting('app.tenant_id', true), '') <> '');

grant select, insert, update, delete on libedge_accounts to akademik_app;
grant select, insert, update, delete on libedge_memberships to akademik_app;
grant select, insert, update, delete on bridge_idempotency to akademik_app;
grant select, insert, update, delete on libedge_subscription_sync to akademik_app;
grant select, insert, update, delete on sso_consumed_jti to akademik_app;

-- Expected afterwards, unchanged from before this file: every work is still
-- tenant-owned, none has been moved to the global catalogue.
select count(*) as works,
       count(*) filter (where tenant_id is not null) as tenant_owned,
       count(*) filter (where tenant_id is null) as global_works
  from works;
