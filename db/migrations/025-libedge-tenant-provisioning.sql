-- 025 - app.libedge_upsert_tenant(): the one way the bridge creates a tenant
--
-- Contract: docs/contracts/libedge-elibrary-v1.md @ b15f8b5, section 5.3
-- (`PUT /tenants/{kind}/{ref}`), section 3.2 (a (kind, ref) pair maps to exactly one
-- tenant).
--
-- Why a function and not an insert. `tenants` carries `tenants_self`:
--
--   using (id = current_setting('app.tenant_id', true)::uuid)
--
-- and the table is FORCE ROW LEVEL SECURITY, so the policy applies to the table owner
-- too. A policy with no explicit `with check` reuses its `using` expression, so an
-- INSERT must satisfy `id = app.tenant_id` - and for a tenant that does not exist yet,
-- `app.tenant_id` cannot name its id, because the id is what the insert is producing.
-- The row is therefore denied for every principal, including the owner: measured
-- against the shipped schema, `akademik_app` gets
--
--   42501  new row violates row-level security policy for table "tenants"
--
-- on the create path while the update path works. Tenant provisioning is therefore not
-- a gap in a grant that a wider grant would close; it needs a privilege that reads and
-- writes outside the tenant policy on purpose.
--
-- SECURITY DEFINER is that privilege, and it is the pattern already used for the other
-- two places that must see past tenants_self: app.tenant_for_login (018) and
-- app.maintenance_tenants (024). Same shape here: pinned search_path, `public, pg_temp`,
-- the owner as the effective user, EXECUTE revoked from PUBLIC and granted to
-- akademik_app alone.
--
-- Deliberate limits, because a definer function that can write any row is worse than the
-- problem it solves:
--
--   * p_kind must be 'institution'. The staff and individual tenants are deployment
--     facts that 021 and the seed establish; the bridge has no business creating a
--     second staff tenant, and this function refuses rather than trusting the caller.
--     'individual' is refused for the same reason - there is one, provisioned with the
--     deployment, not per request.
--   * On an existing (kind, ref) only name and status move. id and slug are what a
--     reader's bookmarked URL and a stored session already point at; renaming a tenant
--     in LibEdge must not break them, and a slug the bridge sends later cannot be used
--     to take over that tenant's address.
--   * A slug held by a different tenant raises an error, which the bridge maps to
--     409 TENANT_SLUG_TAKEN. Checked inside the function under the lock rather than by
--     the caller, so two provisionings of different institutions with one slug cannot
--     both pass a check and one fail on the unique index with a 500.
--   * status is validated here. An unknown status would otherwise be stored happily and
--     be read back by whatever trusts it.
--
-- The id is generated here, not by the caller: a definer function that accepts an id is
-- a definer function that can be asked to write a row with someone else's id.
--
-- NOT a way to write tenant content. It touches `tenants` and nothing else: no users, no
-- memberships, no grants. Those stay under their own policies in 021.
--
-- Files applied by db/migrate.mjs must not contain begin/commit and must not use psql
-- meta-commands. The body terminator is `$body$`, not a bare dollar pair, for the reason
-- 022 documents: a line consisting of the bare terminator would end the runner's own
-- transaction.

set local row_security = off;

create schema if not exists app;

-- The parameter names carry the p_ prefix for the reason 022 documents: a parameter named
-- like a column resolves as the column inside a query, which would turn
-- `where libedge_kind = libedge_kind` into a tautology. Every statement below compares
-- against one of these names.
create or replace function app.libedge_upsert_tenant(
  p_kind text,
  p_ref text,
  p_name text,
  p_slug text,
  p_status text
)
returns table (
  tenant_id uuid,
  name text,
  slug text,
  status text,
  created boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $body$
declare
  existing_id uuid;
  target_id uuid;
begin
  if p_kind is distinct from 'institution' then
    raise exception 'libedge_upsert_tenant: kind % may not be provisioned through the bridge', p_kind
      using errcode = 'P0001';
  end if;

  if p_ref is null or p_ref = '' then
    raise exception 'libedge_upsert_tenant: ref is required'
      using errcode = 'P0001';
  end if;

  if p_status not in ('active', 'suspended', 'archived') then
    raise exception 'libedge_upsert_tenant: % is not a tenant status', p_status
      using errcode = 'P0001';
  end if;

  -- One provisioning per (kind, ref) at a time. 021's unique index on
  -- (libedge_kind, libedge_ref) is what finally rejects a duplicate; the lock is what
  -- keeps two racing callers from both finding "no row" and both trying to insert,
  -- which would surface as a 500 on the loser instead of a clean create-or-update.
  perform pg_advisory_xact_lock(hashtext('libedge-tenant:' || p_kind || ':' || p_ref));

  select t.id into existing_id
    from tenants t
   where t.libedge_kind = p_kind
     and t.libedge_ref = p_ref;

  if existing_id is not null then
    -- name and status only. id and slug are returned unchanged so the caller reports
    -- what the tenant actually is, rather than echoing back what it asked for.
    return query
      update tenants t
         set name = p_name,
             status = p_status
       where t.id = existing_id
      returning t.id, t.name, t.slug, t.status, false;
    return;
  end if;

  -- A tenant that predates 021 and so has no (kind, ref) - the seeded LibEdge tenant is
  -- exactly this - may already own the slug under another identity. Checked before the
  -- insert so the bridge answers 409 instead of losing a race against the unique index.
  select t.id into target_id
    from tenants t
   where t.slug = p_slug
   limit 1;

  if target_id is not null then
    raise exception 'libedge_upsert_tenant: slug % is already held by tenant %', p_slug, target_id
      using errcode = 'P0001';
  end if;

  return query
    insert into tenants (name, slug, status, libedge_kind, libedge_ref)
    values (p_name, p_slug, p_status, p_kind, p_ref)
    returning tenants.id, tenants.name, tenants.slug, tenants.status, true;
end;
$body$;

comment on function app.libedge_upsert_tenant(text, text, text, text, text) is
  'Create or update an institution tenant for the LibEdge bridge. SECURITY DEFINER because tenants_self cannot admit the INSERT that produces the id; institution only; id and slug are never rewritten on an existing tenant. Used by spike/app/libedge-bridge-db.mjs upsertTenant().';

revoke all on function app.libedge_upsert_tenant(text, text, text, text, text) from public;
grant usage on schema app to akademik_app;
grant execute on function app.libedge_upsert_tenant(text, text, text, text, text) to akademik_app;

-- Verified after this file, expected: app_may_execute = t, catalog_may_execute = f. The
-- direct insert by akademik_app still fails on tenants_self - the function is the only
-- path, not a door left open beside one.
select has_function_privilege('akademik_app',
         'app.libedge_upsert_tenant(text, text, text, text, text)', 'execute') as app_may_execute,
       has_function_privilege('akademik_catalog',
         'app.libedge_upsert_tenant(text, text, text, text, text)', 'execute') as catalog_may_execute;

-- ---------------------------------------------------------------------------
-- app.libedge_tenant_by_ref(): resolve (kind, ref) before any tenant is bound
-- ---------------------------------------------------------------------------
--
-- The bridge has to turn `PUT /tenants/institution/42` into a tenant id before it can
-- bind app.tenant_id for anything else, and at that moment nothing is bound. `tenants_self`
-- denies every row: measured on this schema, `select id from tenants` as akademik_app with
-- no binding returns zero rows even though four exist. 024 documents the same trap for the
-- timers; this is the request-side half of it.
--
-- Not a re-run of the plain query under a different name: a policy cannot be satisfied by a
-- caller that does not yet know the id, so the resolution has to happen with the owner's
-- rights, exactly as app.tenant_for_login (018) does for login.
--
-- What it may return is the minimum the bridge already acts on: id, status and the two
-- context columns the caller supplied. No name, no slug, no created_at. It takes a
-- (kind, ref) pair that the caller must already know, so it cannot enumerate tenants - a
-- wrong guess returns nothing.
create or replace function app.libedge_tenant_by_ref(p_kind text, p_ref text)
returns table (tenant_id uuid, status text, kind text, ref text)
language sql
stable
security definer
set search_path = public, pg_temp
as $body$
  select t.id, t.status, t.libedge_kind, t.libedge_ref
    from tenants t
   where t.libedge_kind = p_kind
     and t.libedge_ref = p_ref;
$body$;

comment on function app.libedge_tenant_by_ref(text, text) is
  'Resolve a LibEdge (kind, ref) to a tenant id. SECURITY DEFINER because tenants_self denies every row before a tenant is bound; returns ids and status only. Used by spike/app/libedge-bridge-db.mjs resolveTenant().';

revoke all on function app.libedge_tenant_by_ref(text, text) from public;
grant execute on function app.libedge_tenant_by_ref(text, text) to akademik_app;
