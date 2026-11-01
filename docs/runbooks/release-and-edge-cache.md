# Releases and the Cloudflare edge cache

## What happened (2026-11-01, after v143)
Right after the v143 cutover the public site served the **v142 HTML** while the origin already had the v143
one (`cf-cache-status: HIT`, `Age` about an hour, on `https://elibrary.libedge.com/`). The scripts the stale HTML
asks for are `/app.js?v=<old sha>`; this server ignores the query and answers with the **current** `app.js`, and
the edge stored that under the old URL for 4 hours (`Cache-Control: max-age=14400` reached the browser: the
edge overrides the origin's TTL). v143's `app.js` looks for markup (`#raSkip`) the v142 HTML does not have,
threw while starting, and the page was dead for anyone who got that pair.

Origin headers did not prevent it: the HTML and scripts are sent with `no-cache`, and the edge kept them anyway.
There is a Cloudflare rule (Cache Rule or Page Rule) on this hostname that sets its own edge/browser TTL.
It was not read from the dashboard when this was written; the symptoms are what show it.

Earlier releases were not hit only because the edge's copy happened to be older than its TTL when the release was
checked.

## What the app does about it now (this change)
1. **A stale page heals itself.** The script URL carries the HTML's build (`?v=<sha>`); on start `app.js` asks
   `/api/config` which build is running. If they differ it reloads once under a unique URL (`?fresh=<time>`),
   which no cache can hold, then removes `fresh` from the address. One try per tab session
   (`sessionStorage.staleReload`, cleared when the two match).
2. **A missing element no longer kills the app.** The read-aloud wiring checks that all its markup exists; if the
   HTML is older, the feature is simply not offered and the rest of the app starts.
3. **Headers.** The page, `sw.js`, and any script/stylesheet requested under a build token that is not the running
   one are answered with `Cloudflare-CDN-Cache-Control: no-store` and `CDN-Cache-Control: no-store` (the browser
   gets `no-store` for the wrong-token ones). Cloudflare documents these as the way for an origin to override its
   own caching, **but a Cache Rule that says "ignore origin cache-control" overrides them too**, so this is a
   second line, not the fix.

## The actual fix is in Cloudflare (owner action)
Dashboard, `libedge.com`, **Rules, Cache Rules**. For `elibrary.libedge.com`:
- **Bypass cache** for `/` , `/index.html`, `/sw.js`, `/manifest.webmanifest` (they name the build and must never be kept).
- Everything else under a build token (`/app.js?v=...`, `/styles.css?v=...`, ...) may keep the long TTL: the URL changes
  with every build. Files without a token (modules loaded by other modules, `/vendor/...`) are the ones to look at if a
  stale-code problem ever shows up again.
- `/api/*` should already be dynamic; confirm `/api/config` is not cached (it was fresh after v143).

## At every release
After the cutover, from any machine:
```
curl -s https://elibrary.libedge.com/ | grep -o 'app.js?v=[0-9a-f]*'      # must be the new build's sha
curl -sI https://elibrary.libedge.com/ | grep -i cf-cache-status           # BYPASS / DYNAMIC / MISS, not an old HIT
```
If the sha is old: **Caching, Configuration, Purge Everything** (or Custom Purge for `/`, `/sw.js`). The release
scripts run this check and say so; purging by API needs a Cloudflare token with the Cache Purge permission, which
is not configured.

## Tests
`spike/app/test/stale-shell.browser.mjs` (real Chromium, server started with a `BUILD_SHA`): the headers above; a
stale page (old token, no read-aloud markup) is served once, then the page is fetched again and ends on the current
HTML with the address cleaned; a stale page that has already used its one reload still starts, signs in, shows the
catalogue and opens the reader with no page errors.
It found a second bug while being written: with the markup missing, mouse movement threw (`raActivity` used a null
element).
