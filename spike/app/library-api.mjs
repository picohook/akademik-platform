// Session and CSRF gates run in server.mjs before this handler is called.
export function createLibraryApi({ withDb, listBooks, getBook, canAccessBook, demoProgress }) {
  const memory = new Map();
  async function asUser(auth, fn) {
    return withDb(async client => {
      await client.query('begin');
      try {
        await client.query("select set_config('app.user_id', $1, true)", [auth.userId]);
        const result = await fn(client);
        await client.query('commit');
        return result;
      } catch (error) {
        await client.query('rollback');
        throw error;
      }
    });
  }
  return async function libraryRequest(pathname, method, auth) {
    const match = pathname.match(/^\/api\/favorites\/([^/]+)$/);
    if (pathname !== '/api/favorites' && pathname !== '/api/library/progress' && !match) return null;
    const key = `${auth.tenantId}:${auth.userId}`;
    if (pathname === '/api/library/progress' && method === 'GET') {
      const books = await listBooks(auth);
      const accessible = new Set(books.map(book => book.asset_id));
      const rows = withDb ? await asUser(auth, async client => (await client.query(
        `select asset_id, percent, updated_at from reading_progress
          where tenant_id = $1 and user_id = $2 order by updated_at desc, asset_id`,
        [auth.tenantId, auth.userId],
      )).rows) : [...demoProgress.values()].filter(row => row.user_id === auth.userId);
      return { status: 200, body: rows.filter(row => accessible.has(row.asset_id)) };
    }
    if (pathname === '/api/favorites' && method === 'GET') {
      const accessible = new Set((await listBooks(auth)).map(book => book.id));
      const rows = withDb ? await asUser(auth, async client => (await client.query(
        'select work_id from book_favorites where tenant_id = $1 and user_id = $2 order by created_at desc, work_id',
        [auth.tenantId, auth.userId],
      )).rows) : [...(memory.get(key) || [])].map(work_id => ({ work_id }));
      return { status: 200, body: rows.filter(row => accessible.has(row.work_id)) };
    }
    if (match && ['PUT', 'DELETE'].includes(method)) {
      const workId = match[1];
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(workId)) {
        return { status: 400, body: { error: 'invalid work id' } };
      }
      if (method === 'PUT') {
        const book = await getBook(workId);
        if (!book || book.id !== workId || !await canAccessBook(book, auth)) {
          return { status: 404, body: { error: 'book not found' } };
        }
      }
      if (withDb) await asUser(auth, client => method === 'PUT'
        ? client.query(`insert into book_favorites (tenant_id, user_id, work_id) values ($1, $2, $3)
            on conflict (user_id, work_id) do nothing`, [auth.tenantId, auth.userId, workId])
        : client.query('delete from book_favorites where tenant_id = $1 and user_id = $2 and work_id = $3',
          [auth.tenantId, auth.userId, workId]));
      else {
        if (!memory.has(key)) memory.set(key, new Set());
        if (method === 'PUT') memory.get(key).add(workId);
        else memory.get(key).delete(workId);
      }
      return { status: 200, body: { ok: true } };
    }
    return { status: 405, body: { error: 'method not allowed' } };
  };
}
