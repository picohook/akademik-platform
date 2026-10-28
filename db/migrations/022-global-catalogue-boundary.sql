-- 022 - the global catalogue boundary: catalog role, write policies, publish
--
-- Contract: docs/contracts/libedge-elibrary-v1.md @ b15f8b5, sections 4.3, 5.6.
-- Schema only. NOTHING IS MOVED TO THE GLOBAL CATALOGUE HERE. The initial
-- migration of works is 023, which waits on the approved list in contract 4.4.
--
-- Why this file exists at all. Today every RLS policy on works, editions, assets
-- and asset_pages is `using (tenant_id is null or tenant_id = app.tenant_id)` with
-- no `with check`. A permissive policy's WITH CHECK defaults to its USING
-- expression, so any tenant context can INSERT a row with tenant_id NULL - that
-- is, write into the global catalogue. Nothing in the application does this
-- (updateBook scopes its writes by tenant), so it is a latent hole rather than a
-- live incident. Contract 4.3 closes it in the database, not just in the app:
--
--   1. akademik_app keeps read on global rows and write on its own tenant's rows,
--      and loses the ability to write global rows at all.
--   2. akademik_catalog is a separate login with its own password and its own
--      connection pool. It may write global rows. It may NOT write tenant rows -
--      not event the staff tenant's - except through catalog_publish_work().
--   3. catalog_publish_work(work_id) is SECURITY DEFINER with a pinned
--      search_path and is executable only by akademik_catalog. It moves exactly
--      one staff tenant's work to global; it cannot be used to reach any other
--      row.
--
-- The deliberate limit, stated in the contract: both credentials live in the same
-- process, so this protects against application bugs, not against the process
-- itself being taken over. That is accepted, not overlooked.
--
-- The password for akademik_catalog is NOT set here. It is supplied at deploy
-- time from a secret and applied by db/README.md's step; a password in a
-- migration would be a password in git forever.
--
-- Files applied by db/migrate.mjs must not contain begin/commit and must not use
-- psql meta-commands. `set local row_security = off` is the guard: accepted from
-- the table owner, rejected for akademik_app.

set local row_security = off;

-- ---------------------------------------------------------------------------
-- Role
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'akademik_catalog') then
    -- NOLOGIN first: the login credential is granted separately with a secret
    -- password. NOSUPERUSER and NOBYPASSRLS so the policies below actually apply
    -- to it - a role that bypasses RLS would make this whole file decorative.
    create role akademik_catalog nologin nosuperuser nobypassrls;
  end if;
end $$;

alter role akademik_catalog nosuperuser nobypassrls;
grant usage on schema public to akademik_catalog;

-- ---------------------------------------------------------------------------
-- Withdrawal (contract 5.6)
-- ---------------------------------------------------------------------------
--
-- Withdrawn content is unreadable through every path - catalogue, search, detail,
-- file and Range, ticket issue and redemption, OPDS, OCR - and this overrides
-- title grants too. The column lives on the work because the decision is about
-- the work, not the grant: restoring access is clearing the column, not
-- re-issuing grants.

alter table works add column if not exists withdrawn_at timestamptz;
alter table works add column if not exists withdrawn_reason text;
create index if not exists works_withdrawn on works (id) where withdrawn_at is not null;

-- ---------------------------------------------------------------------------
-- collection_items belongs to a tenant (contract 4.1)
-- ---------------------------------------------------------------------------
--
-- A collection has a tenant; its items did not, so the membership row carried no
-- tenant of its own and could not be policed on its own terms - the RLS on
-- collections covered the header but not the lines. The column is backfilled from
-- the collection, which is the only correct source: an item's tenant is always
-- its collection's tenant. Global collections (tenant_id NULL) yield NULL here,
-- which is exactly right.

alter table collection_items add column if not exists tenant_id uuid
  references tenants(id) on delete cascade;

update collection_items ci
   set tenant_id = c.tenant_id
  from collections c
 where c.id = ci.collection_id
   and ci.tenant_id is distinct from c.tenant_id;

alter table collection_items force row level security;

create policy collection_items_tenant on collection_items
  using (tenant_id is null or tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id is null or tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ---------------------------------------------------------------------------
-- Write policies: who may write a global row (contract 4.3)
-- ---------------------------------------------------------------------------
--
-- Two facts from the PostgreSQL docs shape this block:
--   * permissive policies are ORed together; restrictive ones are ANDed with the
--     result of the permissive set;
--   * a policy declared `to <role>` applies only to that role, but a policy
--     declared without a role (as schema.sql writes them) applies to everyone,
--     including akademik_catalog.
--
-- So a permissive `to akademik_catalog using (tenant_id is null)` would NOT stop
-- the catalog role writing a staff tenant's row: akademik_app's existing policy is
-- still in force for it and the two are ORed. The catalog restriction is
-- therefore declared AS RESTRICTIVE, so `tenant_id is null` is ANDed on top of
-- whatever else applies and holds for every write that role attempts. That is the
-- line which makes catalog_publish_work() the only way into a tenant row rather
-- than merely the convenient way.
--
-- akademik_app DOES need an explicit restriction, and this is the part that was
-- measured rather than assumed. Its existing works_tenant policy has no WITH CHECK;
-- PostgreSQL then applies USING for the check, and `tenant_id is null or
-- tenant_id = $app` is TRUE for a global row - so the app could insert one, which
-- is exactly the hole this file is meant to close. (Verified on PostgreSQL 16 with
-- pg_policies: the policy reports with_check = null.) The app therefore gets a
-- restrictive policy of its own that forbids writing global rows outright, while
-- still allowing every write inside its own tenant.

do $$
declare
  t text;
begin
  foreach t in array array['works','editions','assets','asset_pages','collections'] loop
    execute format('drop policy if exists %I on %I', t || '_catalog_global', t);
    execute format(
      'create policy %I on %I as restrictive for all to akademik_catalog
         using (tenant_id is null)
         with check (tenant_id is null)',
      t || '_catalog_global', t);
  end loop;
end $$;

-- The app's own restriction, added for the same reason in the other direction:
-- it may write its tenant's rows and nothing else. Restrictive, so it is ANDed
-- with works_tenant rather than ORed, and it exists because works_tenant's missing
-- WITH CHECK makes `tenant_id is null` permissive for writes.
--
-- The expression is written as "must not be global" rather than "must equal my
-- tenant" on purpose: a global row's tenant_id is NULL, `NULL = $app` is NULL, and
-- a policy that evaluates to NULL denies - which happens to be right, but only by
-- accident. Saying NOT NULL makes the intent explicit and independent of that.
drop policy if exists works_app_no_global on works;
create policy works_app_no_global on works
  as restrictive for all to akademik_app
  using (true) with check (tenant_id is not null);

drop policy if exists editions_app_no_global on editions;
create policy editions_app_no_global on editions
  as restrictive for all to akademik_app
  using (true) with check (tenant_id is not null);

drop policy if exists assets_app_no_global on assets;
create policy assets_app_no_global on assets
  as restrictive for all to akademik_app
  using (true) with check (tenant_id is not null);

drop policy if exists asset_pages_app_no_global on asset_pages;
create policy asset_pages_app_no_global on asset_pages
  as restrictive for all to akademik_app
  using (true) with check (tenant_id is not null);

drop policy if exists collections_app_no_global on collections;
create policy collections_app_no_global on collections
  as restrictive for all to akademik_app
  using (true) with check (tenant_id is not null);

-- The staff tenant's rows are readable by the catalog role so publish can prove
-- a work is there; they are not writable by it (the policy above forbids it, and
-- no other policy grants it).
grant select on works, editions, assets, asset_pages, collections to akademik_catalog;
grant select on tenants to akademik_catalog;

-- Replacing the permissive read policy on these tables with one that names the
-- role is not needed: RLS policies are permissive and additive, and akademik_app's
-- policy already grants read of global rows. Nothing here removes a read.

-- ---------------------------------------------------------------------------
-- catalog_publish_work (contract 4.3, 5.6)
-- ---------------------------------------------------------------------------
--
-- The only path from a tenant row to a global one. The catalog role holds no
-- INSERT/UPDATE/DELETE privilege on tenant rows at all (the restrictive policy
-- above sees to that), so this function is not a convenience wrapper - without it
-- the role cannot publish, and with it it can do nothing else.
--
-- SECURITY DEFINER with a pinned search_path so the body cannot be redirected by
-- a caller-controlled schema. The owner is the table owner (this file runs as it),
-- which is what lets the body write rows the caller may not.
--
-- The guard is that the work must belong to the staff tenant. Contract 3.2 names
-- that tenant's libedge_kind as 'staff'; the uuid is resolved through 021's
-- libedge_kind/libedge_ref rather than hard-coded, so the same file works on a
-- fresh database and on EC2.
--
-- The parameter is named p_work_id, not work_id: a parameter with a column's name
-- is resolved as the column inside a query, which would silently turn
-- `where work_id = work_id` into a tautology. That is a real hazard here, not a
-- stylistic preference, because every statement below is about a work id.
--
-- The child rows are collected BEFORE works is updated, because each step keys off
-- the parent's tenant_id which the previous step has just cleared.
--
-- Only works, editions, assets and asset_pages move. Annotations, progress,
-- collection_items and grant rows are deliberately untouched: publishing shares a
-- title, it does not share a reader's notes.

create or replace function catalog_publish_work(p_work_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $body$
declare
  staff_tenant uuid;
  moved int;
  moved_editions uuid[];
  moved_assets uuid[];
begin
  select id into staff_tenant
    from tenants
   where libedge_kind = 'staff'
   limit 1;

  if staff_tenant is null then
    raise exception 'catalog_publish_work: no staff tenant is configured'
      using errcode = 'P0001';
  end if;

  -- Already global: 409 ALREADY_GLOBAL in the bridge, raised here too so the
  -- check cannot be skipped by a caller.
  if exists (select 1 from works where id = p_work_id and tenant_id is null) then
    raise exception 'catalog_publish_work: work is already global'
      using errcode = 'P0001';
  end if;

  if not exists (select 1 from works where id = p_work_id and tenant_id = staff_tenant) then
    raise exception 'catalog_publish_work: work is not in the staff tenant'
      using errcode = 'P0001';
  end if;

  select coalesce(array_agg(id), '{}') into moved_editions
    from editions where work_id = p_work_id;

  select coalesce(array_agg(id), '{}') into moved_assets
    from assets where edition_id = any(moved_editions);

  update works set tenant_id = null where id = p_work_id and tenant_id = staff_tenant;
  get diagnostics moved = row_count;

  update editions set tenant_id = null where id = any(moved_editions);
  update assets set tenant_id = null where id = any(moved_assets);
  update asset_pages set tenant_id = null where asset_id = any(moved_assets);

  if moved <> 1 then
    raise exception 'catalog_publish_work: expected to move 1 work, moved %', moved
      using errcode = 'P0001';
  end if;
end$body$;

-- The body terminator touches the last keyword above, and the dollar-quote is
-- $body$ rather than a bare pair of dollar signs, for one reason: db/migrate.mjs
-- refuses a file containing a line that starts with the bare terminator pair,
-- because that is how a migration would end the runner's own transaction. Its
-- regex skips leading whitespace and comment lines, so indentation and explanatory
-- comments do not avoid it; a terminator that is not a bare statement does. Both
-- files stay runnable and the runner's rule stays as strict as it was.

-- Reaching only this function is the entire write surface of the catalog role.
revoke all on function catalog_publish_work(uuid) from public;
grant execute on function catalog_publish_work(uuid) to akademik_catalog;

-- Verified after this file, expected: the catalog role cannot write a staff row
-- directly, and the app role cannot write a global row at all.
select rolname, rolsuper, rolbypassrls, rolcanlogin
  from pg_roles
 where rolname in ('akademik_app','akademik_catalog');

select tablename, policyname, permissive
  from pg_policies
 where schemaname = 'public'
   and policyname like '%catalog_global'
 order by tablename;
