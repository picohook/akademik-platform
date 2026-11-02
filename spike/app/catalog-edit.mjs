// Edits to a record of the global catalogue (works.tenant_id is null).
//
// The app role cannot write those rows: the database refuses it (migration 022, contract 4.3). The catalogue is LibEdge's,
// and its writes go through the separate `akademik_catalog` login on its own pool. That role may update exactly the
// columns used here and only rows whose tenant is null. Who may ask for such a write is decided by the caller: a LibEdge
// staff session (contract 3.2: a staff context is given only to verified staff) whose role is admin.
//
// Pools are passed in, so the SQL and the gating can be tested with fakes.

function cleanSubjects(value) {
  return (Array.isArray(value) ? value : String(value).split(/[;,]/)).map((item) => String(item).trim()).filter(Boolean);
}

// the fields of an edit form -> the statements that apply them, or null when the form changes nothing
export function planGlobalUpdate(body, parseAuthors) {
  const work = [];
  const edition = [];
  const asset = [];
  if (body.title !== undefined) work.push(['title', String(body.title).trim()]);
  if (body.subtitle !== undefined) work.push(['subtitle', body.subtitle ? String(body.subtitle).trim() : null]);
  if (body.language !== undefined) work.push(['language', String(body.language).toLowerCase()]);
  if (body.subjects !== undefined) work.push(['subjects', cleanSubjects(body.subjects)]);
  if (body.authors !== undefined) work.push(['__authors', JSON.stringify(parseAuthors(body.authors))]);
  if (body.publisher !== undefined) edition.push(['publisher', body.publisher || null]);
  if (body.year !== undefined) edition.push(['publication_year', body.year === null || body.year === '' ? null : Number(body.year)]);
  for (const flag of ['allow_copy', 'allow_download', 'allow_print', 'watermark']) {
    if (body[flag] !== undefined) asset.push([flag, body[flag] === true || body[flag] === 'true' || body[flag] === 1 || body[flag] === '1']);
  }
  return work.length || edition.length || asset.length ? { work, edition, asset } : null;
}

// result.status: 'updated' | 'not_found' | 'not_global' | 'unchanged'
export async function updateGlobalWork({ catalogPool, id, body, parseAuthors }) {
  const plan = planGlobalUpdate(body, parseAuthors);
  const client = await catalogPool.connect();
  try {
    await client.query('begin');
    const found = await client.query('select tenant_id from works where id = $1 for update', [id]);
    if (!found.rows.length) { await client.query('rollback'); return { status: 'not_found' }; }
    if (found.rows[0].tenant_id !== null) { await client.query('rollback'); return { status: 'not_global' }; }
    if (!plan) { await client.query('rollback'); return { status: 'unchanged' }; }

    if (plan.work.length) {
      const sets = [];
      const values = [];
      for (const [column, value] of plan.work) {
        values.push(value);
        sets.push(column === '__authors'
          ? `metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{authors}', $${values.length}::jsonb)`
          : `${column} = $${values.length}`);
      }
      values.push(id);
      const done = await client.query(`update works set ${sets.join(', ')} where id = $${values.length} and tenant_id is null`, values);
      if (done.rowCount !== 1) throw new Error('global work was not updated');
    }
    if (plan.edition.length) {
      const values = plan.edition.map(([, value]) => value);
      const sets = plan.edition.map(([column], index) => `${column} = $${index + 1}`);
      values.push(id);
      await client.query(`update editions set ${sets.join(', ')} where work_id = $${values.length} and tenant_id is null`, values);
    }
    if (plan.asset.length) {
      const values = plan.asset.map(([, value]) => value);
      const sets = plan.asset.map(([column], index) => `${column} = $${index + 1}`);
      values.push(id);
      await client.query(
        `update assets set ${sets.join(', ')}
          where tenant_id is null and edition_id in (select id from editions where work_id = $${values.length})`,
        values,
      );
    }
    await client.query('commit');
    return { status: 'updated', fields: [...plan.work, ...plan.edition, ...plan.asset].map(([column]) => (column === '__authors' ? 'authors' : column)) };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// the cover of a global work: set it, or clear it with `cover` null
export async function writeGlobalCover({ catalogPool, id, cover }) {
  const result = cover
    ? await catalogPool.query(
      "update works set metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{cover}', $1::jsonb) where id = $2 and tenant_id is null",
      [JSON.stringify(cover), id])
    : await catalogPool.query(
      "update works set metadata = coalesce(metadata, '{}'::jsonb) - 'cover' where id = $1 and tenant_id is null",
      [id]);
  return result.rowCount > 0;
}
