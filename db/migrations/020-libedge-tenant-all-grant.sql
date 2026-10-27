-- 020 - give LibEdge's own tenant access to its whole catalogue
--
-- After 019 the only LibEdge grant is subject_type 'tenant', scope_type
-- 'collection', scope_id 74149e93-... ("LibEdge Open Academic Collection").
-- Under fail-closed access that hides the 13th work (Demo PDF, in the "Demo"
-- collection) and every newly uploaded work, for everyone including the admin,
-- because the upload path does not add works to any collection.
--
-- LibEdge's own staff must see the whole LibEdge catalogue. Institutions get
-- collection-scoped grants later; the existing collection grant is untouched.
--
-- Fixed id, so the file is idempotent; the audit row is written only when the
-- grant row is actually inserted. No begin/commit, no psql meta-commands: the
-- runner owns the transaction. `set local row_security = off` is the guard -
-- Postgres rejects it for akademik_app, so the app role fails loudly.

set local row_security = off;

with inserted as (
  insert into grants (id, tenant_id, subject_type, subject_id, scope_type, source, status, valid_from, valid_to)
  select '20202020-2020-4020-8020-202020202020',
         '5799f2a5-3d90-41b1-90de-9da07d776052',
         'tenant',
         '5799f2a5-3d90-41b1-90de-9da07d776052',
         'all',
         'manual',
         'active',
         now(),
         null
   where exists (select 1 from tenants where id = '5799f2a5-3d90-41b1-90de-9da07d776052')
  on conflict (id) do nothing
  returning id, tenant_id
)
insert into grant_audit (tenant_id, grant_id, action, actor_user_id, detail)
select tenant_id, id, 'create', null,
       '{"subjectType":"tenant","scopeType":"all","source":"migration 020"}'::jsonb
  from inserted;

-- Expected afterwards: two active tenant grants for 5799f2a5-..., one
-- 'collection' (74149e93-...) and one 'all' (20202020-...), valid_to null.
select id, subject_type, subject_id, scope_type, scope_id, status, valid_to
  from grants
 where tenant_id = '5799f2a5-3d90-41b1-90de-9da07d776052';