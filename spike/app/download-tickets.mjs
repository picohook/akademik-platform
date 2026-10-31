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
//
// Every tenant-scoped statement takes its tenant from the request
// (`tenantId`), not from the process env. The service used to be constructed with
// `tenantId: TENANT_ID`, so a signed-in user of a second institution would issue a
// ticket stamped with the env tenant while withTenant() wrote under their own - the
// two disagreed, and the audit row landed in the wrong tenant. `tenantId` is now a
// callback reading requestTenant(), which throws rather than falling back.
//
// `maintenance()` is the exception: it runs from a timer with no request, so it is
// handed the tenant it is sweeping as an argument and has no default. A sweeper that
// silently picked a tenant would be the same bug in a quieter place.
//
// `access` is the authorization decision, and it is passed in rather than rebuilt
// here. The server already answers "may this session read this book?" for /file,
// /api/books/:id/search and /marc through canAccessBook(); when this module answered
// the same question with its own rules the two disagreed. Measured on staging:
// institution B held no grant, its catalogue was empty and /file answered 404, while
// download-ticket answered 201 and download streamed the PDF. One question, one
// answer - so the caller supplies it and every path below uses it.
export function createDownloadService({ withTenant, getBook, access, grantedIds, tenantId, b2b }) {
  const digest = value => createHash('sha256').update(value).digest('hex');

  async function audit(client, auth, action, book, payload = {}) {
    await client.query(
      `insert into audit_events (tenant_id, actor_id, action, object_type, object_id, payload)
       values ($1, $2, $3, 'asset', $4, $5::jsonb)`,
      [tenantId(), auth.userId, action, book?.asset_id || null,
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

  async function deny(client, auth, book, reason, bypass = false, status = 403, error = 'download ticket rejected', details = {}) {
    await audit(client, auth, 'download.ticket.deny', book, { reason, ...details });
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
      [tenantId(), auth.userId, kind, limit],
    );
    if (row.request_count <= limit) return null;
    if (!row.notified) {
      await client.query(
        'update download_ticket_limits set notified = true where tenant_id = $1 and user_id = $2 and kind = $3',
        [tenantId(), auth.userId, kind],
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
      'select role from users where id = $1 and tenant_id = $2', [auth.userId, tenantId()],
    );
    return rows[0]?.role === 'admin';
  }

  // Whether this session may obtain this book's bytes, decided by the same function
  // /file uses. A grant list is not the answer on its own: allowedGrantIds() used to
  // return [] for a tenant whose `download_grants_required` marker was false, which
  // read as "no grants needed" and let a grantless institution download a title the
  // catalogue would not even list.
  async function canDownload(client, book, auth) {
    if (!book) return false;
    if (typeof access === 'function') return access(book, auth, client);
    throw new Error('download service requires an access decision');
  }

  // The grant ids recorded on the ticket, for the audit trail and for the
  // "the grant that authorised this was withdrawn" check at consume time. The
  // decision itself is canDownload()'s; this only remembers which grants it used, so
  // an empty list means "authorised without a grant" and never "authorised anyway".
  async function activeGrantsFor(client, auth, book) {
    if (typeof grantedIds !== 'function') return [];
    return grantedIds(book, auth, client);
  }

  function validBody(body, keys) {
    return body && typeof body === 'object' && !Array.isArray(body)
      && Object.keys(body).every(key => keys.includes(key));
  }

  return {
    checkRequest(auth) {
      return transaction(client => budget(client, auth, 'traffic', DOWNLOAD_REQUEST_LIMIT));
    },

    // `tenant` is required and has no default: this runs from a timer, outside any
    // request, so there is nothing to read the tenant from and nothing that should
    // be guessed. The caller loops over tenants and names each one.
    maintenance(tenant) {
      if (!tenant) throw new Error('maintenance requires an explicit tenant id');
      return transaction(async client => {
        const { rows: [lock] } = await client.query(
          "select pg_try_advisory_xact_lock(hashtext($1), hashtext('download-maintenance')) as acquired", [tenant],
        );
        if (!lock.acquired) return { skipped: true, ticketsDeleted: 0, limitsDeleted: 0 };
        const tickets = await client.query(
          `with stale as (
             select id from download_tickets where tenant_id = $1
               and expires_at < clock_timestamp() - interval '1 hour'
             order by expires_at limit 1000 for update skip locked
           ) delete from download_tickets t using stale where t.id = stale.id`, [tenant],
        );
        const limits = await client.query(
          `with stale as (
             select tenant_id, user_id, kind from download_ticket_limits where tenant_id = $1
               and window_start < clock_timestamp() - interval '1 day'
             order by window_start limit 1000 for update skip locked
           ) delete from download_ticket_limits l using stale
             where l.tenant_id = stale.tenant_id and l.user_id = stale.user_id and l.kind = stale.kind`, [tenant],
        );
        return { skipped: false, ticketsDeleted: tickets.rowCount, limitsDeleted: limits.rowCount };
      });
    },

    auditDenied(auth, reason, bypass = false, status = 403, details = {}, book = null) {
      // `book` reaches audit_events.object_id and payload.book_id. Callers that
      // hold the book must pass it: without it a deny row is a bare reason with
      // no way back to the title, which is exactly how "which book cannot be
      // downloaded?" had to be answered by hand from a log line.
      return transaction(client => deny(client, auth, book, reason, bypass, status, 'download ticket rejected', details));
    },

    issue(bookId, auth, body) {
      return transaction(async client => {
        const tenant = tenantId();
        if (auth.tenantId !== tenant) return deny(client, auth, null, 'tenant_mismatch');
        const limited = await budget(client, auth, 'issue', DOWNLOAD_ISSUE_LIMIT);
        if (limited) return limited;
        if (!validBody(body, ['watermarkOverride', 'overrideReason'])) return deny(client, auth, null, 'unsupported_issue_fields', true);
        const book = await getBook(bookId, client);
        if (!book) return deny(client, auth, null, 'book_unavailable');
        if (book.allow_download === false) return deny(client, auth, book, 'download_disabled', false, 403, 'download disabled for this title');
        if (!await canDownload(client, book, auth)) return deny(client, auth, book, 'grant_denied');
        if (body.watermarkOverride !== undefined && typeof body.watermarkOverride !== 'boolean') {
          return deny(client, auth, book, 'invalid_override', true, 400, 'invalid watermark override');
        }
        const override = body.watermarkOverride === true;
        if (override && !await currentAdmin(client, auth)) return deny(client, auth, book, 'override_not_admin', true);
        const reason = typeof body.overrideReason === 'string' ? body.overrideReason.trim() : '';
        if ((override && (reason.length < 10 || reason.length > 500)) || (!override && body.overrideReason !== undefined)) {
          return deny(client, auth, book, 'override_reason_required', true, 400, 'override reason must contain 10–500 characters');
        }
        const grantIds = await activeGrantsFor(client, auth, book);
        const token = randomBytes(32).toString('hex');
        const { rows: [ticket] } = await client.query(
          `insert into download_tickets
             (token_hash, tenant_id, user_id, asset_id, work_id, grant_ids, watermark_override, override_reason, created_at, expires_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, statement_timestamp(), statement_timestamp() + interval '60 seconds')
           returning id, expires_at`,
          [digest(token), tenant, auth.userId, book.asset_id, book.id, grantIds, override, override ? reason : null],
        );
        await audit(client, auth, 'download.ticket.issue', book, { ticket_id: ticket.id, watermark_override: override });
        if (override) await audit(client, auth, 'download.watermark.override', book, { ticket_id: ticket.id, reason, phase: 'issue' });
        return { status: 201, body: { ticket: token, expiresAt: ticket.expires_at, expiresIn: 60 } };
      });
    },

    consume(bookId, auth, body) {
      return transaction(async client => {
        const tenant = tenantId();
        if (auth.tenantId !== tenant) return deny(client, auth, null, 'tenant_mismatch');
        if (!validBody(body, ['ticket'])) return deny(client, auth, null, 'unsupported_consume_fields', true);
        if (typeof body.ticket !== 'string' || !/^[0-9a-f]{64}$/.test(body.ticket)) return deny(client, auth, null, 'invalid_ticket');
        const book = await getBook(bookId, client);
        if (!book) return deny(client, auth, null, 'book_unavailable');
        const { rows: [ticket] } = await client.query(
          `select *, expires_at > clock_timestamp() as unexpired
             from download_tickets
            where token_hash = $1 and tenant_id = $2 and user_id = $3 and work_id = $4
            for update`,
          [digest(body.ticket), tenant, auth.userId, book.id],
        );
        if (!ticket || ticket.consumed_at || !ticket.unexpired) return deny(client, auth, null, 'invalid_ticket');
        if (book.asset_id !== ticket.asset_id || book.allow_download === false) return deny(client, auth, book, 'asset_or_download_revoked');
        // Re-decide with the same function /file uses, not with the ticket's own
        // record: a grant withdrawn or expired since issue must stop the download,
        // and a ticket issued while a tenant-wide relaxation applied must not outlive
        // it. The ticket only narrows what that decision already allowed.
        if (!await canDownload(client, book, auth)) return deny(client, auth, book, 'grant_revoked');
        if (ticket.grant_ids.length) {
          const current = await activeGrantsFor(client, auth, book);
          if (!ticket.grant_ids.some(id => current.includes(id))) return deny(client, auth, book, 'grant_revoked');
        }
        if (ticket.watermark_override && !await currentAdmin(client, auth)) return deny(client, auth, book, 'override_role_revoked', true);
        const { rowCount } = await client.query(
          `update download_tickets set consumed_at = clock_timestamp()
            where id = $1 and tenant_id = $2 and user_id = $3 and asset_id = $4
              and consumed_at is null and expires_at > clock_timestamp()`,
          [ticket.id, tenant, auth.userId, book.asset_id],
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
