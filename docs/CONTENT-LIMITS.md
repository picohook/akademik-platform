# Content limits and performance tiers

## Supported interactive envelope

| Format | Hard upload cap | Tested / target | Notes |
|---|---:|---|---|
| PDF (text) | 300 MB | 2,000 pages, 0.7 MB | <2 s first page on 20 Mbps |
| PDF (scanned/image) | 300 MB | **not accepted at 500 MB** | image decode/canvas is the bottleneck |
| EPUB | 300 MB | sample + Green Organizations | fixed-layout not audited |
| Page count | — | 2,000 pages tested | scroll DOM is lazy; no hard cap |

- `server.mjs` rejects uploads over **300 MB** with `file too large`.
- `MAX_INDEX_BYTES` is 300 MB; larger files would not be page-indexed anyway.
- Above the envelope: batch/offline ingest, or add a preview/derivative pipeline only when a real publisher contract requires it.

## Performance SLO

| Tier | File profile | First page | Page turn p95 | Heap |
|---|---|---:|---:|---:|
| A | ≤50 MB text PDF | **<2 s** | <300 ms | <500 MB |
| B | 50–150 MB scanned | <4 s | <500 ms | <500 MB |
| C | 150–300 MB scanned | best effort, warning in UI | <1 s | <500 MB |
| Out | >300 MB | not supported interactively | — | — |

The 500 MB synthetic fixture (`tmp/large-500mb.pdf`) is a **lab stress test**, not an acceptance gate. Its 7.4 s first page comes from 1600×2200 noisy JPEG decode + canvas, not network.

## Why not build a preview pipeline now

A server-side preview/derivative pipeline (Ghostscript/pdftoppm + cached WebP) is the correct fix for 500 MB image-only books, but it adds a renderer, storage, cache invalidation and security work. Current content plan stays inside 300 MB, so it is deferred until a real file demands it.
