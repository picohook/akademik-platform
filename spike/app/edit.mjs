#!/usr/bin/env node
/**
 * Update scaffold metadata for an ingested work.
 *
 * Usage:
 *   node edit.mjs <work-id> [--title "..."] [--subtitle "..."] [--language en]
 *                 [--publisher "..."] [--year 2026] [--pages 697] [--subjects "A;B"]
 *
 * Requires DATABASE_URL.
 */
const argv = process.argv.slice(2);
const workId = argv[0];
if (!workId || workId.startsWith('--')) {
  console.error('Usage: node edit.mjs <work-id> [--title ...] [--subtitle ...] [--language ...] [--publisher ...] [--year ...] [--pages ...] [--subjects "A;B"]');
  process.exit(2);
}

const options = {};
for (let index = 1; index < argv.length; index += 1) {
  const arg = argv[index];
  if (arg === '--title') options.title = argv[++index];
  else if (arg === '--subtitle') options.subtitle = argv[++index];
  else if (arg === '--language') options.language = argv[++index];
  else if (arg === '--publisher') options.publisher = argv[++index];
  else if (arg === '--year') options.year = Number(argv[++index]);
  else if (arg === '--pages') options.pages = Number(argv[++index]);
  else if (arg === '--subjects') options.subjects = String(argv[++index] || '').split(/[;,]/).map((s) => s.trim()).filter(Boolean);
  else {
    console.error(`Unknown option: ${arg}`);
    process.exit(2);
  }
}

if (!Object.keys(options).length) {
  console.error('No fields to update.');
  process.exit(2);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required.');
  process.exit(2);
}

const tenant = process.env.DEMO_TENANT_ID || '11111111-1111-1111-1111-111111111111';
const pg = await import('pg');
const pool = new pg.default.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const client = await pool.connect();

try {
  await client.query('begin');
  await client.query("select set_config('app.tenant_id', $1, false)", [tenant]);

  const sets = [];
  const values = [];
  let index = 1;
  const add = (column, value) => {
    sets.push(`${column} = $${index}`);
    values.push(value);
    index += 1;
  };

  if (options.title !== undefined) add('title', options.title);
  if (options.subtitle !== undefined) add('subtitle', options.subtitle);
  if (options.language !== undefined) add('language', options.language);
  if (options.subjects !== undefined) add('subjects', options.subjects);

  if (sets.length) {
    values.push(workId, tenant);
    const result = await client.query(
      `update works set ${sets.join(', ')} where id = $${index} and tenant_id = $${index + 1} returning id, title`,
      values,
    );
    if (!result.rowCount) throw new Error(`work not found: ${workId}`);
    console.log(`[work] ${result.rows[0].id} -> ${result.rows[0].title}`);
  }

  const editionSets = [];
  const editionValues = [];
  let editionIndex = 1;
  if (options.publisher !== undefined) {
    editionSets.push(`publisher = $${editionIndex}`);
    editionValues.push(options.publisher);
    editionIndex += 1;
  }
  if (options.year !== undefined) {
    editionSets.push(`publication_year = $${editionIndex}`);
    editionValues.push(options.year);
    editionIndex += 1;
  }
  if (editionSets.length) {
    editionValues.push(workId, tenant);
    const result = await client.query(
      `update editions set ${editionSets.join(', ')}
        where work_id = $${editionIndex} and tenant_id = $${editionIndex + 1}
        returning id`,
      editionValues,
    );
    console.log(`[edition] ${result.rowCount} row(s) updated`);
  }

  if (options.pages !== undefined) {
    const result = await client.query(
      `update assets set page_count = $1
        where edition_id in (select id from editions where work_id = $2 and tenant_id = $3)`,
      [options.pages, workId, tenant],
    );
    console.log(`[asset] ${result.rowCount} row(s) updated`);
  }

  await client.query('commit');
} catch (error) {
  await client.query('rollback').catch(() => {});
  console.error(error.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
