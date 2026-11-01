// Runtime settings for the explain/summarise feature, edited in the admin panel.
//
// What is editable: the on/off switch, the three limits, the collections the feature is
// allowed for. What is not, on purpose: the Cloudflare token, the account id and the model.
// They stay in the environment, so a compromised admin session cannot read or redirect them.
//
// The environment stays the outer boundary:
//   * LIBREAD_AI_ENABLED=0 (or unset) turns the feature off whatever the panel says;
//   * a stored limit can only lower or restate a limit up to the ceilings below. The global
//     ceiling keeps worst-case spend inside the free Workers AI allowance:
//     150 requests x about 60 neurons (2000 chars in, 600 tokens out) = about 9,000 of the
//     10,000 free neurons per day.
//
// Nothing here stores or logs request content. The audit log holds who changed which
// setting, with the old and the new value.

export const CEILINGS = Object.freeze({ perMinute: 30, perUserDay: 200, perGlobalDay: 150 });
export const SETTINGS_KEY = 'ai';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELDS = new Set(['enabled', 'perMinute', 'perUserDay', 'perGlobalDay', 'collectionIds']);

function whole(value, max) {
  return Number.isInteger(value) && value >= 1 && value <= max ? value : null;
}

// Strict: unknown keys and out-of-range numbers are rejected, never clamped silently, so what
// the administrator sees saved is what is stored.
export function validateSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'invalid_settings' };
  for (const key of Object.keys(input)) if (!FIELDS.has(key)) return { ok: false, error: 'unknown_field', field: key };
  if (typeof input.enabled !== 'boolean') return { ok: false, error: 'invalid_field', field: 'enabled' };
  const value = { enabled: input.enabled };
  for (const key of ['perMinute', 'perUserDay', 'perGlobalDay']) {
    const n = whole(input[key], CEILINGS[key]);
    if (n === null) return { ok: false, error: 'invalid_field', field: key, max: CEILINGS[key] };
    value[key] = n;
  }
  const ids = input.collectionIds;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 20 || !ids.every((id) => typeof id === 'string' && UUID.test(id))) {
    return { ok: false, error: 'invalid_field', field: 'collectionIds' };
  }
  value.collectionIds = [...new Set(ids.map((id) => id.toLowerCase()))];
  if (value.perUserDay > value.perGlobalDay) return { ok: false, error: 'invalid_field', field: 'perUserDay' };
  return { ok: true, value };
}

// Environment config + stored settings -> the config one request runs with. The stored
// document is re-clamped here, so a row edited by hand in the database cannot exceed a ceiling.
export function applySettings(envConfig, stored) {
  if (!stored || typeof stored !== 'object') return envConfig;
  const pick = (key) => {
    const n = whole(stored[key], CEILINGS[key]);
    return n === null ? envConfig[key] : n;
  };
  const ids = Array.isArray(stored.collectionIds) ? stored.collectionIds.filter((id) => UUID.test(id)).map((id) => id.toLowerCase()) : [];
  return {
    ...envConfig,
    switchedOn: envConfig.switchedOn && stored.enabled !== false,
    perMinute: pick('perMinute'),
    perUserDay: pick('perUserDay'),
    perGlobalDay: pick('perGlobalDay'),
    allowedCollections: ids.length ? ids : envConfig.allowedCollections,
  };
}

// withDb runs inside a bound tenant (admin routes). withPlain needs no tenant: get() also serves
// the unauthenticated /api/config, and app_settings has no tenant policy.
export function createSettingsStore({ withDb, withPlain = withDb, now = Date.now, ttlMs = 5000 } = {}) {
  let cache = { at: -Infinity, value: null };

  // A few seconds of cache keeps the hot path (every AI request, every /api/config) off the
  // database. If the read fails, the last known value stands rather than the feature flapping.
  async function get() {
    if (!withPlain) return null;
    if (now() - cache.at < ttlMs) return cache.value;
    try {
      const rows = await withPlain(async (client) => (await client.query('select value from app_settings where key = $1', [SETTINGS_KEY])).rows);
      cache = { at: now(), value: rows[0]?.value ?? null };
    } catch {
      cache = { at: now(), value: cache.value };
    }
    return cache.value;
  }

  async function save(actorId, value, action = 'ai.settings.update') {
    return withDb(async (client) => {
      await client.query('begin');
      try {
        const before = (await client.query('select value from app_settings where key = $1 for update', [SETTINGS_KEY])).rows[0]?.value ?? null;
        await client.query(
          `insert into app_settings (key, value, updated_at, updated_by) values ($1, $2::jsonb, now(), $3)
           on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by`,
          [SETTINGS_KEY, JSON.stringify(value), actorId],
        );
        await client.query(
          'insert into admin_audit_log (actor, action, detail) values ($1, $2, $3::jsonb)',
          [actorId, action, JSON.stringify({ before, after: value })],
        );
        await client.query('commit');
        cache = { at: now(), value };
        return { before, after: value };
      } catch (error) {
        await client.query('rollback').catch(() => {});
        throw error;
      }
    });
  }

  // Counts only: per UTC day the global total and the number of distinct users, plus today's
  // heaviest users. User ids are resolved to an email where the user is visible to the tenant.
  async function usage(days = 30) {
    const span = Math.min(Math.max(Number(days) || 30, 1), 90);
    return withDb(async (client) => {
      const perDay = (await client.query(
        `select to_char(g.day, 'YYYY-MM-DD') as day, g.used as total,
                (select count(*)::int from ai_usage_daily u where u.day = g.day and u.scope = 'user') as users
           from ai_usage_daily g
          where g.scope = 'global' and g.day > (now() at time zone 'utc')::date - $1::int
          order by g.day desc`,
        [span],
      )).rows;
      const top = (await client.query(
        `select u.subject as user_id, u.used, x.email
           from ai_usage_daily u
           left join users x on x.id::text = u.subject
          where u.scope = 'user' and u.day = (now() at time zone 'utc')::date
          order by u.used desc, u.subject limit 10`,
      )).rows;
      return { days: perDay, topToday: top };
    });
  }

  async function audit(limit = 50) {
    const n = Math.min(Math.max(Number(limit) || 50, 1), 200);
    return withDb(async (client) => (await client.query(
      `select to_char(a.at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at, a.actor as actor_id, x.email as actor_email, a.action, a.detail
         from admin_audit_log a left join users x on x.id = a.actor
        order by a.at desc, a.id desc limit $1`,
      [n],
    )).rows);
  }

  return { get, save, usage, audit };
}
