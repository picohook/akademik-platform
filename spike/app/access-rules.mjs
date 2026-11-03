// The reader's access rules, in one place: server.mjs decides with them, and the bridge's access
// diagnosis explains with them, so the explanation can never drift from the decision.

// Does one grant cover this book? (`book` needs id, publisher, subjects, collection_ids.)
export function grantMatchesBook(grant, book) {
  const publisher = String(book.publisher || '').toLocaleLowerCase('tr');
  const subjects = (book.subjects || []).map((value) => String(value).toLocaleLowerCase('tr'));
  if (grant.scope_type === 'all') return true;
  if (grant.scope_type === 'title') return String(grant.scope_id || '') === String(book.id);
  if (grant.scope_type === 'publisher') return String(grant.scope_key || '').toLocaleLowerCase('tr') === publisher;
  if (grant.scope_type === 'subject') return subjects.includes(String(grant.scope_key || '').toLocaleLowerCase('tr'));
  if (grant.scope_type === 'collection') {
    return (book.collection_ids || []).map(String).includes(String(grant.scope_id || ''));
  }
  return false;
}

// Fail-closed: no grant, no access.
export function grantAllows(book, grants) {
  if (!Array.isArray(grants) || !grants.length) return false;
  return grants.some((grant) => grantMatchesBook(grant, book));
}

// The state of a grant at `now`, as activeGrants() would judge it.
export function grantState(grant, now) {
  if (grant.status !== 'active') return grant.status;
  if (new Date(grant.valid_from).getTime() > now.getTime()) return 'not_started';
  if (grant.valid_to && new Date(grant.valid_to).getTime() <= now.getTime()) return 'ended';
  return 'active';
}

// Why a person can or cannot open a book (or anything at all). The checks run in the order the
// reader enforces them, and the first that closes access is the reason.
//
//   tenant   { id, status }
//   account  { status, revision } | null              LibEdge account row
//   membership { status, revision } | null            this tenant's membership row
//   readerUser { id, role } | null                    null: has never signed in to this tenant
//   grants   rows that could apply to this person (tenant, user, group)
//   sync     applied subscription rows for this person or tenant
//   work     null (no book asked about) | { id, title, publisher, subjects, collection_ids, withdrawn }
export function diagnoseAccess({ now, tenant, account, membership, readerUser, grants, sync, work, workAsked }) {
  const syncBySource = new Map((sync || []).map((row) => [row.source_id, row]));
  const grantRows = (grants || []).map((grant) => {
    const state = grantState(grant, now);
    const subscription = grant.subscription_source_id ? syncBySource.get(grant.subscription_source_id) : null;
    const leaseExpired = Boolean(subscription && subscription.status === 'active' && subscription.lease_until
      && new Date(subscription.lease_until).getTime() <= now.getTime());
    return {
      id: grant.id,
      subject_type: grant.subject_type,
      scope_type: grant.scope_type,
      scope: grant.scope_key || grant.scope_id || null,
      source: grant.source,
      subscription_source_id: grant.subscription_source_id || null,
      valid_from: grant.valid_from ? new Date(grant.valid_from).toISOString() : null,
      valid_to: grant.valid_to ? new Date(grant.valid_to).toISOString() : null,
      state,
      lease_expired: leaseExpired,
      covers_work: work ? grantMatchesBook(grant, work) : null,
    };
  });

  const hints = [];
  if (!readerUser) hints.push('NEVER_SIGNED_IN');
  if (grantRows.some((grant) => grant.state === 'active' && grant.lease_expired)) hints.push('LEASE_EXPIRED_GRANT_STILL_OPEN');

  const decide = (reason, via = null) => ({
    can_open: reason === 'OK', reason, via_grant_id: via, hints,
  });

  let decision;
  if (account?.status === 'disabled') decision = decide('ACCOUNT_DISABLED');
  else if (membership?.status === 'revoked') decision = decide('MEMBERSHIP_REVOKED');
  else if (!tenant || tenant.status !== 'active') decision = decide('TENANT_INACTIVE');
  else if (workAsked && !work) decision = decide('WORK_NOT_FOUND');
  else {
    const open = grantRows.filter((grant) => grant.state === 'active' && (work ? grant.covers_work : true));
    if (open.length) decision = decide('OK', open[0].id);
    else if (work && grantRows.some((grant) => grant.covers_work && grant.state !== 'active')) decision = decide('GRANT_NOT_ACTIVE');
    else decision = decide(work ? 'NO_MATCHING_GRANT' : 'NO_ACTIVE_GRANT');
  }
  return { decision, grants: grantRows };
}
