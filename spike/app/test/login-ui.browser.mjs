import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The sign-in box of the open-access reader (LibRead).
//
// Checked in a real Chromium against the shipped server.mjs in demo mode (no database):
//   * a visitor who is not signed in sees the LibEdge sign-in button and does NOT see
//     "+ Kitap ekle";
//   * the button points at /auth/libedge/start?ctx=individual and a click requests
//     exactly that;
//   * the box and the tab title say LibRead, and the logo is the one from the website;
//   * the e-mail/password form is folded under "Yönetici girişi" and still signs in:
//     a librarian gets "+ Kitap ekle", a plain reader does not, a wrong password keeps
//     the section open with the error.
//
// Screenshots (desktop and phone width) go to SHOTS_DIR when it is set.
//
//   PLAYWRIGHT_MODULE=<path to playwright> [SHOTS_DIR=<dir>] node test/login-ui.browser.mjs

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const appDir = fileURLToPath(new URL('../', import.meta.url));
const shotsDir = process.env.SHOTS_DIR || '';
const SSO_PATH = '/auth/libedge/start?ctx=individual';

let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks += 1; };
const same = (actual, expected, message) => { assert.equal(actual, expected, message); checks += 1; };

const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  probe.on('error', reject);
});

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, PORT: String(port), NODE_ENV: 'development', APP_ENV: 'development' };
delete env.DATABASE_URL;
const server = spawn(process.execPath, ['server.mjs'], { cwd: appDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (chunk) => { serverLog += chunk; });
server.stderr.on('data', (chunk) => { serverLog += chunk; });

let browser;
try {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (attempt === 299) throw new Error(`server did not start:\n${serverLog}`);
  }

  browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || undefined });
  const shoot = async (page, name) => {
    if (!shotsDir) return;
    await mkdir(shotsDir, { recursive: true });
    await page.screenshot({ path: path.join(shotsDir, `${name}.png`) });
  };

  // --- not signed in -------------------------------------------------------------
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto(base);
  await page.locator('#loginScreen').waitFor({ state: 'visible' });

  const sso = page.locator('#ssoLogin');
  check(await sso.isVisible(), 'the LibEdge sign-in button is visible');
  same((await sso.innerText()).trim(), 'LibEdge hesabınla giriş yap', 'button text');
  same(await sso.getAttribute('href'), SSO_PATH, 'button href');
  same(await page.locator('#openUpload').isVisible(), false, '"+ Kitap ekle" is not shown to a visitor');
  same(await page.locator('#openUpload').evaluate((el) => el.hidden), true, '"+ Kitap ekle" is hidden in the DOM');
  same((await page.locator('#loginBrand').innerText()).trim(), 'Size açık yayınlara ulaşın', 'access heading');
  if (process.env.PRODUCT_PAGE_NEGATIVE_CONTROL === '1') await page.locator('.product-intro').evaluate(el => el.remove());
  check(await page.locator('#productTitle').isVisible(), 'public product introduction is visible');
  same(await page.locator('.product-features article').count(), 3, 'three product features are public');
  check((await page.locator('.product-access-note').innerText()).includes('hesabınıza veya kurumunuza'), 'product access requirements are explicit');
  await page.waitForFunction(() => document.title.startsWith('LibRead'));
  check((await page.title()).startsWith('LibRead'), 'tab title');
  const logo = page.locator('.login-logo');
  check(await logo.isVisible(), 'logo is visible');
  same(await logo.evaluate((img) => img.complete && img.naturalWidth > 0), true, 'logo loaded');
  same(await logo.getAttribute('src'), '/icons/libread-logo.png', 'logo path');
  same(await page.locator('#adminLogin').evaluate((el) => el.open), false, 'administrator section starts folded');
  same(await page.locator('#loginEmail').isVisible(), false, 'e-mail field is folded away');
  same(await page.locator('#loginPassword').isVisible(), false, 'password field is folded away');
  await shoot(page, 'desktop-login');

  // the button goes to the right address
  const requested = page.waitForRequest((request) => request.url().startsWith(`${base}/auth/libedge/start`));
  await sso.click();
  const request = await requested;
  same(new URL(request.url()).pathname + new URL(request.url()).search, SSO_PATH, 'click requests the individual start URL');

  // --- administrator sign-in still works -----------------------------------------
  await page.goto(base);
  await page.locator('#loginScreen').waitFor({ state: 'visible' });
  await page.locator('#adminLogin > summary').click();
  check(await page.locator('#loginPassword').isVisible(), 'summary opens the form');
  await shoot(page, 'desktop-login-admin-open');

  await page.fill('#loginEmail', 'librarian@example.edu.tr');
  await page.fill('#loginPassword', 'wrong-password');
  await page.locator('#adminLogin button[type=submit]').click();
  await page.locator('#loginError').waitFor({ state: 'visible' });
  same(await page.locator('#adminLogin').evaluate((el) => el.open), true, 'section stays open after a failed attempt');

  await page.fill('#loginPassword', 'demo1234');
  await page.locator('#adminLogin button[type=submit]').click();
  await page.locator('#loginScreen').waitFor({ state: 'hidden' });
  await page.locator('#openUpload').waitFor({ state: 'visible' });
  check(await page.locator('#openUpload').isVisible(), 'a librarian gets "+ Kitap ekle"');
  await shoot(page, 'desktop-catalog-opening-text');
  await context.close();

  const readerContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const reader = await readerContext.newPage();
  await reader.goto(base);
  await reader.locator('#adminLogin > summary').click();
  await reader.fill('#loginEmail', 'reader@example.edu.tr');
  await reader.fill('#loginPassword', 'demo1234');
  await reader.locator('#adminLogin button[type=submit]').click();
  await reader.locator('#loginScreen').waitFor({ state: 'hidden' });
  same(await reader.locator('#openUpload').isVisible(), false, 'a plain reader does not get "+ Kitap ekle"');
  await readerContext.close();

  // --- phone width ---------------------------------------------------------------
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
  const mobile = await phone.newPage();
  await mobile.goto(base);
  await mobile.locator('#ssoLogin').waitFor({ state: 'visible' });
  await shoot(mobile, 'phone-login');
  const box = await mobile.locator('.login-card').boundingBox();
  check(box.x >= 0 && box.x + box.width <= 390, 'the sign-in card fits the phone width');
  same(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no horizontal scroll');
  await mobile.locator('#adminLogin > summary').click();
  await shoot(mobile, 'phone-login-admin-open');
  await mobile.evaluate(() => localStorage.setItem('uiLang', 'en'));
  await mobile.reload();
  await mobile.waitForFunction(() => document.querySelector('#productTitle')?.textContent.includes('Your digital library'));
  check((await mobile.locator('.product-access-note').innerText()).includes('assigned to your account or institution'), 'English access explanation');
  await shoot(mobile, 'phone-product-en');
  await phone.close();

  console.log(JSON.stringify({ passed: true, checks }));
} catch (error) {
  console.error(error);
  console.error(serverLog.split('\n').slice(-15).join('\n'));
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  server.kill();
}
