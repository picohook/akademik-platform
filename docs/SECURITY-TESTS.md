# PostgreSQL security integration tests

v117 adapts full-download checks to POST ticket issuance/consumption, verifies
legacy GET rejection, and retains the publisher/grant/concurrency scenarios:
**68 HTTP/DB checks passed**. The separate social-DRM suite adds **189 checks**,
including actual PDF/EPUB stamps, single-use races, audit rollback, expiry while
waiting for a lock and migration 013. See [SOCIAL-DRM.md](SOCIAL-DRM.md) for the
contract and permanent evidence. Production was not changed by these tests.

Requires Node.js 22+, installed `spike/app` dependencies, and Docker Desktop
running Linux containers. The runner uses `postgres:16-alpine` (Docker downloads
the image if it is not already available).

```powershell
cd spike/app
npm run test:security
```

The runner always creates a new, randomly named PostgreSQL container. It does
not read `.env`, accept an external database URL, use Compose, or connect to an
existing database. PostgreSQL data lives in a temporary in-memory filesystem;
the published database port binds to `127.0.0.1` only.

The current `db/schema.sql` and `db/seed.sql` initialize this database. Two real
Node servers run copies of the application under `spike/app/tmp/security-*`,
using the non-superuser `akademik_app` role. Test PDFs, OCR fixtures, uploads,
passwords, users, grants, and sessions belong only to this temporary setup.
The runner stops both servers, removes its labeled container, and deletes its
temporary directory on success or failure. Existing application files and
running development/production services are left alone.

## Scenarios

1. **Publisher authorization:** two publisher accounts upload actual generated
   PDFs through the API. Ownership must persist in PostgreSQL. A publisher can
   edit/delete its own upload, while edit/delete of the other publisher's book
   and an older book without an owner must return 403. Grant/group/audit and
   other management requests must also return 403. Database records and file
   existence verify that denied operations have no effect.
2. **Grant lookup SQL failure:** a reader first sees a restricted catalog and
   can read its allowed book. The database administrator temporarily revokes
   `SELECT` on `grants` from the app role. The session must still work, while
   catalog, search, book files, download, OCR, and OPDS return 500 without
   exposing hidden content. Restoring the permission must restore access and
   preserve the original catalog restriction.
3. **Concurrent sessions:** eight different users log in across two server
   processes with a tenant cap of two. A separate PostgreSQL transaction holds
   the tenant advisory lock until at least two app connections are observed
   waiting on it; no session may be inserted before release. After release,
   exactly two logins must succeed, six must return the tenant-limit error,
   and PostgreSQL must contain exactly two sessions. This runs for three waves.
   Four concurrent logins for a single user additionally verify the per-user
   cap of one.

These are API and database integration tests. They do not automate the browser
UI or replace deployment checks, load testing, or a full security assessment.

## Verified run — 2026-10-23

All three scenarios passed with PostgreSQL 16 and two Node.js 22 processes:
60 counted HTTP/database checks, plus response, ownership, and file assertions.
Each of the three concurrent-login waves accepted exactly two of eight requests
and left exactly two database sessions. The four same-user attempts produced
one accepted login and three user-limit errors. The container and temporary
files were removed after the run. The existing 8 citation and 7 search unit
tests also passed.
