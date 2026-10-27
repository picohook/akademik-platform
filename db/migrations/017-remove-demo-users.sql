-- 017 — remove the two seeded demo accounts from the Demo tenant
--
-- The Demo tenant (11111111-…) holds two accounts created by seed.sql and
-- 003-librarian-user.sql. The real catalog lives under the LibEdge tenant
-- (5799f2a5-…), so signing in with those two accounts lands on a tenant with
-- zero works: a valid session and an empty library.
--
-- They are throwaway seed data. No real person owns them and nothing in the
-- LibEdge catalog depends on them, so the fix is to delete them rather than to
-- move them between tenants. Deleting also removes the reason to touch
-- withTenant, grants or grantAllows, which is what made the move fragile.
--
-- Every table that points at users does it with `on delete cascade`, except
-- grant_audit.actor_user_id which is `on delete set null`. So a single delete
-- is enough; no dependent rows are left behind and no foreign key blocks it.
--
-- Run as the table owner (`akademik`), not as `akademik_app`.
--
--   psql -U akademik -d akademik -f db/migrations/017-remove-demo-users.sql
--
-- Safe to run more than once: the second run finds nothing and reports it.
-- Needs a pg_dump first. This deletes rows and there is no undo but the backup.

\set ON_ERROR_STOP on

-- The addresses are the whole point of this file, so name them once.
-- Both are fixed by the seed, not by anything a user can change.
\set demo_tenant '11111111-1111-1111-1111-111111111111'

-- ---------------------------------------------------------------------------
-- STEP 0 — prove we can actually see the rows we are about to delete
-- ---------------------------------------------------------------------------
-- `users` and `tenants` both carry FORCE ROW LEVEL SECURITY. Under FORCE even
-- the table owner is filtered, so a statement without `row_security = off`
-- matches nothing and reports success. A delete written that way would say
-- "0 rows" and look like a clean no-op while the accounts stayed in place.
--
-- Only the table owner can switch row security off. As `akademik_app` Postgres
-- raises instead:
--
--   ERROR: query would be affected by row-level security policy for table "users"
--
-- so the guard below fails loudly in that case rather than silently matching
-- nothing.

begin;
set local row_security = off;

do $$
declare
  demo_users int;
  libedge_users int;
begin
  select count(*) into demo_users
    from users
   where tenant_id = '11111111-1111-1111-1111-111111111111';

  select count(*) into libedge_users
    from users
   where tenant_id <> '11111111-1111-1111-1111-111111111111';

  raise notice 'STEP 0  demo tenant users = %, other tenant users = %',
    demo_users, libedge_users;

  -- If row security is still on, counts come back 0 even though rows exist.
  -- Neither tenant having a single user is impossible on a live database, so
  -- treat it as "the read is being filtered" and stop.
  if demo_users = 0 and libedge_users = 0 then
    raise exception 'STEP 0 failed: no users visible at all — reads are being filtered by row-level security (are you connected as akademik_app?)';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- STEP 1 — report exactly what will be deleted, and what depends on it
-- ---------------------------------------------------------------------------

select id, tenant_id, email, role, created_at
  from users
 where tenant_id = :'demo_tenant'
 order by email;

-- What the delete will take with it. Listed here so the count is on record
-- before the rows disappear, not discovered afterwards.
select 'user_sessions' as table_name, count(*) as rows
  from user_sessions s join users u on u.id = s.user_id
 where u.tenant_id = :'demo_tenant'
union all
select 'annotations', count(*)
  from annotations a join users u on u.id = a.user_id
 where u.tenant_id = :'demo_tenant'
union all
select 'reading_progress', count(*)
  from reading_progress p join users u on u.id = p.user_id
 where u.tenant_id = :'demo_tenant'
union all
select 'user_group_members', count(*)
  from user_group_members m join users u on u.id = m.user_id
 where u.tenant_id = :'demo_tenant'
union all
select 'download_tickets', count(*)
  from download_tickets t join users u on u.id = t.user_id
 where u.tenant_id = :'demo_tenant'
order by table_name;

commit;

-- ---------------------------------------------------------------------------
-- STEP 2 — delete, and stop unless exactly the expected rows went
-- ---------------------------------------------------------------------------
-- The seed creates exactly two accounts. If the delete touches a different
-- number, something is not what this file assumed — an extra account was
-- created in the Demo tenant, or one of the two is already gone — and rolling
-- back is cheaper than guessing.

begin;
set local row_security = off;

-- The rows to delete, pinned now. Counting `users` afterwards would count
-- what is left, not what this statement removed, and the two are only equal
-- by accident. The temp table also holds the row locks, so nothing can add a
-- second account for either address between the check and the delete.
create temp table _demo_users on commit drop as
  select id
    from users
   where tenant_id = :'demo_tenant'
     and email in ('librarian@example.edu.tr', 'reader@example.edu.tr')
     for update;

do $$
declare
  matched int;
  demo_total int;
begin
  select count(*) into matched from _demo_users;

  select count(*) into demo_total
    from users
   where tenant_id = '11111111-1111-1111-1111-111111111111';

  raise notice 'STEP 2  matched % account(s) to delete, Demo tenant holds % in total',
    matched, demo_total;

  if matched not in (0, 2) then
    raise exception 'STEP 2 aborted: expected 0 or 2 accounts, matched % — nothing deleted', matched;
  end if;

  -- `matched = 0` has two very different meanings and only one of them is
  -- "already done". If the Demo tenant still holds accounts but neither is
  -- one of the two named above, the seed is not in the state this file
  -- assumes — stopping beats deleting nothing and reporting success.
  if matched = 0 and demo_total > 0 then
    raise exception 'STEP 2 aborted: Demo tenant still holds % account(s) but none of them are the seeded demo users — refusing to guess', demo_total;
  end if;
end $$;

delete from users u
 using _demo_users d
 where u.id = d.id;

do $$
declare
  deleted int;
begin
  -- Same scoping trap as with an outer UPDATE: `get diagnostics` inside this
  -- block reads this block's own statement, not the delete above. Count what
  -- the delete removed by asking whether the ids still exist.
  select count(*) into deleted
    from _demo_users d
   where not exists (select 1 from users u where u.id = d.id);

  raise notice 'STEP 2  deleted % account(s)', deleted;

  if deleted not in (0, 2) then
    raise exception 'STEP 2 aborted: deleted % rows, expected 0 or 2 — rolling back', deleted;
  end if;

  if deleted = 0 then
    raise notice 'STEP 2  nothing deleted in this run (already applied)';
  end if;
end $$;

commit;

-- ---------------------------------------------------------------------------
-- STEP 3 — what is left afterwards
-- ---------------------------------------------------------------------------
-- Expected: one account (the admin) under the LibEdge tenant, nothing under
-- the Demo tenant, and the catalog untouched at 13 works.

begin;
set local row_security = off;

select id, slug, name from tenants order by created_at;

select tenant_id, email, role
  from users
 order by tenant_id, email;

select tenant_id, count(*) as works
  from works
 group by tenant_id
 order by tenant_id;

select tenant_id, subject_type, scope_type, status, count(*) as grants
  from grants
 group by tenant_id, subject_type, scope_type, status
 order by tenant_id;

commit;

-- ---------------------------------------------------------------------------
-- STEP 4 — nothing may still point at the deleted accounts
-- ---------------------------------------------------------------------------
-- The cascade should have taken every dependent row. This checks rather than
-- assumes: any non-zero count here means a foreign key is missing its
-- `on delete cascade` and rows are now orphaned.

begin;
set local row_security = off;

select 'user_sessions' as table_name, count(*) as orphans
  from user_sessions s
 where not exists (select 1 from users u where u.id = s.user_id)
union all
select 'annotations', count(*)
  from annotations a
 where not exists (select 1 from users u where u.id = a.user_id)
union all
select 'reading_progress', count(*)
  from reading_progress p
 where not exists (select 1 from users u where u.id = p.user_id)
union all
select 'user_group_members', count(*)
  from user_group_members m
 where not exists (select 1 from users u where u.id = m.user_id)
union all
select 'download_tickets', count(*)
  from download_tickets t
 where not exists (select 1 from users u where u.id = t.user_id)
union all
select 'download_ticket_limits', count(*)
  from download_ticket_limits l
 where not exists (select 1 from users u where u.id = l.user_id)
order by table_name;

commit;
