import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const appDir = path.join(root, 'spike/app');
const pg = createRequire(path.join(appDir, 'package.json'))('pg');
const exec = promisify(execFile);
const pin = '1c2ab001e60a633d1c4a3241e34b95645d34f020';
const runId = randomUUID();
const container = `akademik-v118-clone-${runId}`;
const envPassword = randomBytes(24).toString('hex');
const appPassword = randomBytes(24).toString('hex');
const fixturePassword = randomBytes(24).toString('hex');
const sessionSecret = randomBytes(32).toString('hex');
const secrets = [envPassword, appPassword, fixturePassword, sessionSecret];
const tenantId = randomUUID(), userId = randomUUID(), workId = randomUUID(), editionId = randomUUID(), assetId = randomUUID();
const compose = ['compose', '--project-name', 'akademik-platform-prod', '--env-file', '.env.production', '-f', 'docker-compose.prod.yml'];
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const reuseIndex = process.argv.indexOf('--reuse-backup');
const reuseBackup = reuseIndex >= 0;
const backup = reuseBackup ? path.resolve(root, process.argv[reuseIndex + 1] || '') : path.join(root, 'backups', `akademik-pre-v118-clone-${stamp}-${runId.slice(0, 8)}.dump`);
assert.ok(backup.startsWith(path.resolve(root, 'backups') + path.sep) && backup.endsWith('.dump'), 'backup path must remain inside ignored backups directory');
const evidence = path.join(root, 'docs/security-evidence', `v118-clone-2026-10-23-${runId.slice(0, 8)}`);
const report = { runId, sourceCommit: pin, startedAt: new Date().toISOString(), status: 'running', productionAccess: 'read-only Docker inspection and pg_dump only; no production SQL writes, migrations, restarts or deploy', steps: [], sources: {}, cleanup: {} };
let temporary, admin, appChild, containerCreated = false, childLog = '';
const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const sha = value => createHash('sha256').update(value).digest('hex');
function safe(error) {
  let text = String(error?.message || error);
  for (const secret of secrets) text = text.replaceAll(secret, '[redacted]');
  return text.replace(/postgres(?:ql)?:\/\/[^\s]+/g, '[database URL redacted]').replace(/[\w.+-]+@[\w.-]+/g, '[email redacted]').slice(0, 1200);
}
async function command(file, args, extra = {}) {
  return (await exec(file, args, { cwd: root, timeout: 90_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true, ...extra })).stdout;
}
const docker = async (...args) => String(await command('docker', args)).trim();
async function pinned(relative) {
  const bytes = await command('git', ['show', `${pin}:${relative}`], { encoding: 'buffer' });
  report.sources[relative] = sha(bytes);
  return bytes;
}
function step(action, details = {}) {
  report.steps.push({ action, at: new Date().toISOString(), ...details });
  console.log(action);
}
async function eventually(label, fn, ms = 60_000) {
  const until = Date.now() + ms;
  let last;
  do { try { if (await fn()) return; } catch (error) { last = error; } await pause(150); } while (Date.now() < until);
  throw new Error(`${label}: ${safe(last || 'timeout')}`);
}
async function productionState() {
  const state = {};
  for (const service of ['db', 'web']) {
    const id = await docker(...compose, 'ps', '-q', service);
    assert.match(id, /^[a-f0-9]{64}$/);
    state[service] = await docker('inspect', '--format', '{{.Id}}|{{.Image}}|{{.State.StartedAt}}|{{.RestartCount}}', id);
  }
  return state;
}
async function streamProcess(args, input, output) {
  const child = spawn('docker', args, { cwd: root, windowsHide: true, stdio: [input ? 'pipe' : 'ignore', output ? 'pipe' : 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8000); });
  const ended = once(child, 'exit');
  const streams = [];
  if (input) streams.push(pipeline(createReadStream(input), child.stdin));
  if (output) streams.push(pipeline(child.stdout, createWriteStream(output, { flags: 'wx' })));
  await Promise.all(streams);
  const [code] = await ended;
  if (code !== 0) throw new Error(`Docker stream operation failed (exit ${code}): ${safe(stderr)}`);
}
async function schemaSignature() {
  return (await admin.query(`select jsonb_agg(jsonb_build_object(
    'table',c.relname,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
    'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attnum)
      from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
    'policies',(select jsonb_agg(jsonb_build_object('name',p.polname,'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) order by p.polname) from pg_policy p where p.polrelid=c.oid)) order by c.relname) as signature
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'`)).rows[0].signature;
}
async function migrationState() {
  return (await admin.query(`select jsonb_build_object(
    'tables',(select jsonb_agg(jsonb_build_object('name',relname,'rls',relrowsecurity,'forceRls',relforcerowsecurity) order by relname) from pg_class where oid in ('download_tickets'::regclass,'download_ticket_limits'::regclass)),
    'markerColumn',(select count(*)=1 from information_schema.columns where table_schema='public' and table_name='tenants' and column_name='download_grants_required'),
    'markedGrantTenants',(select count(*)::int from tenants t where t.download_grants_required and (exists(select 1 from grants g where g.tenant_id=t.id) or exists(select 1 from grant_audit a where a.tenant_id=t.id))),
    'configuredGrantTenants',(select count(*)::int from tenants t where exists(select 1 from grants g where g.tenant_id=t.id) or exists(select 1 from grant_audit a where a.tenant_id=t.id)),
    'trigger',(select count(*)=1 from pg_trigger where tgname='remember_download_grant_policy' and not tgisinternal),
    'limitsPk',(select pg_get_constraintdef(oid) from pg_constraint where conrelid='download_ticket_limits'::regclass and contype='p')) as state`)).rows[0].state;
}
async function appSmoke(appUrl) {
  const health = await fetch(appUrl + '/api/health');
  assert.equal(health.status, 200); assert.equal((await health.json()).mode, 'db');
  const config = await fetch(appUrl + '/api/config').then(r => r.json());
  assert.equal(config.version, '118'); assert.equal(config.buildSha, pin);
  const login = await fetch(appUrl + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'reader@clone.invalid', password: fixturePassword }) });
  assert.equal(login.status, 200);
  const pairs = login.headers.getSetCookie().map(value => value.split(';')[0]);
  const csrf = decodeURIComponent(pairs.find(value => value.startsWith('akademik_csrf=')).slice('akademik_csrf='.length));
  const headers = { cookie: pairs.join('; '), 'x-csrf-token': csrf, 'content-type': 'application/json' };
  const issued = await fetch(`${appUrl}/api/books/${workId}/download-ticket`, { method: 'POST', headers, body: '{}' });
  assert.equal(issued.status, 201);
  const { ticket, expiresIn } = await issued.json();
  secrets.push(ticket); assert.match(ticket, /^[a-f0-9]{64}$/); assert.equal(expiresIn, 60);
  const downloaded = await fetch(`${appUrl}/api/books/${workId}/download`, { method: 'POST', headers, body: JSON.stringify({ ticket }) });
  assert.equal(downloaded.status, 200); assert.match(downloaded.headers.get('content-type'), /application\/pdf/);
  const bytes = new Uint8Array(await downloaded.arrayBuffer()); assert.ok(bytes.length > 100);
  const replay = await fetch(`${appUrl}/api/books/${workId}/download`, { method: 'POST', headers, body: JSON.stringify({ ticket }) });
  assert.equal(replay.status, 403);
  const dbTicket = (await admin.query('select token_hash,consumed_at from download_tickets where tenant_id=$1', [tenantId])).rows;
  assert.equal(dbTicket.length, 1); assert.equal(dbTicket[0].token_hash, sha(ticket)); assert.ok(dbTicket[0].consumed_at);
  report.cloneSmoke = { health: 200, mode: 'db', version: config.version, buildSha: config.buildSha, login: 200, issue: 201, ttl: 60, consume: 200, replay: 403, pdfBytes: bytes.length, hashedTicketStored: true, consumedAtStored: true };
}

try {
  await mkdir(evidence, { recursive: true });
  const reviewManifest = JSON.parse(await readFile(path.join(root, 'docs/security-evidence/v118-2026-10-23/manifest.json')));
  const oldReportBytes = await readFile(path.join(root, 'docs/security-evidence/v118-2026-10-23/social-drm-results.json'));
  assert.equal(sha(oldReportBytes), reviewManifest.socialDrm.sha256);
  const oldReport = JSON.parse(oldReportBytes); assert.equal(oldReport.status, 'passed'); assert.equal(oldReport.checks, 295);
  for (const item of reviewManifest.sources) {
    const blob = String(await command('git', ['rev-parse', `${pin}:${item.file}`])).trim();
    assert.equal(blob, item.gitBlobAfterLfNormalization, `Pinned evidence source changed: ${item.file}`);
  }
  report.existingIntegration = { report: '../v118-2026-10-23/social-drm-results.json', sha256: sha(oldReportBytes), checks: oldReport.checks, sourceBlobsMatchPin: true,
    realDatabaseIssueTrafficLimitsAndPurge: oldReport.scenarios.filter(x => /issue10|maintenance/.test(x)), rerun: false };
  step('Pinned source and existing 295-check real PostgreSQL evidence verified');
  report.productionBefore = await productionState();
  await mkdir(path.dirname(backup), { recursive: true });
  if (!reuseBackup) await streamProcess([...compose, 'exec', '-T', '-e', 'PGOPTIONS=-c default_transaction_read_only=on', 'db', 'sh', '-c', 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc'], null, backup);
  const backupBytes = await readFile(backup);
  assert.ok(backupBytes.length > 1000 && backupBytes.subarray(0, 5).toString() === 'PGDMP');
  if (reuseBackup) assert.equal(sha(backupBytes), process.argv[reuseIndex + 2], 'reused fresh backup SHA must match first attempt');
  report.backup = { file: path.relative(root, backup).split(path.sep).join('/'), bytes: backupBytes.length, sha256: sha(backupBytes), format: 'PostgreSQL custom archive; unchanged full pg_dump including original ACL/owner metadata', containsProductionData: true, publish: false };
  report.backup.reusedAfterFixtureCorrection = reuseBackup;
  step(reuseBackup ? 'Same fresh production backup hash verified; no second pg_dump' : 'Fresh read-only production backup saved', report.backup);
  await docker('run', '--detach', '--rm', '--name', container, '--label', `akademik.clone-test=${runId}`, '--tmpfs', '/var/lib/postgresql/data', '--publish', '127.0.0.1::5432', '--env', 'POSTGRES_USER=clone_admin', '--env', 'POSTGRES_DB=clone_test', '--env', `POSTGRES_PASSWORD=${envPassword}`, 'postgres:16-alpine');
  containerCreated = true;
  const dbPort = Number((await docker('port', container, '5432/tcp')).match(/:(\d+)\s*$/)?.[1]); assert.ok(dbPort);
  await eventually('clone PostgreSQL readiness', async () => {
    const probe = new pg.Client({ connectionString: `postgres://clone_admin:${envPassword}@127.0.0.1:${dbPort}/clone_test`, connectionTimeoutMillis: 1000 });
    try { await probe.connect(); return true; } finally { await probe.end().catch(() => {}); }
  });
  await streamProcess(['exec', '-i', container, 'pg_restore', '-U', 'clone_admin', '-d', 'clone_test', '--exit-on-error', '--no-owner', '--no-acl'], backup, null);
  admin = new pg.Client({ connectionString: `postgres://clone_admin:${envPassword}@127.0.0.1:${dbPort}/clone_test` }); await admin.connect();
  report.baselineSchema = await schemaSignature();
  report.baselineSchemaSha256 = sha(JSON.stringify(report.baselineSchema));
  const tableNames = report.baselineSchema.map(table => table.table);
  for (const name of ['tenants', 'users', 'works', 'assets', 'asset_pages', 'user_sessions', 'grants', 'grant_audit', 'user_groups', 'user_group_members']) assert.ok(tableNames.includes(name), `Missing pre-013 table ${name}`);
  assert.ok(!tableNames.includes('download_tickets') && !tableNames.includes('download_ticket_limits'));
  assert.ok(!report.baselineSchema.find(table => table.table === 'tenants').columns.some(column => column.name === 'download_grants_required'));
  const columns = (table, names) => names.forEach(name => assert.ok(report.baselineSchema.find(item => item.table === table).columns.some(column => column.name === name), `Missing baseline ${table}.${name}`));
  columns('users', ['password_hash', 'session_version', 'max_sessions']); columns('asset_pages', ['locator', 'text_fold', 'text_words']); columns('grants', ['scope_key']); columns('annotations', ['tags']);
  report.baselineVersion = { featureSignature: '001–012 features present; 013/014 tables and marker absent', formalMigrationLedgerAsserted: false };
  step('Production backup restored; effective 001–012 schema confirmed before app startup');
  await admin.query('create role akademik_app login password \'' + appPassword + '\'');
  await admin.query('grant usage on schema public to akademik_app; grant select,insert,update,delete on all tables in schema public to akademik_app; grant usage,select on all sequences in schema public to akademik_app');
  const migration13 = await pinned('db/migrations/013-download-tickets.sql');
  const migration14 = await pinned('db/migrations/014-download-ticket-limits.sql');
  for (const [name, bytes] of [['013', migration13], ['014', migration14], ['013-repeat', migration13], ['014-repeat', migration14]]) {
    await admin.query(bytes.toString('utf8')); step(`Applied pinned migration ${name} to clone only`);
  }
  report.migratedState = await migrationState();
  for (const table of report.migratedState.tables) assert.ok(table.rls && table.forceRls);
  assert.ok(report.migratedState.markerColumn && report.migratedState.trigger);
  assert.equal(report.migratedState.markedGrantTenants, report.migratedState.configuredGrantTenants);
  assert.equal(report.migratedState.limitsPk, 'PRIMARY KEY (tenant_id, user_id, kind)');
  await writeFile(path.join(evidence, 'restored-schema-before.json'), JSON.stringify(report.baselineSchema, null, 2) + '\n');
  const salt = randomBytes(16).toString('hex'); const hash = `scrypt$${salt}$${scryptSync(fixturePassword, salt, 64).toString('hex')}`;
  // Production identities and personal note/audit contents never enter the app
  // smoke or public evidence. Sanitization happens AFTER real-data migrations.
  await admin.query('delete from user_sessions; delete from annotations; delete from reading_progress; delete from audit_events; delete from grant_audit');
  await admin.query("update users set email='clone-'||id::text||'@invalid.test',display_name='Clone account',password_hash=$1,session_version=session_version+1", [hash]);
  await admin.query("update tenants set name='Clone institution',slug='clone-'||id::text");
  await admin.query("insert into tenants(id,name,slug) values($1,'Clone fixture institution',$2)", [tenantId, 'fixture-' + tenantId]);
  await admin.query("insert into users(id,tenant_id,email,display_name,role,password_hash,max_sessions) values($1,$2,'reader@clone.invalid','Clone fixture reader','reader',$3,1)", [userId, tenantId, hash]);
  await admin.query("insert into works(id,tenant_id,title,language) values($1,$2,'Clone test fixture','en')", [workId, tenantId]);
  await admin.query('insert into editions(id,tenant_id,work_id) values($1,$2,$3)', [editionId, tenantId, workId]);
  await admin.query("insert into assets(id,tenant_id,edition_id,format,storage_key,watermark,allow_download) values($1,$2,$3,'pdf','seed/clone.pdf',false,true)", [assetId, tenantId, editionId]);
  await admin.query("insert into grants(tenant_id,subject_type,subject_id,scope_type,status) values($1,'tenant',$1,'all','active')", [tenantId]);
  const tempParent = path.join(appDir, 'tmp'); await mkdir(tempParent, { recursive: true }); temporary = await mkdtemp(path.join(tempParent, 'migration-clone-'));
  await mkdir(path.join(temporary, 'app/public/seed'), { recursive: true });
  for (const relative of ['server.mjs', 'indexer.mjs', 'download-tickets.mjs', 'social-watermark.mjs', 'public/search.mjs']) await writeFile(path.join(temporary, 'app', relative), await pinned(`spike/app/${relative}`));
  await writeFile(path.join(temporary, 'app/public/seed/clone.pdf'), await pinned('spike/app/public/seed/sample.pdf'));
  const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening'); const appPort = socket.address().port; await new Promise(resolve => socket.close(resolve));
  let childError;
  appChild = spawn(process.execPath, ['server.mjs'], { cwd: path.join(temporary, 'app'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_OPTIONS: '', DATABASE_URL: `postgres://akademik_app:${appPassword}@127.0.0.1:${dbPort}/clone_test`, PORT: String(appPort), DEMO_TENANT_ID: tenantId, SESSION_SECRET: sessionSecret, APP_VERSION: '118', BUILD_SHA: pin, APP_ENV: 'migration-clone-test', SOCIAL_DRM_B2B: 'true' } });
  appChild.on('error', error => { childError = error; }); for (const stream of [appChild.stdout, appChild.stderr]) stream.on('data', chunk => { childLog = (childLog + chunk).slice(-10_000); });
  const appUrl = `http://127.0.0.1:${appPort}`;
  step('v118 clone app started only after both migrations and idempotency checks');
  await eventually('clone application readiness', async () => { if (childError) throw childError; assert.equal(appChild.exitCode, null); return (await fetch(appUrl + '/api/health', { signal: AbortSignal.timeout(1000) })).ok; });
  await appSmoke(appUrl); step('Clone v118 health/login/ticket/download/replay smoke passed');
  report.productionAfter = await productionState(); assert.deepEqual(report.productionAfter, report.productionBefore);
  report.productionContainersUnchanged = true; report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = safe(error); console.error(report.error); process.exitCode = 1; }
finally {
  try {
    if (appChild && appChild.exitCode === null && appChild.signalCode === null) { const exited = once(appChild, 'exit'); appChild.kill(); await Promise.race([exited, pause(3000)]); if (appChild.exitCode === null && appChild.signalCode === null) { appChild.kill('SIGKILL'); await exited; } }
    report.cleanup.appStopped = !appChild || appChild.exitCode !== null || appChild.signalCode !== null;
    await admin?.end().catch(() => {});
    if (containerCreated) { assert.equal(await docker('inspect', '--format', '{{index .Config.Labels "akademik.clone-test"}}', container), runId); await docker('rm', '--force', container); report.cleanup.cloneDatabaseRemoved = true; }
    if (temporary) { const relative = path.relative(path.join(appDir, 'tmp'), path.resolve(temporary)); assert.ok(relative.startsWith('migration-clone-') && !relative.includes(path.sep) && !path.isAbsolute(relative)); await rm(path.resolve(temporary), { recursive: true, force: true }); report.cleanup.temporaryAppRemoved = true; }
  } catch (error) { report.cleanup.error = safe(error); report.status = 'failed'; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); await mkdir(evidence, { recursive: true });
  await writeFile(path.join(evidence, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`Clone validation: ${report.status}; evidence ${path.relative(root, evidence)}`);
  if (report.backup) console.log(`Backup: ${report.backup.file}; SHA256 ${report.backup.sha256}`);
}
