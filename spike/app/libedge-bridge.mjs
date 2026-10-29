// The LibEdge bridge, part (a): entitlements.
//
// Contract: docs/contracts/libedge-elibrary-v1.md @ b15f8b5, sections 5.1-5.4 and 7.
//
// This module is the HTTP-facing half of the bridge, and it deliberately knows
// nothing about http. It takes a parsed request and returns what to answer, so the
// same code can be driven from a test without a listening socket. server.mjs owns
// the socket, the headers and the status line; everything below is the decision.
//
// Four rules from the contract are structural here rather than checked per
// endpoint, because a rule enforced in one place cannot be forgotten in another:
//
//   1. The tenant is in the path. There is no tenant header and no env fallback -
//      section 5.1 rules both out, and a fallback would make "forgot the path" look
//      like "worked on the demo tenant", which is the failure this exists to stop.
//   2. Scope is decided before the body is read. A token of the wrong kind is
//      rejected with 403 TOKEN_SCOPE even when the body is also invalid; otherwise
//      an unauthenticated caller could use our error messages to learn the
//      validation rules (section 5.1).
//   3. An unknown field is a 400, not something to ignore. The contract says so, and
//      it is the cheap way to catch a caller that thinks it is setting a field we
//      never implemented.
//   4. A disabled bridge is 503 BRIDGE_NOT_CONFIGURED for every endpoint, including
//      health. That has to be true for all of them, or the check belongs here.

import { createHash, timingSafeEqual } from 'node:crypto';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

// Every failure in this module is one of these. The status and code come from the
// contract's table (5.2); nothing invents a code that is not in it, because LibEdge
// switches on the code and an unknown one reads to it as a crash.
export class BridgeError extends Error {
  constructor(status, code, detail) {
    super(detail || code);
    this.status = status;
    this.code = code;
    this.detail = detail || null;
  }
}

const badBody = (detail) => new BridgeError(400, 'INVALID_BODY', detail);
const conflict = (code, detail) => new BridgeError(409, code, detail);
const unprocessable = (code, detail) => new BridgeError(422, code, detail);

// ---------------------------------------------------------------------------
// Configuration and tokens
// ---------------------------------------------------------------------------

const SCOPES = ['entitlements', 'catalog'];

// Two live values per scope so a rotation can overlap (section 5.1: "en fazla 2
// gecerli deger"). Tokens shorter than this are refused rather than compared: a
// four-character "secret" is a misconfiguration and comparing it only hides that.
const MIN_TOKEN_LENGTH = 24;

function readTokens(env) {
  const read = (name) => String(env[name] || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return {
    entitlements: read('LIBEDGE_ENTITLEMENTS_TOKENS'),
    catalog: read('LIBEDGE_CATALOG_TOKENS'),
  };
}

// A bridge with no usable token is not a bridge that rejects everything - it is a
// bridge that is switched off, and the contract gives that its own code so LibEdge
// can tell "misconfigured on your side" from "I sent a bad token".
export function isConfigured(env) {
  const tokens = readTokens(env);
  return SCOPES.some((scope) => tokens[scope].length > 0);
}

// Compared in constant time. The lengths are compared first and that is not a leak
// worth avoiding: the length of a secret is not the secret. A fingerprint of the
// candidate would be reusable, so the candidate itself is compared.
function matches(candidate, tokens) {
  if (candidate.length < MIN_TOKEN_LENGTH) return false;
  const given = Buffer.from(candidate, 'utf8');
  let matched = false;
  for (const token of tokens) {
    const expected = Buffer.from(token, 'utf8');
    if (expected.length !== given.length) continue;
    if (timingSafeEqual(expected, given)) matched = true;
  }
  return matched;
}

// Which scope a request carries. Returns null when the token is unknown, and the
// caller turns that into 401.
export function tokenScope(env, authorization) {
  const header = String(authorization || '');
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return null;
  const tokens = readTokens(env);
  for (const scope of SCOPES) {
    if (matches(match[1].trim(), tokens[scope])) return scope;
  }
  return null;
}

const ACTOR = /^(user|system):\S+$/;

export function parseActor(headers) {
  const actor = String(headers['x-libedge-actor'] || '').trim();
  if (!ACTOR.test(actor)) {
    throw new BridgeError(403, 'ACTOR_REQUIRED',
      'X-LibEdge-Actor must be "user:<id>" or "system:<job>"');
  }
  return actor;
}

// ---------------------------------------------------------------------------
// Body validation
// ---------------------------------------------------------------------------

// Validators are written out rather than generated: the contract's bodies are small,
// and an explicit list is what makes "unknown field -> 400" cheap to get right.

function objectBody(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw badBody('body must be a JSON object');
  }
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unknown.length) throw badBody(`unknown field(s): ${unknown.join(', ')}`);
  return body;
}

function requireString(value, name) {
  if (value === undefined || value === null) throw badBody(`${name} is required`);
  if (typeof value !== 'string') throw badBody(`${name} must be a string`);
  const trimmed = value.trim();
  if (!trimmed) throw badBody(`${name} must not be empty`);
  return trimmed;
}

function requireInteger(value, name) {
  // typeof first: Number.isInteger('7') is false, and a numeric string is still the
  // wrong type - say so now rather than fail later on a comparison.
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw badBody(`${name} must be an integer`);
  }
  return value;
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function requireTimestamp(value, name) {
  const text = requireString(value, name);
  if (!ISO.test(text)) throw badBody(`${name} must be an ISO 8601 UTC timestamp ending in Z`);
  const time = Date.parse(text);
  if (Number.isNaN(time)) throw badBody(`${name} is not a real date`);
  return new Date(time);
}

const TENANT_KINDS = ['institution', 'individual', 'staff'];

function requireTenantRef(kind, ref) {
  if (!TENANT_KINDS.includes(kind)) {
    throw badBody(`tenant.kind must be one of ${TENANT_KINDS.join(', ')}`);
  }
  return { kind, ref: requireString(ref, 'tenant.ref') };
}

function requireSubject(subject) {
  if (!subject || typeof subject !== 'object' || Array.isArray(subject)) {
    throw badBody('subject must be an object');
  }
  if (subject.type === 'tenant') {
    objectBody(subject, ['type']);
    return { type: 'tenant', libedge_user_id: null };
  }
  if (subject.type === 'user') {
    objectBody(subject, ['type', 'libedge_user_id']);
    return {
      type: 'user',
      libedge_user_id: requireString(subject.libedge_user_id, 'subject.libedge_user_id'),
    };
  }
  throw badBody('subject.type must be "tenant" or "user"');
}

const SCOPE_TYPES = ['collection', 'title'];

function requireScopes(scopes) {
  if (!Array.isArray(scopes)) throw badBody('scopes must be an array');
  return scopes.map((entry, index) => {
    objectBody(entry, ['type', 'id']);
    if (!SCOPE_TYPES.includes(entry.type)) {
      throw badBody(`scopes[${index}].type must be one of ${SCOPE_TYPES.join(', ')}`);
    }
    return { type: entry.type, id: requireString(entry.id, `scopes[${index}].id`) };
  });
}

// ---------------------------------------------------------------------------
// PUT /tenants/{kind}/{ref} and .../users/{uid}
// ---------------------------------------------------------------------------

const TENANT_STATUSES = ['active', 'inactive'];

export function parseTenantPut(body) {
  objectBody(body, ['name', 'slug', 'status']);
  const status = body.status === undefined ? 'active' : requireString(body.status, 'status');
  if (!TENANT_STATUSES.includes(status)) {
    throw badBody(`status must be one of ${TENANT_STATUSES.join(', ')}`);
  }
  return {
    name: requireString(body.name, 'name'),
    slug: requireString(body.slug, 'slug'),
    status,
  };
}

// A slug reaches a URL and a unique index, so the shape is checked here rather than
// leaving a constraint violation to surface as a 500.
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function slugProblem(slug) {
  return SLUG.test(slug) ? null : 'slug must be lowercase words separated by single hyphens';
}

export function parseUserPut(body) {
  objectBody(body, ['email', 'name']);
  const email = requireString(body.email, 'email');
  // Deliberately loose: the reader does not own address policy, and rejecting an
  // address LibEdge accepts would make the bridge look broken.
  if (!email.includes('@')) throw badBody('email must contain @');
  return { email, name: requireString(body.name, 'name') };
}

// ---------------------------------------------------------------------------
// PUT /accounts/{uid} and .../memberships/{uid}  (section 2.5)
// ---------------------------------------------------------------------------

// The two share a shape: a revision and a status. One function with the field name
// and the allowed statuses as arguments, because the difference really is only the
// vocabulary - and the revision rule they both obey is written once, below.
export function parseStatusPut(body, field, statuses) {
  objectBody(body, ['revision', field]);
  const status = requireString(body[field], field);
  if (!statuses.includes(status)) {
    throw badBody(`${field} must be one of ${statuses.join(', ')}`);
  }
  return { revision: requireInteger(body.revision, 'revision'), status };
}

// Sections 2.5 and 5.4 step 4 use one rule for accounts, memberships and
// subscriptions, so it lives in one place: the higher revision wins, an equal
// revision with the same content is a replay, an equal revision with different
// content is a conflict, and a lower revision is stale. A late "active" can
// therefore never reopen something a newer "disabled" closed (acceptance test 18).
export function revisionDecision(stored, incoming) {
  if (!stored) return { action: 'apply', replayed: false };
  if (incoming.revision > stored.revision) return { action: 'apply', replayed: false };
  if (incoming.revision < stored.revision) {
    const error = conflict('STALE_REVISION',
      `revision ${incoming.revision} is older than the applied revision ${stored.revision}`);
    error.appliedRevision = stored.revision;
    throw error;
  }
  if (incoming.payload_sha256 === stored.payload_sha256) {
    return { action: 'replay', replayed: true };
  }
  throw conflict('REVISION_CONFLICT',
    `revision ${incoming.revision} was already applied with different content`);
}

// ---------------------------------------------------------------------------
// PUT /subscriptions/{source_id}  (section 5.4)
// ---------------------------------------------------------------------------

const SUBSCRIPTION_STATUSES = ['active', 'suspended', 'cancelled'];

export function parseSourceId(sourceId) {
  const match = /^(institution|individual):(.+)$/.exec(String(sourceId || ''));
  if (!match) {
    throw badBody('source_id must be "institution:<id>" or "individual:<id>"');
  }
  return { kind: match[1], ref: match[2] };
}

export function parseSubscriptionPut(body) {
  // The closing request carries only four fields. The rest are accepted by the schema
  // and then dropped rather than rejected, because the contract says a closing
  // request that includes them is "ignored, not validated" (5.4) - LibEdge's outbox
  // can legitimately send a full body from a template. Unknown fields are still a
  // 400: "ignored" covers the documented ones, not a typo.
  objectBody(body, ['revision', 'tenant', 'subject', 'status', 'valid_from', 'valid_to', 'lease_until', 'scopes']);
  const revision = requireInteger(body.revision, 'revision');
  if (!body.tenant || typeof body.tenant !== 'object' || Array.isArray(body.tenant)) {
    throw badBody('tenant is required');
  }
  objectBody(body.tenant, ['kind', 'ref']);
  const tenant = requireTenantRef(body.tenant.kind, body.tenant.ref);
  const subject = requireSubject(body.subject);
  const status = requireString(body.status, 'status');
  if (!SUBSCRIPTION_STATUSES.includes(status)) {
    throw badBody(`status must be one of ${SUBSCRIPTION_STATUSES.join(', ')}`);
  }

  // Section 5.4: the tenant kind and subject type must agree, and this check runs on
  // closing requests too - it is a shape check, not a reason to refuse to close.
  if (tenant.kind === 'institution' && subject.type !== 'tenant') {
    throw unprocessable('SUBJECT_NOT_ALLOWED', 'an institution tenant takes subject.type "tenant"');
  }
  if (tenant.kind === 'individual' && subject.type !== 'user') {
    throw unprocessable('SUBJECT_NOT_ALLOWED', 'an individual tenant takes subject.type "user"');
  }

  if (status !== 'active') {
    // Closing: dates, lease and scopes are dropped here so nothing downstream can use
    // a value that was never meant to be applied.
    return { revision, tenant, subject, status, closing: true };
  }

  const validFrom = requireTimestamp(body.valid_from, 'valid_from');
  // valid_to may be absent or null: an open-ended subscription is legal.
  const validTo = body.valid_to === undefined || body.valid_to === null
    ? null
    : requireTimestamp(body.valid_to, 'valid_to');
  if (validTo && validTo <= validFrom) throw badBody('valid_to must be after valid_from');
  const leaseUntil = requireTimestamp(body.lease_until, 'lease_until');
  const scopes = requireScopes(body.scopes);

  return {
    revision, tenant, subject, status, closing: false, validFrom, validTo, leaseUntil, scopes,
  };
}

// ---------------------------------------------------------------------------
// payload_sha256  (section 5.4 step 2)
// ---------------------------------------------------------------------------

// The fingerprint decides "same revision, same content". lease_until is excluded on
// purpose: a replay that extends the lease must not look like new content, and a
// lease that was allowed to shorten must not either. Scope entries are sorted so two
// spellings of the same set are the same payload; anything left in caller order
// would make a reorder look like a conflict.
export function subscriptionPayloadSha256(parsed) {
  const base = {
    revision: parsed.revision,
    tenant: `${parsed.tenant.kind}:${parsed.tenant.ref}`,
    subject: parsed.subject.type === 'user'
      ? `user:${parsed.subject.libedge_user_id}`
      : 'tenant',
    status: parsed.status,
    valid_from: parsed.closing ? null : parsed.validFrom.toISOString(),
    valid_to: parsed.closing || !parsed.validTo ? null : parsed.validTo.toISOString(),
    // A closing request carries no scopes; hashing [] rather than the caller's list
    // keeps "cancelled" identical no matter what the outbox template contained.
    scopes: parsed.closing
      ? []
      : parsed.scopes.map((scope) => `${scope.type}:${scope.id}`).sort(),
  };
  return createHash('sha256').update(JSON.stringify(base)).digest('hex');
}

// ---------------------------------------------------------------------------
// Lease ceiling  (section 5.4: now < lease_until <= now + MAX + 5 min)
// ---------------------------------------------------------------------------

export const DEFAULT_LEASE_MAX_HOURS = 72;

export function leaseMaxHours(env) {
  const raw = Number(env.LIBEDGE_LEASE_MAX_HOURS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_LEASE_MAX_HOURS;
}

export function assertLeaseWithinCeiling(leaseUntil, now, env) {
  if (leaseUntil.getTime() <= now.getTime()) {
    throw unprocessable('LEASE_TOO_LONG', 'lease_until must be in the future');
  }
  const hours = leaseMaxHours(env);
  const ceiling = now.getTime() + (hours * 60 + 5) * 60 * 1000;
  if (leaseUntil.getTime() > ceiling) {
    throw unprocessable('LEASE_TOO_LONG', `lease_until is beyond now + ${hours}h + 5min`);
  }
}

// ---------------------------------------------------------------------------
// Pagination  (section 5.1)
// ---------------------------------------------------------------------------

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;

export function parseLimit(raw) {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_LIMIT;
  // Only digits: Number('1e3') is 1000 and Number(' 5 ') is 5, and neither is what a
  // caller meant by a page size.
  if (!/^\d+$/.test(String(raw))) throw badBody('limit must be an integer');
  const value = Number(raw);
  if (value < 1 || value > MAX_LIMIT) throw badBody(`limit must be between 1 and ${MAX_LIMIT}`);
  return value;
}
