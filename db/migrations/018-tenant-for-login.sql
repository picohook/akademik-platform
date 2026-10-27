-- Login must resolve an email to its tenant before any tenant is bound, and
-- `users` is under FORCE ROW LEVEL SECURITY with a policy keyed on
-- app.tenant_id. The app role therefore cannot see the row it needs to
-- authenticate, so every login would fail on a second tenant.
--
-- This function is the narrow exception: it takes one email and returns one
-- uuid. SECURITY DEFINER means it runs with the rights of whoever owns it
-- (the table owner, not akademik_app), so it reads across RLS by design.
--
-- Deliberate limits:
--   * search_path is pinned, so a caller cannot shadow `users`.
--   * It returns only a tenant id; no email, hash, or role leaks through it.
--   * It takes an email, so it cannot enumerate tenants.
--   * EXECUTE is granted to the app role and PUBLIC's is revoked.
--
-- The app also falls back to DEMO_TENANT_ID when this function is missing, so
-- deploying the code before this migration does not break single-tenant
-- deployments. That fallback is a transition aid, not a supported end state.

create schema if not exists app;

create or replace function app.tenant_for_login(user_email text)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.tenant_id
    from users u
   where lower(u.email) = lower(user_email)
   order by u.created_at
   limit 1
$$;

comment on function app.tenant_for_login(text) is
  'Resolves a login email to its tenant. SECURITY DEFINER so login works before a tenant is bound; returns only a uuid.';

revoke all on function app.tenant_for_login(text) from public;
grant usage on schema app to akademik_app;
grant execute on function app.tenant_for_login(text) to akademik_app;
