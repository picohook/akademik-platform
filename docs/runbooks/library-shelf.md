# Library shelf (Phase A)

The catalogue has Turkish title/author sorting, newest-publication sorting (added
date as the fallback), personal favourites, and language/publisher/year facets.
The default order keeps search relevance and otherwise uses the catalogue's added
order. Explicit sort choices are stored per account; unavailable localStorage
never prevents the catalogue from loading.

`public/library.mjs`, `public/library-model.mjs` and `public/library.css` own the
catalogue controls. `library-api.mjs` owns its personal-data endpoints. Reader
engines, text layers and toolbars are unchanged.

## Data and access

Migration **031-book-favorites.sql** creates `book_favorites`, keyed by user/work,
with tenant, user and work deletion cascades. FORCE RLS requires both the session
user and tenant. The API binds `app.user_id` transaction-locally on the existing
tenant-bound connection. It exposes:

- `GET /api/favorites`: this user's accessible favourite work IDs.
- `PUT /api/favorites/:workId`: idempotent add, after `canAccessBook`.
- `DELETE /api/favorites/:workId`: idempotent removal, including after access ends.
- `GET /api/library/progress`: this user's accessible asset progress, most recent
  first. No anchors are returned by this listing endpoint.

All routes use the existing authentication and mutation CSRF gates. Favourites
and progress are filtered against current catalogue access every time they are
listed. Progress remains asset-specific; the shelf shows the most recently read
asset for each of the last four distinct works. Its buttons use the existing
reader path, which retrieves the stored PDF/EPUB location.

Catalogue/search responses include the added date. Both accept an optional
`sort=title-asc|title-desc|newest|author-asc`. Search also matches author metadata,
publisher and publication year using the existing per-work Turkish/English FTS
configuration. Combined queries can span the original and new fields. Original
matches retain their previous ranking ahead of metadata-only matches; numeric
year queries do not use the new metadata fuzzy match.

## Verification

Run from the repository root after installing `spike/app` dependencies. PostgreSQL
tests need local Docker; browser tests need Playwright/Chromium (or the existing
`PLAYWRIGHT_MODULE` override). Each DB test owns a disposable local container and
random test credentials. No production database is used.

```text
node db/031.test.mjs
node spike/app/test/library.integration.mjs
node spike/app/test/library-ui.browser.mjs
```

- Migration: applies twice; tests the real app role, cross-user and cross-tenant
  read/insert/delete isolation, tenant mismatch, uniqueness and all three cascades.
- API: real server and PostgreSQL; authentication, CSRF on both mutations,
  idempotence, private favourites/progress, denied and revoked access, sorting,
  author/publisher/year and mixed-field searches, both stemmers, fuzzy matching,
  and title ranking ahead of metadata-only matches.
- Chromium: all sorts, persisted and account-specific preference, selected-language
  variant sorting, keyboard star toggle and retained focus, CSRF payload, failed
  saves, catalogue/shelf star consistency, combined favourites/search/sort,
  continue-reading order, progress bars (including zero), subject and metadata
  facets, live count, English without translating book content, disabled storage,
  and 390px layout with collapsed and expanded filters.

Security mutation evidence: temporarily removing `canAccessBook` from the local
PUT guard made the API suite fail at `inaccessible book cannot be favourited`
(`200 !== 404`). The guard was restored in `finally`; the restored suite passed.

Existing AI selection/settings/HTTP, login and admin Chromium, tenant-access,
SSO unit/callback/HTTP, migration-runner, asset-version, search and security-header
suites also passed during development.

Not verified: manual NVDA/VoiceOver announcements, Safari/Firefox, physical phones,
full real PDF/EPUB resume from the shelf, or performance/relevance on a large
catalogue. Browser endpoint fixtures and real DB/API tests are separate layers.

## Release and rollback

This change does not deploy anything. The release owner must apply migration 031
through `db/migrate.mjs` before starting this application version. The new shell
files are listed in the service worker; its CACHE value is deliberately unchanged
so the release owner can bump it once at release time.

To roll back the application, revert this change and retain the additive 031 table
and its data. The previous application does not use it. Dropping the table would
destroy favourites and is unnecessary for an application rollback. Never edit
migrations 001–030 or delete the migration registry entry during rollback.
