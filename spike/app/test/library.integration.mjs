import assert from 'node:assert/strict';
import { libraryFixture } from './helpers/library-fixture.mjs';

const f = await libraryFixture();
let checks=0;
const same=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks++;};
try {
  const base=await f.start(), a=await f.login(f.users.a), b=await f.login(f.users.b), foreign=await f.login(f.users.foreign);
  const req=(route,user=a,options)=>f.request(base,route,user,options);
  const book=f.books[0], secret=f.books.find(book=>book.title==='Secret Book');
  same((await req('/api/favorites',null)).status,401,'anonymous denied');
  for(const method of ['PUT','DELETE']) same((await req('/api/favorites/'+book.id,a,{method,csrf:false})).status,403,method+' needs CSRF');
  same((await req('/api/favorites/not-a-uuid',a,{method:'PUT'})).status,400,'invalid id');
  same((await req('/api/favorites/'+secret.id,a,{method:'PUT'})).status,404,'inaccessible book cannot be favourited');
  same((await req('/api/favorites/'+book.id,a,{method:'PUT'})).status,200,'owner adds');
  same((await req('/api/favorites/'+book.id,a,{method:'PUT'})).status,200,'idempotent add');
  same((await req('/api/favorites')).data,[{work_id:book.id}],'owner list');
  for(const user of [b,foreign]) {
    same((await req('/api/favorites',user)).data,[],'private across user/tenant');
    same((await req('/api/favorites/'+book.id,user,{method:'DELETE'})).status,200,'delete is scoped');
  }
  same((await req('/api/favorites')).data,[{work_id:book.id}],'others did not delete owner favourite');
  const ordered=async sort=>(await req('/api/books?sort='+sort)).data.map(book=>book.title);
  const az=['Added Recently','Çalışma Kitabı','Işık Bilimi','İstanbul Tarihi','Zaman Studies'];
  same(await ordered('title-asc'),az,'Turkish title order');
  same(await ordered('title-desc'),[...az].reverse(),'reverse Turkish title order');
  same(await ordered('newest'),['Added Recently','Işık Bilimi','İstanbul Tarihi','Çalışma Kitabı','Zaman Studies'],'publication year and added date fallback');
  same(await ordered('author-asc'),['Zaman Studies','Işık Bilimi','İstanbul Tarihi','Added Recently','Çalışma Kitabı'],'author strings and objects');
  const search=async q=>(await req('/api/search?q='+encodeURIComponent(q))).data;
  same((await search('Işıl Çelik')).map(book=>book.title),['Işık Bilimi'],'search author');
  same((await search('Ankara Press')).map(book=>book.title).sort(),['Çalışma Kitabı','İstanbul Tarihi'].sort(),'search publisher');
  same((await search('2024')).map(book=>book.title),['Işık Bilimi'],'search year');
  same((await search('Zamn')).map(book=>book.title),['Zaman Studies'],'fuzzy title');
  same((await search('çalışmalar')).map(book=>book.title),['Çalışma Kitabı'],'Turkish stemming');
  same((await search('study')).map(book=>book.title),['Zaman Studies'],'English stemming');
  same((await search('Zaman London 2018')).map(book=>book.title),['Zaman Studies'],'query spans title, publisher and year');
  same((await search('Writr')).map(book=>book.title),['Zaman Studies'],'fuzzy author');
  // A title match must outrank a newer metadata-only match.
  await f.admin.query("update works set metadata=jsonb_build_object('authors',jsonb_build_array('Işık Bilimi')),created_at=now() where id=$1",[f.books[2].id]);
  same((await search('Işık Bilimi')).map(book=>book.title),['Işık Bilimi','İstanbul Tarihi'],'title ranking survives metadata expansion');
  same((await req('/api/search?q=Library&sort=title-desc')).data.map(book=>book.title),[...az].reverse(),'search and explicit sort');
  await f.admin.query('insert into reading_progress(tenant_id,user_id,asset_id,anchor,percent) values($1,$2,$3,$4,42)',[f.tenant,f.users.a.id,book.asset,{}]);
  same((await req('/api/library/progress')).data.map(row=>[row.asset_id,Number(row.percent)]),[[book.asset,42]],'progress surfaced');
  same((await req('/api/library/progress',b)).data,[],'progress private to user');
  await f.admin.query("update grants set status='revoked' where scope_id=$1",[book.id]);
  same((await req('/api/favorites')).data,[],'revoked access disappears from favourites');
  same((await req('/api/library/progress')).data,[],'revoked progress disappears');
  same((await req('/api/favorites/'+book.id,a,{method:'PUT'})).status,404,'cannot re-favourite revoked book');
  same((await req('/api/favorites/'+book.id,a,{method:'DELETE'})).status,200,'can remove revoked favourite');
  same((await f.admin.query('select * from book_favorites')).rowCount,0,'delete persisted');
  console.log(JSON.stringify({passed:true,checks}));
} finally { await f.cleanup(); }
