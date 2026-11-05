# Public LibRead product page

Anonymous visitors see a bilingual product introduction, three feature descriptions and the existing LibEdge sign-in action at /. Catalog and reader APIs retain their existing authorization. Signed-in users continue to the existing application. Administrator sign-in stays folded; no server or database changes.

Contract: docs/contracts/libedge-elibrary-v1.md, commit b15f8b5.

Validation: real Chromium login UI test passes 24 checks, including desktop/mobile product rendering, English copy, SSO target, failed administrator login, successful librarian login and reader controls. Removing the product introduction makes the new visibility assertion fail, confirming the negative control. The broad node --test test/*.test.mjs command has existing variant-controls harness failures (createLibrary is not defined), reproduced against both origin/main and this branch; it is not claimed green.

Deployment preparation: Oracle was inspected read-only on 2026-11-05. The live web container is libedge-oracle-v136-web, image libedge-oracle-v155:b12a6e4-arm64, bound to 127.0.0.1:3001 and :3004. The historical v137 image in the November 1 runbook is no longer current. Preserve the running environment files, mounts, tunnel and DB network. Re-inspect build metadata before release, take the required backup, and record measured release/rollback values. PR #93 was merged with explicit owner authorization and deployed as v156. See docs/deployments/2026-11-05-public-product-page.md for measured release and rollback details.
