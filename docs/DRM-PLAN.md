# DRM and content-protection plan

**Positioning:** social DRM + access control, not publisher-grade DRM. Do not
market AES-in-browser as unbreakable.

## Already present

- Session + grants + `allow_copy` / `allow_download` / `allow_print`.
- Visible PDF watermark and visible per-user EPUB XHTML watermark.
- Download audit events and usage reporting.
- OPDS/OAI/SUSHI endpoints with environment-gated tokens.

## P0 — Social DRM MVP (5–8 working days)

Goal: safe enough for a first B2B library contract.

1. **Forced watermark for downloads**
   - B2B mode cannot use `watermark=false`; admin override only.
   - PDF and EPUB stamps include user, tenant and date.
2. **Short-lived signed download URL**
   - `POST /api/books/:id/download-ticket` → one-time token, short TTL.
   - `/download?ticket=...` validates, consumes, then streams.
   - Do not expose raw upload paths; current `/file` keeps session/range
     behavior for the reader.
3. **Copy policy parity**
   - EPUB iframe copy/cut/context-menu blocked when `allow_copy=false`.
   - PDF already blocks copy/cut; add context-menu/selection handling.
   - Visible copy button and “copy with citation” can follow separately.
4. **Audit**
   - Record download ticket issue/consume, denied copy, denied print.
5. **Tests**
   - Expired/reused token, wrong user, grant revoked, watermark true/false,
     copy policy in PDF and EPUB.

Acceptance: every download has a traceable stamp; raw direct file links do not
work without a session/grant; copy policy cannot be bypassed with the in-app UI.

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
