import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import pg from 'pg';
import { copyServerFiles } from './server-files.mjs';

const exec = promisify(execFile);
const appDir = fileURLToPath(new URL('../../', import.meta.url));
const repoDir = path.resolve(appDir, '../..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const docker = async (...args) => (await exec('docker', args, { timeout: 90_000, windowsHide: true })).stdout.trim();
const freePort = async () => {
  const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve)); return port;
};

// Every fixture owns its container, random passwords, loopback port and server.
// No DATABASE_URL or other database connection is inherited from the environment.
export async function libraryFixture() {
  const container = `libread-library-${randomUUID()}`;
  const adminPassword = randomBytes(24).toString('hex');
  const appPassword = randomBytes(24).toString('hex');
  const password = randomBytes(18).toString('hex');
  const tenant = randomUUID(), otherTenant = randomUUID();
  let admin, child, temp, created = false;
  const cleanup = async () => {
    if (child && child.exitCode === null) { const done = once(child, 'exit'); child.kill(); await done; }
    await admin?.end().catch(() => {});
    if (created) { await docker('stop', container).catch(() => {}); await docker('rm', '--force', container).catch(() => {}); }
    if (temp) await rm(temp, { recursive: true, force: true });
  };
  try {
    await docker('version', '--format', '{{.Server.Version}}');
    await docker('run', '--detach', '--rm', '--name', container, '--tmpfs', '/var/lib/postgresql/data',
      '--publish', '127.0.0.1::5432', '--env', 'POSTGRES_USER=library_admin', '--env', 'POSTGRES_DB=library_test',
      '--env', `POSTGRES_PASSWORD=${adminPassword}`, 'postgres:16-alpine');
    created = true;
    const port = Number((await docker('port', container, '5432/tcp')).match(/:(\d+)\s*$/)?.[1]);
    assert.ok(port);
    for (let i = 0; i < 120; i++) {
      const candidate = new pg.Client({ connectionString: `postgres://library_admin:${adminPassword}@127.0.0.1:${port}/library_test` });
      try { await candidate.connect(); admin = candidate; break; } catch (error) { await candidate.end(); if (i === 119) throw error; await pause(250); }
    }
    await admin.query(await readFile(path.join(repoDir, 'db/schema.sql'), 'utf8'));
    await admin.query(`alter role akademik_app password '${appPassword}'`);
    for (const file of ['018-tenant-for-login.sql', '028-ai-usage.sql', '029-admin-settings.sql', '030-ai-usage-labels.sql', '031-book-favorites.sql']) {
      await admin.query(await readFile(path.join(repoDir, 'db/migrations', file), 'utf8'));
    }
    await admin.query("insert into tenants(id,name,slug) values ($1,'Library','library'),($2,'Other','other')", [tenant, otherTenant]);
    const salt = randomBytes(16).toString('hex');
    const hash = `scrypt$${salt}$${scryptSync(password, salt, 64).toString('hex')}`;
    const users = {};
    for (const [key, userTenant] of [['a', tenant], ['b', tenant], ['foreign', otherTenant]]) {
      const id = randomUUID(), email = `${key}@library.example`;
      await admin.query("insert into users(id,tenant_id,email,display_name,password_hash,max_sessions) values($1,$2,$3,$3,$4,10)", [id, userTenant, email, hash]);
      users[key] = { id, email, tenant: userTenant };
    }
    const books = [];
    for (const [title, language, publisher, year, author] of [
      ['Çalışma Kitabı', 'tr', 'Ankara Press', 2020, { family: 'Zorlu', given: 'Ayşe' }],
      ['Işık Bilimi', 'tr', 'İzmir Press', 2024, { family: 'Çelik', given: 'Işıl' }],
      ['İstanbul Tarihi', 'tr', 'Ankara Press', 2022, { family: 'İnan', given: 'Ali' }],
      ['Zaman Studies', 'en', 'London Scholarly', 2018, 'Alice Writer'],
      ['Secret Book', 'en', 'Private Press', 2025, 'Hidden Writer'],
      ['Added Recently', 'en', 'London Scholarly', null, 'Unknown Author'],
    ]) {
      const id = randomUUID(), edition = randomUUID(), asset = randomUUID();
      await admin.query("insert into works(id,tenant_id,title,language,subjects,metadata,created_at) values($1,$2,$3,$4,ARRAY['Library'], $5, $6)", [id,tenant,title,language,JSON.stringify({authors:[author]}), year ? '2020-01-01' : '2026-01-01']);
      await admin.query('insert into editions(id,tenant_id,work_id,publisher,publication_year) values($1,$2,$3,$4,$5)',[edition,tenant,id,publisher,year]);
      await admin.query("insert into assets(id,tenant_id,edition_id,format,storage_key,page_count) values($1,$2,$3,'pdf','seed/sample.pdf',10)",[asset,tenant,edition]);
      books.push({id,edition,asset,title,year});
    }
    const grants = [];
    for (const book of books.filter(book => book.title !== 'Secret Book')) {
      const id = randomUUID(); grants.push(id);
      await admin.query("insert into grants(id,tenant_id,subject_type,subject_id,scope_type,scope_id,status) values($1,$2,'tenant',$2,'title',$3,'active')",[id,tenant,book.id]);
    }
    const appUrl = `postgres://akademik_app:${appPassword}@127.0.0.1:${port}/library_test`;
    const asUser = async (user, fn) => {
      const client = new pg.Client({connectionString:appUrl}); await client.connect();
      try {
        await client.query('begin');
        await client.query("select set_config('app.tenant_id',$1,true), set_config('app.user_id',$2,true)",[user.tenant,user.id]);
        const result = await fn(client); await client.query('commit'); return result;
      } catch(error) { await client.query('rollback'); throw error; } finally { await client.end(); }
    };
    const request = async (base, route, session, {method='GET', csrf=true, body}={}) => {
      const headers = {};
      if (session) { headers.cookie = session.cookie; if(csrf) headers['x-csrf-token'] = session.csrf; }
      if (body !== undefined) { headers['content-type']='application/json'; body = JSON.stringify(body); }
      const response = await fetch(base+route,{method,headers,body,signal:AbortSignal.timeout(15000)});
      const text = await response.text(); let data; try { data = JSON.parse(text); } catch { /* diagnostic text */ }
      return {status:response.status,data,text,cookies:response.headers.getSetCookie().map(c=>c.split(';')[0])};
    };
    let base;
    const start = async () => {
      const parent = path.join(appDir,'tmp'); await mkdir(parent,{recursive:true}); temp = await mkdtemp(path.join(parent,'library-'));
      await copyServerFiles(appDir,temp); await mkdir(path.join(temp,'public/seed'),{recursive:true});
      await writeFile(path.join(temp,'public/seed/sample.pdf'),'fixture');
      const port = await freePort(); base = `http://127.0.0.1:${port}`;
      child = spawn(process.execPath,['server.mjs'],{cwd:temp,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,
        PORT:String(port),DATABASE_URL:appUrl,DATABASE_CATALOG_URL:'',DEMO_TENANT_ID:tenant,SESSION_SECRET:randomBytes(32).toString('hex'),
        NODE_ENV:'development',APP_ENV:'development',LIBREAD_AI_ENABLED:'0'}});
      let log=''; child.stdout.on('data',chunk=>{log+=chunk;}); child.stderr.on('data',chunk=>{log+=chunk;});
      for(let i=0;i<150;i++) {
        assert.equal(child.exitCode,null,log);
        try { if((await fetch(base+'/api/health')).ok) return base; } catch { /* starting */ }
        await pause(100);
      }
      throw Error('server startup: '+log);
    };
    const login = async user => {
      const result = await request(base,'/api/login',null,{method:'POST',body:{email:user.email,password}});
      assert.equal(result.status,200,result.text);
      return {cookie:result.cookies.join('; '),csrf:decodeURIComponent(result.cookies.find(c=>c.startsWith('akademik_csrf=')).slice('akademik_csrf='.length))};
    };
    return { admin, tenant, otherTenant, users, books, grants, asUser, request, start, login, cleanup, repoDir };
  } catch(error) { await cleanup(); throw error; }
}
