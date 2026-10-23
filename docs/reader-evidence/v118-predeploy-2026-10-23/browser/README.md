# v118 native browser acceptance — 2026-10-23

Final result: **8/8 PASS**, Edge 155.0.4283.45. All 15 source hashes still match; browser page errors: 0. Owned browser, Node app, temporary PostgreSQL container and copied app were cleaned (4/4).

Seven cases used default Edge: PDF and EPUB catalog offline buttons saved actual stamped POST response bytes to native IndexedDB (SHA-256 equal), ticket provenance was recorded without token persistence, SW v9 cached required dependencies, real HTTP 429 produced a wait toast without changing saved book IDs/hashes, and a network-offline hard reload reopened/rendered both PDF and EPUB with original text and identity stamps.

Authentication used real API login through the browser cookie jar, followed by actual UI card clicks. This run is not evidence for login-form UI behavior.

The eighth case used a separate Edge with `--disable-features=StaticStorageQuota`, the same isolated server, and native DevTools origin quota override. Both DevTools and `navigator.storage.estimate()` reflected the quota; the UI storage admission guard rejected the third save and preserved existing native IndexedDB IDs/hashes. No storage API, IndexedDB, request, or response was mocked. This is **controlled native quota admission**, not physical disk-full or a transaction QuotaExceededError claim.

Generated small PDF/reflowable EPUB only; scanned/large files are outside this harness. Both fixture asset metadata flags were `watermark=false`, while B2B policy was exercised through its secure default (environment setting absent).

`results.json` and `manifest.json` describe the final passing run. `failed-attempt/` retains earlier diagnostic runs and is not part of final acceptance. No production or development services or data were changed.
