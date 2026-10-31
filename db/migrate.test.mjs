import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import {
  expectRunnable, loadFiles, psqlTransactionControl, refuseUnbaselined, TRANSACTION_CONTROL,
} from './migrate.mjs';

// The migration runner, against a throwaway PostgreSQL.
//
// Three of these tests exist because the failure they cover is silent:
//
// - a migration that commits by itself ends the runner's transaction, so the
//   registry row is written outside it. The run reports success and the
//   database disagrees with the registry.
// - an unbaselined database makes every file look pending, and 003 would put
//   the demo1234 account back into production.
// - two runners started at once both decide the same file is pending.
//
// Text matching alone cannot show any of that, so the cases below start a real
// server and look at what the database ended up holding.

const exec = promisify(execFile);
const dbDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(dbDir, '..');
const appDir = path.join(repoDir, 'spike/app');

// Same reasoning as db/migrate.mjs: `pg` belongs to spike/app, so resolve it
// from there rather than adding a second copy of the driver to the repo.
const pg = createRequire(path.join(appDir, 'package.json'))('pg');
const volumeDir = path.join(appDir, 'tmp');
const runId = randomUUID();
const container = `migrate-test-${runId}`;
const dbName = 'migrate_test';
const adminPassword = randomBytes(18).toString('hex');

let port;
let adminUrl;
let sqlDir;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort() {
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const value = socket.address().port;
  await new Promise((resolve, reject) => socket.close((error) => (error ? reject(error) : resolve())));
  return value;
}

async function docker(...args) {
  return (await exec('docker', args, { timeout: 90_000, maxBuffer: 1024 * 1024 })).stdout.trim();
}

// Runs the CLI the way a deploy does, and returns the exit code plus output
// instead of throwing, because most of these cases are about refusing.
async function run(args, { env = {} } = {}) {
  try {
    const { stdout, stderr } = await exec(
      process.execPath,
      [path.join(sqlDir, 'migrate.mjs'), ...args],
      {
        cwd: sqlDir,
        env: { ...process.env, DATABASE_ADMIN_URL: adminUrl, ...env },
        timeout: 120_000,
      },
    );
    return { code: 0, out: stdout + stderr };
  } catch (error) {
    return { code: error.code ?? 1, out: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

async function query(text, params) {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    return await client.query(text, params);
  } finally {
    await client.end().catch(() => {});
  }
}

async function resetDatabase() {
  // Everything except the registry, so each case starts from "the schema is
  // there, nothing is recorded" - which is exactly the production shape.
  await query(`drop schema public cascade; create schema public;`);
}

test.before(async () => {
  await mkdir(volumeDir, { recursive: true });
  // The runner resolves `pg` through spike/app/package.json, and it is copied
  // next to the migrations so the .sql files under test are the real ones.
  sqlDir = path.join(volumeDir, `migrate-${runId}`);
  await mkdir(path.join(sqlDir, 'migrations'), { recursive: true });
  await copyFile(path.join(dbDir, 'migrate.mjs'), path.join(sqlDir, 'migrate.mjs'));

  port = await freePort();
  await docker(
    'run', '-d', '--name', container,
    '-e', `POSTGRES_PASSWORD=${adminPassword}`,
    '-e', `POSTGRES_DB=${dbName}`,
    '-p', `127.0.0.1:${port}:5432`,
    'postgres:16-alpine',
  );
  adminUrl = `postgres://postgres:${adminPassword}@127.0.0.1:${port}/${dbName}`;

  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      await query('select 1');
      break;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await pause(300);
    }
  }
});

test.after(async () => {
  await docker('rm', '-f', container).catch(() => {});
  await rm(sqlDir, { recursive: true, force: true }).catch(() => {});
});

// ---------------------------------------------------------------------------
// Classification: the shipped files, not invented ones.
// ---------------------------------------------------------------------------

test('the shipped 013-017 are refused as unrunnable, and nothing newer is', async () => {
  const files = await loadFiles();
  const byPrefix = new Map(files.map((file) => [file.name.slice(0, 3), file]));

  for (const version of ['013', '014', '015', '016', '017']) {
    const file = byPrefix.get(version);
    assert.ok(file, `${version} is missing from db/migrations`);
    assert.match(expectRunnable(file.sql), /manages its own transaction/,
      `${version} commits by itself and must not be executed`);
  }

  // Everything the runner owns has to satisfy the rules, or it will be refused
  // on the deploy that needs it most.
  const newer = files.filter((file) => Number(file.name.slice(0, 3)) > 17);
  for (const file of newer) {
    assert.equal(expectRunnable(file.sql), null, `${file.name}: ${expectRunnable(file.sql)}`);
  }
});

test('every migration newer than the baseline satisfies the rules (skipped when none exist)', async (t) => {
  // This branch may be the runner on its own, before the first migration it
  // owns has landed. Then there is nothing to check here - and on the branch
  // that does add one, this is what catches it breaking a rule.
  const newer = (await loadFiles()).filter((file) => Number(file.name.slice(0, 3)) > 17);
  if (!newer.length) {
    t.skip('no migrations newer than 017 on this branch');
    return;
  }
  for (const file of newer) {
    assert.equal(expectRunnable(file.sql), null, `${file.name}: ${expectRunnable(file.sql)}`);
  }
});

test('transaction control is caught wherever it starts a statement, and a DO block body is not', () => {
  const cases = {
    'begin;': true,
    '  commit;': true,
    '\n\n begin transaction;': true,
    'START TRANSACTION;': true,
    'savepoint a;': true,
    '\\begin': true,
    'select 1;\ncommit;\nselect 2;': true,
    '-- a comment\ncommit;': true,
    'select 1;': false,
    'do $$ begin if true then raise notice \'commit;\'; end if; end $$;': false,
    'create function f() returns void as $$ begin perform 1; end $$ language plpgsql;': false,
  };
  for (const [sql, expected] of Object.entries(cases)) {
    const caught = TRANSACTION_CONTROL.test(sql);
    assert.equal(caught, expected, `${JSON.stringify(sql)} -> ${caught}, expected ${expected}`);
  }
});

// Regression: a `begin`/`end;` that belongs to a function body is not the file's
// own transaction.
//
// The rule this protects is real - a file that opens or commits a transaction
// breaks the registry - but a line-anchored regex cannot tell a body from a
// statement. 025 and 027 were refused for months because of it: their only
// `end;` is the tail of a plpgsql body, so `--dry-run` dropped them from the
// apply list and a deploy would have believed there was nothing to do. Nothing
// failed; the files were simply never applied. That is why this case is here and
// why the checker below still has to reject a real `commit;` outside a body -
// `psqlTransactionControl` is that outside-the-body view, and the second test
// runs `TRANSACTION_CONTROL` itself against the shapes a body must not hide.
test('transaction control inside a dollar-quoted body is not the file\'s own transaction', () => {
  const cases = {
    // The shapes 025 and 027 actually contain: a plpgsql body whose last
    // statement is `end;` on a line of its own.
    'create function f() returns void as $$\nbegin\n  perform 1;\nend;\n$$ language plpgsql;': [],
    'create function f() returns void as $$ begin perform 1; end; $$ language plpgsql;': [],
    'create function f() returns void as $body$\ndeclare\n  n int;\nbegin\n  n := 1;\n  if n = 1 then\n    perform 1;\n  end if;\nend;\n$body$ language plpgsql;': [],
    'do $$\nbegin\n  commit;\n  rollback;\n  savepoint a;\nend;\n$$;': [],
    // A `commit;` inside a body is dead SQL - plpgsql has no COMMIT - but it is
    // still not the file's transaction, and refusing the file for it would be
    // wrong for the same reason.
    "do $$ begin raise notice 'commit;'; end $$;": [],
    // Tagged quotes, nested quotes of a different tag, and a body that contains
    // the literal text another body uses as its tag.
    'do $outer$ begin execute $inner$ select 1 $inner$; end $outer$;': [],
    'do $a$ begin perform 1; end $a$;\ndo $b$ begin perform 1; end $b$;': [],
    // A comment inside the body, and a body that ends without a semicolon before
    // the closing quote (022 and 025 both do this).
    'do $$\nbegin\n  -- commit; here is only a comment\n  perform 1;\nend\n$$;': [],
    // Unquoted text that looks like the inside of a body is still a statement.
    'create function f() returns void as $$ begin perform 1; end $$ language plpgsql;\ncommit;': ['commit;'],
    'create function f() returns void as $$ begin perform 1; end $$ language plpgsql;\nbegin;': ['begin;'],
    // Real top-level control around bodies - the case the rule exists for.
    'begin;\nselect 1;\ncommit;': ['begin;', 'commit;'],
    'do $$ begin perform 1; end $$;\nend;': ['end;'],
    'end$$;\nstart transaction;': ['start transaction'],
    // The trailing `end` touches the closing quote and is not a statement; the
    // `end;` after it is.
    'do $body$ begin perform 1; end$body$;\nend;': ['end;'],
  };
  for (const [sql, expected] of Object.entries(cases)) {
    assert.deepEqual(psqlTransactionControl(sql), expected, JSON.stringify(sql));
  }
});

test('real transaction control is still refused, dollar-quoted blocks or not', () => {
  // The message names every statement it found, so the assertion is on the
  // command, not on the phrasing.
  const refused = {
    'begin;\nselect 1;\ncommit;': ['begin;', 'commit;'],
    'create function f() returns void as $$ begin perform 1; end $$ language plpgsql;\ncommit;': ['commit;'],
    'do $$ begin perform 1; end $$;\nend;': ['end;'],
    'do $body$ begin perform 1; end$body$;\nsavepoint a;': ['savepoint'],
    'do $body$ begin perform 1; end$body$;\nstart transaction;': ['start transaction'],
    'select 1;\nrollback;': ['rollback;'],
    'select 1;\n\\begin': ['\\begin'],
    // An unbalanced quote must not be able to hide the rest of the file: if a
    // body never closes, everything after it is still checked as SQL.
    'do $$\nbegin\n  perform 1;\n$$;\ncommit;': ['commit;'],
    'create function f() returns void as $odd$ begin perform 1; $body$\ncommit;': ['commit;'],
  };
  for (const [sql, expected] of Object.entries(refused)) {
    const reason = expectRunnable(sql);
    assert.ok(reason, `${JSON.stringify(sql)} was not refused`);
    assert.ok(reason.startsWith('manages its own transaction'), `${JSON.stringify(sql)} -> ${reason}`);
    assert.ok(reason.includes(`(${expected.join(', ')})`), `${JSON.stringify(sql)} -> ${reason}, expected ${expected.join(', ')}`);
  }
});

test('every migration the runner may execute carries no top-level transaction control', async () => {
  // The whole point of the fix: the shipped files, not invented ones. 025 and
  // 027 used to be reported here as `manages its own transaction (end;)`.
  const files = await loadFiles();
  const byPrefix = new Map(files.map((file) => [file.name.slice(0, 3), file]));
  for (const version of ['025', '027']) {
    const file = byPrefix.get(version);
    assert.ok(file, `${version} is missing from db/migrations`);
    assert.deepEqual(psqlTransactionControl(file.sql), [], `${version} has no top-level transaction control of its own`);
    assert.equal(expectRunnable(file.sql), null, `${file.name}: ${expectRunnable(file.sql)}`);
  }
  for (const file of files) {
    const control = psqlTransactionControl(file.sql);
    if (control.length) {
      // Only the historical files may be refused, and only for a reason that is
      // in the SQL rather than in a misread body.
      assert.ok(Number(file.name.slice(0, 3)) <= 17, `${file.name} has top-level transaction control: ${control.join(', ')}`);
    }
  }
});

test('psql meta-commands are refused, because the server cannot parse them', () => {
  assert.match(expectRunnable("\\set demo 'x'\nselect 1;"), /meta-command/);
  assert.equal(expectRunnable('select 1;'), null);
});

// ---------------------------------------------------------------------------
// Behaviour against a real server.
// ---------------------------------------------------------------------------

// Writes a migration into the copied directory. The copied directory is what
// the spawned runner reads, so this is how a case puts a specific file in front
// of it - including files that must be refused.
async function placeMigration(name, sql) {
  await writeFile(path.join(sqlDir, 'migrations', name), sql, 'utf8');
}

async function clearMigrations() {
  await rm(path.join(sqlDir, 'migrations'), { recursive: true, force: true });
  await mkdir(path.join(sqlDir, 'migrations'), { recursive: true });
}

// A registry-free database with a users table: the state EC2 was in before
// anyone ran --baseline. schema.sql is what creates users.
async function unbaselinedDatabase() {
  await resetDatabase();
  await query(await readFile(path.join(dbDir, 'schema.sql'), 'utf8'));
}

test('a migration that commits by itself is refused, and its SQL never runs', async () => {
  await unbaselinedDatabase();
  await clearMigrations();
  await placeMigration(
    '018-commits-by-itself.sql',
    'begin;\ncreate table should_not_exist (id int);\ncommit;\n',
  );

  // Baselined first so the unbaselined guard is out of the way: the only thing
  // that can refuse this file is the transaction-control rule.
  const baselined = await run(['--baseline']);
  assert.equal(baselined.code, 0, baselined.out);
  await query("delete from schema_migrations where filename like '018%'");

  const applied = await run([]);
  assert.equal(applied.code, 1, `runner should refuse the file:\n${applied.out}`);
  assert.match(applied.out, /manages its own transaction/);

  const { rows: [table] } = await query("select to_regclass('public.should_not_exist')::text as name");
  assert.equal(table.name, null, 'a refused migration must not have run');
  const { rows: [row] } = await query("select count(*)::int as n from schema_migrations where filename like '018%'");
  assert.equal(row.n, 0, 'a refused migration must not be recorded as applied');
});

test('without a baseline, a database that has a users table runs none of 001-017', async () => {
  await unbaselinedDatabase();
  await clearMigrations();
  // A stand-in for 003 that would be catastrophic in production, and proves the
  // guard works by writing a row rather than by erroring.
  await placeMigration(
    '003-librarian-user.sql',
    'insert into users (id, tenant_id, email, display_name, role, password_hash)\n'
    + "values ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111',\n"
    + "        'librarian@example.edu.tr', 'Demo Kütüphaneci', 'librarian', 'x')\n"
    + 'on conflict (tenant_id, email) do nothing;\n',
  );

  const blocked = await run([]);
  assert.equal(blocked.code, 1, `runner should refuse before applying:\n${blocked.out}`);
  assert.match(blocked.out, /has not been baselined/);
  assert.match(blocked.out, /003-librarian-user\.sql/);

  const { rows: [user] } = await query("select count(*)::int as n from users where email = 'librarian@example.edu.tr'");
  assert.equal(user.n, 0, 'the demo account must not have been inserted');

  // --dry-run changes nothing and is allowed, so the refusal can be read before
  // it matters.
  const dry = await run(['--dry-run']);
  assert.equal(dry.code, 0, dry.out);
  assert.match(dry.out, /would be refused/);

  // The documented way out: baseline, then apply.
  const baselined = await run(['--baseline']);
  assert.equal(baselined.code, 0, baselined.out);
  const after = await run([]);
  assert.equal(after.code, 0, after.out);
  const { rows: [recorded] } = await query("select count(*)::int as n from schema_migrations where filename like '003%'");
  assert.equal(recorded.n, 1);
});

test('a fresh database with no users table is not treated as unbaselined', async () => {
  await resetDatabase();
  await clearMigrations();
  await placeMigration('001-create-table.sql', 'create table widgets (id int);\n');

  const result = await run([]);
  assert.equal(result.code, 0, `a fresh database should apply normally:\n${result.out}`);
  const { rows: [row] } = await query("select count(*)::int as n from schema_migrations where filename like '001%'");
  assert.equal(row.n, 1);
});

test('two runners started at once do not both apply the same file', async () => {
  await resetDatabase();
  await clearMigrations();
  // The file sleeps for a fixed time, so the second process can be started while
  // the first is provably still inside it. Without that timing the race is not
  // reproducible here: both processes would read the registry, both would see
  // the file pending, and both would try to apply it.
  await placeMigration(
    '001-slow.sql',
    'select pg_sleep(8);\ncreate sequence once_only_seq;\ncreate table once_only (id int);\n'
    + "select nextval('once_only_seq');\n",
  );

  // Spawning node and connecting costs roughly two seconds on this machine, so
  // the second process has to be held long enough that it reads the registry
  // while the first is still sleeping - otherwise the race never happens and the
  // test passes with or without the lock.
  const first = run([]);
  await pause(4000);
  const second = run([]);

  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.code, 0, `first run:\n${a.out}`);
  assert.equal(b.code, 0, `second run:\n${b.out}`);

  const ran = [a, b].filter((result) => /applying 001-slow\.sql/.test(result.out));
  assert.equal(ran.length, 1, `the file must be applied by exactly one run:\nA:${a.out}\nB:${b.out}`);
  const waited = [a, b].find((result) => result !== ran[0]);
  assert.match(waited.out, /up to date/);

  // The point of the lock: the waiting run re-reads the registry *after* it has
  // the lock. If it had decided from the snapshot it took before blocking, it
  // would have tried to apply the file a second time - and the sequence below
  // is what shows the body ran once rather than twice.
  const { rows: [row] } = await query("select count(*)::int as n from schema_migrations where filename like '001%'");
  assert.equal(row.n, 1, 'the file must be recorded exactly once');
  const { rows: [seq] } = await query("select last_value::int as v from once_only_seq");
  assert.equal(seq.v, 1, 'the migration body must have run once, not twice');
});

test('the app role is refused before anything is changed', async () => {
  await resetDatabase();
  await clearMigrations();

  const appUrl = `postgres://akademik_app:akademik_app_dev@127.0.0.1:${port}/${dbName}`;
  const result = await run(['--status'], { env: { DATABASE_ADMIN_URL: appUrl } });
  assert.equal(result.code, 1, `the app role must be refused:\n${result.out}`);
  assert.match(result.out, /cannot create tables in schema public/);
});
