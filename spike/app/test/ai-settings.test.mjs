import assert from 'node:assert/strict';
import test from 'node:test';
import { CEILINGS, applySettings, createSettingsStore, validateSettings } from '../ai-settings.mjs';
import { createAiSelection, readAiConfig } from '../ai-selection.mjs';

// The admin panel's AI settings: validation against hard ceilings, how they combine with the
// environment (which stays the outer boundary), and the store with its audit trail.
//   node --test test/ai-settings.test.mjs

const OA = '74149e93-39dd-50ba-b120-a75415d9b0ca';
const OTHER = '11111111-2222-3333-4444-555555555555';
const good = { enabled: true, perMinute: 5, perUserDay: 30, perGlobalDay: 100, collectionIds: [OA] };
const env = { LIBREAD_AI_ENABLED: '1', LIBREAD_AI_ACCOUNT_ID: 'a'.repeat(32), LIBREAD_AI_API_TOKEN: 'token-not-real', LIBREAD_AI_MODEL: '@cf/test/model' };

test('a valid document is accepted and normalised', () => {
  const result = validateSettings({ ...good, collectionIds: [OA.toUpperCase(), OA] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.collectionIds, [OA], 'lower-cased and de-duplicated');
});

test('values above a ceiling are rejected, not clamped', () => {
  for (const [field, over] of [['perMinute', CEILINGS.perMinute + 1], ['perUserDay', CEILINGS.perUserDay + 1], ['perGlobalDay', CEILINGS.perGlobalDay + 1]]) {
    const result = validateSettings({ ...good, [field]: over });
    assert.equal(result.ok, false, field);
    assert.equal(result.field, field);
    assert.equal(result.max, CEILINGS[field]);
  }
  assert.equal(CEILINGS.perGlobalDay * 60 <= 10_000, true, 'the global ceiling keeps worst-case spend inside the free neurons');
});

test('malformed input is refused', () => {
  for (const bad of [
    null, [], 'x', {},
    { ...good, enabled: 'yes' },
    { ...good, perMinute: 0 }, { ...good, perMinute: 2.5 }, { ...good, perMinute: '5' },
    { ...good, collectionIds: [] }, { ...good, collectionIds: ['not-a-uuid'] }, { ...good, collectionIds: [OA, 7] },
    { ...good, collectionIds: Array.from({ length: 21 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`) },
    { ...good, perUserDay: 120, perGlobalDay: 100 },
  ]) assert.equal(validateSettings(bad).ok, false, JSON.stringify(bad));
  assert.equal(validateSettings({ ...good, token: 'x' }).error, 'unknown_field', 'no way to smuggle a secret or a new setting in');
  assert.equal(validateSettings({ ...good, model: 'x' }).error, 'unknown_field', 'the model is not editable here');
});

test('the environment is the outer boundary: the panel can switch off, never on', () => {
  const off = readAiConfig({ ...env, LIBREAD_AI_ENABLED: '0' });
  assert.equal(applySettings(off, { ...good, enabled: true }).switchedOn, false);
  const on = readAiConfig(env);
  assert.equal(applySettings(on, { ...good, enabled: false }).switchedOn, false);
  assert.equal(applySettings(on, { ...good, enabled: true }).switchedOn, true);
  assert.equal(applySettings(on, null), on, 'nothing stored -> environment as it was');
});

test('limits and collections come from the panel, secrets always from the environment', () => {
  const effective = applySettings(readAiConfig(env), { ...good, perMinute: 2, perUserDay: 10, perGlobalDay: 40, collectionIds: [OTHER] });
  assert.deepEqual([effective.perMinute, effective.perUserDay, effective.perGlobalDay], [2, 10, 40]);
  assert.deepEqual(effective.allowedCollections, [OTHER]);
  assert.equal(effective.token, 'token-not-real');
  assert.equal(effective.model, '@cf/test/model');
});

test('a row edited by hand past a ceiling is clamped back at read time', () => {
  const base = readAiConfig(env);
  const effective = applySettings(base, { enabled: true, perMinute: 9999, perUserDay: 9999, perGlobalDay: 9999, collectionIds: ['junk'] });
  assert.equal(effective.perMinute, base.perMinute, 'out of range -> environment value, not the huge one');
  assert.equal(effective.perGlobalDay, base.perGlobalDay);
  assert.deepEqual(effective.allowedCollections, base.allowedCollections, 'no valid ids -> environment collections');
});

// A tiny in-memory stand-in for the two tables, enough for the store's SQL.
function fakeDb({ failReadAfter = Infinity } = {}) {
  const state = { settings: null, audit: [], reads: 0, log: [] };
  const client = {
    async query(sql, params = []) {
      state.log.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
      if (/^select value from app_settings/i.test(sql.trim())) {
        state.reads += 1;
        if (state.reads > failReadAfter) throw new Error('db down');
        return { rows: state.settings ? [{ value: state.settings }] : [] };
      }
      if (/^insert into app_settings/i.test(sql.trim())) { state.pending = JSON.parse(params[1]); return { rows: [] }; }
      if (/^insert into admin_audit_log/i.test(sql.trim())) { state.pendingAudit = { actor: params[0], action: params[1], detail: JSON.parse(params[2]) }; return { rows: [] }; }
      if (/^commit/i.test(sql.trim())) { state.settings = state.pending; state.audit.push(state.pendingAudit); return { rows: [] }; }
      return { rows: [] };
    },
  };
  return { state, withDb: async (fn) => fn(client) };
}

test('save writes the setting and the audit row together, with old and new values', async () => {
  const { state, withDb } = fakeDb();
  const store = createSettingsStore({ withDb });
  await store.save('admin-1', good);
  assert.deepEqual(state.settings, good);
  assert.equal(state.audit.length, 1);
  assert.deepEqual(state.audit[0], { actor: 'admin-1', action: 'ai.settings.update', detail: { before: null, after: good } });
  await store.save('admin-1', { ...good, perGlobalDay: 50 });
  assert.deepEqual(state.audit[1].detail.before, good, 'the second change records the first as before');
  assert.equal(JSON.stringify(state.audit).includes('token'), false, 'no secret in the audit trail');
});

test('get is cached for a few seconds, sees a save at once, and survives a read failure', async () => {
  let clock = 0;
  const { state, withDb } = fakeDb({ failReadAfter: 2 });
  const store = createSettingsStore({ withDb, now: () => clock, ttlMs: 5000 });
  assert.equal(await store.get(), null);
  assert.equal(await store.get(), null);
  assert.equal(state.reads, 1, 'second call served from cache');
  await store.save('a', good);
  assert.deepEqual(await store.get(), good, 'own save is visible immediately');
  clock += 6000;
  assert.deepEqual(await store.get(), good, 'cache expired, read fails -> last known value, not a crash');
});

test('a failed audit insert rolls the whole save back', async () => {
  const { state, withDb } = fakeDb();
  const original = withDb;
  const failing = async (fn) => original(async (client) => fn({
    async query(sql, params) {
      if (/^insert into admin_audit_log/i.test(sql.trim())) throw new Error('audit down');
      return client.query(sql, params);
    },
  }));
  const store = createSettingsStore({ withDb: failing });
  await assert.rejects(() => store.save('a', good), /audit down/);
  assert.equal(state.settings, null, 'the setting did not land without its audit row');
});

// ---- end to end through createAiSelection ----------------------------------------------------

const book = { id: 'b1', allow_copy: true, collection_ids: [OA] };
const passage = 'Photosynthesis converts light energy into chemical energy stored in glucose molecules.';
const body = { bookId: 'b1', mode: 'explain', lang: 'en', text: passage };
function budgetDb() {
  const used = new Map();
  return async (fn) => fn({
    async query(sql, params = []) {
      if (/^begin|^rollback|^commit/i.test(sql.trim())) return { rows: [], rowCount: 0 };
      const key = `${params[0]}:${params[1]}`;
      const next = (used.get(key) || 0) + 1;
      if (next > params[2]) return { rows: [], rowCount: 0 };
      used.set(key, next);
      return { rows: [{ used: next }], rowCount: 1 };
    },
  });
}
const okFetch = async () => ({ ok: true, status: 200, json: async () => ({ success: true, result: { response: 'An answer.' } }) });
const holder = (value) => ({ get: async () => value });

test('switching off in the panel stops requests and /api/config follows', async () => {
  const service = createAiSelection({ env, withDb: budgetDb(), fetchImpl: okFetch, log: () => {}, settings: holder({ ...good, enabled: false }) });
  assert.equal(await service.isEnabled(), false);
  assert.equal((await service.handle({ userId: 'u', book, body })).body.error, 'ai_disabled');
});

test('a lower per-minute limit from the panel is applied without a restart', async () => {
  const service = createAiSelection({ env, withDb: budgetDb(), fetchImpl: okFetch, log: () => {}, settings: holder({ ...good, perMinute: 1 }) });
  assert.equal((await service.handle({ userId: 'u', book, body })).status, 200);
  assert.equal((await service.handle({ userId: 'u', book, body })).body.error, 'rate_limited');
});

test('a lower daily limit from the panel is enforced by the counter', async () => {
  const service = createAiSelection({ env, withDb: budgetDb(), fetchImpl: okFetch, log: () => {}, settings: holder({ ...good, perMinute: 30, perUserDay: 2, perGlobalDay: 5 }) });
  assert.equal((await service.handle({ userId: 'u', book, body })).status, 200);
  assert.equal((await service.handle({ userId: 'u', book, body })).status, 200);
  assert.equal((await service.handle({ userId: 'u', book, body })).body.error, 'daily_user_limit');
});

test('collections set in the panel decide which books are allowed', async () => {
  const service = createAiSelection({ env, withDb: budgetDb(), fetchImpl: okFetch, log: () => {}, settings: holder({ ...good, collectionIds: [OTHER] }) });
  assert.equal((await service.handle({ userId: 'u', book, body })).body.error, 'not_available_for_book', 'OA book no longer allowed');
  assert.equal((await service.handle({ userId: 'u', book: { ...book, collection_ids: [OTHER] }, body })).status, 200);
});

test('with the environment switched off the panel cannot turn the feature on', async () => {
  const service = createAiSelection({ env: { ...env, LIBREAD_AI_ENABLED: '0' }, withDb: budgetDb(), fetchImpl: okFetch, log: () => {}, settings: holder(good) });
  assert.equal(await service.isEnabled(), false);
  assert.equal((await service.handle({ userId: 'u', book, body })).body.error, 'ai_disabled');
});
