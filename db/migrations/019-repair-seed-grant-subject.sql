-- 019 — point the seed grant at the tenant it belongs to
--
-- EC2 carries one grants row whose two tenant columns disagree:
--
--   tenant_id   5799f2a5-... (LibEdge, where the 13 works live)
--   subject_id  11111111-... (Demo, a tenant with no works and, since 017,
--                            no users either)
--
-- A `subject_type = 'tenant'` grant means "every member of this tenant", but
-- the members are looked up in `users`, and `users.tenant_id` is 5799f2a5-...
-- for all of them. So a subject_id of 11111111-... matches nobody: the correct
-- grant for "the LibEdge tenant sees its own catalogue" is subject_id =
-- 5799f2a5-....
--
-- While grantAllows() answered `true` to an empty match list this was
-- invisible - everyone saw everything anyway. Under fail-closed it is the
-- difference between the admin seeing 13 works and seeing none, which is why
-- this runs before the image that enforces it.
--
-- Run as the table owner (`akademik`), not as `akademik_app`. `grants` is under
-- FORCE ROW LEVEL SECURITY, so the owner needs row_security = off to see the
-- row it is about to update.
--
-- The `set local` below is itself the guard. Postgres checks it against the
-- caller: the owner may lift FORCE RLS, `akademik_app` may not, and the
-- statement is rejected outright rather than quietly ignored. That rejection is
-- the whole safety property - run this as the app role and the migration fails
-- loudly instead of reporting "0 rows" and looking successful. There is
-- deliberately no attempt to detect the filtered case from inside the file:
-- once `set local` has succeeded, any row_security check reports 'off' by
-- construction and can never fire.
--
-- Safe to run more than once and safe to run on a database that never had the
-- breakage: the update matches on the exact broken shape and nothing else.
-- Files applied by db/migrate.mjs must not contain their own begin/commit and
-- must not use psql meta-commands such as \set, so this file has neither - the
-- runner copies it as a server-side statement string and wraps it together with
-- its registry row. The identifiers are therefore written out literally.

set local row_security = off;

-- Report before touching anything. On a database where the row is already
-- correct (or absent) the update below is a no-op, and this line is the reason
-- why - not a silent pass.
select id, tenant_id, subject_type, subject_id, scope_type, scope_key, status
  from grants
 where tenant_id = '5799f2a5-3d90-41b1-90de-9da07d776052'
   and subject_type = 'tenant';

do $$
declare
  broken int;
begin
  select count(*) into broken
    from grants
   where tenant_id = '5799f2a5-3d90-41b1-90de-9da07d776052'
     and subject_type = 'tenant'
     and subject_id = '11111111-1111-1111-1111-111111111111';

  -- Report, do not judge: on a database that legitimately has no broken row
  -- (including one with no grants at all) the update below is a no-op, and this
  -- notice is the reason why. The refusal for the wrong role happened one
  -- statement earlier, at `set local row_security = off`.
  raise notice '019: % grant(s) to repair', broken;
end $$;

-- Conditional by construction: only the row whose subject_id is the Demo
-- tenant and whose tenant_id is LibEdge is matched. Any other grant, and any
-- subject_id that is a real user or already the right tenant, is left alone.
update grants
   set subject_id = '5799f2a5-3d90-41b1-90de-9da07d776052'
 where tenant_id = '5799f2a5-3d90-41b1-90de-9da07d776052'
   and subject_type = 'tenant'
   and subject_id = '11111111-1111-1111-1111-111111111111';

-- Expected afterwards: the LibEdge tenant grants are all subject_id
-- 5799f2a5-..., and the count of works under it is unchanged at 13.
select id, tenant_id, subject_type, subject_id, scope_type, scope_key, status
  from grants
 where tenant_id = '5799f2a5-3d90-41b1-90de-9da07d776052'
   and subject_type = 'tenant';
