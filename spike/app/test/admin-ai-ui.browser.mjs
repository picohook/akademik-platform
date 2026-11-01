import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The "Yönetim" panel for the AI feature, in a real Chromium against the shipped server.mjs.
//
// The server runs in demo mode (no database), so the admin endpoints are answered by the test
// through Playwright routes: this file checks what the browser does with them. The endpoints
// themselves are covered with a real database by test/admin-ai.integration.mjs.
//
//   * the button exists only for an administrator; a librarian and a reader do not get it;
//   * the panel shows the stored settings, the ceilings, the collections, usage and history;
//   * Save sends exactly the edited values (and nothing else, no secret field);
//   * a refusal (400) is shown and the panel stays open; a 403 hides the form;
//   * when the server says the environment has the feature off, the switch is disabled;
//   * Escape closes it and focus goes back to the button; it works in English and at phone width.
//
// Screenshots go to SHOTS_DIR when it is set.
//
//   PLAYWRIGHT_MODULE=<path to playwright> [SHOTS_DIR=<dir>] node test/admin-ai-ui.browser.mjs

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const appDir = fileURLToPath(new URL('../', import.meta.url));
const shotsDir = process.env.SHOTS_DIR || '';
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks += 1; };
const same = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks += 1; };

const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  probe.on('error', reject);
});

const OA = '74149e93-39dd-50ba-b120-a75415d9b0ca';
const PRIVATE = '44444444-4444-4444-4444-444444444444';
const today = new Date().toISOString().slice(0, 10);
const panelData = (over = {}) => ({
  envEnabled: true, active: true,
  ceilings: { perMinute: 30, perUserDay: 200, perGlobalDay: 150 },
  stored: { enabled: true, perMinute: 5, perUserDay: 30, perGlobalDay: 100, collectionIds: [OA] },
  effective: { enabled: true, perMinute: 5, perUserDay: 30, perGlobalDay: 100, collectionIds: [OA] },
  collections: [{ id: OA, title: 'Açık Erişim' }, { id: PRIVATE, title: 'Özel Koleksiyon' }],
  usage: {
    days: [{ day: today, total: 42, users: 6 }, { day: '2026-10-31', total: 17, users: 3 }],
    topToday: [
      { user_id: 'aaaaaaaa-0000-0000-0000-000000000000', used: 11, email: 'ayse@example.edu', display_name: 'Ayşe Yılmaz', tenant_slug: 'libedge-individual' },
      { user_id: 'bbbbbbbb-0000-0000-0000-000000000000', used: 4, email: 'same@example.edu', display_name: 'same@example.edu', tenant_slug: 'libedge' },
      { user_id: 'cccccccc-1111-0000-0000-000000000000', used: 1, email: null, display_name: null, tenant_slug: null },
    ],
  },
  ...over,
});
const auditRows = [{
  at: '2026-11-01T14:00:00Z', actor_id: 'b'.repeat(8) + '-0000-0000-0000-000000000000', actor_email: 'boss@libedge.com', action: 'ai.settings.update',
  detail: { before: { enabled: true, perGlobalDay: 100, collectionIds: [OA] }, after: { enabled: false, perGlobalDay: 60, collectionIds: [OA, PRIVATE] } },
}];

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
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (attempt === 99) throw new Error(`server did not start:\n${serverLog}`);
  }
  browser = await chromium.launch();
  const shoot = async (page, name) => {
    if (!shotsDir) return;
    await mkdir(shotsDir, { recursive: true });
    await page.screenshot({ path: path.join(shotsDir, `${name}.png`) });
  };

  // Sign in with the demo librarian or reader; `asRole` rewrites the role the page receives.
  async function signIn(context, email, asRole) {
    const page = await context.newPage();
    const state = { puts: [], getStatus: 200, putStatus: 200, putBody: { ok: true }, data: panelData(), configAi: true };
    await page.route('**/api/login', async (route) => {
      const response = await route.fetch();
      const json = await response.json();
      if (asRole && response.ok()) json.role = asRole;
      await route.fulfill({ response, json });
    });
    // a reload (the language switch does one) asks /api/me again, so the role is rewritten there too
    await page.route('**/api/me', async (route) => {
      const response = await route.fetch();
      const json = await response.json().catch(() => null);
      if (asRole && response.ok() && json) json.role = asRole;
      await route.fulfill({ response, json });
    });
    await page.route('**/api/admin/ai', async (route) => {
      if (route.request().method() === 'PUT') {
        state.puts.push(route.request().postDataJSON());
        return route.fulfill({ status: state.putStatus, json: state.putBody });
      }
      return state.getStatus === 200 ? route.fulfill({ json: state.data }) : route.fulfill({ status: state.getStatus, json: { error: 'yetkiniz yok' } });
    });
    await page.route('**/api/admin/audit', (route) => route.fulfill({ json: auditRows }));
    await page.route('**/api/config', async (route) => {
      const response = await route.fetch();
      const json = await response.json();
      await route.fulfill({ response, json: { ...json, aiSelection: state.configAi } });
    });
    await page.goto(base);
    await page.locator('#adminLogin > summary').click();
    await page.fill('#loginEmail', email);
    await page.fill('#loginPassword', 'demo1234');
    await page.locator('#adminLogin button[type=submit]').click();
    await page.locator('#loginScreen').waitFor({ state: 'hidden' });
    return { page, state };
  }

  // --- who gets the button -----------------------------------------------------------
  const readerCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const reader = await signIn(readerCtx, 'reader@example.edu.tr');
  same(await reader.page.locator('#adminBtn').isVisible(), false, 'a reader has no Yönetim button');
  await readerCtx.close();
  const librarianCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const librarian = await signIn(librarianCtx, 'librarian@example.edu.tr');
  same(await librarian.page.locator('#adminBtn').isVisible(), false, 'a librarian has no Yönetim button');
  same(await librarian.page.locator('#grantsBtn').isVisible(), true, '...but still has the access button');
  await librarianCtx.close();

  // --- the administrator ---------------------------------------------------------------
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const { page, state } = await signIn(ctx, 'librarian@example.edu.tr', 'admin');
  const button = page.locator('#adminBtn');
  same(await button.isVisible(), true, 'an administrator sees Yönetim');
  await button.focus();
  await button.click();
  await page.locator('#adminModal').waitFor({ state: 'visible' });
  await page.locator('#adminAiForm').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('#adminPerMinute').value === '5');

  same(await page.locator('#adminAiEnabled').isChecked(), true, 'switch shows the stored state');
  same([await page.inputValue('#adminPerMinute'), await page.inputValue('#adminPerUserDay'), await page.inputValue('#adminPerGlobalDay')], ['5', '30', '100'], 'limits show the stored values');
  same(await page.locator('#adminPerGlobalDay').getAttribute('max'), '150', 'the ceiling is the input maximum');
  check((await page.locator('#adminPerGlobalDayLabel').innerText()).includes('150'), 'the ceiling is written next to the field');
  same(await page.locator('#adminCollections input').count(), 2, 'both collections are offered');
  same(await page.locator('#adminCollections input:checked').count(), 1, 'only the allowed one is ticked');
  check((await page.locator('#adminStatus').innerText()).includes('açık'), 'status says it is on');
  same(await page.locator('#adminUsageBar').evaluate((el) => [el.max, el.value]), [100, 42], 'today bar: 42 of the 100 daily cap');
  check((await page.locator('#adminUsage').innerText()).includes('42 istek'), 'usage list shows requests');
  const topText = await page.locator('#adminTop').innerText();
  check(topText.includes('Ayşe Yılmaz · ayse@example.edu · libedge-individual'), 'a person is shown by name, e-mail and tenant: ' + topText);
  check(topText.includes('same@example.edu · libedge') && !topText.includes('same@example.edu · same@example.edu'), 'the name is left out when it is only the address again');
  check(topText.includes('cccccccc'), 'a user the server could not name falls back to the start of the id');
  const auditText = await page.locator('#adminAudit').innerText();
  check(auditText.includes('boss@libedge.com') && auditText.includes('açık: evet → hayır') && auditText.includes('toplam/gün: 100 → 60') && auditText.includes('koleksiyon: 1 → 2'), 'history shows who and what changed: ' + auditText);
  const html = await page.locator('#adminModal').innerHTML();
  check(!/token|api[_-]?key|secret/i.test(await page.locator('#adminModal input').evaluateAll((els) => els.map((el) => el.id + el.name).join(' '))), 'no secret input exists in the panel');
  check(html.includes('sunucuda tutulur'), 'the panel says secrets stay on the server');
  await shoot(page, 'desktop-admin-panel');

  // Save sends exactly the edited values
  await page.fill('#adminPerMinute', '3');
  await page.fill('#adminPerUserDay', '12');
  await page.fill('#adminPerGlobalDay', '80');
  await page.locator('#adminCollections input').nth(1).check();
  await page.locator('#adminAiEnabled').uncheck();
  state.configAi = false;
  await page.locator('#saveAdmin').click();
  await page.waitForFunction(() => document.querySelector('#toast, .toast')?.textContent.includes('Kaydedildi'));
  same(state.puts.length, 1, 'one PUT');
  same(state.puts[0], { enabled: false, perMinute: 3, perUserDay: 12, perGlobalDay: 80, collectionIds: [OA, PRIVATE] }, 'payload is exactly the five settings');
  // the toast appears while the panel reloads; Save is disabled only for that moment
  await page.waitForFunction(() => !document.querySelector('#saveAdmin').disabled);
  same(await page.locator('#saveAdmin').isDisabled(), false, 'Save is usable again');

  // a refusal is shown
  state.putStatus = 400; state.putBody = { ok: false, error: 'invalid_field', field: 'perGlobalDay', max: 150 };
  await page.locator('#saveAdmin').click();
  await page.locator('#adminError').waitFor({ state: 'visible' });
  check((await page.locator('#adminError').innerText()).includes('Geçersiz değer'), 'the refusal is explained');
  same(await page.locator('#adminModal').isVisible(), true, 'the panel stays open');
  await shoot(page, 'desktop-admin-error');

  // Escape closes, focus returns
  await page.keyboard.press('Escape');
  await page.locator('#adminModal').waitFor({ state: 'hidden' });
  same(await page.evaluate(() => document.activeElement?.id), 'adminBtn', 'focus returns to the Yönetim button');

  // environment has it off: the switch cannot be turned on from here
  state.data = panelData({ envEnabled: false, active: false });
  await button.click();
  await page.waitForFunction(() => document.querySelector('#adminStatus').textContent.includes('Sunucuda kapalı'));
  same(await page.locator('#adminAiEnabled').isDisabled(), true, 'the switch is disabled when the environment has it off');
  await page.keyboard.press('Escape');

  // not the platform administrator: 403 hides the form
  state.getStatus = 403;
  await button.click();
  await page.waitForFunction(() => document.querySelector('#adminStatus').textContent.includes('platform yöneticisine'));
  same(await page.locator('#adminAiForm').isVisible(), false, 'a 403 hides the form');
  await page.keyboard.press('Escape');
  state.getStatus = 200; state.data = panelData();

  // English
  await page.locator('.topbar [data-lang-toggle]').click();
  await button.click();
  await page.waitForFunction(() => document.querySelector('#adminPerMinute').value === '5');
  check((await page.locator('#adminStatus').innerText()).includes('On and running'), 'status in English');
  check((await page.locator('#adminPerGlobalDayLabel').innerText()).includes('Total / day (max 150)'), 'label in English with the ceiling');
  check((await page.locator('#adminUsage').innerText()).includes('42 requests'), 'usage in English');
  const englishAudit = await page.locator('#adminAudit').innerText();
  check(englishAudit.includes('on: yes → no') && englishAudit.includes('collections: 1 → 2'), 'history in English: ' + englishAudit);
  check((await page.locator('#adminHeading').innerText()).includes('Admin'), 'heading in English');
  await shoot(page, 'desktop-admin-panel-en');
  await page.keyboard.press('Escape');
  await ctx.close();

  // phone width: no sideways scroll, the panel fits
  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const phone = await signIn(phoneCtx, 'librarian@example.edu.tr', 'admin');
  await phone.page.locator('#adminBtn').click();
  await phone.page.waitForFunction(() => document.querySelector('#adminPerMinute').value === '5');
  same(await phone.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no horizontal page scroll at phone width');
  same(await phone.page.locator('#adminModal .admin-card').evaluate((el) => el.getBoundingClientRect().right <= window.innerWidth + 1), true, 'the panel fits inside the screen');
  await shoot(phone.page, 'phone-admin-panel');
  await phoneCtx.close();

  console.log(JSON.stringify({ passed: true, checks }));
} catch (error) {
  console.error(error);
  console.error(serverLog.split('\n').slice(-8).join('\n'));
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
