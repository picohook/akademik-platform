import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

// The HTTP edge of POST /api/ai/selection, on the shipped server.mjs in demo mode (no
// database, so no budget counter and the feature must stay off):
//   * /api/config says aiSelection:false;
//   * no session -> 401, session without the CSRF header -> 403 (the shared gate);
//   * a signed-in reader with CSRF gets 503 ai_disabled even if every AI variable is
//     set, because without a database there is nothing to meter against;
//   * the response is not cacheable and carries no answer.
// What happens when the feature is on (budget, provider, collection gate) is covered
// by test/ai-selection.test.mjs and db/028.test.mjs.
//
//   node test/ai-http.test.mjs

const appDir = fileURLToPath(new URL('../', import.meta.url));
let checks = 0;
const same = (actual, expected, message) => { assert.equal(actual, expected, message); checks += 1; };

const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  probe.on('error', reject);
});

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const env = {
  ...process.env, PORT: String(port), NODE_ENV: 'development', APP_ENV: 'development',
  LIBREAD_AI_ENABLED: '1', LIBREAD_AI_ACCOUNT_ID: 'a'.repeat(32), LIBREAD_AI_API_TOKEN: 'not-real', LIBREAD_AI_MODEL: '@cf/test/model',
};
delete env.DATABASE_URL;
const server = spawn(process.execPath, ['server.mjs'], { cwd: appDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
server.stdout.on('data', (chunk) => { log += chunk; });
server.stderr.on('data', (chunk) => { log += chunk; });

const post = (headers = {}, body = { bookId: 'x', mode: 'explain', lang: 'tr', text: 'x'.repeat(40) }) => fetch(`${base}/api/ai/selection`, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
});

try {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (attempt === 99) throw new Error(`server did not start:\n${log}`);
  }

  const config = await (await fetch(`${base}/api/config`)).json();
  same(config.aiSelection, false, 'no database, no AI feature, even with every variable set');

  same((await post()).status, 401, 'no session');

  const login = await fetch(`${base}/api/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'reader@example.edu.tr', password: 'demo1234' }),
  });
  same(login.status, 200, 'demo sign-in');
  const cookies = login.headers.getSetCookie().map((line) => line.split(';')[0]);
  const csrf = decodeURIComponent((cookies.find((c) => c.startsWith('akademik_csrf=')) || '').split('=')[1] || '');
  assert.ok(csrf, 'a CSRF token was issued');
  const cookie = cookies.join('; ');

  same((await post({ cookie })).status, 403, 'session without the CSRF header');

  const res = await post({ cookie, 'x-csrf-token': csrf });
  same(res.status, 404, 'unknown book in demo mode is 404 before the AI module is reached');

  const books = await (await fetch(`${base}/api/books`, { headers: { cookie } })).json();
  const first = Array.isArray(books) ? books[0] : books.books?.[0];
  if (first) {
    const disabled = await post({ cookie, 'x-csrf-token': csrf }, { bookId: first.id, mode: 'explain', lang: 'tr', text: 'x'.repeat(40) });
    same(disabled.status, 503, 'known book, feature off');
    const payload = await disabled.json();
    same(payload.error, 'ai_disabled', 'error code');
    same('answer' in payload, false, 'no answer in a refusal');
    same(disabled.headers.get('cache-control'), 'no-store', 'not cacheable');
  }
  console.log(JSON.stringify({ passed: true, checks, knownBookCase: Boolean(first) }));
} catch (error) {
  console.error(error);
  console.error(log.split('\n').slice(-12).join('\n'));
  process.exitCode = 1;
} finally {
  server.kill();
}
