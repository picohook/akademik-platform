import { AsyncLocalStorage } from 'node:async_hooks';

// Which tenant a unit of work belongs to.
//
// The app used to read process.env.DEMO_TENANT_ID for every query. That is
// correct only while one tenant is served: the moment a second institution
// signs in, every user's queries point at whichever tenant the env names.
//
// Rather than thread an `auth` argument through 39 withTenant call sites -
// easy to miss one, and a missed one silently reads the wrong tenant - the
// request binds its tenant once and withTenant reads it back from here.
//
// A request with no session has no tenant. That is deliberate: withTenant
// throws instead of falling back to a default, because a default is exactly
// the bug this replaces.

const storage = new AsyncLocalStorage();

export function runWithTenant(tenantId, fn) {
  if (!tenantId) throw new Error('runWithTenant requires a tenant id');
  return storage.run({ tenantId: String(tenantId) }, fn);
}

export function currentTenant() {
  return storage.getStore()?.tenantId || null;
}
