# Reader AI: explain / summarise a selected passage

Status (2026-11-01): **live in production** (image v139, migration 028 applied, switched on
with `@cf/mistralai/mistral-small-3.1-24b-instruct`). The switch and the limits are managed in
the reader's **Yönetim** panel (below); the secrets stay in the environment. The plan it
follows: `docs/LIBEDGE-READER-AI-PLAN.md` (free quota only, no paid fallback).

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

## Switching it on (how it was done; kept as the record)
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

## Yönetim panel (migration 029)
Administrators of the deployment's own tenant get a **Yönetim** button in the top bar. It shows
and edits, without touching the server:

| Setting | Notes |
|---|---|
| Feature on/off | Can only switch **off** what the environment allows. `LIBREAD_AI_ENABLED` unset or `0` stays off whatever the panel says, and the panel says so. |
| Per user per minute, per user per day, total per day | Hard ceilings in code (`ai-settings.mjs`): 30, 200, 150. A value above a ceiling is **refused** (400), not clamped. The global ceiling keeps worst-case spend inside the free allowance: 150 requests x about 60 neurons (2000 characters in, 600 tokens out) is about 9,000 of the 10,000 free neurons a day. A user cap above the total cap is refused. |
| Allowed collections | Chosen from the tenant's own collections; an id the tenant does not have is refused. |

It also shows today's usage against the total cap, the last 30 days (requests and distinct users),
today's heaviest users (name, e-mail, tenant), and a change history (who, when, old and new value).

What it deliberately does **not** do: show or edit the Cloudflare token, account id or model name.
No endpoint returns them (a test plants distinctive values and fails if any appears in an admin
response). Changing those stays an environment change plus a container restart.

Who: `role = admin` **and** the session's tenant equal to the deployment tenant (`DEMO_TENANT_ID`,
the LibEdge tenant in production). A librarian, a reader or the administrator of another tenant
gets 403 on read and write; a save without the CSRF header is 403.

Storage: `app_settings` (one JSON document, key `ai`) and `admin_audit_log` (append-only: the app
role can insert and read but not update or delete). Both are written in one transaction, so a
failed audit row also rolls the setting back. Settings are read through a 5-second cache; a save
takes effect at once in the process that handled it. Values are re-clamped at read time, so a row
edited by hand in the database cannot exceed a ceiling. If the settings cannot be read, the last
known value (or the environment) stands.

Naming users (migration 030): the people who use the feature mostly sign in through the LibEdge button and
belong to the `libedge-individual` tenant, while the administrator is bound to the platform tenant, and
`users` is under row level security. A plain join therefore showed a bare id. `app.ai_usage_user_labels()`
(SECURITY DEFINER, same shape as `app.tenant_for_login`) takes no argument and returns id, e-mail, display
name and tenant slug **only for users who appear in `ai_usage_daily`**; no role, hash or session data. The
usage query is the only caller and sits behind the platform administrator check. A user the function cannot
name (for example a deleted account) is shown by the start of the id.

Endpoints: `GET/PUT /api/admin/ai`, `GET /api/admin/audit`.

Rollback of the panel itself: the feature behaves exactly as before when `app_settings` has no
`ai` row, so deleting that row returns control to the environment values.

## Limits and open points
- The caps are in **requests**, not neurons. Measured with Mistral Small 3.1: about 11 neurons per
  request on typical selections, about 50 to 60 at the worst case. The Cloudflare account is on the
  Free plan (10,000 neurons a day); check the dashboard's neuron count against the panel's usage
  after a week and adjust.
- The per-minute and in-flight limits are in memory: correct for one web container; a
  second container would double them. The daily caps are shared (database).
- No answer cache yet (the plan allows exact-match caching later).
- `ai_usage_daily` rows are tiny and are not purged yet; one row per user per day.
- Tests: `spike/app/test/ai-selection.test.mjs` (logic, fake provider),
  `spike/app/test/ai-settings.test.mjs` (validation, ceilings, environment as outer boundary, store),
  `spike/app/test/ai-http.test.mjs` (HTTP gates, demo mode), `db/028.test.mjs`
  (real Postgres, concurrent reservations; fails if the cap is removed from the SQL),
  `db/029.test.mjs` (real Postgres, append-only audit, atomic save; also 030: a user of another tenant is named, one who never used the feature is not exposed),
  `spike/app/test/admin-ai.integration.mjs` (real Postgres and server: roles, tenants, validation,
  no secret in responses, audit, public config follows the switch) and
  `spike/app/test/admin-ai-ui.browser.mjs` (Chromium: button visibility, save payload, errors,
  English, phone width).
- Not covered by a test: a live call to Cloudflare from the panel's settings (the limits are
  applied through the same `createAiSelection` path that the unit tests drive with a fake provider).
