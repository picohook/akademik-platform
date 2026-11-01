-- 030 - let the admin panel name the users in the AI usage list
--
-- The panel's "heaviest users today" list shows ai_usage_daily subjects, which are user ids.
-- Resolving an id to a name needs `users`, which is under FORCE ROW LEVEL SECURITY keyed on
-- app.tenant_id, so an administrator bound to the platform tenant could not see the people who
-- signed in through the individual-reader tenant (the LibEdge SSO button), and the list showed a
-- bare id for exactly the users who use the feature.
--
-- Same shape as app.tenant_for_login (018): one narrow SECURITY DEFINER function instead of
-- loosening the policy on `users`.
--
-- Deliberate limits:
--   * It takes no argument and returns only people who appear in ai_usage_daily as a user
--     subject, so it cannot be used to enumerate users who never touched the feature.
--   * It returns an id, an e-mail, a display name and a tenant slug. No role, no hash, no
--     session data.
--   * search_path is pinned; EXECUTE is granted to the app role only and PUBLIC's is revoked.
--   * The app calls it only from the admin panel's usage query, behind the platform
--     administrator check.
-- Applied by db/migrate.mjs: no begin/commit, idempotent.

create schema if not exists app;

create or replace function app.ai_usage_user_labels()
returns table (user_id uuid, email text, display_name text, tenant_slug text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.id, u.email, u.display_name, t.slug
    from users u
    join tenants t on t.id = u.tenant_id
   where u.id in (
     select a.subject::uuid
       from ai_usage_daily a
      where a.scope = 'user'
        and a.subject ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   )
$$;

comment on function app.ai_usage_user_labels() is
  'Names (e-mail, display name, tenant slug) of users who appear in ai_usage_daily. SECURITY DEFINER because users is under RLS; admin panel only.';

revoke all on function app.ai_usage_user_labels() from public;
grant usage on schema app to akademik_app;
grant execute on function app.ai_usage_user_labels() to akademik_app;
