# DRM and content-protection plan

**Positioning:** social DRM + access control, not publisher-grade DRM. Do not
market AES-in-browser as unbreakable.

## Already present

- Session + grants + `allow_copy` / `allow_download` / `allow_print`.
- Visible PDF watermark and visible per-user EPUB XHTML watermark.
- Download audit events and usage reporting.
- OPDS/OAI/SUSHI endpoints with environment-gated tokens.

## P0 — Social DRM MVP (v118 remediation; independent review pending)

Goal: traceable, authorized full-file downloads for institutional use.

1. **Forced watermark for the app's Download and Offline ↓ actions**
   - B2B mode cannot use `watermark=false`; admin override only.
   - PDF and EPUB stamps include user, tenant and date.
2. **Short-lived, database-backed download tickets**
   - `POST /api/books/:id/download-ticket` → 256-bit random token, 60-second TTL;
     only its SHA-256 hash is stored, bound to user/tenant/asset/work.
   - `POST /api/books/:id/download` consumes `{ticket}` atomically; no token URL.
   - Do not expose raw upload paths; current `/file` keeps session/range
     behavior for the reader.
3. **Copy policy parity**
   - Implemented in v116 (`1540136`): PDF and EPUB iframe copy/cut policy,
     visible copy and copy-with-citation buttons; 24 unit checks and 13 author-run
     Edge acceptance checks. See [COPYING-TESTS.md](COPYING-TESTS.md).
   - Text selection remains available for notes/highlights when copying is
     denied. Do not disable selection or all context menus as a blanket policy.
   - These UI controls do not prevent extraction through browser developer tools.
4. **Audit**
   - Record download ticket issue/consume/deny and watermark bypass/override.
5. **Tests**
   - Expired/reused token, wrong user, grant revoked, watermark true/false,
     copy policy in PDF and EPUB.

P0 implementation/review contract: [SOCIAL-DRM.md](SOCIAL-DRM.md). B2B full
downloads carry a traceable stamp unless an explicitly audited administrator
exception is used. Reader file links retain session/grant checks. Copy controls
remain UI policy, not protection against deliberate extraction. P0 source does
not deploy or migrate production automatically.

**Product boundary:** `/file` and `/book.epub` still return original reader bytes.
An authorized reader can save them. No claim that all copies/downloads are
traceable is supported. v118 offline saves use the ticketed path; legacy cached
copies cannot be retroactively stamped. PDF stamps have no opaque backdrop.
Shared per-user request limits and automatic ticket cleanup are included in v118.

## P1 — Encryption at rest (3–4 weeks total)

Goal: protect stored files and backups from disk/volume leaks.

- AES-GCM at rest with a key from env/KMS; keys never reach the browser.
- Server decrypts after auth, then streams; full-file decrypt is the simple
  first version (memory/latency cost for large PDFs).
- Migration/backfill of existing uploads; key rotation runbook.
- Backups must not contain plaintext; restore must re-wrap keys.
- Performance test on the 2,000-page fixture and a 100–300 MB scanned PDF.

This does **not** stop screenshots, DevTools, or a determined user with a
decrypted stream. It raises the cost of storage leaks.

## P2 — Conditional / publisher demand

- **Chunked range decryption** so PDF.js range requests work with encrypted
  files: +2–3 weeks, only if large encrypted PDFs are required.
- **Encrypted offline cache**: device/short-TTL wrapped blobs; otherwise the
  offline library is a DRM hole.
- **Readium LCP**: 6–10 weeks + vendor/licensing; only when a publisher contract
  requires a recognized DRM.
- Adobe DRM: out of scope.

## Explicit non-goals

- Browser-side AES with keys in JavaScript.
- Preventing screenshots/photos.
- Claiming “DRM” in contracts without a named scheme (social DRM vs LCP).
- Encrypting the live PDF range path before the full-file decrypt version is
  proven.

## Decision log

- 2026-10-23: adopt P0 first; P1 only on a real B2B requirement; LCP only on a
  publisher mandate.
