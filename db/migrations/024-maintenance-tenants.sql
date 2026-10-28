-- 024 - app.maintenance_tenants(): which tenants a timer sweeps
--
-- Contract: docs/contracts/libedge-elibrary-v1.md @ b15f8b5, section 7.2 ("timers
-- must cover every tenant"). Depends on nothing: this file is additive, it
-- creates no tenant data and reads no tenant data at apply time.
--
-- Why a function and not a query. The two timers (download ticket sweep, annotation
-- receipt retention) run outside any request, so no tenant is bound and nothing can
-- be inferred from the request. The obvious list is:
--
--   select id from tenants;
--
-- and it returns exactly one row for the app role, whatever the data holds:
-- tenants_self is `using (id = current_setting('app.tenant_id', true)::uuid)`, and
-- with nothing bound `current_setting` is NULL, `id = NULL` is NULL, and every row
-- is denied. A sweeper written that way looks correct - it iterates a list, it has
-- no hard-coded tenant - and covers one institution. Worse, which one depends on
-- whether something else on that pooled connection happened to leave app.tenant_id
-- set, because the setting is session-level and the connection comes from a pool.
--
-- So the list comes from a SECURITY DEFINER function. It runs as the table owner,
-- which is not bypassed by tenants' policy because tenants is FORCEd for the owner
-- too (db/schema.sql) - hence the explicit `set local row_security = off` below,
-- which the owner may do and akademik_app may not.
--
-- What it may return, and what it may not. Ids only: no name, no slug, no status,
-- no counts. The app already knows its own tenant's row through tenants_self, so
-- this exposes nothing it could not read; it exposes no other tenant's data, only
-- the fact that other tenants exist - which the sweep needs in order to run for
-- them. `status <> 'deleted'` is not filtered here: a tenant is never deleted
-- (there is no such status in the schema), and filtering on a guess would hide a
-- tenant that still has tickets to expire.
--
-- Not restricted to the caller's tenant on purpose: that would be the plain query
-- again, with extra steps.
--
-- It returns tenant_id, not id, because the caller in spike/app/server.mjs reads
-- `rows.map(row => row.tenant_id)`. A function that is correct SQL and ignored by
-- every caller is worse than none, so the name is part of the contract here.
--
-- Files applied by db/migrate.mjs must not contain begin/commit and must not use
-- psql meta-commands. The body terminator is `$body$`, not a bare dollar pair, for
-- the reason 022 documents: a line consisting of the bare terminator would end the
-- runner's own transaction.

set local row_security = off;

-- An application schema, so the grant is one line instead of naming a function
-- signature that changes whenever the return type does. `create schema if not
-- exists` plus its `grant usage` are both idempotent, so a re-run is safe.
create schema if not exists app;

create or replace function app.maintenance_tenants()
returns table (tenant_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $body$
  select t.id
    from tenants t
   order by t.id;
$body$;

comment on function app.maintenance_tenants() is
  'Tenant ids for timers that run outside a request. SECURITY DEFINER because tenants_self shows the app role one row; returns ids only. Used by spike/app/server.mjs maintenanceTenantIds().';

-- The default for a new function is EXECUTE to PUBLIC; revoke it so the only way to
-- call this is the grant below. akademik_app is the app; akademik_catalog is the
-- bridge's catalogue role and has no timer, so it does not need this.
revoke all on function app.maintenance_tenants() from public;
grant usage on schema app to akademik_app;
grant execute on function app.maintenance_tenants() to akademik_app;

-- Verified after this file, expected: one row per tenant in `tenants`, and the same
-- list for any principal - it is not filtered by the caller's tenant.
select count(*) as tenants, count(distinct tenant_id) as distinct_tenants
  from app.maintenance_tenants();

select has_function_privilege('akademik_app', 'app.maintenance_tenants()', 'execute') as app_may_execute,
       has_function_privilege('akademik_catalog', 'app.maintenance_tenants()', 'execute') as catalog_may_execute;
