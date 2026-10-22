# Security notes — 2026-10-23

Five findings were reported against v100. All five were confirmed and fixed.

## 1. Public uploads / seed files

`serveStatic` previously resolved any path under `public/`, so `/uploads/...` and `/seed/sample.pdf` were readable without login.

**Fix:** static serving is now an explicit allowlist (`index.html`, app modules, CSS, SW, manifest, `/icons/`, `/vendor/`); everything else is 404. The allowlist is checked against the **resolved filesystem path**, not the raw URL, so `/vendor/..%2fuploads/...` and `/vendor/%2e%2e/uploads/...` are rejected. Book files are only served through `/api/books/:id/file` and `/download`, which enforce session + grants.

hOCR files are no longer static: `/ocr/<asset-uuid>/page-NNN.hocr` is a session+grant-checked route, preserving the OCR overlay without exposing the directory. `/opds` is also behind the session gate (it was previously reachable unauthenticated because the gate only covered `/api/`).

## 2. URIError killed the process

`new URL` / `decodeURIComponent` ran outside the request `try`, so `/%E0%A4%A` threw `URIError` and terminated Node.

**Fix:** parsing is wrapped; malformed URLs return **400** and the server stays alive. Verified: `/%E0%A4%A` → 400, next `/api/health` → 200.

## 3. Grant lookup failed open

`activeGrants` caught DB errors and returned `[]`; `grantAllows` treats an empty grant list as unrestricted, so a DB error exposed the whole catalog.

**Fix:** lookup errors now throw; callers return 500. An **empty but successful** result still means unrestricted by product design. Do not weaken this without changing the “no grants = open catalog” rule.

The PostgreSQL integration test also exposed an OPDS error path: sending 200
headers before awaiting the feed caused `ERR_HTTP_HEADERS_SENT` and terminated
Node when grant lookup failed. The feed is now prepared before sending headers,
so this failure returns 500 and leaves the server running.

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
- `/vendor/..%2fuploads/security-probe.txt` → 404; `/vendor/%2e%2e/uploads/security-probe.txt` → 404.
- `/ocr/<asset>/page-001.hocr` → 401 anonymous, 200 with session.
- `/opds` → 401 anonymous, 200 with session.
- malformed URL → 400, server still healthy.
- login/books/grants/OPDS smoke → 200.
- Automated PostgreSQL integration covers publisher upload/edit/delete ownership,
  restricted management endpoints, real grant SQL permission failures, and
  synchronized concurrent logins across two Node processes. Run
  `cd spike/app; npm run test:security`. See [SECURITY-TESTS.md](SECURITY-TESTS.md)
  for isolation, assertions, and requirements.
