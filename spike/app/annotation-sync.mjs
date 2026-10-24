import { createHash, randomUUID } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLORS = ['yellow', 'green', 'blue', 'pink', 'bookmark'];
const FIELDS = 'id, asset_id, anchor, color, note, selected_text, tags, status, created_at, updated_at, version';
const reply = (status, body) => ({ status, body });
const error = (status, code) => reply(status, { error: code });
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
function tags(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(/[;,]/);
  return [...new Set(values.map(v => String(v || '').trim()).filter(Boolean))].slice(0, 20);
}
function prepare({ method, id, body, userId }) {
  if (!body || typeof body !== 'object') return error(400, 'invalid_annotation_request');
  if (Object.hasOwn(body, 'ownerId') && body.ownerId !== userId) return error(403, 'annotation_owner_mismatch');
  if (!body.operationId) return error(428, 'operation_id_required');
  if (!UUID.test(body.operationId)) return error(400, 'invalid_operation_id');
  if (method !== 'POST' && !UUID.test(id || '')) return error(400, 'invalid_annotation_id');
  if (method !== 'POST' && (!Number.isInteger(body.baseVersion) || body.baseVersion < 1)) return error(428, 'annotation_version_required');
  const data = {};
  if (method === 'POST') {
    if (!UUID.test(body.assetId || '') || !body.anchor || typeof body.anchor !== 'object' || Array.isArray(body.anchor)) return error(400, 'invalid_annotation_anchor');
    Object.assign(data, { assetId: body.assetId.toLowerCase(), anchor: body.anchor, color: body.color || 'yellow',
      note: String(body.note || '').trim() || null, selectedText: body.selectedText || null, tags: tags(body.tags) });
  } else if (method === 'PATCH') {
    if (Object.hasOwn(body, 'note')) data.note = String(body.note || '').trim() || null;
    if (Object.hasOwn(body, 'color')) data.color = body.color;
    if (Object.hasOwn(body, 'tags')) data.tags = tags(body.tags);
    if (!Object.keys(data).length) return error(400, 'annotation_changes_required');
  }
  if (Object.hasOwn(data, 'color') && !COLORS.includes(data.color)) return error(400, 'invalid_annotation_color');
  if (method !== 'POST') data.baseVersion = body.baseVersion;
  return { data, operationId: body.operationId.toLowerCase(), hash: createHash('sha256').update(JSON.stringify(canonical({ method, id: id?.toLowerCase() || null, data }))).digest('hex') };
}

// Called inside the existing withTenant transaction. The advisory lock covers
// receipt lookup, CAS mutation and receipt INSERT across all Node processes.
export async function mutateAnnotation(client, context) {
  const { method, id, body, tenantId, userId } = context;
  const prepared = prepare(context);
  if (prepared.status) return prepared;
  const { data, hash, operationId } = prepared;
  await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`annotation:${tenantId}:${userId}:${operationId}`]);
  const previous = (await client.query('select request_hash, response_status, response_body from annotation_operations where tenant_id=$1 and user_id=$2 and operation_id=$3', [tenantId, userId, operationId])).rows[0];
  if (previous) return previous.request_hash === hash ? reply(previous.response_status, previous.response_body) : error(409, 'idempotency_key_reused');
  const tombstone = (await client.query('select request_hash from annotation_operation_tombstones where tenant_id=$1 and user_id=$2 and operation_id=$3', [tenantId, userId, operationId])).rows[0];
  if (tombstone) {
    return tombstone.request_hash === hash ? error(410, 'operation_expired') : error(409, 'idempotency_key_reused');
  }
  let result;
  let annotationId = id;
  if (method === 'POST') {
    const created = (await client.query(`insert into annotations (tenant_id,user_id,asset_id,anchor,color,note,selected_text,tags)
      values($1,$2,$3,$4::jsonb,$5,$6,$7,$8) returning ${FIELDS}`,
    [tenantId, userId, data.assetId, JSON.stringify(data.anchor), data.color, data.note, data.selectedText, data.tags])).rows[0];
    annotationId = created.id;
    result = reply(201, created);
  } else {
    const current = (await client.query(`select ${FIELDS} from annotations where id=$1 and user_id=$2 for update`, [id, userId])).rows[0];
    if (!current) result = reply(404, { error: 'annotation_not_found', current: null });
    else if (current.version !== data.baseVersion) result = reply(409, { error: 'annotation_conflict', current });
    else if (method === 'DELETE') {
      await client.query('delete from annotations where id=$1 and user_id=$2 and version=$3', [id, userId, data.baseVersion]);
      result = reply(200, { ok: true, id, version: current.version });
    } else {
      const values = [], sets = [];
      for (const key of ['note', 'color', 'tags']) if (Object.hasOwn(data, key)) { values.push(data[key]); sets.push(`${key}=$${values.length}`); }
      values.push(id, userId, data.baseVersion);
      const changed = (await client.query(`update annotations set ${sets.join(', ')}
        where id=$${values.length - 2} and user_id=$${values.length - 1} and version=$${values.length} returning ${FIELDS}`, values)).rows[0];
      if (!changed) throw new Error('annotation CAS invariant failed');
      result = reply(200, changed);
    }
  }
  await client.query(`insert into annotation_operations(tenant_id,user_id,operation_id,request_hash,method,annotation_id,response_status,response_body)
    values($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`, [tenantId, userId, operationId, hash, method, annotationId, result.status, JSON.stringify(result.body)]);
  return result;
}

// Full receipts contain note text. Move old ones to content-free tombstones so
// an old retry cannot recreate a deleted note, then expire very old tombstones.
export async function purgeAnnotationReceipts(client, { tenantId, retentionDays = 90, tombstoneDays = 365, limit = 1000 }) {
  const retention = Math.max(1, Math.trunc(retentionDays));
  const tombstoneRetention = Math.max(retention, Math.trunc(tombstoneDays));
  // Do not use SELECT ... FOR UPDATE here: that would require UPDATE privilege
  // and an UPDATE RLS policy for the application role. A transaction advisory
  // lock gives one maintenance runner per tenant; normal writes are unaffected.
  const lock = await client.query(
    "select pg_try_advisory_xact_lock(hashtextextended($1, 0)) as acquired",
    [`annotation-retention:${tenantId}`],
  );
  if (!lock.rows[0]?.acquired) {
    return { skipped: true, receiptsMoved: 0, receiptsDeleted: 0, tombstonesDeleted: 0,
      retentionDays: retention, tombstoneDays: tombstoneRetention };
  }
  const stale = `select tenant_id, user_id, operation_id, request_hash, method, annotation_id, created_at
                   from annotation_operations
                  where tenant_id = $1 and created_at < clock_timestamp() - ($2::int * interval '1 day')
                  order by created_at
                  limit $3`;
  // INSERT ... RETURNING would require tombstone SELECT visibility for the
  // maintenance role. rowCount is enough; the delete below is keyed by the
  // same selected rows.
  const moved = await client.query(`
    with stale as (${stale})
    insert into annotation_operation_tombstones
      (tenant_id, user_id, operation_id, request_hash, method, annotation_id, created_at, purged_at)
    select tenant_id, user_id, operation_id, request_hash, method, annotation_id, created_at, clock_timestamp()
      from stale
    on conflict (tenant_id, user_id, operation_id) do nothing`, [tenantId, retention, limit]);
  const deleted = await client.query(`
    with stale as (${stale})
    delete from annotation_operations operations using stale
     where operations.tenant_id = stale.tenant_id
       and operations.user_id = stale.user_id
       and operations.operation_id = stale.operation_id`, [tenantId, retention, limit]);
  const expiredTombstones = await client.query(
    `delete from annotation_operation_tombstones
      where tenant_id = $1 and purged_at < clock_timestamp() - ($2::int * interval '1 day')`,
    [tenantId, tombstoneRetention],
  );
  return {
    skipped: false,
    receiptsMoved: moved.rowCount,
    receiptsDeleted: deleted.rowCount,
    tombstonesDeleted: expiredTombstones.rowCount,
    retentionDays: retention,
    tombstoneDays: tombstoneRetention,
  };
}

// Demo API has the same owner/version/replay semantics; no shared-account notes.
export function memoryAnnotationMutations(rows) {
  const receipts = new Map();
  return context => {
    const { method, id, body, tenantId, userId } = context;
    const p = prepare(context);
    if (p.status) return p;
    const key = `${tenantId}:${userId}:${p.operationId}`, previous = receipts.get(key);
    if (previous) return previous.hash === p.hash ? structuredClone(previous.result) : error(409, 'idempotency_key_reused');
    const row = rows.find(item => item.id === id && item.user_id === userId);
    let result;
    if (method === 'POST') {
      const now = new Date().toISOString();
      const created = { id: randomUUID(), user_id: userId, asset_id: p.data.assetId, anchor: p.data.anchor,
        color: p.data.color, note: p.data.note, selected_text: p.data.selectedText, tags: p.data.tags,
        status: 'active', created_at: now, updated_at: now, version: 1 };
      rows.push(created); result = reply(201, created);
    } else if (!row) result = reply(404, { error: 'annotation_not_found', current: null });
    else if (row.version !== p.data.baseVersion) result = reply(409, { error: 'annotation_conflict', current: row });
    else if (method === 'DELETE') { rows.splice(rows.indexOf(row), 1); result = reply(200, { ok: true, id, version: row.version }); }
    else { for (const field of ['note', 'color', 'tags']) if (Object.hasOwn(p.data, field)) row[field] = p.data[field]; row.version++; row.updated_at = new Date().toISOString(); result = reply(200, row); }
    result = structuredClone(result);
    if (result.body?.user_id) delete result.body.user_id;
    if (result.body?.current?.user_id) delete result.body.current.user_id;
    receipts.set(key, { hash: p.hash, result });
    return structuredClone(result);
  };
}
