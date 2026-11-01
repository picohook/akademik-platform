# Reader AI: explain / summarise a selected passage

Status (2026-11-01): **implemented in a PR, not deployed, not switched on.** Nothing in
production changes until the PR is merged, image built, migration 028 applied and the
variables below are set. The plan it follows: `docs/LIBEDGE-READER-AI-PLAN.md`
(free quota only, no paid fallback).

## What a reader sees
Select text in a PDF or EPUB: the selection bar gets **Açıkla** (explain) and **Özetle**
(summarise). The answer appears in a panel with "Yapay zekâ tarafından üretildi; yanılabilir."
The buttons exist only when `/api/config` says `aiSelection: true`.

## Gates, in order (`POST /api/ai/selection`)
1. Session and CSRF (the shared gate for every POST).
2. The book exists and `canAccessBook` allows it: the same decision as `/file`.
3. Feature on and configured, database present.
4. Input: mode `explain|summarize`, 20 to 2000 characters, language `tr|en`.
5. The book is a member of an allowed collection (default: the OA collection
   `74149e93-…`, so books added to it later work automatically) **and** `allow_copy` is not
   false.
6. Per user: 5 per minute, one request at a time (per process, i.e. per web container).
7. Daily budget in Postgres (`ai_usage_daily`, migration 028), reserved atomically:
   per user 30/day and all users 100/day (UTC day). A reservation counts even if the
   provider then fails, so retries cannot burn quota for free. If the counter is
   unreachable the request is refused, never run unmetered.
8. One call to Workers AI over REST. No tools, no retries, no other provider.

Failure never touches reading: the client shows a short message and the reader keeps working.

## What is and is not stored
Stored: counters only (day, scope, user id, number). The log line carries user id, book id,
character count, outcome and milliseconds. **Not stored or logged:** the selected text, the
answer, the token. The selected text does leave the server to Cloudflare Workers AI.

## Prompt-injection stance
The passage is untrusted data: fenced in `<passage>` tags (a `</passage>` inside the text is
neutralised), the system message says never to follow instructions inside it, the model has
no tools, and the client renders the answer with `textContent`. This reduces, not removes,
the risk of a wrong or manipulated answer; the panel says the answer can be wrong.

## Switching it on (not done yet)
1. Merge the PR; build and run the new image; apply migration 028 through `db/migrate.mjs`
   (new migration: follow the v137 runbook discipline, take a backup first).
2. Choose the model with the quality test (Turkish and English paragraphs of OA books).
3. Put `LIBREAD_AI_ENABLED=1`, `LIBREAD_AI_ACCOUNT_ID`, `LIBREAD_AI_API_TOKEN`,
   `LIBREAD_AI_MODEL` into one of the container's env files (the token is a secret: a
   Workers AI-only token, not a global key). The three-env-file rule in
   `docs/deployments/2026-11-01-libread-production.md` applies.
4. Verify: `/api/config` shows `aiSelection:true`; one explain call as a test user; the
   counter row appears; hit the per-user cap once and see the message.
5. Only then mention AI on the LibRead product card.

Switch off: unset `LIBREAD_AI_ENABLED` (or any of the four) and restart the web container.

## Limits and open points
- The default caps (30/user, 100/global per day) are conservative guesses in **requests**,
  not neurons. Map them to the real Cloudflare free allowance after measuring the chosen
  model's per-request cost; Cloudflare's current free allowance and the account plan must
  be checked in the dashboard (the account is on the Free plan).
- The per-minute and in-flight limits are in memory: correct for one web container; a
  second container would double them. The daily caps are shared (database).
- No answer cache yet (the plan allows exact-match caching later).
- `ai_usage_daily` rows are tiny and are not purged yet; one row per user per day.
- Tests: `spike/app/test/ai-selection.test.mjs` (logic, fake provider),
  `spike/app/test/ai-http.test.mjs` (HTTP gates, demo mode), `db/028.test.mjs`
  (real Postgres, concurrent reservations; fails if the cap is removed from the SQL).
