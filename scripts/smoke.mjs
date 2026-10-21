import assert from 'node:assert/strict';

const base = (process.argv[2] || process.env.SMOKE_BASE || 'http://localhost:8080').replace(/\/$/, '');
const cookies = new Map();

function saveCookies(response) {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [];
  values.forEach((value) => {
    const pair = value.split(';')[0];
    const index = pair.indexOf('=');
    if (index > 0) cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
  });
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (cookies.size) {
    headers.set('cookie', [...cookies.entries()].map(([key, value]) => `${key}=${value}`).join('; '));
  }
  const response = await fetch(`${base}${path}`, { ...options, headers, redirect: 'manual' });
  saveCookies(response);
  return response;
}

async function json(response) {
  return response.json().catch(() => ({}));
}

function csrf() {
  return cookies.get('akademik_csrf') || '';
}

async function login(email) {
  const response = await request('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'demo1234' }),
  });
  assert.equal(response.status, 200, `login ${email}`);
}

let checks = 0;
function ok(label) {
  checks += 1;
  console.log(`ok ${checks} - ${label}`);
}

const health = await request('/api/health');
assert.equal(health.status, 200);
const healthBody = await json(health);
assert.equal(healthBody.ok, true);
ok(`health (${healthBody.mode})`);

const config = await request('/api/config');
assert.equal(config.status, 200);
ok('config');

const anonymousBooks = await request('/api/books');
assert.equal(anonymousBooks.status, 401);
ok('anonymous books rejected');

await login('reader@example.edu.tr');
ok('reader login');

const me = await request('/api/me');
assert.equal(me.status, 200);
assert.equal((await json(me)).role, 'reader');
ok('reader session');

const booksResponse = await request('/api/books');
assert.equal(booksResponse.status, 200);
const books = await json(booksResponse);
assert.ok(Array.isArray(books) && books.length > 0, 'catalog is not empty');
const book = books[0];
ok(`catalog (${books.length} books)`);

const anchor = {
  asset_version_id: book.asset_id,
  type: 'pdf',
  page: 1,
  rects: [[10, 10, 20, 10]],
  text_quote: { prefix: '', exact: 'smoke', suffix: '' },
  text_position: { start: 0, end: 5 },
};
const annotationBody = {
  assetId: book.asset_id,
  anchor,
  color: 'yellow',
  note: 'smoke test',
  selectedText: 'smoke',
  tags: 'smoke; test',
};

const noCsrf = await request('/api/annotations', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(annotationBody),
});
assert.equal(noCsrf.status, 403);
ok('CSRF rejection');

const createdResponse = await request('/api/annotations', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-csrf-token': csrf() },
  body: JSON.stringify(annotationBody),
});
assert.equal(createdResponse.status, 201);
const created = await json(createdResponse);
assert.ok(created.id);
ok('annotation create');

const patchedResponse = await request(`/api/annotations/${created.id}`, {
  method: 'PATCH',
  headers: { 'content-type': 'application/json', 'x-csrf-token': csrf() },
  body: JSON.stringify({ note: 'smoke edited', tags: 'smoke' }),
});
assert.equal(patchedResponse.status, 200);
assert.equal((await json(patchedResponse)).note, 'smoke edited');
ok('annotation patch');

const deletedResponse = await request(`/api/annotations/${created.id}`, {
  method: 'DELETE',
  headers: { 'x-csrf-token': csrf() },
});
assert.equal(deletedResponse.status, 200);
ok('annotation delete');

const uploadDenied = await request('/api/upload', {
  method: 'POST',
  headers: { 'x-csrf-token': csrf() },
  body: new FormData(),
});
assert.equal(uploadDenied.status, 403);
ok('reader upload rejected');

const searchResponse = await request(`/api/books/${book.id}/search?q=the`);
assert.equal(searchResponse.status, 200);
ok('book search endpoint');

const logout = await request('/api/logout', { method: 'POST' });
assert.equal(logout.status, 200);
const afterLogout = await request('/api/books');
assert.equal(afterLogout.status, 401);
ok('logout');

await login('librarian@example.edu.tr');
const librarian = await request('/api/me');
assert.equal((await json(librarian)).role, 'librarian');
ok('librarian login');
const librarianBooks = await request('/api/books');
assert.equal(librarianBooks.status, 200);
ok('librarian catalog');

const librarianLogout = await request('/api/logout', { method: 'POST' });
assert.equal(librarianLogout.status, 200);
ok('librarian logout');

console.log(`\n${checks} checks passed against ${base}`);
