# SSO vectors

Shared fixtures for the reader-side SSO of `libedge-elibrary-v1.md`. Both sides of the
contract test against these bytes: the Worker signs with the private half, this repository
verifies with the public half. If the two implementations disagree, they disagree here.

| File | What it fixes | Contract | Tested by |
|---|---|---|---|
| `ed25519-test-keys.json` | One Ed25519 key pair, `kid` `test-2026-11` | 2.3/1-3 | `spike/app/test/sso-token.test.mjs`, `sso-production-gate.test.mjs` |
| `sso-token.json` | One valid token and five that must be refused, each with the reason | 2.2, 2.3/4-6, 3.4 | `spike/app/test/sso-token.test.mjs` |
| `sso-state.json` | A state value, its hash, and the exact cookie header | 2.1/2-4 | `spike/app/test/sso-state.test.mjs` |

## The private key is in this repository

`ed25519-test-keys.json` carries the private half, so anyone who has read this repository
can mint a handoff token that verifies. That is the point of a test vector and it is fatal
in production. Two things follow:

* Production keys live in the Worker secret and in the deployment's
  `LIBEDGE_SSO_PUBLIC_KEYS`; they are never written down here.
* The server refuses to start if `NODE_ENV=production` and the loaded key's fingerprint is
  the one in `spike/app/sso/test-keys.mjs` (`TEST_KEY_FINGERPRINTS`). The check is on the
  fingerprint, not the `kid`, so copying the key under a new name does not get past it.
  `sso-state.test.mjs` re-derives the fingerprint from this file, so a regenerated key
  cannot leave a stale constant behind.

## Regenerating

`node spike/app/sso/vectors.mjs` rewrites all three files. It is only needed if the claim
set of 2.2 changes - and then both sides must be updated together, which is the reason the
files are committed rather than generated at test time.

The verdicts in `sso-token.json` are stated at the fixed instant `now` in that file, so the
"expired" and "not yet valid" cases mean the same thing on every run.

## SameSite: NOT MEASURED

The state cookie is `SameSite=Lax` (contract 2.1/2), and the reasoning is that the
callback's cross-origin POST from `libedge.com` to `elibrary.libedge.com` is same-*site*:
SameSite is computed on the registrable domain (eTLD+1), not the origin, and both hosts sit
under `libedge.com`. On that reasoning a `Lax` cookie is sent on the POST, while a genuinely
cross-site POST (`*.pages.dev`, an attacker's page) gets no cookie and fails the nonce check.

**This has not been measured with a real browser.** It is the one claim in this change that
rests on the specification rather than on a run. The attempt and its blocker:

* A Playwright probe was written: map `libedge.test` and `elibrary.libedge.test` to
  `127.0.0.1` with Chromium's `--host-resolver-rules`, set the cookie from
  `elibrary.libedge.test`, submit a real `<form method=post>` from each origin, and record
  whether the server saw `Cookie`. A locally installed Chrome was available.
* It failed before the measurement, not at it: `__Host-` requires `Secure`, Chrome does not
  store a `Secure` cookie on an `http` origin, and the machine has neither `openssl` nor a
  Node build with `tls.generate` to make a certificate. `*.pages.dev` also cannot serve as
  the cross-site control over plain http, because it is HSTS-preloaded.
* What remains as evidence is the DOM-side proof, which is real but weaker: with the
  `__Host-` prefix the browser itself refuses to store the cookie unless `Secure`, `Path=/`
  and no `Domain` are all present (`sso-state.test.mjs` asserts the header), and it refuses
  to send it to any host other than the one that set it.

To finish the measurement: serve the probe over https with a certificate for the three
names (a self-signed one and `--ignore-certificate-errors` are enough), use a
non-HSTS-preloaded `.test` domain for the cross-site control, and record both runs. The
probe script was deleted rather than committed half-working; it is ~120 lines and the
description above is the whole of it.

If it turns out that `Lax` does not survive the real handoff, the fix is in one place -
`sso/state.mjs` - and it is a contract change (`SameSite=None; Secure` plus a stricter
`Origin` check on the callback), not a local edit.
