import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { once } from 'node:events';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

// Intentionally no target URL / DATABASE_URL option. Every run owns a fresh DB,
// an application copy and distinct users. Never load-test an existing service.
const repo = fileURLToPath(new URL('../', import.meta.url));
const appDir = path.join(repo, 'spike/app');
const args = process.argv.slice(2);
if (!args.includes('--run') || args.includes('--help')) {
  console.log('Isolated PostgreSQL API load test (Node >=22, Docker, installed app dependencies).\n'
    + 'node scripts/load-capacity.mjs --run [--stages 10,25,50,100] [--duration 30]\n'
    + '  [--think-ms 500] [--timeout-ms 10000] [--books 20] [--output path]\n'
    + 'Quick harness smoke: --run --stages 2 --duration 3 --books 2\n'
    + 'No external URL accepted. Duration is seconds per steady-state stage.');
  process.exit(0);
}
const known = new Set(['--run', '--stages', '--duration', '--think-ms', '--timeout-ms', '--books', '--output']);
const opts = {};
for (let i = 0; i < args.length; i++) {
  assert.ok(known.has(args[i]), `Unknown option: ${args[i]}`);
  if (args[i] !== '--run') {
    assert.ok(args[i + 1] && !args[i + 1].startsWith('--'), `Missing value: ${args[i]}`);
    opts[args[i]] = args[++i];
  }
}
function integer(name, fallback, min, max) {
  const value = Number(opts[name] ?? fallback);
  assert.ok(Number.isInteger(value) && value >= min && value <= max, `${name}: integer ${min}..${max}`);
  return value;
}
const stages = (opts['--stages'] || '10,25,50,100').split(',').map(Number);
assert.ok(stages.length > 0 && stages.length <= 4 && stages.every((n) => Number.isInteger(n) && n >= 1 && n <= 100), '1..4 stages, each 1..100 users');
const duration = integer('--duration', 30, 1, 120);
const thinkMs = integer('--think-ms', 500, 100, 10_000);
const timeoutMs = integer('--timeout-ms', 10_000, 1000, 30_000);
const booksCount = integer('--books', 20, 1, 200);
const pg = createRequire(path.join(appDir, 'package.json'))('pg');
const exec = promisify(execFile);
const runId = randomUUID();
const container = `akademik-capacity-${runId}`;
const tenant = '11111111-1111-1111-1111-111111111111';
const adminPassword = randomBytes(24).toString('hex');
const appPassword = randomBytes(24).toString('hex');
const userPassword = randomBytes(24).toString('hex');
const secret = randomBytes(32).toString('hex');
const secrets = [adminPassword, appPassword, userPassword, secret];
const output = path.resolve(opts['--output'] || path.join(repo, 'tmp', `load-capacity-${new Date().toISOString().replace(/[:.]/g, '-')}`));
const report = {
  runId, startedAt: new Date().toISOString(), status: 'running', isolation: 'fresh PostgreSQL container + application copy; no existing target',
  workload: { stages, durationSeconds: duration, thinkMs, timeoutMs, books: booksCount, pagesPerBook: 6, pdf: 'bundled six-page sample', range: 'first up to 65536 bytes', model: 'closed-loop; one request per user at a time' },
  host: { platform: process.platform, node: process.version, logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem() },
  stages: [], source: {}, telemetry: [], cleanup: {},
  limitations: ['Synthetic small PDF; no browser rendering, EPUB, download watermark, TLS/proxy, large file, network or offline-sync benchmark.', 'Node client, Node server and Docker PostgreSQL share this host; results are not production capacity.', 'API p95 excludes login/logout; login burst is reported separately. Warm-cache closed-loop results are workload specific.'],
};
let temporary;
let admin;
let child;
let containerCreated = false;
let interrupted = false;
let childError;
let appLog = '';
let base;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function safeError(error) {
  let message = String(error?.message || error);
  for (const value of secrets) message = message.replaceAll(value, '[redacted]');
  return message.replace(/postgres(?:ql)?:\/\/[^\s]+/g, '[database connection redacted]').slice(0, 1000);
}
async function docker(...command) {
  return (await exec('docker', command, { timeout: 60_000, maxBuffer: 1024 * 1024, windowsHide: true })).stdout.trim();
}
async function eventually(fn, seconds = 45) {
  const end = Date.now() + seconds * 1000;
  let last;
  while (Date.now() < end && !interrupted) {
    try { if (await fn()) return; } catch (error) { last = error; }
    await pause(200);
  }
  throw new Error(`Readiness failed: ${safeError(last || 'timeout')}`);
}
function metric() { return { samples: [], errors: 0, bytes: 0, statuses: {}, examples: [] }; }
function summarize(value) {
  const sorted = value.samples.slice().sort((a, b) => a - b);
  const percentile = (p) => sorted.length ? +sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)].toFixed(2) : null;
  return { requests: sorted.length, errors: value.errors, errorRate: sorted.length ? value.errors / sorted.length : 0, bytes: value.bytes,
    p50Ms: percentile(0.5), p95Ms: percentile(0.95), p99Ms: percentile(0.99), maxMs: sorted.length ? +sorted.at(-1).toFixed(2) : null,
    statuses: value.statuses, errorExamples: value.examples };
}
async function request(metrics, label, route, session, { method = 'GET', body, expected = 200, headers = {}, validate } = {}) {
  const record = metrics[label] ||= metric();
  const start = performance.now();
  let status = 'network';
  let byteCount = 0;
  try {
    const requestHeaders = new Headers(headers);
    if (session?.cookie) requestHeaders.set('cookie', session.cookie);
    if (session?.csrf) requestHeaders.set('x-csrf-token', session.csrf);
    if (body !== undefined) requestHeaders.set('content-type', 'application/json');
    const response = await fetch(base + route, { method, headers: requestHeaders, body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    status = response.status;
    const bytes = new Uint8Array(await response.arrayBuffer());
    byteCount = bytes.byteLength;
    assert.equal(status, expected, `${label}: HTTP ${status}, expected ${expected}`);
    let data;
    if ((response.headers.get('content-type') || '').includes('application/json')) data = JSON.parse(new TextDecoder().decode(bytes));
    if (validate) validate(data, response, bytes);
    return { data, response };
  } catch (error) {
    record.errors++;
    if (record.examples.length < 3) record.examples.push(safeError(error));
    throw error;
  } finally {
    record.samples.push(performance.now() - start);
    record.bytes += byteCount;
    record.statuses[status] = (record.statuses[status] || 0) + 1;
  }
}

async function setup() {
  // Require an already-installed image; no implicit image/network download.
  report.postgresImage = await docker('image', 'inspect', 'postgres:16-alpine', '--format', '{{.Id}}');
  const tempParent = path.join(appDir, 'tmp');
  await mkdir(tempParent, { recursive: true });
  temporary = await mkdtemp(path.join(tempParent, 'load-capacity-'));
  const sandbox = path.join(temporary, 'app');
  await mkdir(path.join(sandbox, 'public/seed'), { recursive: true });
  for (const relative of ['server.mjs', 'indexer.mjs', 'public/search.mjs', 'public/seed/sample.pdf']) {
    const destination = path.join(sandbox, relative);
    await copyFile(path.join(appDir, relative), destination);
    report.source[relative] = createHash('sha256').update(await readFile(destination)).digest('hex');
  }
  const schema = await readFile(path.join(repo, 'db/schema.sql'), 'utf8');
  const seed = await readFile(path.join(repo, 'db/seed.sql'), 'utf8');
  report.source['db/schema.sql'] = createHash('sha256').update(schema).digest('hex');
  report.source['db/seed.sql'] = createHash('sha256').update(seed).digest('hex');
  report.fixtureBytes = (await readFile(path.join(sandbox, 'public/seed/sample.pdf'))).byteLength;
  await docker('run', '--detach', '--rm', '--name', container, '--label', `akademik.capacity-test=${runId}`,
    '--tmpfs', '/var/lib/postgresql/data', '--publish', '127.0.0.1::5432',
    '--env', 'POSTGRES_USER=capacity_admin', '--env', 'POSTGRES_DB=capacity_test', '--env', `POSTGRES_PASSWORD=${adminPassword}`, 'postgres:16-alpine');
  containerCreated = true;
  const mapping = await docker('port', container, '5432/tcp');
  const port = Number(mapping.match(/:(\d+)\s*$/)?.[1]);
  assert.ok(port, 'Unexpected Docker port mapping');
  const adminUrl = `postgres://capacity_admin:${adminPassword}@127.0.0.1:${port}/capacity_test`;
  await eventually(async () => {
    const probe = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 1000 });
    try { await probe.connect(); return true; } finally { await probe.end().catch(() => {}); }
  });
  admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(schema);
  await admin.query(seed);
  await admin.query(`alter role akademik_app password '${appPassword}'`);
  const { rows: [role] } = await admin.query("select rolsuper, rolbypassrls from pg_roles where rolname = 'akademik_app'");
  assert.equal(role.rolsuper, false);
  assert.equal(role.rolbypassrls, false);
  report.databaseRole = { superuser: false, bypassRls: false, applicationPoolMax: 5 };
  // One account per virtual reader, max_sessions=1. Grant seats match the peak.
  const salt = randomBytes(16).toString('hex');
  const hash = `scrypt$${salt}$${scryptSync(userPassword, salt, 64).toString('hex')}`;
  const maxUsers = Math.max(...stages);
  await admin.query('update grants set seat_limit = $1', [maxUsers]);
  for (let i = 0; i < maxUsers; i++) await admin.query(
    `insert into users (id,tenant_id,email,display_name,role,password_hash,max_sessions) values ($1,$2,$3,$3,'reader',$4,1)`,
    [randomUUID(), tenant, `capacity-${i}@load.invalid`, hash]);
  await admin.query('delete from collection_items');
  await admin.query('delete from assets');
  await admin.query('delete from editions');
  await admin.query('delete from works');
  const books = [];
  const text = 'Academic research implant complications diagnosis treatment prevention. Akademik araştırma implant komplikasyonları tanı tedavi.';
  for (let i = 0; i < booksCount; i++) {
    const id = randomUUID(), edition = randomUUID(), asset = randomUUID();
    await admin.query("insert into works (id,tenant_id,title,language,abstract) values ($1,$2,$3,'en',$4)", [id, tenant, `Capacity research book ${i + 1}`, text]);
    await admin.query("insert into editions (id,tenant_id,work_id,publisher) values ($1,$2,$3,'Test Publisher')", [edition, tenant, id]);
    await admin.query("insert into assets (id,tenant_id,edition_id,format,storage_key,page_count,text_content,access_status,watermark) values ($1,$2,$3,'pdf','seed/sample.pdf',6,$4,'restricted',false)", [asset, tenant, edition, text]);
    for (let page = 1; page <= 6; page++) await admin.query(
      "insert into asset_pages (asset_id,tenant_id,page_no,text_content,text_search,source) values ($1,$2,$3,$4,$4,'pdf')", [asset, tenant, page, text]);
    books.push({ id, asset });
  }
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const appPort = socket.address().port;
  await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  base = `http://127.0.0.1:${appPort}`;
  // Process telemetry travels over IPC; the application source is unchanged.
  const wrapper = `import { monitorEventLoopDelay } from 'node:perf_hooks';
    const delay = monitorEventLoopDelay({resolution:20}); delay.enable();
    let previous=process.cpuUsage(), at=performance.now();
    setInterval(()=>{ const now=performance.now(), cpu=process.cpuUsage(previous); previous=process.cpuUsage();
      process.send?.({at:Date.now(),rss:process.memoryUsage().rss,cpuPercent:(cpu.user+cpu.system)/(now-at)/10,eventLoopP95Ms:delay.percentile(95)/1e6});
      at=now;delay.reset(); },1000).unref();
    await import(${JSON.stringify(pathToFileURL(path.join(sandbox, 'server.mjs')).href)});`;
  child = spawn(process.execPath, ['--input-type=module', '--eval', wrapper], {
    cwd: sandbox, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, DATABASE_URL: `postgres://akademik_app:${appPassword}@127.0.0.1:${port}/capacity_test`,
      PORT: String(appPort), DEMO_TENANT_ID: tenant, SESSION_SECRET: secret, APP_ENV: 'capacity-test', NODE_ENV: 'test',
      OPDS_API_KEY: '', OPDS_USER_EMAIL: '', SUSHI_API_KEY: '', OAI_TOKEN: '', NODE_OPTIONS: '' },
  });
  child.on('error', (error) => { childError = error; });
  child.on('message', (message) => { report.telemetry.push(message); });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => { appLog = (appLog + chunk).slice(-20_000); });
  await eventually(async () => {
    if (childError) throw childError;
    if (child.exitCode !== null) throw new Error(`Application exited: ${safeError(appLog)}`);
    const response = await fetch(base + '/api/health', { signal: AbortSignal.timeout(1000) });
    return response.ok && (await response.json()).mode === 'db';
  });
  return books;
}

async function stage(users, books) {
  console.log(`Stage ${users}: login burst, then ${duration}s authenticated workload`);
  const result = { users, startedAt: new Date().toISOString(), login: {}, endpoints: {}, completedCycles: 0, failedCycles: 0 };
  report.stages.push(result);
  const loginMetrics = {};
  const sessions = await Promise.all(Array.from({ length: users }, async (_, i) => {
    try {
      const { response } = await request(loginMetrics, 'login', '/api/login', null, { method: 'POST', body: { email: `capacity-${i}@load.invalid`, password: userPassword } });
      const cookies = response.headers.getSetCookie().map((value) => value.split(';')[0]);
      const token = cookies.find((value) => value.startsWith('akademik_csrf='));
      assert.ok(token && cookies.some((value) => value.startsWith('akademik_session=')), 'Login cookies missing');
      return { cookie: cookies.join('; '), csrf: decodeURIComponent(token.slice('akademik_csrf='.length)) };
    } catch { return null; }
  }));
  result.login = summarize(loginMetrics.login);
  result.admittedUsers = sessions.filter(Boolean).length;
  const metrics = {};
  const started = performance.now();
  const deadline = started + duration * 1000;
  await Promise.all(sessions.map(async (session, index) => {
    if (!session) return;
    let sequence = 0;
    while (!interrupted && performance.now() < deadline) {
      const book = books[(index + sequence++) % books.length];
      const anchor = { type: 'pdf', page: sequence % 6 + 1, asset_version_id: book.asset, rects: [[10, 10, 20, 10]] };
      let annotation;
      try {
        await request(metrics, 'catalog', '/api/books', session, { validate: (data) => assert.equal(data.length, booksCount) });
        await request(metrics, 'catalogSearch', '/api/search?q=research', session, { validate: (data) => assert.ok(data.length > 0) });
        await request(metrics, 'bookSearch', `/api/books/${book.id}/search?q=implant`, session, { validate: (data) => assert.ok(data.results?.length > 0 || Array.isArray(data) && data.length > 0, 'Expected indexed search hit') });
        await request(metrics, 'pdfRange', `/api/books/${book.id}/file`, session, { expected: 206, headers: { Range: 'bytes=0-65535' }, validate: (_, response, bytes) => {
          assert.equal(bytes.length, Math.min(65536, report.fixtureBytes));
          assert.ok(response.headers.get('content-range')?.startsWith('bytes 0-'));
        } });
        const progress = { assetId: book.asset, anchor, percent: anchor.page / 6 * 100 };
        await request(metrics, 'progressWrite', '/api/progress', session, { method: 'POST', body: progress });
        await request(metrics, 'progressRead', `/api/progress?assetId=${book.asset}`, session, { validate: (data) => assert.equal(data.anchor.page, anchor.page) });
        annotation = (await request(metrics, 'annotationCreate', '/api/annotations', session, { method: 'POST', expected: 201,
          body: { assetId: book.asset, anchor, color: 'yellow', note: `capacity ${runId}`, selectedText: 'implant', tags: 'capacity' }, validate: (data) => assert.ok(data.id) })).data.id;
        await request(metrics, 'annotationPatch', `/api/annotations/${annotation}`, session, { method: 'PATCH', body: { note: 'capacity edited' }, validate: (data) => assert.equal(data.note, 'capacity edited') });
        await request(metrics, 'annotationList', `/api/annotations?assetId=${book.asset}`, session, { validate: (data) => assert.ok(data.some((row) => row.id === annotation)) });
        result.completedCycles++;
      } catch { result.failedCycles++; }
      finally {
        if (annotation) await request(metrics, 'annotationDelete', `/api/annotations/${annotation}`, session, { method: 'DELETE' }).catch(() => {});
      }
      await pause(Math.min(thinkMs, Math.max(0, deadline - performance.now())));
    }
  }));
  result.elapsedSeconds = +((performance.now() - started) / 1000).toFixed(3);
  result.endpoints = Object.fromEntries(Object.entries(metrics).map(([label, value]) => [label, summarize(value)]));
  const combined = metric();
  for (const value of Object.values(metrics)) {
    for (const sample of value.samples) combined.samples.push(sample);
    combined.errors += value.errors; combined.bytes += value.bytes;
  }
  result.total = summarize(combined);
  result.requestsPerSecond = +(result.total.requests / result.elapsedSeconds).toFixed(2);
  result.functionalPass = result.admittedUsers === users && result.total.requests > 0 && result.total.errors === 0;
  const cleanupMetrics = {};
  await Promise.all(sessions.filter(Boolean).map((session) => request(cleanupMetrics, 'logout', '/api/logout', session, { method: 'POST' }).catch(() => {})));
  result.logout = summarize(cleanupMetrics.logout || metric());
  result.functionalPass &&= result.logout.errors === 0;
  // Snapshot, not a continuous DB CPU/memory profile.
  result.postgresStats = await docker('stats', '--no-stream', '--format', '{{json .}}', container).then(JSON.parse).catch((error) => ({ error: safeError(error) }));
  console.log(`Stage ${users}: ${result.functionalPass ? 'PASS' : 'FAIL'}, ${result.total.requests} requests, p95 ${result.total.p95Ms}ms, errors ${result.total.errors}, ${result.requestsPerSecond} req/s`);
  if (!result.functionalPass) throw new Error(`Stage ${users} failed; higher stages skipped`);
}

async function cleanup() {
  if (child && child.exitCode === null) {
    child.kill();
    await Promise.race([once(child, 'exit').catch(() => {}), pause(5000)]);
    report.cleanup.appStopped = child.exitCode !== null || child.signalCode !== null;
  }
  if (admin) await admin.end().catch(() => {});
  if (containerCreated) {
    // Verify identity before the only destructive Docker operation.
    const label = await docker('inspect', '--format', '{{index .Config.Labels "akademik.capacity-test"}}', container);
    assert.equal(label, runId, 'Refuse to remove container without matching run label');
    await docker('rm', '--force', container);
    report.cleanup.databaseRemoved = true;
  }
  if (temporary) {
    const tempParent = path.resolve(appDir, 'tmp') + path.sep;
    assert.ok(path.resolve(temporary).startsWith(tempParent) && path.basename(temporary).startsWith('load-capacity-'), 'Unsafe temporary deletion target');
    await rm(temporary, { recursive: true, force: true });
    report.cleanup.temporaryAppRemoved = true;
  }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { interrupted = true; });
try {
  await mkdir(output, { recursive: true });
  console.log('Provisioning an isolated PostgreSQL container and temporary application; existing services are untouched.');
  const books = await setup();
  for (const users of stages) {
    assert.ok(!interrupted, 'Interrupted');
    await stage(users, books);
  }
  report.status = 'passed';
} catch (error) {
  report.status = interrupted ? 'interrupted' : 'failed';
  report.error = safeError(error);
  console.error(report.error);
  process.exitCode = 1;
} finally {
  await cleanup().catch((error) => { report.cleanup.error = safeError(error); process.exitCode = 1; report.status = 'failed'; });
  report.finishedAt = new Date().toISOString();
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`Report: ${path.join(output, 'results.json')}`);
}
