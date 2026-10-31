// A download must be decided by the same authority as the file: the reader's
// institution and a grant that covers this title.
//
// Measured on staging: institution B held no grant. Its catalogue was empty and
// GET /api/books/:id/file answered 404, yet POST /download-ticket answered 201
// and POST /download streamed the PDF. The ticket path was not checking access at
// all, so a PDF a reader could not even see was a PDF they could download. The
// catalogue boundary hid it from the UI, which is why it survived.
//
// The fixture is the production shape: two institutions, the catalogue under
// LibEdge (the staff tenant, which holds the 'all' grant from 020), and a second
// institution with a reader of its own. `download_grants_required` is true for both,
// as it is on every tenant that has ever held a grant (013), so the tenant-wide
// relaxation in allowedGrantIds() cannot be mistaken for access here.
//
// Every negative case below failed before the fix unless the assertion says
// otherwise; each one is a distinct way to reach the bytes.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import pg from 'pg';
import { copyServerFiles } from './helpers/server-files.mjs';

const exec = promisify(execFile);
const appDir = fileURLToPath(new URL('../', import.meta.url));
const repoDir = path.resolve(appDir, '../..');
const tempParent = path.join(appDir, 'tmp');
const runId = randomUUID();
const container = `akademik-download-${runId}`;

// Measured EC2 identifiers, as in tenant-access.integration.mjs: the catalogue
// really does live under the staff tenant.
const LIBEDGE_TENANT = '5799f2a5-3d90-41b1-90de-9da07d776052';
const INSTITUTION_B = '22222222-2222-2222-2222-222222222222';
const ALL_GRANT = '99999999-9999-9999-9999-999999999999';
const TITLE_GRANT = '88888888-8888-8888-8888-888888888888';
const SECOND_TITLE_GRANT = '55555555-5555-5555-5555-555555555555';
// A grant scoped to one title that is NOT the title being downloaded. Its
// existence is what makes "the reader has a grant" true while "the reader may have
// this book" is false.
const OTHER_TITLE_GRANT = '66666666-6666-6666-6666-666666666666';

const WORKS = [1, 2].map((suffix) => ({
  work: `a0000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`,
  edition: `b0000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`,
  asset: `c0000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`,
  title: `Staging regression title 0${suffix}`,
}));

// In the database, absent from every grant. The staff tenant's 'all' grant covers it;
// reader A's title-scoped grant does not, so it is the "wrong title" a reader who
// otherwise holds a grant must still be refused.
const UNGRANTED = {
  work: 'a1111111-0000-4000-8000-000000000001',
  edition: 'b1111111-0000-4000-8000-000000000001',
  asset: 'c1111111-0000-4000-8000-000000000001',
  title: 'Staging regression title (ungranted by everyone else)',
};

const adminPassword = randomBytes(24).toString('hex');
const appPassword = randomBytes(24).toString('hex');
const userPassword = randomBytes(18).toString('hex');
const sessionSecret = randomBytes(32).toString('hex');
const children = [];
let tempDir;
let admin;
let cleanupPromise;
let checks = 0;
let scenarios = 0;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function docker(...args) {
  return (await exec('docker', args, { timeout: 90_000, maxBuffer: 1024 * 1024 })).stdout.trim();
}

async function eventually(label, fn, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  do {
    try { if (await fn()) return; } catch (error) { lastError = error; }
    await pause(200);
  } while (Date.now() < deadline);
  throw new Error(`${label} timed out${lastError ? `: ${lastError.message}` : ''}`);
}

async function freePort() {
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  return port;
}

function check(condition, message) {
  assert.ok(condition, message);
  checks++;
}

// A one-page PDF written by hand. Deliberately not %PDF-1.4 in a text file: the
// watermark step parses and re-serialises the document, so anything that is not a
// real PDF fails with a 409 before the access decision can be observed.
function minimalPdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '<< /Length 44 >>\nstream\nBT /F1 12 Tf 20 100 Td (Entitlement fixture) Tj ET\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

// DEMO_TENANT_ID is set to the OTHER institution on purpose. The old ticket code
// only compared it to the bound tenant, so a fixture that put both on the same value
// could pass while the session's own institution was ignored.
async function startApp(databaseUrl, extraEnv = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: path.join(tempDir, 'app'),
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      DATABASE_CATALOG_URL: '',
      STORAGE_DRIVER: 'local',
      PORT: String(port),
      DEMO_TENANT_ID: INSTITUTION_B,
      SESSION_SECRET: sessionSecret,
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const entry = { child, log: '', error: null, base: `http://127.0.0.1:${port}` };
  children.push(entry);
  child.on('error', (error) => { entry.error = error; });
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => { entry.log = (entry.log + chunk).slice(-20_000); });
  }
  await eventually('app startup', async () => {
    if (entry.error) throw entry.error;
    assert.equal(child.exitCode, null, `server exited: ${entry.log}`);
    const response = await fetch(`${entry.base}/api/health`, { signal: AbortSignal.timeout(2000) });
    assert.equal((await response.json()).mode, 'db');
    return response.ok;
  }, 60_000);
  return entry.base;
}

async function request(base, route, session, { method = 'GET', body, headers: extraHeaders = {} } = {}) {
  const headers = { ...extraHeaders };
  if (session) {
    headers.cookie = session.cookie;
    headers['x-csrf-token'] = session.csrf;
  }
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const response = await fetch(base + route, {
    method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(30_000),
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  const text = buffer.toString('latin1');
  let data;
  try { data = JSON.parse(buffer.toString('utf8')); } catch { /* binary delivery */ }
  const cookies = response.headers.getSetCookie().map((cookie) => cookie.split(';')[0]);
  return { status: response.status, headers: response.headers, buffer, text, data, cookies };
}

async function login(base, email, expected = 200) {
  const result = await request(base, '/api/login', null, {
    method: 'POST', body: { email, password: userPassword },
  });
  assert.equal(result.status, expected, `login ${email}: ${result.text}`);
  const csrf = result.cookies.find((cookie) => cookie.startsWith('akademik_csrf='));
  return {
    ...result,
    cookie: result.cookies.join('; '),
    csrf: csrf ? decodeURIComponent(csrf.slice('akademik_csrf='.length)) : '',
  };
}

// The two POSTs the reader's download code makes (public/downloads.mjs).
async function ticket(base, session, bookId) {
  const issued = await request(base, `/api/books/${bookId}/download-ticket`, session, {
    method: 'POST', body: {},
  });
  if (issued.status !== 201) return { issued, delivered: null };
  const delivered = await request(base, `/api/books/${bookId}/download`, session, {
    method: 'POST', body: { ticket: issued.data.ticket },
  });
  return { issued, delivered };
}

async function visibleTitles(base, session) {
  const result = await request(base, '/api/books', session);
  assert.equal(result.status, 200, `list books: ${result.text}`);
  const books = Array.isArray(result.data) ? result.data : result.data?.books;
  assert.ok(Array.isArray(books), `expected an array, got: ${result.text.slice(0, 200)}`);
  return books.map((book) => book.work_title || book.title).sort();
}
async function setup() {
  await docker('version', '--format', '{{.Server.Version}}');
  await mkdir(tempParent, { recursive: true });
  tempDir = await mkdtemp(path.join(tempParent, 'download-'));
  const sandboxApp = path.join(tempDir, 'app');
  await mkdir(path.join(sandboxApp, 'public', 'seed'), { recursive: true });
  await copyServerFiles(appDir, sandboxApp);
  // A real, minimal PDF: delivery watermarks the bytes with pdf-lib, so a
  // placeholder string would fail on the stamp path and mask the access decision
  // under test as a 409. Built here rather than checked in as a binary.
  await writeFile(path.join(sandboxApp, 'public', 'seed', 'download.pdf'), minimalPdf());

  await docker('run', '--detach', '--rm', '--name', container,
    '--label', `akademik.download-test=${runId}`,
    '--tmpfs', '/var/lib/postgresql/data',
    '--publish', '127.0.0.1::5432',
    '--env', 'POSTGRES_USER=download_admin',
    '--env', 'POSTGRES_DB=download_test',
    '--env', `POSTGRES_PASSWORD=${adminPassword}`, 'postgres:16-alpine');
  const mapping = await docker('port', container, '5432/tcp');
  const port = Number(mapping.match(/:(\d+)\s*$/)?.[1]);
  assert.ok(port, `unexpected port mapping: ${mapping}`);
  const adminUrl = `postgres://download_admin:${adminPassword}@127.0.0.1:${port}/download_test`;
  await eventually('PostgreSQL readiness', async () => {
    const probe = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 1000 });
    try { await probe.connect(); return true; } finally { await probe.end().catch(() => {}); }
  }, 60_000);
  admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(await readFile(path.join(repoDir, 'db/schema.sql'), 'utf8'));
  await admin.query(`alter role akademik_app password '${appPassword}'`);
  // Login resolves an email to a tenant before any tenant is bound; run the real
  // migration rather than a copy of it.
  await admin.query(await readFile(path.join(repoDir, 'db/migrations/018-tenant-for-login.sql'), 'utf8'));

  const { rows: [role] } = await admin.query(
    "select rolsuper, rolbypassrls from pg_roles where rolname = 'akademik_app'",
  );
  assert.equal(role.rolsuper, false, 'the app role must not be a superuser');
  assert.equal(role.rolbypassrls, false, 'the app role must not bypass RLS');

  // Both tenants carry the policy marker 013 sets on any tenant that has ever
  // held a grant. Without it, allowedGrantIds()'s tenant-wide relaxation would
  // make scenario 1 pass for the wrong reason.
  await admin.query(
    `insert into tenants (id, name, slug, download_grants_required) values
       ($1, 'LibEdge', 'libedge', true),
       ($2, 'Kurum B', 'kurum-b', true)`, [LIBEDGE_TENANT, INSTITUTION_B],
  );

  const salt = randomBytes(16).toString('hex');
  const hash = `scrypt$${salt}$${scryptSync(userPassword, salt, 64).toString('hex')}`;
  const users = {};
  for (const [key, tenantId, email, roleName] of [
    ['staff', LIBEDGE_TENANT, 'staff@libedge.com', 'admin'],
    ['readerA', LIBEDGE_TENANT, 'reader-a@libedge.com', 'reader'],
    // A second granted reader. The issue budget is 10 per user per minute and the
    // denial scenarios below spend it (see scenario 11), so they get their own
    // account instead of starving the positive cases.
    ['readerA2', LIBEDGE_TENANT, 'reader-a2@libedge.com', 'reader'],
    ['readerB', INSTITUTION_B, 'reader-b@kurumb.example.edu.tr', 'reader'],
  ]) {
    const id = randomUUID();
    await admin.query(
      `insert into users (id, tenant_id, email, display_name, role, password_hash, max_sessions)
       values ($1, $2, $3, $3, $4, $5, 10)`, [id, tenantId, email, roleName, hash],
    );
    users[key] = { id, email, tenantId };
  }

  // The catalogue is GLOBAL, as on staging: published by the staff tenant (022's
  // catalog_publish_work sets tenant_id to null) and therefore readable across
  // institutions. That is exactly why /api/books lists nothing for an institution
  // without a grant while getBook() still finds the title: the list is filtered by a
  // grant, the row is not. Reproducing staging means the rows must be global.
  for (const row of [...WORKS, UNGRANTED]) {
    await admin.query(
      `insert into works (id, tenant_id, title, language, subjects) values ($1, null, $2, 'en', '{}')`,
      [row.work, row.title],
    );
    await admin.query(
      `insert into editions (id, tenant_id, work_id, publisher) values ($1, null, $2, 'LibEdge Press')`,
      [row.edition, row.work],
    );
    await admin.query(
      `insert into assets (id, tenant_id, edition_id, format, storage_key, page_count)
       values ($1, null, $2, 'pdf', 'seed/download.pdf', 1)`,
      [row.asset, row.edition],
    );
  }

  // Reader A holds exactly one title, in kurum A. The staff tenant's 'all' grant
  // (020) belongs to LibEdge and is not a per-user entitlement for anyone else.
  await admin.query(
    `insert into grants (id, tenant_id, subject_type, subject_id, scope_type, scope_id, status)
     values ($1, $2, 'user', $3, 'title', $4, 'active')`,
    [TITLE_GRANT, LIBEDGE_TENANT, users.readerA.id, WORKS[0].work],
  );
  // Reader A2 holds the same title, for the scenarios that exhaust the issue budget.
  await admin.query(
    `insert into grants (id, tenant_id, subject_type, subject_id, scope_type, scope_id, status)
     values ($1, $2, 'user', $3, 'title', $4, 'active')`,
    [SECOND_TITLE_GRANT, LIBEDGE_TENANT, users.readerA2.id, WORKS[0].work],
  );
  await admin.query(
    `insert into grants (id, tenant_id, subject_type, subject_id, scope_type, status)
     values ($1, $2, 'tenant', $2, 'all', 'active')`, [ALL_GRANT, LIBEDGE_TENANT],
  );
  // Revoked immediately, and left in place because 013 flips the policy marker when
  // the last grant is deleted: the marker must be set for a tenant that has held a
  // grant, which is precisely the state in which a grantless user must be refused.
  await admin.query("update grants set status = 'revoked' where id = $1", [ALL_GRANT]);
  // Reader B - institution B - holds nothing. This is the staging state.
  const bGrants = await admin.query('select count(*)::int as n from grants where tenant_id = $1', [INSTITUTION_B]);
  assert.equal(bGrants.rows[0].n, 0, 'institution B must hold no grant for this fixture to reproduce staging');

  return { port, users };
}

const databaseUrl = (port) => `postgres://akademik_app:${appPassword}@127.0.0.1:${port}/download_test`;

// Scenario 1: the staging finding itself. Institution B, no grant, no catalogue,
// /file 404 - and yet a ticket was issued and the PDF was delivered.
async function ungrantedInstitutionTest(context) {
  const base = await startApp(databaseUrl(context.port));
  const session = await login(base, context.users.readerB.email);

  check((await visibleTitles(base, session)).length === 0,
    'institution B must see no catalogue for this test to mean anything');

  // Measure the authority the ticket has to agree with, before asking the ticket.
  const file = await request(base, `/api/books/${WORKS[0].asset}/file`, session);
  check(file.status === 404, `/file for an institution with no grant answered ${file.status}, expected 404`);

  const { issued, delivered } = await ticket(base, session, WORKS[0].asset);
  check(issued.status === 403,
    `download-ticket issued to an institution with no grant: ${issued.status} ${issued.text.slice(0, 200)}`);
  check(!issued.data?.ticket, 'a denied issue must not return a ticket');
  check(delivered === null, 'no delivery may be attempted without a ticket');

  scenarios++;
  console.log('PASS entitlement: an institution with no grant cannot obtain a download ticket.');
}

// Scenario 1b: the same institution, with the one flag that changes the outcome.
//
// `download_grants_required` is a tenant-wide marker from 013, set the first time a
// tenant ever holds a grant and never cleared, because it exists to distinguish "no
// grants configured yet" from "the last grant was deleted". allowedGrantIds() reads it
// as permission to skip the grant check entirely. That is the divergence: /file
// always requires grantAllows() to be true, the ticket path accepts "no grants
// needed", so a tenant whose flag is false - the state of a tenant provisioned
// straight from a subscription with no grant rows - gets 404 from /file and a 201 and
// a PDF from the ticket route. Measured both ways so the assertion names the cause and
// not just the symptom.
async function relaxationDivergenceTest(context) {
  const base = await startApp(databaseUrl(context.port));
  const session = await login(base, context.users.readerB.email);

  const { rows: [flag] } = await admin.query(
    'select download_grants_required from tenants where id = $1', [INSTITUTION_B]);
  check(flag.download_grants_required === true, 'the marker must start set for this test to isolate it');

  await admin.query('update tenants set download_grants_required = false where id = $1', [INSTITUTION_B]);
  try {
    const file = await request(base, `/api/books/${WORKS[0].asset}/file`, session);
    check(file.status === 404, `/file answered ${file.status} for a grantless institution, expected 404`);

    const { issued, delivered } = await ticket(base, session, WORKS[0].asset);
    check(issued.status === 403,
      `the tenant-wide relaxation issued a ticket /file would not allow: ${issued.status}`);
    check(delivered === null, 'no PDF may be delivered when /file refuses the same request');
  } finally {
    await admin.query('update tenants set download_grants_required = true where id = $1', [INSTITUTION_B]);
  }

  // The grant still decides, not the flag: with the marker off and a real grant for a
  // different title, the ungranted title stays closed.
  await admin.query(
    `insert into grants (id, tenant_id, subject_type, subject_id, scope_type, scope_id, status)
     values ($1, $2, 'user', $3, 'title', $4, 'active')`,
    [OTHER_TITLE_GRANT, INSTITUTION_B, context.users.readerB.id, WORKS[0].work],
  );
  try {
    await admin.query('update tenants set download_grants_required = false where id = $1', [INSTITUTION_B]);
    const granted = await ticket(base, session, WORKS[0].asset);
    check(granted.issued.status === 201,
      `a granted title was refused: ${granted.issued.status} ${granted.issued.text.slice(0, 200)}`);
    const other = await ticket(base, session, UNGRANTED.asset);
    check(other.issued.status === 403,
      `a title with no grant was issued a ticket: ${other.issued.status}`);
  } finally {
    await admin.query('delete from grants where id = $1', [OTHER_TITLE_GRANT]);
    await admin.query('update tenants set download_grants_required = true where id = $1', [INSTITUTION_B]);
  }

  scenarios++;
  console.log('PASS entitlement: the tenant-wide relaxation cannot outvote /file.');
}

// Scenario 2: the positive control. Without it, "deny everything" would pass
// scenario 1 and look like a fix.
async function grantedReaderTest(context) {
  const base = await startApp(databaseUrl(context.port));
  const session = await login(base, context.users.readerA.email);

  const titles = await visibleTitles(base, session);
  check(titles.includes(WORKS[0].title), `reader A must see the title they hold: ${titles.join(', ')}`);

  const file = await request(base, `/api/books/${WORKS[0].asset}/file`, session);
  check(file.status === 200, `/file for a granted reader answered ${file.status}`);
  check(file.buffer.subarray(0, 5).toString('latin1') === '%PDF-', `/file must serve the stored PDF: ${file.text.slice(0, 40)}`);

  const { issued, delivered } = await ticket(base, session, WORKS[0].asset);
  check(issued.status === 201, `granted reader was denied a ticket: ${issued.status} ${issued.text.slice(0, 200)}`);
  check(delivered.status === 200, `granted reader was denied the download: ${delivered.status} ${delivered.text.slice(0, 200)}`);
  check(delivered.buffer.subarray(0, 5).toString('latin1') === '%PDF-', 'the download must be PDF bytes');

  scenarios++;
  console.log('PASS entitlement: a reader with a grant for this title issues, consumes and receives the PDF.');
}

// Scenario 3: the wrong title. A grant that covers title 01 must not obtain title
// 02 - "the reader has some grant" is not "the reader may have this book".
async function wrongTitleTest(context) {
  const base = await startApp(databaseUrl(context.port));
  const session = await login(base, context.users.readerA.email);

  const file = await request(base, `/api/books/${UNGRANTED.asset}/file`, session);
  check(file.status === 404, `/file for an ungranted title answered ${file.status}, expected 404`);

  const { issued, delivered } = await ticket(base, session, UNGRANTED.asset);
  check(issued.status === 403,
    `ticket issued for a title the grant does not cover: ${issued.status} ${issued.text.slice(0, 200)}`);
  check(delivered === null, 'no delivery may be attempted without a ticket');

  scenarios++;
  console.log('PASS entitlement: a grant for one title does not authorise another.');
}

// Scenario 4: a ticket belongs to the user and institution that obtained it.
// A global catalogue makes this reachable: the work is readable by many, but the
// ticket was minted for one person.
async function crossInstitutionTicketTest(context) {
  const base = await startApp(databaseUrl(context.port));
  const holder = await login(base, context.users.readerA.email);
  const other = await login(base, context.users.readerB.email);

  const issued = await request(base, `/api/books/${WORKS[0].asset}/download-ticket`, holder, {
    method: 'POST', body: {},
  });
  check(issued.status === 201, `the ticket holder was denied a ticket: ${issued.status} ${issued.text.slice(0, 200)}`);

  // Institution B replays reader A's ticket byte for byte.
  const replayed = await request(base, `/api/books/${WORKS[0].asset}/download`, other, {
    method: 'POST', body: { ticket: issued.data.ticket },
  });
  check(replayed.status === 403, `another institution replayed a ticket and got ${replayed.status}`);
  check(replayed.buffer.subarray(0, 5).toString('latin1') !== '%PDF-', 'a rejected replay must not return the PDF');

  // Same institution, different user: the staff admin holds the 'all' grant and
  // still may not use somebody else's ticket.
  const staff = await login(base, context.users.staff.email);
  const staffReplay = await request(base, `/api/books/${WORKS[0].asset}/download`, staff, {
    method: 'POST', body: { ticket: issued.data.ticket },
  });
  check(staffReplay.status === 403, `a same-institution third party replayed a ticket and got ${staffReplay.status}`);

  // The failed attempts must not burn the ticket: the holder can still use it.
  const own = await request(base, `/api/books/${WORKS[0].asset}/download`, holder, {
    method: 'POST', body: { ticket: issued.data.ticket },
  });
  check(own.status === 200, `the holder could not use their own ticket after replay attempts: ${own.status}`);
  check(own.buffer.subarray(0, 5).toString('latin1') === '%PDF-', "the holder's own download must still deliver the PDF");

  scenarios++;
  console.log('PASS entitlement: a ticket cannot be used by another user or institution.');
}

// Scenario 5: the grant is withdrawn between issue and use.
//
// This is why consumption re-decides access instead of trusting the ticket. A
// ticket lives 60 seconds; a revocation landing inside that window must still stop
// the download, or a librarian's revocation is only advisory.
async function revokedBeforeConsumeTest(context) {
  const base = await startApp(databaseUrl(context.port));
  const session = await login(base, context.users.readerA2.email);

  const issued = await request(base, `/api/books/${WORKS[0].asset}/download-ticket`, session, {
    method: 'POST', body: {},
  });
  check(issued.status === 201, `ticket not issued: ${issued.status} ${issued.text.slice(0, 200)}`);

  await admin.query("update grants set status = 'revoked' where id = $1", [SECOND_TITLE_GRANT]);
  try {
    const delivered = await request(base, `/api/books/${WORKS[0].asset}/download`, session, {
      method: 'POST', body: { ticket: issued.data.ticket },
    });
    check(delivered.status === 403, `a ticket survived its grant being revoked: ${delivered.status}`);
    check(delivered.buffer.subarray(0, 5).toString('latin1') !== '%PDF-', 'a revoked grant must not deliver bytes');
  } finally {
    await admin.query("update grants set status = 'active' where id = $1", [SECOND_TITLE_GRANT]);
  }

  scenarios++;
  console.log('PASS entitlement: revoking the grant after issue rejects the download.');
}

// Scenario 6: the grant expires between issue and use. Revocation is a status,
// expiry is a clock; both must be re-read at consume time.
async function expiredGrantTest(context) {
  const base = await startApp(databaseUrl(context.port));
  const session = await login(base, context.users.readerA2.email);

  const issued = await request(base, `/api/books/${WORKS[0].asset}/download-ticket`, session, {
    method: 'POST', body: {},
  });
  check(issued.status === 201, `ticket not issued: ${issued.status} ${issued.text.slice(0, 200)}`);

  // Valid now, invalid well before the ticket's own 60 seconds are up - so the
  // rejection is attributable to the grant, not to the ticket.
  await admin.query(
    "update grants set valid_from = now() - interval '2 hours', valid_to = now() + interval '2 seconds' where id = $1",
    [SECOND_TITLE_GRANT],
  );
  try {
    await pause(2500);
    const delivered = await request(base, `/api/books/${WORKS[0].asset}/download`, session, {
      method: 'POST', body: { ticket: issued.data.ticket },
    });
    check(delivered.status === 403, `an expired grant still delivered: ${delivered.status}`);
    check(delivered.buffer.subarray(0, 5).toString('latin1') !== '%PDF-', 'an expired grant must not deliver bytes');
  } finally {
    await admin.query('update grants set valid_from = now(), valid_to = null where id = $1', [SECOND_TITLE_GRANT]);
  }

  scenarios++;
  console.log('PASS entitlement: a grant that expired between issue and use rejects the download.');
}

// Scenario 7: the ticket's own 60-second window. An expired ticket is refused while
// the grant is still valid, so a ticket cannot become a long-lived bearer token.
async function expiredTicketTest(context) {
  const base = await startApp(databaseUrl(context.port));
  const session = await login(base, context.users.readerA.email);

  const issued = await request(base, `/api/books/${WORKS[0].asset}/download-ticket`, session, {
    method: 'POST', body: {},
  });
  check(issued.status === 201, `ticket not issued: ${issued.status} ${issued.text.slice(0, 200)}`);

  // Insert an already-expired ticket rather than backdating the issued one: the
  // schema pins expires_at to within 60 seconds of created_at, so an update that
  // expires it in the past is rejected. body.ticket must be the same sha256 hash.
  const expiredToken = randomBytes(32).toString('hex');
  await admin.query(
    `insert into download_tickets
       (token_hash, tenant_id, user_id, asset_id, work_id, grant_ids, created_at, expires_at)
     values (encode(sha256($1::bytea), 'hex'), $2, $3, $4, $5, '{}',
             now() - interval '61 seconds', now() - interval '1 second')`,
    [expiredToken, LIBEDGE_TENANT, context.users.readerA.id, WORKS[0].asset, WORKS[0].work],
  );
  const delivered = await request(base, `/api/books/${WORKS[0].asset}/download`, session, {
    method: 'POST', body: { ticket: expiredToken },
  });
  check(delivered.status === 403, `an expired ticket delivered: ${delivered.status}`);
  check(delivered.buffer.subarray(0, 5).toString('latin1') !== '%PDF-', 'an expired ticket must not deliver bytes');

  scenarios++;
  console.log('PASS entitlement: an expired ticket is rejected.');
}

// Scenario 8: a catalogue-wide grant does not override a per-title switch-off.
// "It is in the catalogue" and "it may be downloaded" are two decisions and the
// ticket path must honour the second one.
async function downloadDisabledTest(context) {
  const base = await startApp(databaseUrl(context.port));
  const session = await login(base, context.users.readerA.email);

  await admin.query('update assets set allow_download = false where id = $1', [WORKS[0].asset]);
  try {
    const { issued, delivered } = await ticket(base, session, WORKS[0].asset);
    check(issued.status === 403,
      `a title with downloads switched off issued a ticket: ${issued.status} ${issued.text.slice(0, 200)}`);
    check(delivered === null, 'no delivery may be attempted without a ticket');
  } finally {
    await admin.query('update assets set allow_download = true where id = $1', [WORKS[0].asset]);
  }

  scenarios++;
  console.log('PASS entitlement: allow_download = false refuses a ticket.');
}

// Scenario 9: the ticket path and /file must agree, case by case. The divergence
// between the two was the whole defect, so it is asserted directly rather than
// inferred from the cases above.
async function sameDecisionTest(context) {
  const base = await startApp(databaseUrl(context.port));
  const cases = [
    ['granted reader, ungranted title', context.users.readerA.email, UNGRANTED.asset],
    ['reader of an institution with no grant', context.users.readerB.email, WORKS[0].asset],
    ['granted reader, granted title', context.users.readerA.email, WORKS[0].asset],
    ['staff admin with the all grant', context.users.staff.email, WORKS[1].asset],
  ];
  for (const [label, email, assetId] of cases) {
    const session = await login(base, email);
    const file = await request(base, `/api/books/${assetId}/file`, session);
    const { issued } = await ticket(base, session, assetId);
    check((file.status === 200) === (issued.status === 201),
      `${label}: /file answered ${file.status} but download-ticket answered ${issued.status}`);
  }

  scenarios++;
  console.log('PASS entitlement: /file and download-ticket reach the same decision for the same session.');
}

// Scenario 10: the scope of a grant is honoured, not just its existence. The staff
// tenant's blanket 'all' grant is revoked above, so this measures the title scope
// alone: two title grants, two titles, and the third stays closed.
async function scopedGrantTest(context) {
  const base = await startApp(databaseUrl(context.port));
  await admin.query(
    `insert into grants (id, tenant_id, subject_type, subject_id, scope_type, scope_id, status)
     values ($1, $2, 'user', $3, 'title', $4, 'active')`,
    [OTHER_TITLE_GRANT, LIBEDGE_TENANT, context.users.readerA2.id, WORKS[1].work],
  );
  try {
    const session = await login(base, context.users.readerA2.email);
    // The second title grant must work for its own title...
    const covered = await ticket(base, session, WORKS[1].asset);
    check(covered.issued.status === 201,
      `a title-scoped grant did not authorise its own title: ${covered.issued.status}`);
    // ...and neither grant may reach a title no grant names.
    const uncovered = await ticket(base, session, UNGRANTED.asset);
    check(uncovered.issued.status === 403,
      `a title no grant names was issued a ticket: ${uncovered.issued.status}`);
  } finally {
    await admin.query('delete from grants where id = $1', [OTHER_TITLE_GRANT]);
  }

  scenarios++;
  console.log('PASS entitlement: scoped grants authorise exactly their scope.');
}

async function cleanup() {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    for (const { child } of children) {
      if (child.exitCode === null) {
        const exited = once(child, 'exit').catch(() => {});
        child.kill();
        await Promise.race([exited, pause(3000)]);
      }
    }
    if (admin) await admin.end().catch(() => {});
    await docker('rm', '--force', container).catch(() => {});
    if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  })();
  return cleanupPromise;
}

let failed = false;
try {
  const context = await setup();
  await ungrantedInstitutionTest(context);
  await relaxationDivergenceTest(context);
  await grantedReaderTest(context);
  await wrongTitleTest(context);
  await crossInstitutionTicketTest(context);
  await revokedBeforeConsumeTest(context);
  await expiredGrantTest(context);
  await expiredTicketTest(context);
  await downloadDisabledTest(context);
  await sameDecisionTest(context);
  await scopedGrantTest(context);
  console.log(`\nPASS download entitlement: ${scenarios} scenarios, ${checks} checks.`);
} catch (error) {
  failed = true;
  console.error(`\nFAIL download entitlement: ${error.message}`);
  const last = children[children.length - 1];
  if (last?.log) console.error('--- app log ---\n' + last.log);
  process.exitCode = 1;
} finally {
  await cleanup();
  if (failed) console.error('test failed');
}

