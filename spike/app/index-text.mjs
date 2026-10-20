import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { indexAll, indexAsset } from './indexer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const TENANT_ID = process.env.DEMO_TENANT_ID || '11111111-1111-1111-1111-111111111111';

const args = process.argv.slice(2);
const assetIndex = args.indexOf('--asset');
const assetId = assetIndex >= 0 ? args[assetIndex + 1] : null;
const statusOnly = args.includes('--status');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required (run inside the web container).');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  if (statusOnly) {
    const client = await pool.connect();
    try {
      await client.query("select set_config('app.tenant_id', $1, false)", [TENANT_ID]);
      const { rows } = await client.query(
        `select a.title, a.page_count, count(p.page_no)::int as indexed
           from assets a
           left join asset_pages p on p.asset_id = a.id
          group by a.id, a.title, a.page_count
          order by a.title`,
      );
      console.table(rows);
    } finally {
      client.release();
    }
  } else if (assetId) {
    const client = await pool.connect();
    let rows = [];
    try {
      await client.query("select set_config('app.tenant_id', $1, false)", [TENANT_ID]);
      ({ rows } = await client.query(
        'select id, storage_key, tenant_id from assets where id = $1 or source_id = $1 limit 1',
        [assetId],
      ));
    } finally {
      client.release();
    }
    if (!rows[0]) throw new Error(`asset not found: ${assetId}`);
    await indexAsset({
      pool,
      tenantId: rows[0].tenant_id || TENANT_ID,
      assetId: rows[0].id,
      storageKey: rows[0].storage_key,
      publicDir: PUBLIC_DIR,
    });
  } else {
    await indexAll({ pool, tenantId: TENANT_ID, publicDir: PUBLIC_DIR });
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
