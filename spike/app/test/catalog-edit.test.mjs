import test from 'node:test';
import assert from 'node:assert/strict';
import { planGlobalUpdate, updateGlobalWork, writeGlobalCover } from '../catalog-edit.mjs';

const authors = (value) => String(value).split(';').map((name) => ({ family: name.trim(), given: '' }));

// a pool whose single client records every statement; `rows` answers the first select
function fakePool({ tenantId = null, found = true, failOn = null } = {}) {
  const log = [];
  const client = {
    async query(sql, values = []) {
      log.push({ sql: sql.replace(/\s+/g, ' ').trim(), values });
      if (failOn && sql.includes(failOn)) throw new Error('boom');
      if (sql.startsWith('select tenant_id from works')) return { rows: found ? [{ tenant_id: tenantId }] : [], rowCount: found ? 1 : 0 };
      return { rows: [], rowCount: 1 };
    },
    release() { log.push({ sql: 'release' }); },
  };
  return { log, connect: async () => client, query: client.query };
}

test('the plan turns an edit form into statements, and nothing into null', () => {
  assert.equal(planGlobalUpdate({}, authors), null);
  const plan = planGlobalUpdate({
    title: ' A Guide ', subjects: 'Research methods; Ethics', authors: 'Smith', publisher: 'Pub', year: '2020', allow_copy: false, watermark: 'true',
  }, authors);
  assert.deepEqual(plan.work.map(([c]) => c), ['title', 'subjects', '__authors']);
  assert.deepEqual(plan.work[1][1], ['Research methods', 'Ethics']);
  assert.deepEqual(plan.edition, [['publisher', 'Pub'], ['publication_year', 2020]]);
  assert.deepEqual(plan.asset, [['allow_copy', false], ['watermark', true]]);
});

test('a global work is updated in one transaction, only where tenant_id is null', async () => {
  const pool = fakePool();
  const result = await updateGlobalWork({ catalogPool: pool, id: 'W1', body: { subjects: ['Research methods'], publisher: 'P' }, parseAuthors: authors });
  assert.equal(result.status, 'updated');
  assert.deepEqual(result.fields, ['subjects', 'publisher']);
  const sql = pool.log.map((entry) => entry.sql);
  assert.equal(sql[0], 'begin');
  assert.ok(sql.includes('commit') && sql.at(-1) === 'release');
  const works = pool.log.find((entry) => entry.sql.startsWith('update works'));
  assert.match(works.sql, /subjects = \$1 where id = \$2 and tenant_id is null/);
  assert.deepEqual(works.values, [['Research methods'], 'W1']);
  const editions = pool.log.find((entry) => entry.sql.startsWith('update editions'));
  assert.match(editions.sql, /where work_id = \$2 and tenant_id is null/);
  assert.ok(pool.log.every((entry) => !/update works set .*tenant_id =/.test(entry.sql)), 'the tenant is never written');
});

test('a work of a tenant is refused here, an unknown id is not found, an empty form changes nothing', async () => {
  const tenant = fakePool({ tenantId: 'T1' });
  assert.equal((await updateGlobalWork({ catalogPool: tenant, id: 'W', body: { title: 'x' }, parseAuthors: authors })).status, 'not_global');
  assert.ok(!tenant.log.some((entry) => entry.sql.startsWith('update')), 'nothing was written');
  assert.ok(tenant.log.some((entry) => entry.sql === 'rollback'));
  assert.equal((await updateGlobalWork({ catalogPool: fakePool({ found: false }), id: 'W', body: { title: 'x' }, parseAuthors: authors })).status, 'not_found');
  assert.equal((await updateGlobalWork({ catalogPool: fakePool(), id: 'W', body: {}, parseAuthors: authors })).status, 'unchanged');
});

test('a failing statement rolls the transaction back and releases the connection', async () => {
  const pool = fakePool({ failOn: 'update editions' });
  await assert.rejects(updateGlobalWork({ catalogPool: pool, id: 'W', body: { title: 'x', publisher: 'p' }, parseAuthors: authors }), /boom/);
  assert.ok(pool.log.some((entry) => entry.sql === 'rollback'));
  assert.ok(!pool.log.some((entry) => entry.sql === 'commit'));
  assert.equal(pool.log.at(-1).sql, 'release');
});

test('a global cover is set or cleared on rows whose tenant is null', async () => {
  const pool = fakePool();
  assert.equal(await writeGlobalCover({ catalogPool: pool, id: 'W', cover: { key: 'k', version: 1, ratio: 0.7 } }), true);
  assert.equal(await writeGlobalCover({ catalogPool: pool, id: 'W', cover: null }), true);
  assert.ok(pool.log.every((entry) => /tenant_id is null/.test(entry.sql)));
});
