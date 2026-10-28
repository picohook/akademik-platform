-- 022 - the global catalogue boundary: catalog role, write policies, publish
--
-- Contract: docs/contracts/libedge-elibrary-v1.md @ b15f8b5, sections 4.3, 5.6.
-- Schema only. NOTHING IS MOVED TO THE GLOBAL CATALOGUE HERE. The initial
-- migration of works is 023, which waits on the approved list in contract 4.4.
--
-- Why this file exists at all. Every RLS policy on works, editions, assets,
-- asset_pages and collections is `using (tenant_id is null or tenant_id =
-- app.tenant_id)` with no `with check`. A permissive policy's WITH CHECK defaults to
-- its USING expression, so any tenant context can write into the global catalogue.
-- collection_items had no RLS at all. Contract 4.3 closes this in the database, not
-- just in the app:
--
--   1. akademik_app keeps read on global rows and write on its own tenant's rows,
--      and loses the ability to write global rows at all - including by UPDATE,
--      which is not covered by WITH CHECK alone.
--   2. akademik_catalog is a separate login with its own password and its own
--      connection pool. It may write global rows. It may NOT write tenant rows -
--      not even the staff tenant's - except through catalog_publish_work() and
--      catalog_set_withdrawn().
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

alter table collection_items enable row level security;
alter table collection_items force row level security;

-- Every policy in this file is dropped before it is created, so re-running 022 on
-- a database that already has it is a no-op rather than an error.
drop policy if exists collection_items_tenant on collection_items;
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

-- The catalog role's own restriction, in the other direction: it may write global
-- rows and nothing else. `for all` is safe HERE where it was not for the app,
-- because the expression is the same on both sides - USING and WITH CHECK are both
-- `tenant_id is null`, so a row it can see is exactly a row it may write, and it
-- cannot move a tenant row into the global catalogue this way (that row is not
-- visible to it at all). Publishing goes through the function below instead.
do $$
declare
  t text;
begin
  foreach t in array array['works','editions','assets','asset_pages','collections','collection_items'] loop
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
-- SPLIT BY COMMAND, and this is the fix for a defect that a first version missed.
-- `for all using (true) with check (tenant_id is not null)` looked correct and was
-- not: WITH CHECK governs rows being written, USING governs rows being READ TO
-- MODIFY. `using (true)` therefore let the app's UPDATE *see* a global row, and
-- `with check (tenant_id is not null)` was satisfied once that same UPDATE had
-- moved the row into the app's own tenant. Measured on PostgreSQL 16: the app
-- pulled a global work into its tenant with `set tenant_id = <its own>`, and
-- deleted a global work outright. Neither is possible with the policy below.
--
-- So USING carries the same `tenant_id is not null` for UPDATE and DELETE: a
-- global row is not visible to the app's write paths at all.
--
-- SELECT deliberately gets no restrictive policy. Reading the global catalogue is
-- the entire point of it, and akademik_app's permissive policy already allows it.
--
-- A NULL tenant_id never denies anyone by accident either: the app's own rows
-- always have one, and a policy that evaluates to NULL denies, so the expression
-- says `is not null` rather than relying on `null = $app` being NULL.
-- The same three policies on every tenant-owned catalogue table, including
-- collection_items, because the identical defect existed identically there: an app
-- bound to tenant A could add a line to a global collection (tenant_id NULL), and
-- the collection's membership is tenant-visible content.
do $$
declare
  t text;
begin
  foreach t in array array['works','editions','assets','asset_pages','collections','collection_items'] loop
    execute format('drop policy if exists %I on %I', t || '_app_no_global', t);
    execute format('drop policy if exists %I on %I', t || '_app_no_global_insert', t);
    execute format('drop policy if exists %I on %I', t || '_app_no_global_update', t);
    execute format('drop policy if exists %I on %I', t || '_app_no_global_delete', t);
    execute format(
      'create policy %I on %I as restrictive for insert to akademik_app
         with check (tenant_id is not null)', t || '_app_no_global_insert', t);
    execute format(
      'create policy %I on %I as restrictive for update to akademik_app
         using (tenant_id is not null) with check (tenant_id is not null)',
      t || '_app_no_global_update', t);
    execute format(
      'create policy %I on %I as restrictive for delete to akademik_app
         using (tenant_id is not null)', t || '_app_no_global_delete', t);
  end loop;
end $$;

-- The staff tenant's rows are readable by the catalog role so publish can prove
-- a work is there; they are not writable by it (the policy above forbids it, and
-- no other privilege grants it).
--
-- The write privileges below are the trust boundary itself. First version granted
-- only SELECT, which made the restrictive policies look enforced while making the
-- bridge's global writes impossible: the catalog path could read a published work
-- and not correct its title. Contract 4.3 asks for insert/update/delete on
-- `tenant_id IS NULL` rows, and that is what these grants give - with the policy
-- above deciding WHICH rows, and a column list deciding what may change on them.
--
-- Columns are named on UPDATE rather than granted table-wide. A table-wide UPDATE
-- would let the catalog path write tenant_id on a global row - the exact move the
-- app is now forbidden from making, and the one the policies cannot express,
-- because `with check (tenant_id is null)` is satisfied by keeping it null and
-- says nothing about the value before and after.
grant select on works, editions, assets, asset_pages, collections, collection_items
  to akademik_catalog;
grant select on tenants to akademik_catalog;

-- Collections are created and maintained here: the bridge's collection CRUD is a
-- global write in the catalogue sense.
grant insert, delete on collections to akademik_catalog;
grant update (title, slug, description, visibility) on collections to akademik_catalog;

grant insert, delete on collection_items to akademik_catalog;

-- Works metadata, and withdrawal (contract 5.6: withdrawn_at, withdrawn_reason).
-- withdrawn_at is NOT here: it is contract 4.3's own sentence, restricted to a
-- global work, and it goes through catalog_set_withdrawn() below so that the
-- global-row condition lives in the database rather than in the caller.
grant insert, delete on works to akademik_catalog;
grant update (title, subtitle, language, abstract, subjects, metadata, content_type,
              withdrawn_reason) on works to akademik_catalog;

grant insert, delete on editions to akademik_catalog;
grant update (publisher, publication_year, edition, isbn13, doi, handle,
              license_uri, license_note, rights_note) on editions to akademik_catalog;

grant insert, delete on assets to akademik_catalog;
grant insert, delete on asset_pages to akademik_catalog;

-- Child rows of a global work: the catalog path may correct their content but not
-- move them between parents. The restrictive policy already limits which rows it
-- sees. format and edition_id are left out of the UPDATE list for that reason.
grant update (storage_key, page_count, text_content, quality_score, source_system,
              source_id, source_url, source_checksum, harvested_at, access_status,
              allow_copy, allow_download, allow_print, watermark) on assets to akademik_catalog;
grant update (text_content, text_search, source, locator) on asset_pages to akademik_catalog;


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

-- Reaching only these two functions is the entire write surface of the catalog
-- role on tenant data. Everything else it may write is a global row.

revoke all on function catalog_publish_work(uuid) from public;
grant execute on function catalog_publish_work(uuid) to akademik_catalog;

-- Withdrawal and restoration (contracts 4.3, 5.6). Only the global work's
-- withdrawn_at changes, and only a global work can be reached.
--
-- This is a function rather than an UPDATE grant on the column for a specific
-- reason: a column grant cannot say "global rows only". The restrictive policy
-- permits a global row and forbids a tenant row, so an UPDATE grant on withdrawn_at
-- alone would let the catalog path withdraw a staff tenant's title - and contract
-- 5.6 is about withdrawing a published work, while contract 4.3 forbids this role
-- touching tenant rows at all.
--
-- SECURITY DEFINER is not needed to exceed the caller's rights here; it is used so
-- the global-row check runs with one definition rather than being repeated by every
-- caller. It raises instead of quietly updating nothing when the work is not global,
-- because a silent no-op would look like a successful withdrawal to the bridge.
create or replace function catalog_set_withdrawn(
  p_work_id uuid,
  p_withdraw boolean,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $body$
declare
  moved int;
begin
  if not exists (select 1 from works where id = p_work_id and tenant_id is null) then
    raise exception 'catalog_set_withdrawn: work % is not in the global catalogue', p_work_id
      using errcode = 'P0001';
  end if;

  update works
     set withdrawn_at = case when p_withdraw then now() else null end,
         withdrawn_reason = case when p_withdraw then p_reason else null end
   where id = p_work_id
     and tenant_id is null;
  get diagnostics moved = row_count;

  if moved <> 1 then
    raise exception 'catalog_set_withdrawn: expected to change 1 work, changed %', moved
      using errcode = 'P0001';
  end if;
end$body$;

revoke all on function catalog_set_withdrawn(uuid, boolean, text) from public;
grant execute on function catalog_set_withdrawn(uuid, boolean, text) to akademik_catalog;

-- Verified after this file, expected: the catalog role cannot write a staff row
-- directly, and the app role cannot write a global row at all.
select rolname, rolsuper, rolbypassrls, rolcanlogin
  from pg_roles
 where rolname in ('akademik_app','akademik_catalog');

select pol.tablename, pol.policyname, pol.permissive, pol.cmd
  from pg_policies pol
 where pol.schemaname = 'public'
   and (pol.policyname like '%catalog_global' or pol.policyname like '%app_no_global%')
 order by pol.tablename, pol.policyname;

select c.relname, c.relrowsecurity, c.relforcerowsecurity
  from pg_class c
 where c.relname = 'collection_items';
