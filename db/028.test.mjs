import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';

// 028: the AI usage counters, measured on the real SQL under real concurrency.
//
// The unit tests of spike/app/ai-selection.mjs use a fake database, and a fake cannot
// prove the claim that matters: "parallel requests cannot spend past the cap". Here
// the shipped reserveBudget() runs against a real postgres with many separate
// connections at once, as the app role (not the owner), with no tenant bound.
//
// Checked:
//   * 028 applies twice (idempotent) and the table is reachable by akademik_app;
//   * 40 simultaneous reservations against a global cap of 10: exactly 10 win, the
//     stored counter is exactly 10, never 11;
//   * 30 simultaneous reservations of ONE user against a user cap of 5 with a roomy
//     global cap: exactly 5 win, and the global counter is 5 too - a refused user
//     request rolls its global reservation back instead of leaking it;
//   * many users racing a tight global cap while each also has a user cap: the sum of
//     the winners equals the global counter equals the cap;
//   * counters are per UTC day and per subject, and the app role has no tenant
//     binding here, which is the state of a real request with no RLS on this table.
//
// Run by hand, it starts its own postgres and takes a few seconds:
//   node db/028.test.mjs

const exec = promisify(execFile);
const dbDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(dbDir, '..');
const appDir = path.join(repoDir, 'spike/app');
const pg = createRequire(path.join(appDir, 'package.json'))('pg');
const { reserveBudget, readAiConfig } = await import(pathToFileURL(path.join(appDir, 'ai-selection.mjs')).href);

const container = `libedge-ai-usage-${randomUUID()}`;
const adminPassword = randomBytes(18).toString('hex');
const appPassword = randomBytes(18).toString('hex');
let port;
let admin;
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks += 1; };

async function docker(...args) {
  return (await exec('docker', args, { timeout: 90_000, maxBuffer: 1024 * 1024 })).stdout.trim();
}
// `--rm` is not reliable on Docker Desktop for Windows; stop, then remove by exact name.
async function stopContainer() {
  await docker('stop', container).catch(() => {});
  await docker('rm', '--force', container).catch(() => {});
}
async function freePort() {
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const value = socket.address().port;
  await new Promise((resolve, reject) => socket.close((error) => (error ? reject(error) : resolve())));
  return value;
}

const appUrl = () => `postgres://akademik_app:${appPassword}@127.0.0.1:${port}/mig`;

// Every reservation gets its own connection, so they genuinely overlap on the server.
function withOwnConnection(fn) {
  return (async () => {
    const client = new pg.Client({ connectionString: appUrl() });
    await client.connect();
    try { return await fn(client); } finally { await client.end().catch(() => {}); }
  })();
}

const counter = async (scope, subject) => {
  const { rows } = await admin.query(
    "select used from ai_usage_daily where scope = $1 and subject = $2 and day = (now() at time zone 'utc')::date",
    [scope, subject],
  );
  return rows[0]?.used ?? 0;
};
const resetCounters = () => admin.query('truncate ai_usage_daily');
const configWith = (overrides) => ({ ...readAiConfig({}), ...overrides });

async function setup() {
  await docker('version', '--format', '{{.Server.Version}}');
  port = await freePort();
  await docker('run', '--detach', '--rm', '--name', container,
    '--tmpfs', '/var/lib/postgresql/data',
    '--publish', `127.0.0.1:${port}:5432`,
    '--env', 'POSTGRES_USER=mig_admin',
    '--env', 'POSTGRES_DB=mig',
    '--env', `POSTGRES_PASSWORD=${adminPassword}`, 'postgres:16-alpine');
  let lastError;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const candidate = new pg.Client({ connectionString: `postgres://mig_admin:${adminPassword}@127.0.0.1:${port}/mig` });
    try { await candidate.connect(); admin = candidate; break; } catch (error) {
      lastError = error;
      await candidate.end().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  if (!admin) throw new Error(`postgres did not become reachable: ${lastError?.message}`);
  await admin.query(await readFile(path.join(repoDir, 'db/schema.sql'), 'utf8'));
  await admin.query(`alter role akademik_app password '${appPassword}'`);
}

async function main() {
  await setup();
  const sql = await readFile(path.join(dbDir, 'migrations', '028-ai-usage.sql'), 'utf8');
  await admin.query(sql);
  await admin.query(sql); // idempotent
  checks += 1;

  const rls = await admin.query("select relrowsecurity from pg_class where relname = 'ai_usage_daily'");
  check(rls.rows[0].relrowsecurity === false, 'the table carries no tenant policy (it holds counts, not tenant rows)');

  // 1. global cap under 40 simultaneous reservations
  await resetCounters();
  let config = configWith({ perGlobalDay: 10, perUserDay: 1000 });
  let results = await Promise.all(Array.from({ length: 40 }, (_, i) =>
    withOwnConnection((client) => reserveBudget((fn) => fn(client), `user-${i}`, config))));
  const wins = results.filter((r) => r.ok).length;
  check(wins === 10, `expected exactly 10 winners against the global cap, got ${wins}`);
  check(await counter('global', '-') === 10, `global counter must be exactly 10, is ${await counter('global', '-')}`);
  check(results.filter((r) => !r.ok).every((r) => r.code === 'daily_budget_exhausted'), 'losers are told the budget is exhausted');

  // 2. one user, user cap 5, roomy global: refused attempts must not leak global budget
  await resetCounters();
  config = configWith({ perGlobalDay: 100, perUserDay: 5 });
  results = await Promise.all(Array.from({ length: 30 }, () =>
    withOwnConnection((client) => reserveBudget((fn) => fn(client), 'one-user', config))));
  check(results.filter((r) => r.ok).length === 5, 'exactly 5 winners for one user');
  check(await counter('user', 'one-user') === 5, 'user counter is exactly 5');
  check(await counter('global', '-') === 5, `global counter must be 5 (rollback of refused attempts), is ${await counter('global', '-')}`);
  check(results.filter((r) => !r.ok).every((r) => r.code === 'daily_user_limit'), 'losers are told the user limit is reached');

  // 3. many users, tight global cap, each also user-capped
  await resetCounters();
  config = configWith({ perGlobalDay: 12, perUserDay: 2 });
  results = await Promise.all(Array.from({ length: 60 }, (_, i) =>
    withOwnConnection((client) => reserveBudget((fn) => fn(client), `user-${i % 10}`, config))));
  const winners = results.filter((r) => r.ok).length;
  check(winners === 12, `expected 12 winners, got ${winners}`);
  check(await counter('global', '-') === 12, 'global counter equals the cap');
  const { rows: perUser } = await admin.query("select coalesce(sum(used),0)::int as total, max(used) as most from ai_usage_daily where scope = 'user'");
  check(perUser[0].total === 12, `the user counters add up to the winners (${perUser[0].total})`);
  check(perUser[0].most <= 2, 'no user went past the user cap');

  // 4. a different day starts from zero (counters are keyed by UTC day)
  await resetCounters();
  await admin.query("insert into ai_usage_daily (day, scope, subject, used) values ((now() at time zone 'utc')::date - 1, 'global', '-', 10)");
  config = configWith({ perGlobalDay: 10, perUserDay: 10 });
  const today = await withOwnConnection((client) => reserveBudget((fn) => fn(client), 'u', config));
  check(today.ok && today.globalUsed === 1, "yesterday's full counter does not block today");

  console.log(JSON.stringify({ passed: true, checks }));
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await admin?.end().catch(() => {});
  await stopContainer();
}
