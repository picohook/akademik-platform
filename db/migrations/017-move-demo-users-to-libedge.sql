-- 017 — move the two seeded demo users from the Demo tenant to LibEdge.
--
-- Why this exists
-- ---------------
-- v131 ships with a single tenant (5799f2a5-…, "LibEdge") holding the real
-- catalog. The users created by db/seed.sql and 003-librarian-user.sql still
-- live in the Demo tenant (11111111-…). A user who signs in with those
-- credentials gets a valid session but an EMPTY library, because every
-- catalog query is tenant-scoped.
--
-- Why it is not a plain UPDATE
-- ----------------------------
--   1. `users` has FORCE ROW LEVEL SECURITY. Without `row_security = off`
--      every statement sees zero rows and silences itself. This is why the
--      earlier diagnostic queries returned nothing.
--   2. `users` is unique on (tenant_id, email). If the same address already
--      exists under the LibEdge tenant the move must NOT run blind.
--   3. Moving a user does not move their work. Grants, sessions and
--      annotations hang off user_id/tenant_id separately; see STEP 4.
--
-- This file is written to be run in STEPS, not as one migration. The parts
-- that mutate data commit only if their post-conditions hold.

-- ---------------------------------------------------------------------------
-- STEP 0 — confirm we can see across tenants at all
-- ---------------------------------------------------------------------------
-- Must run as the database owner. If demo_users comes back 0 while the demo
-- seed unquestionably exists, ABORT: RLS is still hiding everything and
-- every conclusion drawn afterwards would be wrong.

begin;
set local row_security = off;

select current_user,
       (select rolbypassrls from pg_roles where rolname = current_user) as bypassrls,
       (select count(*) from users
         where tenant_id = '11111111-1111-1111-1111-111111111111') as demo_users,
       (select count(*) from users
         where tenant_id = '5799f2a5-3d90-41b1-90de-9da07d776052') as libedge_users;

commit;

-- ---------------------------------------------------------------------------
-- STEP 1 — collision check. MUST return 0 rows before STEP 2.
-- ---------------------------------------------------------------------------

begin;
set local row_security = off;

select o.email,
       o.id as demo_id,
       o.role as demo_role,
       n.id as libedge_id,
       n.role as libedge_role
  from users o
  join users n on n.email = o.email
 where o.tenant_id = '11111111-1111-1111-1111-111111111111'
   and n.tenant_id = '5799f2a5-3d90-41b1-90de-9da07d776052'
 order by o.email;

commit;

-- ---------------------------------------------------------------------------
-- STEP 2 — move the two seeded users. Rolls back unless exactly 2 land.
-- ---------------------------------------------------------------------------
-- The email list is explicit on purpose: `where tenant_id = …` alone would
-- carry any unexpected user along with it.

begin;
set local row_security = off;

-- Fail loudly and early if the move would collide. Without this the UPDATE
-- stops on a raw unique-violation, which is safe but tells the operator
-- nothing about which address is the problem.
create temp table _collide on commit drop as
select o.email, o.id as demo_id, n.id as libedge_id
  from users o
  join users n on n.email = o.email
 where o.tenant_id = '11111111-1111-1111-1111-111111111111'
   and n.tenant_id = '5799f2a5-3d90-41b1-90de-9da07d776052';

do $$
begin
  if exists (select 1 from _collide) then
    raise exception 'ABORT: % address(es) already exist under the LibEdge tenant: %',
      (select count(*) from _collide),
      (select string_agg(email, ', ') from _collide);
  end if;
end
$$;

-- Capture exactly the rows this UPDATE touches, so the check below measures
-- this run rather than "is the end state plausible". A re-run touches 0 rows
-- and must say so instead of passing as if it had done the work.
create temp table _moved on commit drop as
select id, email
  from users
 where tenant_id = '11111111-1111-1111-1111-111111111111'
   and email in ('librarian@example.edu.tr', 'reader@example.edu.tr')
   for update;

update users u
   set tenant_id = '5799f2a5-3d90-41b1-90de-9da07d776052'
  from _moved m
 where m.id = u.id;

-- Carry the sessions too. A row pinned to the old tenant would keep failing
-- the user_sessions policy after its owner moved.
update user_sessions s
   set tenant_id = '5799f2a5-3d90-41b1-90de-9da07d776052'
  from _moved m
 where m.id = s.user_id;

do $$
declare
  touched int;
  in_new int;
  in_old int;
begin
  select count(*) into touched from _moved;

  if touched = 0 then
    raise notice 'nothing moved in this run - the demo users already live in the LibEdge tenant';
    return;
  end if;

  if touched <> 2 then
    raise exception 'expected to move 2 users, matched % - rolling back', touched;
  end if;

  select count(*) into in_new
    from users
   where tenant_id = '5799f2a5-3d90-41b1-90de-9da07d776052'
     and email in ('librarian@example.edu.tr', 'reader@example.edu.tr');

  if in_new <> 2 then
    raise exception 'expected 2 users in the LibEdge tenant, found % - rolling back', in_new;
  end if;

  select count(*) into in_old
    from users
   where tenant_id = '11111111-1111-1111-1111-111111111111'
     and email in ('librarian@example.edu.tr', 'reader@example.edu.tr');

  if in_old <> 0 then
    raise exception '% user(s) left behind in the Demo tenant - rolling back', in_old;
  end if;
end
$$;

commit;

-- ---------------------------------------------------------------------------
-- STEP 3 — verify what the librarians will actually see
-- ---------------------------------------------------------------------------
-- The check that matters. Moving the row is bookkeeping; if the catalog still
-- resolves to nothing the user reports "empty library" again, for a new reason.

begin;
set local row_security = off;

select u.email,
       u.role,
       u.tenant_id,
       case when u.password_hash is null then 'sso-only' else 'password' end as login
  from users u
 where u.email in ('librarian@example.edu.tr', 'reader@example.edu.tr');

commit;

-- ---------------------------------------------------------------------------
-- STEP 4 — what the Demo tenant still owns
-- ---------------------------------------------------------------------------
-- Any table listed below still holds rows for the old tenant. Grants pointing
-- at the Demo tenant will not surface for the moved users, so a non-empty
-- result means the move looks right in `users` but is incomplete from the
-- user's point of view.
--
-- Generic on purpose: it inspects every base table carrying a tenant_id
-- column instead of hard-coding a table list that would rot.

create or replace function pg_temp.report_tenant_orphans(target uuid)
returns table (tbl text, rows_left bigint)
language plpgsql as $$
declare
  r record;
  n bigint;
begin
  for r in
    select c.table_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema
       and t.table_name = c.table_name
     where c.table_schema = 'public'
       and c.column_name = 'tenant_id'
       and t.table_type = 'BASE TABLE'
     order by c.table_name
  loop
    execute format('select count(*) from public.%I where tenant_id = $1', r.table_name)
       into n
      using target;
    if n > 0 then
      tbl := r.table_name;
      rows_left := n;
      return next;
    end if;
  end loop;
end
$$;

begin;
set local row_security = off;
select * from pg_temp.report_tenant_orphans('11111111-1111-1111-1111-111111111111');
commit;

