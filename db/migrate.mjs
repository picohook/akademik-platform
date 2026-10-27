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

const sha = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const prefix = (filename) => filename.split('-')[0];

async function loadFiles() {
  const names = (await readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort();
  const files = [];
  for (const name of names) {
    const sql = await readFile(path.join(migrationsDir, name), 'utf8');
    files.push({ name, sql, checksum: sha(sql) });
  }
  return files;
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
    'select current_user as role, (select rolsuper from pg_roles where rolname = current_user) as super',
  );
  console.log(`  connected as ${who.role}${who.super ? ' (superuser)' : ''}`);
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
        console.log(`    ${state.padEnd(8)} ${file.name}`);
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

    if (options.dryRun) {
      console.log(`\n  would apply: ${pending.map((file) => file.name).join(', ')}`);
      return 0;
    }

    console.log();
    for (const file of pending) {
      process.stdout.write(`  applying ${file.name} ... `);
      const duration = await applyOne(client, file);
      console.log(`${duration} ms`);
    }
    console.log(`\n  ${pending.length} migration(s) applied`);
    return 0;
  } finally {
    await client.end().catch(() => {});
  }
}

main().then(
  (code) => { process.exitCode = code; },
  (error) => {
    console.error(`\n  failed: ${error.message}`);
    if (error.code) console.error(`  postgres code: ${error.code}`);
    process.exitCode = 1;
  },
);
