# 2026-11-05 — LibRead public product page (v156)

The public Turkish/English product page from PR #93 is deployed. Anonymous visitors can read the introduction and access explanation; catalog and reader usage still requires sign-in. No server.mjs or database migration changed.

## Measured release

| Item | Value |
| --- | --- |
| Public origin | https://elibrary.libedge.com/ |
| Host | ubuntu@92.5.157.233 (ARM64) |
| Web container | libedge-oracle-v136-web |
| New image | libedge-oracle-v156:public-1f051ee-arm64 |
| Image ID | sha256:5d37eb1865b6bb734ce4e1e393c47fabf8b8e7629b279fa0582c3b51ab238376 |
| Application version | 156 |
| Build identity | b12a6e4-public-1f051ee |
| Runtime base | libedge-oracle-v155:b12a6e4-arm64 |
| Public-page source | 1f051ee2191e111603eba1a797228d4d5324b460 (merged PR #93) |
| Release directory | /home/ubuntu/libread-public-1f051ee-20261105 |
| Previous container retained | libedge-oracle-v136-web-before-public-1f051ee |
| Health | HTTP 200 on 127.0.0.1:3001/api/health |
| Product markup | productTitle verified in the served root document |
| Config | version 156, buildSha b12a6e4-public-1f051ee |

The November 1 v137 record is historical. Before this release, the live image was measured as v155. SHA-256 checks confirmed that all five public files matched the PR base exactly. The image layers only index.html, app.js, styles.css, i18n.mjs and sw.js onto that running v155 base. Other server code and dependencies are retained; the composite build identity records this explicitly.

## Backup and preserved configuration

The existing libread-backup.service completed successfully before cutover (Result=success, ExecMainStatus=0). The old container remains stopped for rollback.

The new container preserves the current running environment, excluding only APP_VERSION, BUILD_SHA and BUILD_DATE. Memory/CPU/security settings, restart policy, network and port bindings were compared and unchanged. Bind sources, destinations, read/write flags and propagation were compared by destination and preserved: uploads and ocr RW, seed RO, backups RW. Docker may display these mounts in a different order or Mode representation.

Ports remain 127.0.0.1:3001 and :3004 to container port 3000. Network remains libedge-oracle-v136. The production tunnel, staging containers, database, application credentials and data were not changed. Protected environment/config snapshots remain on the server, mode 0600, in the release directory; their values are not in this repository.

## Validation

Chromium login UI test: 24 checks passed, including public desktop/mobile introduction, English copy, SSO target, failed password handling, successful librarian sign-in and reader upload restrictions. Removing the product introduction fails the intended visibility assertion. The broad Node suite has an existing variant-controls harness failure (createLibrary is not defined), reproduced against both origin/main and the changed source; the full suite is not claimed green.

## Rollback

The deployment script automatically restores the previous container if health, product markup or build version validation fails. For a later manual rollback, stop and rename the current container to a unique retained name, rename libedge-oracle-v136-web-before-public-1f051ee back to libedge-oracle-v136-web, and start it. Keep the DB, network, mounts and tunnel intact. No DB rollback is required for this UI-only release.

Contract: docs/contracts/libedge-elibrary-v1.md, commit b15f8b5.
