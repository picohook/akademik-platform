# Database

- `schema.sql` — tables, indexes, RLS policies, and the scaffold app role.
- `seed.sql` — one demo tenant, user, work, asset, collection, and grant.
- `migrations/` — incremental migrations for an existing volume (not re-run on init).

## Applying a migration

Migrations are applied by `db/migrate.mjs`, which records what ran in
`schema_migrations`. Do not paste `psql -f` commands by hand: before this
runner existed there was no record of which files had been applied, and the
only way to answer that was to inspect the data a migration changed.

```bash
# what is applied, pending, or edited after being applied
DATABASE_ADMIN_URL=postgres://owner:...@host/db node db/migrate.mjs --status

# apply everything pending, in filename order, one transaction per file
DATABASE_ADMIN_URL=... node db/migrate.mjs

# show what would run, change nothing
DATABASE_ADMIN_URL=... node db/migrate.mjs --dry-run
```

`DATABASE_ADMIN_URL` must be a role that can run DDL. The app role
(`akademik_app`) deliberately cannot, and the runner needs the table owner to
create the registry on first use.

Each file runs inside one transaction together with its `schema_migrations`
row, so a failing migration leaves neither partial SQL nor a false record. An
applied file whose content later changed is reported as `MODIFIED` and stops
the run; `--allow-modified` overrides that deliberately.

### The one-time baseline (001-017)

Migrations 001-017 were applied by hand before the runner existed, so no
registry rows exist for them. On a database that already has data, mark them
once:

```bash
DATABASE_ADMIN_URL=... node db/migrate.mjs --baseline
```

This writes rows only; it runs no SQL, so it asserts the files *should* be
applied without proving it. Verify against the database before trusting it -
for 017, that means `select count(*) from users where tenant_id = '11111111-...'`
returning 0. After the baseline, `--status` is the authoritative answer.

018 and later are applied by the runner only. There is no 018 file that creates
`schema_migrations`: a migration that creates the table which records
migrations cannot itself be recorded.

Demo login: `reader@example.edu.tr` (reader) or `librarian@example.edu.tr` (upload/edit) / `demo1234`.

> Note: as of migration 017 the two demo users are removed from the Demo
> tenant. `db/seed.sql` still creates them for a fresh local volume, so this
> line applies to a newly seeded database only.

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
