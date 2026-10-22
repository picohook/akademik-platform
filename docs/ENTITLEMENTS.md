# Entitlements and seat limits

Migration `010-grant-scope-key.sql` adds `grants.scope_key` for publisher/subject names. The `grants` table already existed in `schema.sql`.

## Behaviour

- **No active grant** for the tenant/user → all tenant books remain visible (backward compatible).
- **At least one active grant** → a book is visible only when it matches one grant:
  - `all` — everything
  - `publisher` — `scope_key` equals `editions.publisher` (case-insensitive)
  - `subject` — `scope_key` equals one of `works.subjects`
  - `title` — `scope_id` equals `works.id`
  - `collection` — `scope_id` equals a collection containing the work
- Direct `/file`, `/book.epub`, `/search` and `/download` requests run the same check and return `403`.
- `listBooks` filters the catalog.
- **Erişim** modal (librarian/admin) creates and revokes grants; the form supports tenant/user subject, all/publisher/subject/collection/title scope and seat limit.

## Seat limit

- A grant may set `seat_limit` (positive integer).
- Login counts active `user_sessions` for the tenant (7-day window); if the **smallest** matching grant seat limit is reached, login returns `429` with `tenant seat limit reached`.
- `users.max_sessions` still applies per user; the effective limit is the smaller of the two.
- Same-browser tabs share one session; separate profiles/devices are separate sessions.

## SQL examples

Publisher subscription for a whole tenant:

```sql
insert into grants
  (tenant_id, subject_type, subject_id, scope_type, scope_key,
   source, status, valid_from, seat_limit)
values
  ('11111111-1111-1111-1111-111111111111', 'tenant',
   '11111111-1111-1111-1111-111111111111', 'publisher', 'Wiley',
   'subscription', 'active', now(), 25);
```

Single title:

```sql
insert into grants
  (tenant_id, subject_type, subject_id, scope_type, scope_id, source, status)
values
  ('11111111-1111-1111-1111-111111111111', 'tenant',
   '11111111-1111-1111-1111-111111111111', 'title',
   'f2192891-c31a-4e55-9f20-9c1452d6e685', 'purchase', 'active');
```

Revoke:

```sql
update grants set status = 'revoked' where id = '<grant-id>';
```

Inspect active grants:

```sql
select subject_type, subject_id, scope_type, scope_key, scope_id, seat_limit, valid_to
  from grants
 where status = 'active' and (valid_to is null or valid_to > now())
 order by created_at desc;
```

## Not implemented yet

- Group subjects.
- Granting a collection from a picker (the form takes a UUID).
- COUNTER-style usage reports.
- Per-grant audit log.
- Seat usage dashboard.
