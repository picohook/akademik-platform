import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { libraryFixture } from '../spike/app/test/helpers/library-fixture.mjs';

const f = await libraryFixture();
let checks = 0;
const check = (condition, message) => { assert.ok(condition,message); checks++; };
try {
  const sql = await readFile(path.join(f.repoDir,'db/migrations/031-book-favorites.sql'),'utf8');
  await f.admin.query(sql); await f.admin.query(sql); checks++;
  const a=f.users.a, b=f.users.b, foreign=f.users.foreign, book=f.books[0];
  const insert = client => client.query('insert into book_favorites(tenant_id,user_id,work_id) values($1,$2,$3)',[a.tenant,a.id,book.id]);
  check((await f.asUser(a,c=>c.query('select current_user'))).rows[0].current_user==='akademik_app','uses app role');
  await f.asUser(a,insert);
  check((await f.asUser(a,c=>c.query('select * from book_favorites'))).rowCount===1,'owner sees favourite');
  for (const user of [b,foreign]) {
    check((await f.asUser(user,c=>c.query('select * from book_favorites'))).rowCount===0,'other user/tenant cannot read');
    check((await f.asUser(user,c=>c.query('delete from book_favorites'))).rowCount===0,'other user/tenant cannot delete');
    await assert.rejects(f.asUser(user,insert),error=>error.code==='42501'); checks++;
  }
  await assert.rejects(f.asUser(a,insert),error=>error.code==='23505'); checks++;
  // Deliberately mismatched tenant while the owner user is bound is also refused.
  await assert.rejects(f.asUser(a,c=>c.query('insert into book_favorites values($1,$2,$3,now())',[foreign.tenant,a.id,f.books[1].id])),error=>error.code==='42501'); checks++;
  await f.admin.query('delete from works where id=$1',[book.id]);
  check((await f.asUser(a,c=>c.query('select * from book_favorites'))).rowCount===0,'work deletion cascades');
  await f.asUser(a,c=>c.query('insert into book_favorites(tenant_id,user_id,work_id) values($1,$2,$3)',[a.tenant,a.id,f.books[1].id]));
  await f.admin.query('delete from users where id=$1',[a.id]);
  check((await f.admin.query('select * from book_favorites')).rowCount===0,'user deletion cascades');
  await f.asUser(b,c=>c.query('insert into book_favorites(tenant_id,user_id,work_id) values($1,$2,$3)',[b.tenant,b.id,f.books[2].id]));
  await f.admin.query('delete from tenants where id=$1',[b.tenant]);
  check((await f.admin.query('select * from book_favorites')).rowCount===0,'tenant deletion cascades');
  console.log(JSON.stringify({passed:true,checks}));
} finally { await f.cleanup(); }
