#!/usr/bin/env node
// Migration runner.
//
// Until this existed, applying a migration meant pasting psql commands from
// db/README.md by hand, and there was no record that any of them had run. The
// only way to know whether 017 had been applied was to inspect the data it
// changed. That is the gap this closes.
//
// Design notes that are not obvious from the code:
//
// - The registry table is created by this script, not by a numbered file. A
//   migration that creates the table to record migrations cannot itself be
//   recorded, so every run would try to apply it again.
// - The app role (akademik_app) cannot run DDL. This connects with a separate
//   admin URL and refuses to run if it ends up as a role that cannot create
//   tables, because a half-applied migration is worse than none.
// - Each file runs in one transaction together with its registry row: a file
//   either lands and is recorded, or neither happens.
// - A file that contains its own top-level begin/commit is refused rather than
//   run. Its commit would end the runner's transaction early, so the registry
//   row would land outside it - the migration's changes committed, the record
//   of them not, or vice versa. 013-017 predate this rule and break it; they
//   are only ever baselined, never executed. Dollar-quoted bodies are masked
//   before the check, so a plpgsql `begin ... end;` is not read as the file's
//   own transaction - it was, and 025 and 027 were skipped for it.
// - Runs take a session-level advisory lock, so two deploys racing each other
//   queue up instead of both deciding the same file is pending.
// - A file whose checksum changed after it was applied is reported and, unless
//   --allow-modified is passed, stops the run. Silently re-running edited
//   migrations is how environments drift apart.
//
// Usage:
//   node db/migrate.mjs --status
//   node db/migrate.mjs --baseline      # mark 001-017 applied, run no SQL
//   node db/migrate.mjs --dry-run
//   node db/migrate.mjs                 # apply what is pending
//
// Env: DATABASE_ADMIN_URL (required), or DATABASE_URL as a fallback with a warning.

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

// `pg` is a dependency of spike/app, not of this directory, and Node resolves
// bare imports from the importing file's location. Requiring it through the app
// keeps the runner runnable from anywhere and avoids adding a second copy of
// the driver to the repo.
const appRequire = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), '../spike/app/package.json'));
const pg = appRequire('pg');

// The last migration that predates this runner. Everything up to and including
// it is assumed already applied on any database that has real data, because it
// was applied by hand. 018 and later are managed by this script alone.
const BASELINE_THROUGH = '017';

const REGISTRY_DDL = `
  create table if not exists schema_migrations (
    filename text primary key,
    checksum text not null,
    applied_at timestamptz not null default now(),
    duration_ms int not null default 0
  );
  comment on table schema_migrations is
    'One row per applied file in db/migrations. Managed by db/migrate.mjs; do not edit by hand.';
`;

// A fixed key, so every runner process on this database queues behind the same
// lock. Session-level, held for the whole run, released by disconnect.
const ADVISORY_LOCK_KEY = 8_026_071_001;

// Top-level transaction control in a migration file. Matched at the start of a
// line, with any statement keywords before it skipped, so a `commit;` inside a
// DO block body (indented, and not a statement boundary of its own) is not
// caught but a real one is. Also catches savepoints and psql's \begin, both of
// which move transaction state out from under the runner.
//
// This regex knows nothing about dollar quotes, which is why it is no longer the
// only thing consulted: a plpgsql body is valid SQL that contains `begin` and
// `end;` on lines of their own, and this pattern reads the `end;` as the file's.
// 025 and 027 were refused for exactly that reason. `expectRunnable` now masks
// bodies out first; the tests still run this pattern against the masked text, and
// against raw text to show what it would have said.
const TRANSACTION_CONTROL = /^\s*(?:--[^\n]*\n\s*)*(?:\\begin|\\commit|\\rollback|begin\s*(?:transaction|work)?\s*;|start\s+transaction\b|commit\s*(?:work|transaction)?\s*;|rollback\s*(?:work|transaction)?\s*;|end\s*(?:work|transaction)?\s*;|savepoint\b|release\s+savepoint\b|rollback\s+to\s+savepoint\b)/im;

// A dollar quote: `$$`, or `$tag$` with a tag that cannot start with a digit.
// Both forms are in the shipped migrations - 013 and 027 use `$$`, 022, 024, 025
// and 026 use `$body$`.
const DOLLAR_QUOTE = /\$([A-Za-z_][A-Za-z0-9_]*)?\$/g;

// Replaces the contents of every dollar-quoted string with spaces, leaving the
// quotes and the newlines where they were. Same length, same line breaks, so a
// position in the result is a position in the input and a match on the result
// can be reported against the original text.
//
// What is deliberately still visible outside a body: string literals ('...') and
// comments. A `commit;` inside a single-quoted string is dead SQL, and refusing
// it costs nothing; leaving literals out of this scanner keeps it to one job.
//
// An unterminated quote is masked to the end of the file only when no tag of the
// same form closes it - see below for why that is the safe direction.
function maskDollarQuotedBodies(sql) {
  let masked = '';
  let cursor = 0;

  while (cursor < sql.length) {
    DOLLAR_QUOTE.lastIndex = cursor;
    const open = DOLLAR_QUOTE.exec(sql);
    if (!open) break;

    const tag = open[0];
    const bodyStart = open.index + tag.length;
    // The closing tag is the same `$tag$`, so `indexOf` is the whole rule: a
    // `$inner$` inside a `$outer$` body does not close it, which is exactly what
    // Postgres does.
    const close = sql.indexOf(tag, bodyStart);
    // No terminator: leave the rest of the file as SQL rather than assume the
    // body runs to EOF. Assuming EOF would hide a real `commit;` that follows a
    // typo, which is the failure this whole check exists to prevent. Report it
    // as written instead; if it is a body, the tag is simply missing and the file
    // is broken anyway.
    if (close === -1) break;

    masked += sql.slice(cursor, bodyStart);
    // Only the body: the closing tag stays, because a body can end `end$body$`
    // and the `end` must not be seen as a statement.
    masked += sql.slice(bodyStart, close).replace(/[^\n]/g, ' ');
    cursor = close;
  }

  return masked + sql.slice(cursor);
}

// Every top-level transaction-control statement in a file, as written. Empty for
// a file the runner may execute. Exported for the tests, which is where the
// "real commands are still refused" half of the rule is pinned.
function psqlTransactionControl(sql) {
  const masked = maskDollarQuotedBodies(sql);
  const found = [];
  const scan = new RegExp(TRANSACTION_CONTROL.source, 'gim');
  for (const match of masked.matchAll(scan)) {
    const keyword = match[0].split('\n').pop().trim();
    if (keyword) found.push(keyword);
  }
  return found;
}


// psql meta-commands cannot be sent to the server at all: pg parses them as
// syntax errors. 017 uses \set, which is why it can never be executed by this
// runner - only baselined.
const PSQL_METACOMMAND = /^\s*\\(?!begin|commit|rollback)\w+/im;

// The meta-command check has the mirror-image blind spot: a body can contain a
// backslash (`\n` inside a format(), a `\d` in a regex) and a line inside a body
// can start with one. Same masking, so a `\set` a body happens to contain is not
// read as a file-level meta-command.
function psqlMetaCommands(sql) {
  const masked = maskDollarQuotedBodies(sql);
  const found = [];
  const scan = new RegExp(PSQL_METACOMMAND.source, 'gim');
  for (const match of masked.matchAll(scan)) found.push(match[0].trim());
  return found;
}

const sha = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const prefix = (filename) => filename.split('-')[0];

async function loadFiles() {
  const names = (await readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort();
  const files = [];
  for (const name of names) {
    const sql = await readFile(path.join(migrationsDir, name), 'utf8');
    files.push({ name, sql, checksum: sha(sql), runnable: expectRunnable(sql) });
  }
  return files;
}

// Whether a file may be *executed* by the runner. Baselining only writes a
// registry row, so a file that cannot run can still be marked applied - that is
// the whole reason 013-017 are baselined rather than applied.
//
// Returns null when the file is runnable, or the reason it is not. Callers print
// the reason instead of failing, because "cannot be run" is a permanent
// property of a historical file, not an error in this run.
function expectRunnable(sql) {
  const control = psqlTransactionControl(sql);
  if (control.length) {
    return `manages its own transaction (${control.join(', ')}) - the runner needs one transaction per file so the registry row commits with it`;
  }
  const meta = psqlMetaCommands(sql);
  if (meta.length) {
    return `contains the psql meta-command ${meta.join(', ')}, which the server cannot parse`;
  }
  return null;
}

function parseArgs(argv) {
  const flags = new Set(argv.filter((arg) => arg.startsWith('--')));
  const known = ['--status', '--baseline', '--dry-run', '--allow-modified', '--help'];
  const unknown = [...flags].filter((flag) => !known.includes(flag));
  if (unknown.length) throw new Error(`unknown option: ${unknown.join(', ')}`);
  return {
    status: flags.has('--status'),
    baseline: flags.has('--baseline'),
    dryRun: flags.has('--dry-run'),
    allowModified: flags.has('--allow-modified'),
    help: flags.has('--help'),
  };
}

function connectionString() {
  if (process.env.DATABASE_ADMIN_URL) return { url: process.env.DATABASE_ADMIN_URL, warning: null };
  if (process.env.DATABASE_URL) {
    return {
      url: process.env.DATABASE_URL,
      warning: 'DATABASE_ADMIN_URL is not set; using DATABASE_URL. It must be able to run DDL.',
    };
  }
  throw new Error('DATABASE_ADMIN_URL is required (see db/README.md)');
}

const HELP = `
Usage: node db/migrate.mjs [--status|--baseline|--dry-run] [--allow-modified]

  (no flag)         apply every pending migration in filename order
  --status          show applied / pending / modified, change nothing
  --baseline        mark ${BASELINE_THROUGH}-* as applied without running them
  --dry-run         show what would run, change nothing
  --allow-modified  continue even if an applied file's content changed

Environment:
  DATABASE_ADMIN_URL  required; a role that can run DDL (not akademik_app)
`;

async function connect() {
  const { url, warning } = connectionString();
  if (warning) console.warn(`  warning: ${warning}`);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const { rows: [who] } = await client.query(
    `select current_user as role,
            (select rolsuper from pg_roles where rolname = current_user) as super,
            has_schema_privilege(current_user, 'public', 'CREATE') as can_create_table`,
  );
  console.log(`  connected as ${who.role}${who.super ? ' (superuser)' : ''}`);

  // The role has to be able to create the registry and run the DDL inside the
  // migrations. Saying so now beats failing halfway through a file, and it is
  // the check that catches someone pointing this at the app role.
  if (!who.can_create_table) {
    throw new Error(
      `role ${who.role} cannot create tables in schema public, so it cannot run migrations. ` +
      'Use the table owner (DATABASE_ADMIN_URL), not the app role akademik_app.',
    );
  }

  // Session-level: held until this connection closes. A second runner reports
  // what it is waiting for rather than guessing, and one that cannot get the
  // lock in time fails without touching anything.
  const waiting = setTimeout(
    () => console.log('  waiting for another migration run to finish (advisory lock) ...'),
    1000,
  );
  try {
    await client.query('select pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
  } finally {
    clearTimeout(waiting);
  }
  return client;
}

async function ensureRegistry(client, { dryRun }) {
  if (dryRun) return;
  await client.query(REGISTRY_DDL);
}

async function readRegistry(client) {
  const { rows } = await client.query('select filename, checksum, applied_at from schema_migrations');
  return new Map(rows.map((row) => [row.filename, row]));
}

// Applied rows whose file content no longer matches what was applied. Not an
// error to see them in --status, but applying further migrations on top of a
// drifting file is how two environments end up with different schemas.
function modifiedFiles(files, applied) {
  const modified = [];
  for (const file of files) {
    const row = applied.get(file.name);
    if (row && row.checksum !== file.checksum) modified.push(file.name);
  }
  return modified;
}

async function applyOne(client, file) {
  const started = Date.now();
  await client.query('begin');
  try {
    // No parameters: a migration is a script, not a query. pg's simple protocol
    // allows multiple statements in one call.
    await client.query(file.sql);
    const duration = Date.now() - started;
    await client.query(
      'insert into schema_migrations (filename, checksum, duration_ms) values ($1, $2, $3)',
      [file.name, file.checksum, duration],
    );
    await client.query('commit');
    return Date.now() - started;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  }
}

async function baseline(client, files, applied, { dryRun }) {
  const targets = files.filter((file) => Number(prefix(file.name)) <= Number(BASELINE_THROUGH) && !applied.has(file.name));
  if (!targets.length) {
    console.log(`  nothing to baseline: ${BASELINE_THROUGH}-* already recorded or absent`);
    return 0;
  }
  for (const file of targets) {
    console.log(`  baseline ${file.name}`);
    if (dryRun) continue;
    await client.query(
      'insert into schema_migrations (filename, checksum, duration_ms) values ($1, $2, 0)',
      [file.name, file.checksum],
    );
  }
  // Baseline does not run SQL, so it does not prove the file was applied. Say
  // so out loud rather than letting the registry imply more than it knows.
  console.log(`  ${targets.length} file(s) marked as applied without being run - verify against the database before trusting this.`);
  return targets.length;
}

// Guards the case --baseline exists for, in the direction that can lose data.
//
// On a database that already has a schema but no registry, every file looks
// pending. Applying them is not "re-applying history": 003 would insert the
// demo1234 librarian account into a live database, and 001-012 create objects
// that already exist. The registry being empty on a database with a users table
// means "not baselined yet", never "fresh database". A truly fresh database has
// no users table, so it is unaffected by this rule.
async function refuseUnbaselined(client, pending) {
  const { rows: [state] } = await client.query(
    `select to_regclass('public.users') is not null as has_users,
            (select count(*) from schema_migrations)::int as recorded`,
  );
  if (!state.has_users || state.recorded > 0) return null;

  const historical = pending.filter((file) => Number(prefix(file.name)) <= Number(BASELINE_THROUGH));
  if (!historical.length) return null;

  return [
    `the database has a users table but no registry rows, and ${historical.length} file(s) it would run predate this runner:`,
    ...historical.map((file) => `    ${file.name}${file.runnable ? '' : `  (not runnable: ${file.runnable})`}`),
    '',
    `  ${historical.some((file) => file.runnable) ? 'Some of these would run against a live database - 003 re-inserts the demo1234 account.' : ''}`,
    '  This database has not been baselined. Run --baseline first, then --status to confirm, then apply.',
  ].join('\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
    return 0;
  }

  const files = await loadFiles();
  const client = await connect();
  try {
    await ensureRegistry(client, options);
    const exists = await client.query("select to_regclass('schema_migrations')::text as name");
    if (!exists.rows[0].name) {
      console.log('  schema_migrations absent; nothing has been recorded yet');
    }
    const applied = exists.rows[0].name ? await readRegistry(client) : new Map();
    const pending = files.filter((file) => !applied.has(file.name));
    const modified = modifiedFiles(files, applied);

    if (options.status || options.dryRun) {
      console.log(`\n  ${files.length} files, ${applied.size} applied, ${pending.length} pending`);
      for (const file of files) {
        const row = applied.get(file.name);
        const state = row ? (row.checksum === file.checksum ? 'applied' : 'MODIFIED') : 'pending';
        // A pending file that cannot run is not going to run; say so here rather
        // than discovering it when the deploy is already half done.
        const note = !row && file.runnable ? `  (cannot run: ${file.runnable})` : '';
        console.log(`    ${state.padEnd(8)} ${file.name}${note}`);
      }
      if (modified.length) {
        console.log(`\n  ${modified.length} applied file(s) changed since they ran: ${modified.join(', ')}`);
      }
    }

    if (options.status) return 0;

    if (modified.length && !options.allowModified) {
      console.error(`\n  refusing to continue: ${modified.length} applied file(s) were edited after being applied.`);
      console.error('  Re-run with --allow-modified only if you know the edited file does not need a re-run.');
      return 1;
    }

    if (options.baseline) {
      await baseline(client, files, applied, options);
      return 0;
    }

    if (!pending.length) {
      console.log('  up to date');
      return 0;
    }

    const unbaselined = await refuseUnbaselined(client, pending);
    if (unbaselined && !options.dryRun) {
      console.error(`\n  refusing to apply: ${unbaselined}`);
      return 1;
    }
    if (unbaselined) {
      console.log(`\n  warning: applying now would be refused - ${unbaselined.split('\n')[0]}`);
    }

    // Baselined files that could actually run are fine to execute; files that
    // cannot run are a permanent property of history, not this run's problem.
    const runnable = pending.filter((file) => !file.runnable);
    if (runnable.length !== pending.length) {
      for (const file of pending) {
        if (file.runnable) console.log(`  skipping ${file.name}: ${file.runnable}`);
      }
      if (!runnable.length) {
        console.error('\n  nothing applicable: none of the pending files can be run.');
        console.error('  Run --status to see which, and --baseline to mark the historical ones as applied.');
        return 1;
      }
    }

    if (options.dryRun) {
      console.log(`\n  would apply: ${runnable.map((file) => file.name).join(', ')}`);
      return 0;
    }

    console.log();
    for (const file of runnable) {
      process.stdout.write(`  applying ${file.name} ... `);
      const duration = await applyOne(client, file);
      console.log(`${duration} ms`);
    }
    console.log(`\n  ${runnable.length} migration(s) applied`);
    return 0;
  } finally {
    await client.end().catch(() => {});
  }
}

// Exported for db/migrate.test.mjs. Importing this file must not connect to
// anything, so main() only runs when it is the entry point.
export {
  expectRunnable, loadFiles, psqlMetaCommands, psqlTransactionControl, refuseUnbaselined,
  maskDollarQuotedBodies, TRANSACTION_CONTROL, PSQL_METACOMMAND,
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => { process.exitCode = code; },
    (error) => {
      console.error(`\n  failed: ${error.message}`);
      if (error.code) console.error(`  postgres code: ${error.code}`);
      process.exitCode = 1;
    },
  );
}
