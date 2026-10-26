import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';

export const BRIDGE_VERSION = 1;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function effectiveGrantStatus(grant, now = Date.now()) {
  if (grant.status !== 'active') return grant.status;
  if (grant.valid_to && Date.parse(grant.valid_to) <= now) return 'expired';
  if (Date.parse(grant.valid_from) > now) return 'pending';
  return 'active';
}

export function groupCatalog(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = row.metadata?.variant_group || row.work_id;
    if (!groups.has(key)) groups.set(key, { id: key, title: row.title, variants: [] });
    const group = groups.get(key);
    let work = group.variants.find(w => w.id === row.work_id);
    if (!work) {
      work = { id: row.work_id, title: row.title, language: row.language,
        cover_url: row.metadata?.cover_url || null, variant_group: row.metadata?.variant_group || '',
        editable: row.editable, editions: [] };
      group.variants.push(work);
    }
    if (!row.edition_id) continue;
    let edition = work.editions.find(e => e.id === row.edition_id);
    if (!edition) {
      edition = { id: row.edition_id, publisher: row.publisher, publication_year: row.publication_year,
        edition: row.edition, isbn13: row.isbn13, assets: [] };
      work.editions.push(edition);
    }
    if (row.asset_id) edition.assets.push({ id: row.asset_id, format: row.format });
  }
  return [...groups.values()];
}

function fail(status, code) { return Object.assign(new Error(code), { status, code }); }
function object(body, keys) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !keys.includes(k))) throw fail(400, 'INVALID_BODY');
}
function text(value, max, nullable = false) {
  if (nullable && (value === null || value === '')) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw fail(400, 'INVALID_FIELD');
  return value.trim();
}
export function validateGrant(body) {
  object(body, ['collection_id', 'valid_from', 'valid_to', 'status']);
  if (!uuid.test(body.collection_id || '')) throw fail(400, 'INVALID_COLLECTION');
  if (!['active', 'pending', 'revoked', 'expired'].includes(body.status)) throw fail(400, 'INVALID_STATUS');
  const start = Date.parse(body.valid_from);
  const end = body.valid_to === null ? null : Date.parse(body.valid_to);
  if (!Number.isFinite(start) || (end !== null && (!Number.isFinite(end) || end <= start))) throw fail(400, 'INVALID_DATES');
  return { ...body, valid_from: new Date(start).toISOString(), valid_to: end === null ? null : new Date(end).toISOString() };
}
export function validateMetadata(body) {
  object(body, ['title', 'language', 'cover_url', 'variant_group', 'edition_id', 'publisher', 'publication_year', 'edition', 'isbn13']);
  const result = {};
  for (const [key, max] of [['title', 500], ['language', 35], ['cover_url', 2000], ['variant_group', 120], ['publisher', 300], ['edition', 100], ['isbn13', 30]]) {
    if (body[key] !== undefined) result[key] = text(body[key], max, !['title', 'language'].includes(key));
  }
  if (result.cover_url) {
    let url;
    try { url = new URL(result.cover_url); } catch { throw fail(400, 'INVALID_COVER'); }
    if (url.protocol !== 'https:' || url.username || url.password) throw fail(400, 'INVALID_COVER');
  }
  if (body.publication_year !== undefined) {
    if (body.publication_year !== null && (!Number.isInteger(body.publication_year) || body.publication_year < 1 || body.publication_year > 9999)) throw fail(400, 'INVALID_YEAR');
    result.publication_year = body.publication_year;
  }
  if (['publisher', 'publication_year', 'edition', 'isbn13'].some(k => k in result)) {
    if (!uuid.test(body.edition_id || '')) throw fail(400, 'EDITION_REQUIRED');
    result.edition_id = body.edition_id;
  }
  if (!Object.keys(result).length) throw fail(400, 'EMPTY_UPDATE');
  return result;
}

// The service credential is accepted only here, never as a reader session.
// Every write and its existing reader audit record share one transaction.
export function createLibedgeBridge({ pool, token, tenantId, version, buildSha, readJson, json }) {
  async function transaction(tenant, fn) {
    if (!pool) throw fail(503, 'DATABASE_UNAVAILABLE');
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('app.tenant_id', $1, true)", [tenant]);
      const { rows } = await client.query('select id, name, status from tenants where id = $1', [tenant]);
      if (!rows[0] || rows[0].status !== 'active') throw fail(404, 'TENANT_NOT_FOUND');
      const result = await fn(client, rows[0]);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    } finally { client.release(); }
  }
  return async function handle(req, res, url) {
    if (!url.pathname.startsWith('/api/libedge/v1/')) return false;
    try {
      if (!token || token.length < 32) throw fail(503, 'BRIDGE_NOT_CONFIGURED');
      const supplied = String(req.headers.authorization || '');
      const digest = value => createHash('sha256').update(value).digest();
      if (!timingSafeEqual(digest(supplied), digest(`Bearer ${token}`))) throw fail(401, 'BRIDGE_UNAUTHORIZED');
      const tenant = req.headers['x-libedge-tenant'] || tenantId;
      if (!uuid.test(tenant || '')) throw fail(400, 'INVALID_TENANT');
      const route = url.pathname.slice('/api/libedge/v1'.length);
      if (route === '/health' && req.method === 'GET') {
        const data = await transaction(tenant, async (_client, row) => ({ ok: true, bridge_version: BRIDGE_VERSION,
          version, build_sha: buildSha || null, mode: 'db', tenant_id: row.id }));
        json(res, 200, data); return true;
      }
      const actor = String(req.headers['x-libedge-actor'] || '');
      if (!/^[1-9]\d{0,15}$/.test(actor)) throw fail(403, 'ACTOR_REQUIRED');
      if (route === '/catalog' && req.method === 'GET') {
        const data = await transaction(tenant, async client => {
          const { rows } = await client.query(`select w.id as work_id, w.title, w.language, w.metadata,
            (w.tenant_id = $1) as editable, e.id as edition_id, e.publisher, e.publication_year, e.edition, e.isbn13,
            a.id as asset_id, a.format from works w
            left join editions e on e.work_id = w.id left join assets a on a.edition_id = e.id
            where w.tenant_id is null or w.tenant_id = $1 order by w.title, w.id, e.id, a.id`, [tenant]);
          return { works: groupCatalog(rows) };
        });
        json(res, 200, data); return true;
      }
      if (route === '/collections' && req.method === 'GET') {
        const data = await transaction(tenant, async client => {
          const { rows } = await client.query(`select c.id, c.title, c.description, count(ci.work_id)::int as item_count
            from collections c left join collection_items ci on ci.collection_id = c.id
            where c.tenant_id = $1 or c.tenant_id is null group by c.id order by c.title`, [tenant]);
          return { collections: rows };
        });
        json(res, 200, data); return true;
      }
      if (route === '/grant-audit' && req.method === 'GET') {
        const data = await transaction(tenant, async client => {
          const { rows } = await client.query(`select id, grant_id, action, detail, created_at from grant_audit
            where tenant_id = $1 order by created_at desc limit 50`, [tenant]);
          return { audit: rows };
        });
        json(res, 200, data); return true;
      }
      if (route === '/grants' && req.method === 'GET') {
        const data = await transaction(tenant, async client => {
          const { rows } = await client.query(`select g.*, c.title as collection_title from grants g
            left join collections c on c.id = g.scope_id where g.tenant_id = $1
            and g.subject_type = 'tenant' and g.subject_id = $1 and g.scope_type = 'collection'
            order by g.created_at desc`, [tenant]);
          return { grants: rows.map(row => ({ ...row, effective_status: effectiveGrantStatus(row) })) };
        });
        json(res, 200, data); return true;
      }
      const workMatch = route.match(/^\/works\/([0-9a-f-]{36})$/i);
      if (workMatch && req.method === 'PATCH') {
        const body = validateMetadata(await readJson(req, 16_384));
        const data = await transaction(tenant, async client => {
          const { rows: [before] } = await client.query('select id, title, language, metadata from works where id = $1 and tenant_id = $2 for update', [workMatch[1], tenant]);
          if (!before) throw fail(404, 'WORK_NOT_FOUND');
          const metadata = { ...before.metadata };
          for (const key of ['cover_url', 'variant_group']) if (key in body) metadata[key] = body[key];
          let editionBefore = null;
          if (body.edition_id) {
            const { rows } = await client.query('select * from editions where id = $1 and work_id = $2 and tenant_id = $3 for update', [body.edition_id, before.id, tenant]);
            editionBefore = rows[0];
            if (!editionBefore) throw fail(404, 'EDITION_NOT_FOUND');
            await client.query(`update editions set publisher = $1, publication_year = $2, edition = $3, isbn13 = $4 where id = $5 and tenant_id = $6`,
              ['publisher', 'publication_year', 'edition', 'isbn13'].map(k => k in body ? body[k] : editionBefore[k]).concat([body.edition_id, tenant]));
          }
          await client.query('update works set title = $1, language = $2, metadata = $3::jsonb where id = $4 and tenant_id = $5',
            [body.title ?? before.title, body.language ?? before.language, JSON.stringify(metadata), before.id, tenant]);
          await client.query(`insert into audit_events (tenant_id, action, object_type, object_id, payload)
            values ($1, 'libedge.metadata.update', 'work', $2, $3::jsonb)`,
            [tenant, before.id, JSON.stringify({ libedge_actor_id: actor, before, edition_before: editionBefore, after: body })]);
          return { ok: true };
        });
        json(res, 200, data); return true;
      }
      const grantMatch = route.match(/^\/grants\/([0-9a-f-]{36})$/i);
      if ((route === '/grants' && req.method === 'POST') || (grantMatch && req.method === 'PATCH')) {
        const body = validateGrant(await readJson(req, 16_384));
        const data = await transaction(tenant, async client => {
          const { rows: collections } = await client.query('select id from collections where id = $1 and (tenant_id = $2 or tenant_id is null)', [body.collection_id, tenant]);
          if (!collections.length) throw fail(404, 'COLLECTION_NOT_FOUND');
          const id = grantMatch?.[1] || randomUUID();
          let before = null;
          if (grantMatch) {
            const { rows } = await client.query(`select * from grants where id = $1 and tenant_id = $2
              and subject_type = 'tenant' and subject_id = $2 and scope_type = 'collection' for update`, [id, tenant]);
            before = rows[0];
            if (!before) throw fail(404, 'GRANT_NOT_FOUND');
          }
          const { rows: [after] } = before
            ? await client.query(`update grants set scope_id = $1, valid_from = $2, valid_to = $3, status = $4
                where id = $5 and tenant_id = $6 returning *`, [body.collection_id, body.valid_from, body.valid_to, body.status, id, tenant])
            : await client.query(`insert into grants (id, tenant_id, subject_type, subject_id, scope_type, scope_id, valid_from, valid_to, status, source)
                values ($1, $2, 'tenant', $2, 'collection', $3, $4, $5, $6, 'manual') returning *`,
              [id, tenant, body.collection_id, body.valid_from, body.valid_to, body.status]);
          await client.query(`insert into grant_audit (tenant_id, grant_id, action, detail) values ($1, $2, $3, $4::jsonb)`,
            [tenant, id, before ? (body.status === 'revoked' ? 'revoke' : 'update') : 'create', JSON.stringify({ libedge_actor_id: actor, before, after })]);
          return { grant: { ...after, effective_status: effectiveGrantStatus(after) } };
        });
        json(res, grantMatch ? 200 : 201, data); return true;
      }
      throw fail(404, 'BRIDGE_ROUTE_NOT_FOUND');
    } catch (error) { json(res, error.status || 503, { error: error.code || 'READER_DATABASE_FAILURE' }); return true; }
  };
}
