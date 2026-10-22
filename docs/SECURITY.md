# Security notes — 2026-10-23

Five findings were reported against v100. All five were confirmed and fixed.

## 1. Public uploads / seed files

`serveStatic` previously resolved any path under `public/`, so `/uploads/...` and `/seed/sample.pdf` were readable without login.

**Fix:** static serving is now an explicit allowlist (`index.html`, app modules, CSS, SW, manifest, `/icons/`, `/vendor/`); everything else is 404. Book files are only served through `/api/books/:id/file` and `/download`, which enforce session + grants.

## 2. URIError killed the process

`new URL` / `decodeURIComponent` ran outside the request `try`, so `/%E0%A4%A` threw `URIError` and terminated Node.

**Fix:** parsing is wrapped; malformed URLs return **400** and the server stays alive. Verified: `/%E0%A4%A` → 400, next `/api/health` → 200.

## 3. Grant lookup failed open

`activeGrants` caught DB errors and returned `[]`; `grantAllows` treats an empty grant list as unrestricted, so a DB error exposed the whole catalog.

**Fix:** lookup errors now throw; callers return 500. An **empty but successful** result still means unrestricted by product design. Do not weaken this without changing the “no grants = open catalog” rule.

## 4. Publisher role

`canManage` included `publisher`, which gave grant management and edit/delete of any title. There was no content ownership.

**Fix:**

- `canManageAccess` = admin/librarian only: grants, groups, collections, usage CSV, audit.
- Publishers may upload.
- `canEditBook` allows publishers only when `book.metadata.uploaded_by === auth.userId`; admin/librarian can edit all.
- New uploads store `uploaded_by`.
- Existing publisher uploads created before this fix have no owner and are therefore not editable by publishers.

## 5. Tenant seat race

The advisory lock was per user, so two different users could both pass the tenant seat count.

**Fix:** every login takes a **tenant advisory lock first**, then the per-user lock, before counting sessions and inserting. This serializes tenant seat checks.

Trade-off: logins for one tenant serialize for the duration of the count/insert transaction; acceptable at current scale.

## Verification

- `node --check` on server/app.
- `/uploads/test.pdf` → 404, `/seed/sample.pdf` → 404, `/` → 200.
- malformed URL → 400, server still healthy.
- login/books/grants/OPDS smoke → 200.
- DB-mode integration and concurrent login test still need to run against Postgres.
