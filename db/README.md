# Database

- `schema.sql` — tables, indexes, RLS policies, and the scaffold app role.
- `seed.sql` — one demo tenant, user, work, asset, collection, and grant.
- `migrations/` — incremental migrations for an existing volume (not re-run on init).

## Applying a migration to an existing volume

Docker only runs `schema.sql`/`seed.sql` when the volume is first created. For an existing database, apply migrations explicitly:

```bash
docker compose exec db psql -U akademik -d akademik -f /migrations/001-asset-pages.sql
docker compose exec db psql -U akademik -d akademik -f /migrations/002-users-password.sql
docker compose exec db psql -U akademik -d akademik -f /migrations/003-librarian-user.sql
docker compose exec db psql -U akademik -d akademik -f /migrations/004-session-version.sql
docker compose exec db psql -U akademik -d akademik -f /migrations/005-annotation-tags.sql
docker compose exec db psql -U akademik -d akademik -f /migrations/006-access-policies.sql
```

Demo login: `reader@example.edu.tr` (reader) or `librarian@example.edu.tr` (upload/edit) / `demo1234`.

Then build the per-page text index used by in-book search:

```bash
docker compose exec web node index-text.mjs --all
docker compose exec web node index-text.mjs --status
# or a single asset:
docker compose exec web node index-text.mjs --asset <asset-id>
```

New uploads are indexed in the background; `--all` covers books uploaded before the index existed. The indexer skips PDFs larger than 300 MB.

## Roles and RLS

The app must **not** connect as the table owner or a superuser; either bypasses RLS. `schema.sql` creates a `NOSUPERUSER` login role `akademik_app` and grants it DML on the public schema. `docker-compose.yml` connects the web service as that role.

`FORCE ROW LEVEL SECURITY` is set on tenant-scoped tables. The app sets `app.tenant_id` on every pooled connection before querying:

```sql
select set_config('app.tenant_id', $1, false);
```

The seed runs as the owner and sets the demo tenant before inserting, because FORCE RLS applies to the owner too.

## Scaffold credentials

`akademik_app` / `akademik_app_dev` are **local scaffold credentials** and are committed here on purpose so `docker compose up` works. Before any real deployment:

1. Rotate the password with `ALTER ROLE akademik_app PASSWORD '...'`.
2. Remove the hardcoded password from `schema.sql`; provision the role outside the schema or via a secret.
3. Keep the app role `NOSUPERUSER` and non-owner.
4. Add a separate migration role; do not let the app run DDL.

## Applying

Docker initializes a fresh volume with `schema.sql` then `seed.sql`. To apply manually:

```bash
psql "$DATABASE_URL" -f db/schema.sql
psql "$DATABASE_URL" -f db/seed.sql
```

`schema.sql` is not idempotent for policies and should be treated as an initial migration, not a re-runnable script.
