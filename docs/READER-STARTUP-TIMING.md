# Reader startup timing

The pilot reports roughly 9.4–9.6 s for initial rendering on both physical page 1 and saved page 264 of Discrete Mathematics. Direct R2 reads for the same first 256 KiB complete in 150–220 ms; isolated authenticated browser reads complete in 1.06–1.34 s. These measurements do not yet explain the 3–4 s initial range wait under PDF.js.

This change measures rather than tunes the loader again. Authorized reader responses include numeric Server-Timing stages:
- app: server request handler start through authorization, book lookup, access check and any view usage logging, before storage.open.
- storage: storage.open through upstream response headers, excluding body transfer.

window.__readerPerf() additionally reports beforePdfMs, labelsMs and the last 20 completed Resource Timing entries for the current book and current opening, with request TTFB, body-transfer duration and the two server stages. TTFB includes network transit and should not be read as server processing alone. Failed/aborted timings may be incomplete, missing values are null, and entries still in flight are absent. Diagnostics contain no cookies, credentials, object keys or signed URLs. Existing book title remains in the report.

Interpret the initial request's app/storage durations alongside ttfbMs: low server durations with high TTFB point outside the measured handler stages (such as transit/tunnel or work before Node receives the request); high app or storage identifies the corresponding stage. labelsMs separates page-label preparation from rendering. These are per-run measurements, not a performance guarantee.

Validation: node --test spike/app/test/reader-timing.test.mjs and syntax checks for app.js, server.mjs and storage.mjs. Real AWS measurements still required. No access, caching, range sizing or content-storage behavior changes.
