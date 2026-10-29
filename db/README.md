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

### Rules a migration file must follow

The runner refuses a file rather than run it in a way that would desynchronise
the registry from the database. A refused file leaves nothing behind.

- **No transaction control of its own.** No `begin`, `commit`, `rollback`,
  `end`, `start transaction`, `savepoint`, `release savepoint`, and no psql
  `\begin`/`\commit`/`\rollback`. The file's `commit` would end the runner's
  transaction, so the registry row would land outside it: the changes committed
  and unrecorded, or recorded and rolled back. Let the runner open and close the
  transaction.
- **No psql meta-commands.** No `\set`, `\i`, `\echo` and so on: the runner
  sends the file to the server, and Postgres cannot parse a backslash command.
  Write the values out literally instead of parameterising them with `\set`.
- **Idempotent or guarded.** `--baseline` marks a file applied without running
  it, so a file that is later run by mistake, or run twice out of order, must
  not duplicate data. `create ... if not exists`, `on conflict do nothing`, and
  a `where` that matches only the broken shape all count.

013-017 break the first two rules and are therefore never executed by the
runner: they are baselined, and `--status` reports them as `cannot run`.

### Baseline

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

The runner refuses to apply anything when the registry is empty **and** a
`users` table exists. In that state every file looks pending, and applying them
is not re-running history: 003 would insert the `demo1234` librarian account
into a live database. An empty registry on a database with a schema means "not
baselined yet", never "fresh database"; a genuinely fresh database has no
`users` table and is unaffected.

### Running it on the EC2 host

The host has no `node` and no `spike/app/node_modules`, and the disk is tight,
so do not `npm install` on the host. Run the runner in a throwaway container
attached to the compose network, mounting the repo read-only and the app's
`node_modules` as an anonymous volume so `npm ci` never writes into the repo:

```bash
cd /home/ubuntu/akademik-platform      # the checkout that docker compose runs from
REPO=$PWD
NET=akademik-platform-prod_default

docker run --rm --network "$NET" \
  -v "$REPO":/repo:ro \
  -v /repo/spike/app/node_modules \
  -w /repo/spike/app \
  -e DATABASE_ADMIN_URL='postgres://akademik:PASSWORD@db:5432/akademik' \
  -e NODE_PATH=/repo/spike/app/node_modules \
  node:22-alpine \
  sh -c 'npm ci --omit=dev --no-audit --no-fund >/dev/null && node /repo/db/migrate.mjs --status'
```

Drop `:ro` and add `--user "$(id -u):$(id -g)"` if you would rather mount the
repo writable; the only thing that needs to be writable is the anonymous
`node_modules` volume. `db/` is not mounted into the app image, which is why the
runner has to run from the host checkout and not from `docker compose exec web`.

`DATABASE_ADMIN_URL` must use the table owner (`POSTGRES_USER` from `.env`),
never `DATABASE_URL`: the app role cannot create the registry and the runner
refuses to start as it.

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

## Migrations 021 and 022, and the `akademik_catalog` credential

`db/migrations/021-*.sql` and `022-*.sql` run through `node db/migrate.mjs`, in that order, from the deployment environment. Both are schema only; no work is moved to the global catalogue until 023.

022 creates the `akademik_catalog` role as **NOLOGIN** on purpose: a password in a migration is a password in git forever. The login is provisioned after the migration, from the deployment secret, and is a separate step:

```sql
alter role akademik_catalog login password '<from secret>';
```

The bridge's catalog path must connect as this role, with its own connection pool, and not as `akademik_app`. What it may do is decided by grants and policies, not by the application:

- write global rows (`tenant_id IS NULL`) on `works`, `editions`, `assets`, `asset_pages`, `collections`, `collection_items`;
- update metadata columns only - `tenant_id` is deliberately not in any UPDATE grant, so the catalog path cannot hand a global row to a tenant;
- publish a staff tenant's work with `catalog_publish_work(work_id)`;
- withdraw or restore a global work with `catalog_set_withdrawn(work_id, boolean, reason)`.

It cannot write a tenant row directly, cannot read or modify another tenant's `collection_items`, and cannot withdraw a staff tenant's title. If the role is recreated, both functions and every grant in 022 must be re-applied; re-running the file is safe.

Verification after a deploy, expected `relrowsecurity = t` and `relforcerowsecurity = t`:

```sql
select relname, relrowsecurity, relforcerowsecurity from pg_class where relname = 'collection_items';
```

## Migration 025, and the bridge's two `tenants` functions

`025-libedge-tenant-provisioning.sql` exists because `tenants` is FORCE ROW LEVEL SECURITY
for the owner too and `tenants_self` has no `with check`, so **no principal can INSERT a
tenant**. Measured on the shipped schema, `akademik_app` gets

```
42501  new row violates row-level security policy for table "tenants"
```

on the create path while the update path works. Widening a grant does not help - a policy
cannot be satisfied by a caller that does not yet know the id it is inserting. So 025 adds
two narrow `SECURITY DEFINER` functions, in the shape 018 and 024 already established:

- `app.libedge_tenant_by_ref(kind, ref)` resolves a LibEdge context to a tenant id **before**
  any tenant is bound. Without it, `select id from tenants` as `akademik_app` returns **zero
  rows** on a database with four tenants in it - the same trap 024 documents for the timers,
  on the request side. Returns id, status and the two context columns only, and needs a
  `(kind, ref)` pair the caller must already know, so it cannot enumerate tenants.
- `app.libedge_upsert_tenant(kind, ref, name, slug, status)` creates or updates an
  institution tenant. Its limits, each asserted in `spike/app/test/libedge-bridge.integration.mjs`:

  | refused | because |
  | --- | --- |
  | any `kind` but `institution` | the staff and individual tenants are deployment facts, not per-request |
  | rewriting `id` or `slug` on an existing `(kind, ref)` | a reader's bookmark and a stored session point at them |
  | a slug already held by another tenant | reported as `409 TENANT_SLUG_TAKEN`, checked under a lock so a race cannot become a 500 |
  | an unknown `status` | the column's domain is the only source of truth for it |

  It touches `tenants` and nothing else: no users, no memberships, no grants.

EXECUTE is `akademik_app` only on both, `PUBLIC` is revoked, `search_path` is pinned to
`public, pg_temp`, and a direct `INSERT` by the app role is still refused - the functions are
the one path, not a door left open beside one. Integration coverage: 61 checks against its
own `postgres:16-alpine`, applying `schema.sql` then 021, 022, 024 and 025.

Files applied by `db/migrate.mjs` must not contain begin/commit and must not use psql
meta-commands. The body terminator is `$body$`, not a bare dollar pair, for the reason 022
documents: a line consisting of the bare terminator would end the runner's own transaction.

## Migration 024, and `app.maintenance_tenants()`

`024-maintenance-tenants.sql` depends on nothing: it creates the `app` schema, one
function, and the grant on it. **It is not part of 023.** 023 moves works to the
global catalogue and waits on the approved list in contract §4.4; 024 exists
because the timers need it and is independent of that decision.

The two timers - download ticket sweep, annotation receipt retention - run outside
any request, so no tenant is bound. `select id from tenants` is not an answer:
`tenants_self` is `using (id = current_setting('app.tenant_id', true)::uuid)`, so
the app role sees **one** row - the tenant that pooled connection last bound, or
none at all. A sweeper written that way looks correct and covers one institution.

So the list comes from `app.maintenance_tenants()`: `SECURITY DEFINER`, `search_path`
pinned, returning **ids only**, executable by `akademik_app` alone. `tenants` is
FORCEd for the owner too, hence the `set local row_security = off` in the file - the
owner may do that, `akademik_app` may not.

Measured by `node db/024.test.mjs` (17 checks, its own postgres): with no tenant
bound the app role gets the same list as the owner, a tenant inserted afterwards
appears, and neither `akademik_catalog` nor a definer-less function would pass.

Until 024 is applied, `spike/app/server.mjs` falls back to the env tenant and logs
a warning on every tick. That fallback has to catch `3F000` (`app` schema missing),
not just `42883` - Postgres resolves the schema before the function, so the code a
missing migration actually produces is `invalid_schema_name`. `42883` is the other
half: a schema that exists with no function in it. Both were measured; the first is
what a database without 024 gives you today.
