import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import { promisify } from 'node:util';
const exec = promisify(execFile), root = process.cwd();
const out = path.join(root, 'tmp/deploy-v122');
await mkdir(out, { recursive: true });
const stateFile = path.join(out, 'deployment.json');
const compose = ['compose', '--project-name', 'akademik-platform-prod', '--env-file', '.env.production', '-f', 'docker-compose.prod.yml'];
const web = 'akademik-platform-prod-web-1', db = 'akademik-platform-prod-db-1', caddy = 'akademik-platform-prod-caddy-1';
const baseline = 'sha256:8c29759dc1181f7ee77ab2f001548631637e9258c3e652fdc548027372e7470a';
const releaseTag = 'akademik-platform-prod-web:v122-8b598a3';
const latest = 'akademik-platform-prod-web:latest';
const sha = b => createHash('sha256').update(b).digest('hex');
const norm = b => Buffer.from(b.toString().replaceAll('\r\n', '\n'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let state = await readFile(stateFile, 'utf8').then(JSON.parse).catch(() => null);
async function save() { await writeFile(stateFile, JSON.stringify(state, null, 2) + '\n'); }
async function command(file, args, extra = {}) {
  try { return (await exec(file, args, { cwd: root, windowsHide: true, timeout: 240000, maxBuffer: 24 * 1024 * 1024, ...extra })).stdout; }
  catch (error) { throw new Error(`${file} ${args[0]} failed (${error.code}): ${String(error.stderr || error.message).slice(-2200)}`); }
}
const docker = async (...args) => { if(args[0]==='compose'&&args[compose.length]==='exec'){const tail=args.slice(compose.length+1);assert.equal(tail.shift(),'-T');const opts=[];while(tail[0]==='-e')opts.push(tail.shift(),tail.shift());const service=tail.shift();assert.ok(['db','web'].includes(service));args=['exec',...opts,service==='db'?db:web,...tail];}return String(await command('docker',args)).trim(); };
async function info(name) { return JSON.parse(await docker('inspect', '--format', '{{json .}}', name)); }
function publicInfo(i) { return { id: i.Id, image: i.Image, startedAt: i.State.StartedAt, status: i.State.Status, health: i.State.Health?.Status, restarts: i.RestartCount }; }
function metadata(i) { return Object.fromEntries(i.Config.Env.filter(v => /^(APP_VERSION|BUILD_SHA|BUILD_DATE|APP_ENV|SOCIAL_DRM_B2B)=/.test(v)).map(v => { const p = v.indexOf('='); return [v.slice(0, p), v.slice(p + 1)]; })); }
const psql = async sql => JSON.parse(await docker(...compose, 'exec', '-T', 'db', 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', state.dbUser, '-d', state.dbName, '-tA', '-c', sql));
const releaseEnv = () => ({ ...process.env, APP_VERSION: '122', BUILD_SHA: '8b598a3', BUILD_DATE: state.buildDate, APP_ENV: 'production', SOCIAL_DRM_B2B: 'true' });
async function http(url) {
  const ca = await readFile(path.join(out, 'caddy-root.crt'));
  return new Promise((resolve, reject) => https.get('https://localhost' + url, { ca, timeout: 20000 }, response => {
    const chunks = []; response.on('data', b => chunks.push(b)); response.on('end', () => resolve({ status: response.statusCode, bytes: Buffer.concat(chunks) }));
  }).on('error', reject).on('timeout', function () { this.destroy(new Error('HTTPS timeout')); }));
}
async function prepare() {
  assert.equal(state, null, 'Existing release state must not be overwritten');
  assert.equal((await command('git', ['diff', '--name-only', 'HEAD', '--', 'spike/app', 'db', 'docker-compose.prod.yml'])).trim(), '', 'Reviewed application source must be clean');
  const pin = (await command('git', ['rev-parse', '8b598a3'])).trim();
  assert.equal((await command('git', ['diff', '--name-only', `${pin}..HEAD`, '--', 'spike/app', 'docker-compose.prod.yml', 'db/migrations'])).trim(), '', 'HEAD changed release code');
  const browser = JSON.parse(await readFile('docs/reader-evidence/v122-retention-exact/df6dae12-bec0-42e7-bb5f-90c65841c2bd/results.json'));
  assert.equal(browser.status, 'passed'); assert.equal(browser.cases.length, 11); assert.ok(browser.cases.every(c => c.status === 'PASS')); assert.deepEqual(browser.browserErrors, []);
  const before = await info(web), dbBefore = await info(db), caddyBefore = await info(caddy);
  assert.equal(before.Image, baseline); assert.equal(before.State.Health.Status, 'healthy');
  const startedAt = new Date().toISOString(), runId = startedAt.replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 6);
  const buildDate = '2026-10-24';
  state = { release: 'v122', sourceCommit: pin, operationsCommit: (await command('git', ['rev-parse', 'HEAD'])).trim(), startedAt, runId, buildDate, before: publicInfo(before), dbBefore: publicInfo(dbBefore), caddyBefore: publicInfo(caddyBefore), previousMetadata: metadata(before), releaseTag, rollbackTag: `akademik-platform-prod-web:rollback-v121-pre-v122-${runId}`, prepared: false, schemaReady: false, built: false, deployed: false, finalized: false, steps: [] };
  state.dbUser = await docker(...compose, 'exec', '-T', 'db', 'printenv', 'POSTGRES_USER');
  state.dbName = await docker(...compose, 'exec', '-T', 'db', 'printenv', 'POSTGRES_DB');
  assert.equal(state.dbName, 'akademik');
  state.dbAdmin = await psql("select json_build_object('role',current_user,'superuser',(select rolsuper from pg_roles where rolname=current_user),'tickets',to_regclass('public.download_tickets'),'limits',to_regclass('public.download_ticket_limits'))");
  assert.equal(state.dbAdmin.superuser, true, 'DB administrator required'); assert.equal(state.dbAdmin.tickets, 'download_tickets'); assert.equal(state.dbAdmin.limits, 'download_ticket_limits');
  state.sourceRoot = path.join(out, 'source-8b598a3'); await mkdir(state.sourceRoot, { recursive: true });
  const archive = path.join(out, 'source-8b598a3.tar');
  await command('git', ['archive', '--format=tar', '--output=' + archive, pin, 'spike/app', 'db/migrations']);
  await command('tar', ['-xf', archive, '-C', state.sourceRoot]);
  state.sourceProof = [];
  for (const [file, testedHash] of Object.entries(browser.source)) {
    if (file.startsWith('db/')) { assert.equal(sha(await readFile(path.join(root,file))),testedHash); continue; }
    const local = await readFile(path.join(root, 'spike/app', file)); assert.equal(sha(local), testedHash);
    const pinned = await readFile(path.join(state.sourceRoot, 'spike/app', file)); assert.deepEqual(norm(pinned), norm(local));
    state.sourceProof.push({ file, sha256: sha(pinned), testedSha256: testedHash, equalAfterLineEndingNormalization: true });
  }
  for (const file of ['016-annotation-receipt-retention.sql']) {
    const actual = await command('docker', [...compose, 'exec', '-T', 'db', 'cat', '/migrations/' + file], { encoding: 'buffer' });
    const pinned = await readFile(path.join(state.sourceRoot, 'db/migrations', file)); assert.deepEqual(norm(actual), norm(pinned));
  }
  await docker('cp', caddy + ':/data/caddy/pki/authorities/local/root.crt', path.join(out, 'caddy-root.crt'));
  const config = JSON.parse((await http('/api/config')).bytes); assert.equal(config.version, '121');
  await docker('tag', baseline, state.rollbackTag);
  await docker('tag', baseline, 'akademik-platform-prod-web:v121-933615a');
  state.backups = [];
  const dump = `akademik-pre-v122-${runId}.dump`, files = `files-pre-v122-${runId}.tgz`;
  console.log('Creating fresh production DB and upload/OCR backups.');
  await docker(...compose, 'exec', '-T', '-e', 'PGOPTIONS=-c default_transaction_read_only=on', 'db', 'pg_dump', '-U', state.dbUser, '-d', state.dbName, '-Fc', '-f', '/backups/' + dump);
  await docker(...compose, 'exec', '-T', 'web', 'tar', 'czf', '/backups/' + files, '-C', '/app/public', 'uploads', 'ocr');
  await docker(...compose, 'exec', '-T', 'db', 'pg_restore', '--list', '/backups/' + dump);
  await docker(...compose, 'exec', '-T', 'web', 'tar', 'tzf', '/backups/' + files);
  for (const name of [dump, files]) { const relative = 'backups/' + name, bytes = await readFile(relative); assert.ok(bytes.length > 0); state.backups.push({ file: relative, bytes: bytes.length, sha256: sha(bytes), private: true }); }
  state.schemaReady = false; state.migrationAction = '016 pending clone validation and DB-admin production apply'; state.prepared = true; state.steps.push({ step: 'fresh-backups-validated-and-rollback-retained', at: new Date().toISOString() }); await save();
  console.log(JSON.stringify({ prepared: true, baseline: state.before, rollbackTag: state.rollbackTag, backups: state.backups.map(({sha256,...b})=>b) }));
}

async function clone() {
 assert.ok(state.prepared&&!state.deployed&&!state.cloneVerified);
 const name='akademik-v122-restore-'+state.runId, label='akademik.v122-clone';
 const report={startedAt:new Date().toISOString(),backup:state.backups[0],status:'running',cleanup:{},scope:'Fresh actual production backup restored in network-isolated owned PostgreSQL. No real note/account content published; fingerprints only. Migration 016 applied twice as admin; complete annotation and receipt fingerprints preserved.'};
 const cp=async sql=>JSON.parse(await docker('exec',name,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','clone_admin','-d','clone_test','-tA','-c',sql));
 const fingerprint="select json_build_object('notes',(select count(*) from annotations),'contentDigest',(select md5(coalesce(string_agg(md5(to_jsonb(a)::text),'' order by id),'')) from annotations a),'receipts',(select count(*) from annotation_operations),'receiptDigest',(select md5(coalesce(string_agg(md5(to_jsonb(a)::text),'' order by tenant_id,user_id,operation_id),'')) from annotation_operations a),'works',(select count(*) from works),'assets',(select count(*) from assets),'users',(select count(*) from users))";
 let created=false;
 try {
  assert.equal(sha(await readFile(path.join(root,state.backups[0].file))),state.backups[0].sha256);
  await docker('run','--detach','--rm','--network','none','--name',name,'--label',label+'='+state.runId,'--tmpfs','/var/lib/postgresql/data','--env','POSTGRES_USER=clone_admin','--env','POSTGRES_DB=clone_test','--env','POSTGRES_HOST_AUTH_METHOD=trust','postgres:16-alpine');created=true;
  for(let n=0;n<60;n++){try{await docker('exec',name,'pg_isready','-U','clone_admin','-d','clone_test');break;}catch{if(n===59)throw Error('clone readiness timeout');await sleep(1000);}}
  await docker('exec',name,'psql','-U','clone_admin','-d','clone_test','-v','ON_ERROR_STOP=1','-c','create role akademik_app nologin');
  await docker('cp',path.join(root,state.backups[0].file),name+':/tmp/input.dump');
  await docker('exec',name,'pg_restore','-U','clone_admin','-d','clone_test','--exit-on-error','--no-owner','--no-acl','/tmp/input.dump');
  report.before=await cp(fingerprint);
  await docker('cp',path.join(state.sourceRoot,'db/migrations/016-annotation-receipt-retention.sql'),name+':/tmp/016.sql');
  for(let n=1;n<=2;n++){await docker('exec',name,'psql','-X','-v','ON_ERROR_STOP=1','-U','clone_admin','-d','clone_test','-f','/tmp/016.sql');}
  report.after=await cp(fingerprint);assert.deepEqual(report.after,report.before);
  report.schema=await cp("select json_build_object('receiptRls',(select relrowsecurity and relforcerowsecurity from pg_class where oid='annotation_operations'::regclass),'tombstoneRls',(select relrowsecurity and relforcerowsecurity from pg_class where oid='annotation_operation_tombstones'::regclass),'trigger',(select count(*)=1 from pg_trigger where tgname='annotation_operations_tombstone_guard' and not tgisinternal),'tombstones',(select count(*) from annotation_operation_tombstones))");
  assert.equal(report.schema.receiptRls,true);assert.equal(report.schema.tombstoneRls,true);assert.equal(report.schema.trigger,true);assert.equal(report.schema.tombstones,0);
  assert.deepEqual(await cp(fingerprint),report.before);report.fingerprintsPreserved=true;report.doubleApply=true;report.status='passed';state.cloneVerified=true;state.steps.push({step:'fresh-production-backup-restored-migration-016-double-applied-and-data-retained',at:new Date().toISOString()});await save();
 }catch(e){report.status='failed';report.error=e.message;throw e;}
 finally{if(created){assert.equal(await docker('inspect','--format','{{index .Config.Labels "'+label+'"}}',name),state.runId);await docker('rm','--force',name);report.cleanup.ownedCloneRemoved=true;}report.completedAt=new Date().toISOString();await writeFile(path.join(out,'restore-migration-results.json'),JSON.stringify(report,null,2)+'\n');}
 console.log(JSON.stringify({clone:report.status,doubleApply:report.doubleApply,dataRetained:true,cleanup:report.cleanup}));
}
async function migrate() {
 assert.ok(state.cloneVerified&&state.built&&state.envPersisted&&!state.deployed&&!state.schemaReady);
 assert.equal((await info(web)).Image,baseline);
 const actual=await command('docker',[...compose,'exec','-T','db','cat','/migrations/016-annotation-receipt-retention.sql'],{encoding:'buffer'});
 assert.deepEqual(norm(actual),norm(await readFile(path.join(state.sourceRoot,'db/migrations/016-annotation-receipt-retention.sql'))));
 const result=await docker(...compose,'exec','-T','db','psql','-X','-v','ON_ERROR_STOP=1','-U',state.dbUser,'-d',state.dbName,'-f','/migrations/016-annotation-receipt-retention.sql');
 await writeFile(path.join(out,'016-annotation-receipt-retention.sql.txt'),result+'\n');
 state.migratedSchema=await psql("select json_build_object('version',(select count(*)=1 from information_schema.columns where table_name='annotations' and column_name='version'),'receiptRls',(select relrowsecurity and relforcerowsecurity from pg_class where oid='annotation_operations'::regclass),'tombstoneRls',(select relrowsecurity and relforcerowsecurity from pg_class where oid='annotation_operation_tombstones'::regclass),'trigger',(select count(*)=1 from pg_trigger where tgname='annotation_operations_tombstone_guard' and not tgisinternal))");
 assert.ok(Object.values(state.migratedSchema).every(Boolean));state.schemaReady=true;state.migrationAction='016 applied as DB administrator after fresh-backup restore/double-apply validation';state.steps.push({step:'production-migration-016-applied-before-v122-web',at:new Date().toISOString()});await save();console.log(JSON.stringify({migration:'016',...state.migratedSchema}));
}

async function build() {
  assert.ok(state.cloneVerified && !state.deployed);
  console.log('Building pinned v122-8b598a3 image.');
  try { const result = await exec('docker', ['build', '--progress=plain', '--label', 'org.opencontainers.image.revision=' + state.sourceCommit, '--label', 'org.opencontainers.image.version=v122', '--tag', releaseTag, path.join(state.sourceRoot, 'spike/app')], { cwd: root, windowsHide: true, timeout: 600000, maxBuffer: 32*1024*1024 }); await writeFile(path.join(out, 'build.txt'), result.stdout + result.stderr); }
  catch (e) { await writeFile(path.join(out, 'build.txt'), String(e.stdout||'')+String(e.stderr||'')); throw new Error('Build failed; see private build log'); }
  state.releaseImage = await docker('image', 'inspect', '--format', '{{.Id}}', releaseTag);
  const code = `const fs=require('fs'),c=require('crypto'),o={};for(const f of ${JSON.stringify(state.sourceProof.map(x=>x.file))})o[f]=c.createHash('sha256').update(fs.readFileSync('/app/'+f)).digest('hex');console.log(JSON.stringify(o))`;
  state.imageHashes = JSON.parse(await docker('run', '--rm', '--network', 'none', '--entrypoint', 'node', releaseTag, '-e', code));
  for (const file of state.sourceProof) assert.equal(state.imageHashes[file.file], file.sha256, file.file);
  state.built = true; state.steps.push({ step: 'pinned-image-built-and-file-hashes-verified', at: new Date().toISOString() }); await save(); console.log(JSON.stringify({ image: state.releaseImage, verifiedFiles: state.sourceProof.length }));
}
async function cutover() {
  assert.ok(state.schemaReady && state.built && state.retentionProbe && !state.deployed); assert.equal((await info(web)).Image, baseline);
  await docker('tag', state.releaseImage, latest);
  await command('docker', [...compose, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'web'], { env: releaseEnv() });
  state.deployed = true; state.steps.push({ step: 'v122-web-started-after-migration-016', at: new Date().toISOString() }); await save();
  for (let n=0;n<90;n++) { const current = await info(web); assert.equal(current.Image, state.releaseImage); if(current.State.Health?.Status==='healthy'){state.after=publicInfo(current);await save();console.log(JSON.stringify(state.after));return;} assert.notEqual(current.State.Health?.Status,'unhealthy'); await sleep(1000); }
  throw new Error('New image did not become healthy');
}
async function verify() {
  assert.ok(state.deployed && !state.finalized);
  const health = await http('/api/health'); assert.equal(health.status, 200); assert.equal(JSON.parse(health.bytes).mode, 'db');
  const config = JSON.parse((await http('/api/config')).bytes); assert.equal(config.version, '122'); assert.equal(config.buildSha, '8b598a3'); assert.equal(config.environment, 'production');
  const files=[]; for(const source of state.sourceProof.filter(s=>s.file.startsWith('public/'))){const response=await http(source.file==='public/index.html'?'/?v=120':'/'+source.file.slice(7));assert.equal(response.status,200);assert.equal(sha(response.bytes),source.sha256);files.push({file:source.file,sha256:source.sha256});}
  await writeFile(path.join(out,'http-verification.json'),JSON.stringify({health:200,config:{version:config.version,buildSha:config.buildSha,environment:config.environment,buildDate:config.buildDate},servedFiles:files},null,2)+'\n');
  const result=await exec(process.execPath,['scripts/smoke.mjs','https://localhost'],{cwd:root,windowsHide:true,env:{...process.env,NODE_EXTRA_CA_CERTS:path.join(out,'caddy-root.crt')},timeout:90000,maxBuffer:1024*1024});
  await writeFile(path.join(out,'smoke.txt'),result.stdout+result.stderr); assert.match(result.stdout,/16 checks passed/);
  state.smokeChecks=16; state.after=publicInfo(await info(web)); assert.equal(state.after.health,'healthy'); assert.equal(state.after.restarts,0);
  state.steps.push({step:'HTTPS-source-hashes-and-smoke-16-passed',at:new Date().toISOString()}); await save(); console.log(JSON.stringify({smoke:16,servedFiles:files.length,health:state.after}));
}
async function rollback() {
  const current=await info(web); assert.ok([state.releaseImage,baseline].includes(current.Image));
  await docker('tag',baseline,latest); const env={...process.env,...state.previousMetadata};
  await command('docker',[...compose,'up','-d','--no-deps','--no-build','--force-recreate','web'],{env});
  for(let n=0;n<60;n++){const i=await info(web);if(i.Image===baseline&&i.State.Health?.Status==='healthy'){state.rolledBack=true;state.afterRollback=publicInfo(i);await save();await persistEnv(state.previousMetadata,false);console.log('Rolled back application to v121; migration 016 retained.');return;}await sleep(1000);}throw Error('Rollback health timeout');
}
async function finalize() {
  assert.ok(state.smokeChecks===16&&state.deployed&&!state.rolledBack);
  const acceptance=JSON.parse(await readFile(path.join(out,'production-browser-results.json')));assert.equal(acceptance.status,'passed');
  assert.ok(state.envPersisted&&state.retentionVerified);
  state.after=publicInfo(await info(web));assert.equal(state.after.image,state.releaseImage);assert.equal(state.after.health,'healthy');assert.equal(state.after.restarts,0);
  state.dbAfter=publicInfo(await info(db));state.caddyAfter=publicInfo(await info(caddy));assert.equal(state.dbAfter.id,state.dbBefore.id);assert.equal(state.caddyAfter.id,state.caddyBefore.id);
  assert.equal(await docker('image','inspect','--format','{{.Id}}',state.rollbackTag),baseline);
  state.finalized=true;state.completedAt=new Date().toISOString();state.steps.push({step:'production-conflict-offline-privacy-verification-passed-and-public-metadata-persisted',at:state.completedAt});await save();console.log(JSON.stringify({release:releaseTag,image:state.releaseImage,health:state.after,smoke:16,complete:true}));
}

async function persistEnv(values,record=true){
 const desired=Object.fromEntries(['APP_VERSION','BUILD_SHA','BUILD_DATE'].map(k=>[k,values[k]]));
 const file=path.join(root,'.env.production'),before=await readFile(file,'utf8'),eol=before.includes('\r\n')?'\r\n':'\n';let after=before;const original={};
 for(const[key,value]of Object.entries(desired)){assert.equal(typeof value,'string');const re=new RegExp('^'+key+'=.*$','gm');original[key]=(before.match(re)||[]).map(s=>s.trimEnd());const line=key+'='+value;after=re.test(after)?after.replace(re,()=>line):after+(after.endsWith('\n')?'':eol)+line+eol;}
 const strip=s=>s.split(/\r?\n/).filter(l=>l&&!Object.keys(desired).some(k=>l.startsWith(k+'='))).join('\n');assert.equal(strip(before),strip(after));await writeFile(file,after);
 if(record)await writeFile(path.join(out,'release-env-metadata.json'),JSON.stringify({before:original,after:desired},null,2)+'\n');
}
async function environment(){assert.ok(state.prepared&&!state.deployed);await persistEnv({APP_VERSION:'122',BUILD_SHA:'8b598a3',BUILD_DATE:'2026-10-24'});state.envPersisted=true;await save();console.log('Only three requested public production metadata fields persisted.');}
async function probe(){
 assert.ok(state.schemaReady&&!state.deployed&&!state.retentionProbe);assert.equal((await info(web)).Image,baseline);
 const op=randomUUID(),annotation=randomUUID(),hash=sha(Buffer.from('v122-retention-probe:'+op));
 const current=await info(web),tenant=current.Config.Env.find(x=>x.startsWith('DEMO_TENANT_ID=')).slice('DEMO_TENANT_ID='.length);assert.match(tenant,/^[a-f0-9-]{36}$/);
 const row=await psql("with inserted as (insert into annotation_operations(tenant_id,user_id,operation_id,request_hash,method,annotation_id,response_status,response_body,created_at) select tenant_id,id,'"+op+"','"+hash+"','POST','"+annotation+"',201,'{\"probe\":\"synthetic release retention test\"}',clock_timestamp()-interval '91 days' from users where tenant_id='"+tenant+"' order by id limit 1 returning operation_id) select json_build_object('inserted',(select count(*) from inserted))");
 assert.equal(row.inserted,1);state.retentionProbe={operationId:op,annotationId:annotation,syntheticOnly:true,agedDays:91,existingAnnotationsModified:false,createdAt:new Date().toISOString()};await save();console.log(JSON.stringify({retentionProbeSeeded:true,syntheticOnly:true,existingAnnotationsModified:false}));
}
async function retention(){
 assert.ok(state.deployed&&state.retentionProbe);const current=await info(web);assert.equal(current.Image,state.releaseImage);
 const runtimeEnv=Object.fromEntries(current.Config.Env.map(x=>{const i=x.indexOf('=');return[x.slice(0,i),x.slice(i+1)];}));assert.equal(new URL(runtimeEnv.DATABASE_URL).username,'akademik_app');assert.equal(runtimeEnv.ANNOTATION_RECEIPT_RETENTION_DAYS,'90');assert.equal(runtimeEnv.ANNOTATION_TOMBSTONE_RETENTION_DAYS,'365');const role=await psql("select json_build_object('superuser',rolsuper,'bypassRls',rolbypassrls) from pg_roles where rolname='akademik_app'");assert.equal(role.superuser,false);assert.equal(role.bypassRls,false);const elapsed=Date.now()-Date.parse(current.State.StartedAt);assert.ok(elapsed>=65000,'First scheduled retention has not yet run');
 const logs=await exec('docker',['logs','--timestamps','--since',current.State.StartedAt,web],{cwd:root,windowsHide:true,timeout:30000,maxBuffer:2e6});const combined=logs.stdout+logs.stderr;
 assert.doesNotMatch(combined,/\[annotations\] retention failed:/);assert.match(combined,/\[annotations\] retention: 1 receipts, 0 tombstones/);
 const op=state.retentionProbe.operationId;assert.match(op,/^[a-f0-9-]{36}$/);
 const dbResult=await psql("select json_build_object('receiptRemaining',(select count(*) from annotation_operations where operation_id='"+op+"'),'tombstoneCount',(select count(*) from annotation_operation_tombstones where operation_id='"+op+"'),'annotationCreated',(select count(*) from annotations where id='"+state.retentionProbe.annotationId+"'),'tombstoneHasContentColumn',(select count(*)>0 from information_schema.columns where table_name='annotation_operation_tombstones' and column_name='response_body'))");
 assert.equal(dbResult.receiptRemaining,0);assert.equal(dbResult.tombstoneCount,1);assert.equal(dbResult.annotationCreated,0);assert.equal(dbResult.tombstoneHasContentColumn,false);
 const lines=combined.split(/\r?\n/).filter(l=>/\[annotations\] retention/.test(l));await writeFile(path.join(out,'retention-log.txt'),lines.join('\n')+'\n');await writeFile(path.join(out,'retention-verification.json'),JSON.stringify({checkedAt:new Date().toISOString(),automaticFirstRun:true,elapsedMs:elapsed,appRole:'akademik_app',appRoleVerified:true,superuser:false,bypassRls:false,retentionDays:90,tombstoneDays:365,syntheticProbe:state.retentionProbe,logLines:lines,...dbResult},null,2)+'\n');
 state.retentionVerified=true;state.steps.push({step:'first-automatic-retention-purged-synthetic-91-day-receipt-without-errors',at:new Date().toISOString()});await save();console.log(JSON.stringify({retention:'passed',automaticFirstRun:true,...dbResult}));
}

try { const phase=process.argv[2];console.log('Release phase: '+phase);assert.ok(['prepare','clone','migrate','build','cutover','verify','rollback','finalize','env','probe','retention'].includes(phase));await({prepare,clone,migrate,build,cutover,verify,rollback,finalize,env:environment,probe,retention}[phase])(); }
catch(e){if(state){state.lastError={phase:process.argv[2],at:new Date().toISOString(),message:e.message};await save();}console.error(e.message);process.exitCode=1;}
