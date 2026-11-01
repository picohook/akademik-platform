import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

// A page whose HTML comes from an OLDER build than its scripts (Cloudflare kept the HTML for hours after a
// release; the scripts under the old ?v= URL are answered with the current ones). Seen in production after v143:
// the new app.js looked for read-aloud markup the old HTML did not have, threw while starting, and the page was dead.
//
// Checked in a real Chromium against server.mjs started with a BUILD_SHA:
//   * the page and the service worker, and a script asked for under a token that is not the running build, are
//     marked "never keep this at the edge"; a script under the current token is not;
//   * a stale page heals itself: it is fetched again under a unique URL, ends up on the current HTML, and the
//     `fresh` parameter is removed from the address;
//   * if it cannot heal (the reload was already tried), the app still starts and works, only the newer feature is
//     absent, instead of dying on a missing element.
//
//   PLAYWRIGHT_MODULE=<path to playwright> node test/stale-shell.browser.mjs

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const appDir = fileURLToPath(new URL('../', import.meta.url));
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks += 1; };
const same = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks += 1; };

const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  probe.on('error', reject);
});

const NEW = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, PORT: String(port), NODE_ENV: 'development', APP_ENV: 'development', BUILD_SHA: NEW };
delete env.DATABASE_URL;
const server = spawn(process.execPath, ['server.mjs'], { cwd: appDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (chunk) => { serverLog += chunk; });
server.stderr.on('data', (chunk) => { serverLog += chunk; });

// What an older release's HTML looked like: its own token, and none of the read-aloud markup
const stale = (html) => html.replaceAll(`?v=${NEW}`, `?v=${OLD}`).replace(/\s*<div class="ra-player"[\s\S]*?<aside class="ai-panel"/, '\n  <aside class="ai-panel"');

let browser;
try {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (attempt === 99) throw new Error(`server did not start:\n${serverLog}`);
  }

  // ---- headers ----
  const head = async (path) => (await fetch(base + path)).headers;
  const page = await head('/');
  same(page.get('cloudflare-cdn-cache-control'), 'no-store', 'the page is never kept at the Cloudflare edge');
  same(page.get('cdn-cache-control'), 'no-store', 'nor by other CDNs that read the standard header');
  same((await head('/sw.js')).get('cloudflare-cdn-cache-control'), 'no-store', 'the service worker is never kept at the edge');
  const current = await head(`/app.js?v=${NEW}`);
  same(current.get('cloudflare-cdn-cache-control'), null, 'a script under the current build token may be kept');
  same(current.get('cache-control'), 'no-cache', 'and keeps its usual header');
  const old = await head(`/app.js?v=${OLD}`);
  same(old.get('cloudflare-cdn-cache-control'), 'no-store', 'a script asked for under a token that is not the running build is never kept at the edge');
  same(old.get('cache-control'), 'no-store', 'nor by the browser');
  same((await head(`/styles.css?v=${OLD}`)).get('cache-control'), 'no-store', 'same for a stylesheet');
  same((await head('/app.js')).get('cache-control'), 'no-cache', 'a script with no token is unchanged');
  const body = await (await fetch(`${base}/app.js?v=${OLD}`)).text();
  check(body.includes('staleReload'), 'it still answers with the current script (the page heals from it)');

  browser = await chromium.launch();

  // ---- a stale page heals itself ----
  const context = await browser.newContext();
  const healing = await context.newPage();
  const errors = [];
  healing.on('pageerror', (error) => errors.push(String(error)));
  let served = 0;
  // the page itself, whatever its query: the first answer is the stale one an edge would have kept
  await healing.route((requested) => requested.pathname === '/', async (route) => {
    served += 1;
    if (served > 1) return route.continue();
    const response = await route.fetch();
    return route.fulfill({ response, body: stale(await response.text()) });
  });
  await healing.goto(`${base}/?book=33333333-3333-3333-3333-333333333333`);
  await healing.waitForFunction(() => document.querySelector('#raPlayer') !== null && !location.search.includes('fresh'), null, { timeout: 15000 });
  same(served, 2, 'the stale page was served once and then fetched again under a new URL');
  same(await healing.evaluate(() => document.querySelector('script[type=module][src*="app.js"]').getAttribute('src').split('?v=')[1]), NEW, 'and is now the current HTML');
  const url = new URL(healing.url());
  check(!url.searchParams.has('fresh'), 'the cache-buster is gone from the address: ' + healing.url());
  same(url.searchParams.get('book'), '33333333-3333-3333-3333-333333333333', 'and the rest of the address is kept');
  await healing.locator('#loginScreen').waitFor({ state: 'visible' });
  same(errors, [], 'no page errors while healing');
  same(await healing.evaluate(() => sessionStorage.getItem('staleReload')), null, 'the one-time flag is cleared once the page is current');
  await context.close();

  // ---- a stale page that cannot heal still starts ----
  const stuckContext = await browser.newContext();
  const stuck = await stuckContext.newPage();
  const stuckErrors = [];
  stuck.on('pageerror', (error) => stuckErrors.push(String(error)));
  await stuck.addInitScript(() => { try { sessionStorage.setItem('staleReload', '1'); } catch { /* noop */ } });
  await stuck.route((requested) => requested.pathname === '/', async (route) => {
    const response = await route.fetch();
    return route.fulfill({ response, body: stale(await response.text()) });
  });
  await stuck.goto(base);
  await stuck.locator('#loginScreen').waitFor({ state: 'visible' });
  same(await stuck.locator('#raPlayer').count(), 0, 'the stale HTML really has no read-aloud markup');
  await stuck.locator('#adminLogin > summary').click();
  await stuck.fill('#loginEmail', 'librarian@example.edu.tr');
  await stuck.fill('#loginPassword', 'demo1234');
  await stuck.locator('#adminLogin button[type=submit]').click();
  await stuck.locator('#loginScreen').waitFor({ state: 'hidden' });
  await stuck.locator('.card').first().waitFor({ timeout: 10000 });
  check(await stuck.locator('.card').count() > 0, 'sign-in works and the catalogue is there');
  await stuck.locator('.card button', { hasText: 'Oku' }).first().click();
  await stuck.locator('#reader').waitFor({ state: 'visible' });
  same(await stuck.locator('#raBtn').isVisible(), false, 'the newer feature is not offered, the reader still opens');
  same(stuckErrors, [], 'no page errors: a missing element no longer kills the app: ' + stuckErrors.join(' | '));
  await stuckContext.close();

  console.log(JSON.stringify({ passed: true, checks }));
} catch (error) {
  console.error(error);
  console.error(serverLog.split('\n').slice(-8).join('\n'));
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
