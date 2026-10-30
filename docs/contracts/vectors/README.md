# SSO vectors

Shared fixtures for the reader-side SSO of `libedge-elibrary-v1.md`. Both sides of the
contract test against these bytes: the Worker signs with the private half, this repository
verifies with the public half. If the two implementations disagree, they disagree here.

| File | What it fixes | Contract | Tested by |
|---|---|---|---|
| `ed25519-test-keys.json` | One Ed25519 key pair, `kid` `test-2026-11` | 2.3/1-3 | `spike/app/test/sso-token.test.mjs`, `sso-production-gate.test.mjs` |
| `sso-token.json` | One valid token and five that must be refused, each with the reason | 2.2, 2.3/4-6, 3.4 | `spike/app/test/sso-token.test.mjs` |
| `sso-state.json` | A state value, its hash, and the exact cookie header | 2.1/2-4 | `spike/app/test/sso-state.test.mjs` |
| `sso-jti.json` | The `jti` the Worker must produce for a fixed 32-byte input: base64url string, length, SHA-256, plus three strings that are long enough but are not 128 random bits | 2.2 (`jti`), 2.3/9 | `spike/app/test/sso-jti.test.mjs` |

## `jti`: the vector, not the length

2.2 says `jti` is random and at least 128 bits. A verifier can only impose a *length* on a
received string - 22 base64url characters is the shortest that can hold 128 bits - and length
by itself proves nothing about randomness. `sso-jti.json` fixes the producer's side instead:

```js
// The Worker, and anything else minting a handoff token:
jti = base64url(crypto.getRandomValues(new Uint8Array(32)));   // -> 86QcB75Y2S5rFK8wyNdeIZSwL6bNPoFXSpBnsv0cjjU
```

* 32 bytes = 256 bits, 43 base64url characters, no padding.
* The same 32 bytes must produce the string in `sso-jti.json`; a test on the Worker's side can
  base64url-encode `bytesHex` and compare, and ours does the same in reverse.
* `sha256Hex` is there so a mismatch names the input rather than only the output.
* Do **not** use `randomUUID()` for this. It is 122 bits behind one version nibble and one
  variant nibble, and it reads as 22 or 36 characters depending on formatting, so its length
  says nothing. `insufficient` in the vector file lists a UUID, a repeated-character string and
  a hex string with the reason each one fails.
* Generate the value, never type it. base64url is only canonical at lengths of 0, 2 and 3
  modulo 4, so a hand-written string of 23 or 34 characters decodes to a byte length that
  re-encodes differently - the verifier refuses it on the round-trip, and the fixture is the
  thing at fault. This happened twice while writing this vector.

The verifier keeps the length rule from 2.2 (`MIN_JTI_LENGTH`, 22) because that is what the
contract states, and adds a round-trip check so a non-base64url value cannot pass on length
alone. What it cannot check is randomness: a 36-character UUID passes. The vector is what
makes the producer's side checkable, and that is the division of labour.

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

`node spike/app/sso/vectors.mjs` rewrites all four files. It is only needed if the claim
set of 2.2 changes - and then both sides must be updated together, which is the reason the
files are committed rather than generated at test time.

It also mints a fresh key pair and fresh signatures on every run, so re-running it rotates
the test key and invalidates `TEST_KEY_FINGERPRINTS` in `spike/app/sso/test-keys.mjs`; the
state test fails until both are updated together. To change only the `jti` vector, use
`node write-jti-vector.mjs`, which writes `sso-jti.json` from the frozen bytes and touches
nothing else.

The verdicts in `sso-token.json` are stated at the fixed instant `now` in that file, so the
"expired" and "not yet valid" cases mean the same thing on every run.

## Claims that are required and claims that are not

2.2 fixes the claim table, and the verifier follows it rather than its own convenience:

| Claim | 2.2 | Ours |
|---|---|---|
| `iss`, `aud`, `sub`, `ctx`, `role`, `jti`, `nonce`, `iat`, `exp` | required | required; a token without one is `bad_claims` before any database work |
| `inst` | required for `ctx=institution`, **forbidden** otherwise | enforced in both directions (`bad_context`) |
| `email` | required | required. Written to `users.email`, which is not null, and shown to the reader |
| `name`, `lang` | optional, display only | optional; typed when present, `null` when absent; `name` becomes `display_name` |

`email` is required by the contract, so a token without it is refused with `bad_claims` before
step 7 - no tenant lookup, no burned `jti`, no synthetic address. (An invented address would be
stored as identity, be shown to the reader, and could collide with the unique
`(tenant_id, email)` index.) `sso-token.test.mjs` and the integration test both assert this,
including that the refusal leaves the `jti` table untouched so a corrected token is not a
replay.

`name` is the only display value that can differ from the address. It is written to
`display_name` on creation, and updated on later sign-ins only when the row is new or still
carrying the address, so a later token without `name` does not blank a name a reader already
has. `lang` is accepted and carried on the verified claims but is not stored: there is no
column for it, and adding one would be a schema change for a UI preference nobody has asked
for yet.

## SameSite: to be measured on HTTPS staging

The state cookie is `SameSite=Lax` (contract 2.1/2), and the reasoning is that the
callback's cross-origin POST from `libedge.com` to `elibrary.libedge.com` is same-*site*:
SameSite is computed on the registrable domain (eTLD+1), not the origin, and both hosts sit
under `libedge.com`. On that reasoning a `Lax` cookie is sent on the POST, while a genuinely
cross-site POST (`*.pages.dev`, an attacker's page) gets no cookie and fails the nonce check.

**This has not been measured yet.** It is the one claim in this change that rests on the
specification rather than on a run. It will be measured in the real HTTPS staging
environment, which removes the blocker a local probe ran into:

* A local attempt was made and failed before the measurement: `__Host-` requires `Secure`,
  Chrome does not store a `Secure` cookie on an `http` origin, and the machine had no
  certificate tooling. Local certificates are no longer the plan.
* What the code asserts today is the DOM-side part, which is real but weaker:
  `sso-state.test.mjs` checks the exact header (`Secure`, `Path=/`, no `Domain`, `Lax`), so
  the browser will store the cookie only with those attributes, and only for the host that
  set it.

The staging run must answer two questions and record both:

1. **Same-site delivery.** Start the flow on `https://elibrary.<staging-domain>`, let the
   Worker POST the callback form from `https://libedge.<staging-domain>`, and confirm the
   callback sees `__Host-sso_state` (a successful sign-in is the evidence; the audit row
   `sso.login` names it).
2. **Cross-site control.** Repeat the POST from an origin that is not in the same registrable
   domain (a `*.pages.dev` preview is fine over HTTPS) with a valid token, and confirm it is
   refused with `state_mismatch` because no cookie was sent. Without this control a green
   first run only proves the happy path.

If `Lax` does not survive the real handoff, the fix is in one place - `sso/state.mjs` - and
it is a contract change (`SameSite=None; Secure` plus a stricter `Origin` check on the
callback), not a local edit.
