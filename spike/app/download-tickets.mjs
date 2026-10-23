import { createHash, randomBytes } from 'node:crypto';

export const DOWNLOAD_ISSUE_LIMIT = 10;
export const DOWNLOAD_REQUEST_LIMIT = 40;

export function startDownloadMaintenance(service, {
  setIntervalFn = setInterval, clearIntervalFn = clearInterval,
  onError = error => console.warn('[downloads] maintenance failed:', error.message),
} = {}) {
  let running = false;
  let stopped = false;
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try { await service.maintenance(); }
    catch (error) { onError(error); }
    finally { running = false; }
  };
  const timer = setIntervalFn(tick, 60_000);
  timer.unref?.();
  void tick();
  return () => { stopped = true; clearIntervalFn(timer); };
}

// Raw tickets cross the HTTP boundary only in JSON POST bodies. Neither raw
// tickets nor their hashes belong in audit payloads, URLs, or application logs.
export function createDownloadService({ withTenant, getBook, activeGrants, grantAllows, tenantId, b2b }) {
  const digest = value => createHash('sha256').update(value).digest('hex');

  async function audit(client, auth, action, book, payload = {}) {
    await client.query(
      `insert into audit_events (tenant_id, actor_id, action, object_type, object_id, payload)
       values ($1, $2, $3, 'asset', $4, $5::jsonb)`,
      [tenantId, auth.userId, action, book?.asset_id || null,
        JSON.stringify({ book_id: book?.id || null, ...payload })],
    );
  }

  async function transaction(fn) {
    return withTenant(async client => {
      await client.query('begin');
      try {
        const result = await fn(client);
        await client.query('commit');
        return result;
      } catch (error) {
        await client.query('rollback').catch(() => {});
        throw error;
      }
    });
  }

  async function deny(client, auth, book, reason, bypass = false, status = 403, error = 'download ticket rejected') {
    await audit(client, auth, 'download.ticket.deny', book, { reason });
    if (bypass) await audit(client, auth, 'download.watermark.bypass_attempt', book, { reason });
    return { status, body: { error } };
  }

  async function budget(client, auth, kind, limit) {
    const { rows: [row] } = await client.query(
      `insert into download_ticket_limits (tenant_id, user_id, kind, window_start, request_count, notified)
       values ($1, $2, $3, clock_timestamp(), 1, false)
       on conflict (tenant_id, user_id, kind) do update set
         window_start = case when download_ticket_limits.window_start <= clock_timestamp() - interval '60 seconds'
           then clock_timestamp() else download_ticket_limits.window_start end,
         request_count = case when download_ticket_limits.window_start <= clock_timestamp() - interval '60 seconds'
           then 1 else least(download_ticket_limits.request_count + 1, $4::int + 1) end,
         notified = case when download_ticket_limits.window_start <= clock_timestamp() - interval '60 seconds'
           then false else download_ticket_limits.notified end
       returning request_count, notified,
         greatest(1, ceil(extract(epoch from window_start + interval '60 seconds' - clock_timestamp())))::int as retry_after`,
      [tenantId, auth.userId, kind, limit],
    );
    if (row.request_count <= limit) return null;
    if (!row.notified) {
      await client.query(
        'update download_ticket_limits set notified = true where tenant_id = $1 and user_id = $2 and kind = $3',
        [tenantId, auth.userId, kind],
      );
      await audit(client, auth, 'download.rate_limit', null, { kind, limit, window_seconds: 60 });
    }
    // One summary per window, never one audit row for every rejected request.
    return { status: 429, body: { error: 'too many download requests', retryAfter: row.retry_after }, retryAfter: row.retry_after };
  }

  async function currentAdmin(client, auth) {
    // Session role claims can outlive a role change: recheck the database for
    // this exceptional permission, both when issuing and consuming the ticket.
    const { rows } = await client.query(
      'select role from users where id = $1 and tenant_id = $2', [auth.userId, tenantId],
    );
    return rows[0]?.role === 'admin';
  }

  async function allowedGrantIds(client, book, auth) {
    const grants = await activeGrants(auth, client);
    if (grants.length) {
      const matches = grants.filter(grant => grantAllows(book, [grant]));
      return matches.length ? matches.map(grant => grant.id) : null;
    }
    // Reader compatibility remains unchanged. Full downloads fail closed when
    // a tenant has configured grants but this user has none active/applicable;
    // revoking the final grant must not turn a restricted download into open access.
    const { rows } = await client.query('select download_grants_required as configured from tenants where id = $1', [tenantId]);
    return rows[0] && !rows[0].configured ? [] : null;
  }

  function validBody(body, keys) {
    return body && typeof body === 'object' && !Array.isArray(body)
      && Object.keys(body).every(key => keys.includes(key));
  }

  return {
    checkRequest(auth) {
      return transaction(client => budget(client, auth, 'traffic', DOWNLOAD_REQUEST_LIMIT));
    },

    maintenance() {
      return transaction(async client => {
        const { rows: [lock] } = await client.query(
          "select pg_try_advisory_xact_lock(hashtext($1), hashtext('download-maintenance')) as acquired", [tenantId],
        );
        if (!lock.acquired) return { skipped: true, ticketsDeleted: 0, limitsDeleted: 0 };
        const tickets = await client.query(
          `with stale as (
             select id from download_tickets where tenant_id = $1
               and expires_at < clock_timestamp() - interval '1 hour'
             order by expires_at limit 1000 for update skip locked
           ) delete from download_tickets t using stale where t.id = stale.id`, [tenantId],
        );
        const limits = await client.query(
          `with stale as (
             select tenant_id, user_id, kind from download_ticket_limits where tenant_id = $1
               and window_start < clock_timestamp() - interval '1 day'
             order by window_start limit 1000 for update skip locked
           ) delete from download_ticket_limits l using stale
             where l.tenant_id = stale.tenant_id and l.user_id = stale.user_id and l.kind = stale.kind`, [tenantId],
        );
        return { skipped: false, ticketsDeleted: tickets.rowCount, limitsDeleted: limits.rowCount };
      });
    },

    auditDenied(auth, reason, bypass = false, status = 403) {
      return transaction(client => deny(client, auth, null, reason, bypass, status));
    },

    issue(bookId, auth, body) {
      return transaction(async client => {
        if (auth.tenantId !== tenantId) return deny(client, auth, null, 'tenant_mismatch');
        const limited = await budget(client, auth, 'issue', DOWNLOAD_ISSUE_LIMIT);
        if (limited) return limited;
        if (!validBody(body, ['watermarkOverride', 'overrideReason'])) return deny(client, auth, null, 'unsupported_issue_fields', true);
        const book = await getBook(bookId, client);
        if (!book) return deny(client, auth, null, 'book_unavailable');
        if (book.allow_download === false) return deny(client, auth, book, 'download_disabled', false, 403, 'download disabled for this title');
        const grantIds = await allowedGrantIds(client, book, auth);
        if (grantIds === null) return deny(client, auth, book, 'grant_denied');
        if (body.watermarkOverride !== undefined && typeof body.watermarkOverride !== 'boolean') {
          return deny(client, auth, book, 'invalid_override', true, 400, 'invalid watermark override');
        }
        const override = body.watermarkOverride === true;
        if (override && !await currentAdmin(client, auth)) return deny(client, auth, book, 'override_not_admin', true);
        const reason = typeof body.overrideReason === 'string' ? body.overrideReason.trim() : '';
        if ((override && (reason.length < 10 || reason.length > 500)) || (!override && body.overrideReason !== undefined)) {
          return deny(client, auth, book, 'override_reason_required', true, 400, 'override reason must contain 10–500 characters');
        }
        const token = randomBytes(32).toString('hex');
        const { rows: [ticket] } = await client.query(
          `insert into download_tickets
             (token_hash, tenant_id, user_id, asset_id, work_id, grant_ids, watermark_override, override_reason, created_at, expires_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, statement_timestamp(), statement_timestamp() + interval '60 seconds')
           returning id, expires_at`,
          [digest(token), tenantId, auth.userId, book.asset_id, book.id, grantIds, override, override ? reason : null],
        );
        await audit(client, auth, 'download.ticket.issue', book, { ticket_id: ticket.id, watermark_override: override });
        if (override) await audit(client, auth, 'download.watermark.override', book, { ticket_id: ticket.id, reason, phase: 'issue' });
        return { status: 201, body: { ticket: token, expiresAt: ticket.expires_at, expiresIn: 60 } };
      });
    },

    consume(bookId, auth, body) {
      return transaction(async client => {
        if (auth.tenantId !== tenantId) return deny(client, auth, null, 'tenant_mismatch');
        if (!validBody(body, ['ticket'])) return deny(client, auth, null, 'unsupported_consume_fields', true);
        if (typeof body.ticket !== 'string' || !/^[0-9a-f]{64}$/.test(body.ticket)) return deny(client, auth, null, 'invalid_ticket');
        const { rows: [ticket] } = await client.query(
          `select *, expires_at > clock_timestamp() as unexpired
             from download_tickets
            where token_hash = $1 and tenant_id = $2 and user_id = $3 and work_id = $4
            for update`,
          [digest(body.ticket), tenantId, auth.userId, bookId],
        );
        if (!ticket || ticket.consumed_at || !ticket.unexpired) return deny(client, auth, null, 'invalid_ticket');
        const book = await getBook(bookId, client);
        if (!book || book.asset_id !== ticket.asset_id || book.allow_download === false) return deny(client, auth, book, 'asset_or_download_revoked');
        const grantIds = await allowedGrantIds(client, book, auth);
        if (grantIds === null || (ticket.grant_ids.length && !ticket.grant_ids.some(id => grantIds.includes(id)))) {
          return deny(client, auth, book, 'grant_revoked');
        }
        if (ticket.watermark_override && !await currentAdmin(client, auth)) return deny(client, auth, book, 'override_role_revoked', true);
        const { rowCount } = await client.query(
          `update download_tickets set consumed_at = clock_timestamp()
            where id = $1 and tenant_id = $2 and user_id = $3 and asset_id = $4
              and consumed_at is null and expires_at > clock_timestamp()`,
          [ticket.id, tenantId, auth.userId, book.asset_id],
        );
        if (rowCount !== 1) return deny(client, auth, book, 'invalid_ticket');
        const watermark = !ticket.watermark_override && (b2b || book.watermark !== false);
        await audit(client, auth, 'download.ticket.consume', book, { ticket_id: ticket.id, watermarked: watermark });
        if (ticket.watermark_override) {
          await audit(client, auth, 'download.watermark.override', book, { ticket_id: ticket.id, reason: ticket.override_reason, phase: 'consume' });
        }
        // Commit before rendering/streaming. A failed or interrupted transfer
        // consumes its ticket; the user must request a new one, never replay it.
        return { status: 200, book, watermark, ticketId: ticket.id };
      });
    },
  };
}
