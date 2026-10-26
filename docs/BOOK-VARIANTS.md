# LibEdge reader: book variants

Implemented candidate; AWS deployment/browser acceptance is pending. No database migration, new R2 content, AI inference or paid service is introduced.

## Behavior

- The catalog groups authorized asset rows by the existing work UUID and renders one card per work, with a combined language/format/edition selector when alternatives exist.
- The reader has the same selector. Switching saves the current progress, closes the current renderer, clears the old physical page/EPUB CFI from the URL and opens the selected asset using that asset's own saved progress.
- Physical PDF pages, EPUB CFIs, annotations and bookmarks are not mapped across translations or editions.
- OA import metadata.asset_variants provides the per-file title and language. Edition year and edition text come from the edition row, with imported metadata as a fallback.
- PDF/EPUB selection is offered only when those files actually belong to the same work. This does not convert files or combine unrelated titles. The current imported Dive into Deep Learning pair offers Turkish and English PDFs; do not expect a PDF/EPUB pair to appear for every book.
- Asset-specific requests are used for PDF, EPUB, in-book search and ticketed downloads. The work ID remains canonical for grants, catalog records and download ticket work binding. Ticket consumption rechecks the selected asset, grants, download permission and watermark rules.
- Permalinks retain book=<work> and add asset=<asset>. Existing work-only and asset-ID links remain supported.
- New offline files use asset UUID keys, preserving both formats instead of replacing one work-keyed blob. Old work-keyed entries remain readable only if their saved asset matches. Legacy offline progress is reused only for that matching legacy entry. Old and new copies can coexist until manually removed.
- Search results retain the existing server-side matching/ranking and 50-row limit; catalog search still searches the canonical work metadata. No extra asset becomes visible by consulting the import metadata map.
- The existing catalog editor remains a work-level editor. After editing, the catalog reloads authorized rows instead of replacing every variant with one response row.
- The service-worker shell is v21; index.html loads app.js?v=127-variants1.

## Validation

15 new tests cover grouping, selected language/title, stale selections, asset-scoped links and offline storage, legacy fallback, selector behavior, switch ordering, offline misses and download asset/grant bindings. Existing download, cleanup, timing, range/storage, citation, search and watermark tests were also run: 83 tests in total passed after materializing missing runtime modules in the local audit checkout. The local HTTP regression additionally verifies authenticated asset-ID range delivery and unauthenticated denial. Syntax checks pass.

Tests use local HTTP/demo mode and mocked SQL for download-service contracts; real PostgreSQL multi-asset/R2 browser acceptance is still required. No GitHub Actions run is needed.

Local command:
node --test test/book-variants.test.mjs test/variant-controls.test.mjs test/downloads.test.mjs test/reader-timing.test.mjs test/download-maintenance.test.mjs test/storage.test.mjs test/storage-http.test.mjs test/search.test.mjs test/citations.test.mjs test/social-watermark.test.mjs

## AWS acceptance

Build a separate image tag and select it with the existing docker-compose.prod.yml + docker-compose.libedge.yml pair. Preserve the prior tag. Confirm app.js?v=127-variants1 in the served index.

With an existing authorized account, check: one card for the D2L work; TR/EN labels and publication years; switching opens the correct language file; each asset resumes its own progress and retains its own notes; a reload of an asset permalink returns to that asset; selected-asset offline save/download uses the existing ticket/watermark path. Check a PDF/EPUB pair only when such a pair exists. Nothing is deployed to the LibEdge website or Research Board by this reader change.

Persist the chosen LIBEDGE_IMAGE only after acceptance. The separate approved AI plan remains docs/LIBEDGE-READER-AI-PLAN.md; reviewed stored summaries and free-tier Q&A are not implemented here.
