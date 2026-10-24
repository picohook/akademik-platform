import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const out='tmp/deploy-v122',dir='docs/deployments/v122-2026-10-24';
const read=f=>JSON.parse(fs.readFileSync(out+'/'+f,'utf8'));
const state=read('deployment.json'),browser=read('production-browser-results.json'),clone=read('restore-migration-results.json'),cleanup=read('cleanup-verification.json'),retention=read('retention-verification.json');
assert.ok(state.finalized&&state.schemaReady&&state.smokeChecks===16&&state.retentionVerified);
assert.equal(browser.status,'passed');assert.equal(browser.cases.length,14);assert.deepEqual(browser.browserErrors,[]);
assert.equal(clone.status,'passed');assert.equal(cleanup.testBooksRemaining,0);assert.equal(cleanup.headlessSessions,0);assert.equal(retention.tombstoneCount,1);
assert.ok(!fs.existsSync(dir),'Existing release evidence must not be overwritten');fs.mkdirSync(dir,{recursive:true});
const files=['deployment.json','production-browser-results.json','restore-migration-results.json','016-annotation-receipt-retention.sql.txt','smoke.txt','build.txt','http-verification.json','release-env-metadata.json','cleanup-verification.json','retention-log.txt','retention-verification.json','offline-bookmark-pdf.png','offline-bookmark-epub.png','two-device-conflict-pdf.png','two-device-conflict-epub.png','B-bookmark-privacy-pdf.png','B-bookmark-privacy-epub.png'];
for(const f of files)fs.copyFileSync(out+'/'+f,dir+'/'+f);
for(const [from,to]of [['deploy.mjs','deployment-helper.mjs'],['browser-production.mjs','browser-production-helper.mjs'],['cleanup.mjs','cleanup-helper.mjs'],['record.mjs','record-helper.mjs']])fs.copyFileSync(out+'/'+from,dir+'/'+to);
fs.copyFileSync('scripts/smoke.mjs',dir+'/smoke-helper.mjs');fs.writeFileSync(dir+'/.gitattributes','* -text\n* whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol\n*.txt -whitespace\n');
const hash=b=>createHash('sha256').update(b).digest('hex');
fs.writeFileSync(dir+'/release-proof.json',JSON.stringify({release:'v122',sourceCommit:state.sourceCommit,sourceIsPinnedArchive:true,acceptedRuntimeCommit:'4300f1f8d742229f245e891055281b1b6784e0e6',acceptedRetest:'docs/reader-evidence/v122-retention-exact/df6dae12-bec0-42e7-bb5f-90c65841c2bd/results.json',sourceProof:state.sourceProof,imageHashes:state.imageHashes,migration:'016-annotation-receipt-retention.sql',migrationSourceSha256:hash(fs.readFileSync(path.join(state.sourceRoot,'db/migrations/016-annotation-receipt-retention.sql'))),knownLimits:['Full receipts retained for 90 days; content-free tombstones retained for 365 days from purge. No indefinite deduplication guarantee after tombstone expiry.','Unset app.user_id retains tenant-only compatibility fallback for v121; v122 mutation transactions set the authenticated user.','v121 rollback returns 500/P0001 for a tombstoned old operation and lacks v122 per-user RLS/410 handling. Keep migration 016.','Same-host independent Edge contexts exercise device conflicts; no physical multi-device or manual WCAG claim.']},null,2)+'\n');
const local=t=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Istanbul',dateStyle:'short',timeStyle:'medium'}).format(new Date(t));
const record=`# Production deployment — v122 — 2026-10-24

| Alan | Değer |
| --- | --- |
| Endpoint / Compose | https://localhost / akademik-platform-prod |
| Kaynak commit | ${state.sourceCommit} |
| İmaj etiketi | ${state.releaseTag} |
| İmaj ID | ${state.releaseImage} |
| Frontend / CSS / SW | v122 / v45 / v14 |
| Web başlangıcı (Europe/Istanbul) | ${local(state.after.startedAt)} |
| Kabul tamamlandı (Europe/Istanbul) | ${local(state.completedAt)} |
| Health / restart | ${state.after.health} / ${state.after.restarts} |
| HTTPS smoke | 16/16 |
| Gerçek prod PostgreSQL / Edge | 14/14, 0 JS hatası, cleanup 4/4 |
| Migration | 016; 001–016 mevcut |
| Saklama | 90 gün receipt; purge sonrası 365 gün içeriksiz tombstone |

Kullanıcı teknik kabul sonrasında v122 için açık GO verdi. Sabit **8b598a3** Git arşivi kullanıldı; çalışma ağacındaki uygulama kodu değiştirilmedi. Kabul edilen 4300f1f runtime ile eşitlik ve 11/11 gerçek app-role retest kanıtının kaynak hash’leri doğrulandı. Önceki aynı runtime birim kanıtı 65/65’tir; bu operasyonel dağıtımda tekrar koşulmadı. v121 dağıtım kaydı değiştirilmedi.

## Yedek, migration ve kesim

Taze DB ve upload/OCR yedekleri alındı; pg_restore --list ve tar tzf ile doğrulandı. DB yedeği dış ağa kapalı, yalnız bu teste ait PostgreSQL konteynerine restore edildi. Migration 016 DB admin ile iki kez uygulandı: annotation ve receipt içerik fingerprint’leri, kitap/asset ve kullanıcı sayımları korundu. RLS ve tombstone guard trigger doğrulandı; geçici konteyner kaldırıldı.

.env.production içinde yalnız istenen üç public alan kalıcı güncellendi: APP_VERSION=122, BUILD_SHA=8b598a3, BUILD_DATE=2026-10-24. Diğer değerler korundu. İmaj sabit arşivden derlendi; ${state.sourceProof.length} uygulama dosyası imajda ve 9 public dosya HTTPS üzerinden hash ile doğrulandı. Ardından **016 prod DB admin ile uygulandı, sonra v122 web başlatıldı**. DB/Caddy konteyner kimlikleri değişmedi. /api/config 122/8b598a3; /api/health DB/200. Rollback gerekmedi.

## Canlı kabul

- Smoke 16/16; gerçek not POST/PATCH/DELETE dahil.
- Gerçek biletli PDF/EPUB offline Blob kaydı; IndexedDB/provenance (2).
- Offline PDF/EPUB yer imi oluştur/iptal/yeniden oluştur → reload → konuma dön → eşitle (2).
- Offline yer imi sil → reload → sunucuda silme (2).
- PDF/EPUB offline not düzenle → hard reload → CAS sürüm 2 (2).
- Aynı hesapta iki bağımsız Edge bağlamında PDF/EPUB 409 çatışması; kendi taslağı/diğer sürümü seçerek çözüm (2).
- A→B→A gerçek logout/login; yerel not ve kuyruk gizliliği ve dönüşte doğru sahibin eşitlemesi (4).

Toplam **14/14**, JS hatası 0. Hesap geçişi kuyruğu yalnız test tarayıcısında kontrollü 403 ile bekletildi; gerçek grant iptali değildir. İki cihaz testi aynı hostta bağımsız cookie/IndexedDB bağlamları kullanır; fiziksel iki cihaz, kapasite veya manuel WCAG kabulü değildir. Dedicated Edge yerel CA için certificate-error istisnası kullanır; Node HTTPS kontrolleri dışa alınan Caddy CA’yı doğrular, OS trust değişmedi.

Geçici iki kitap API ile silindi, test oturumları kapatıldı. Salt okunur DB kontrolünde ${cleanup.testBooksRemaining} test kitabı, ${cleanup.headlessSessions} headless oturumu kaldı; ${cleanup.assets} asset ve ${cleanup.notes} not görüldü. Test operasyon receipt’leri mevcut saklama politikasıyla kaldı; müşteri audit’i veya receipt’i temizlenmedi.

## İlk otomatik retention

Migration sonrası, v122 başlamadan önce yalnız dağıtım doğrulaması için benzersiz anahtarlı **bir sentetik 91 günlük receipt** eklendi. Müşteri notu değiştirilmedi ve bu fixture için annotation oluşturulmadı. Web’in ilk 60 saniyelik zamanlayıcısı gerçek app rolüyle otomatik çalıştı:

\`\`\`text
${retention.logLines.join('\n')}
\`\`\`

Tam receipt artık 0, içeriksiz tombstone 1; fixture annotation sayısı 0. Tombstone tablosunda response_body alanı yok. Retention hata logu yok. Bir sentetik içeriksiz tombstone 365 günlük politika kapsamında bırakıldı. Sonraki periyot 6 saattir; bu kayıtta 6 saat beklenerek ikinci tur gözlemlendiği iddia edilmez.

## Yedek ve rollback

${state.backups.map(b=>'- '+b.file+' ('+b.bytes+' byte; özel, Git dışında)').join('\n')}

v121 rollback korunur: **akademik-platform-prod-web:v121-933615a**, ID ${state.before.image}. Ek etiket: ${state.rollbackTag}. Rollback yalnız web imajı ve önceki public metadata ile yapılır; **016 geri alınmaz**. v121 tombstone’lu eski POST’ta 500/P0001 verir, transaction geri alınır; 410 ve v122 kullanıcı RLS bağlamı yoktur. v122’ye dönünce bu davranışlar geri gelir. Tombstone saklama süresi sonrasında sınırsız tekilleştirme garantisi verilmez.

[Manifest](v122-2026-10-24/manifest.json), [restore/migration](v122-2026-10-24/restore-migration-results.json), [smoke](v122-2026-10-24/smoke.txt), [tarayıcı](v122-2026-10-24/production-browser-results.json), [retention](v122-2026-10-24/retention-verification.json), [kaynak kanıtı](v122-2026-10-24/release-proof.json).
`;
fs.writeFileSync('docs/deployments/2026-10-24-v122.md',record);
let project=fs.readFileSync('PROJECT-STATE.md','utf8');
project=project.replace(/^- Web kaynak .*$/m,'- Web kaynak ve prod **v122/8b598a3**, stiller **v45**, SW cache **v14**. Bağımsız teknik kabul 11/11; prod smoke 16/16 + PostgreSQL/Edge 14/14 ve ilk otomatik retention geçti. docs/deployments/2026-10-24-v122.md.');
project=project.replace(/^- DB migration kaynak .*$/m,'- DB migration kaynak ve prod **001–016**. Taze restore kopyasında 016 çift uygulandı; annotation/receipt fingerprint’leri korundu. DB admin 016 → v122 web sırası tamam. 016 rollback’te korunur.');
project=project.replace(/^- Prod:.*$/m,'- Prod: **v122** ('+local(state.completedAt)+' Europe/Istanbul), kaynak **8b598a3**, imaj '+state.releaseImage+', etiket '+state.releaseTag+'; healthy/0, smoke **16/16**, gerçek PostgreSQL/Edge **14/14**, JS hatası 0, cleanup 4/4. İlk otomatik retention: sentetik 1 receipt → 1 tombstone, hata yok. v121 rollback korunur. docs/deployments/2026-10-24-v122.md.');
project=project.replace('Prod v121/001–015 aynı; deploy yapılmadı. docs/reader-evidence/v122-retention-exact/requested-checks.json.','Bu izole retest sırasında prod değiştirilmedi; ardından GO ile v122/001–016 deploy tamamlandı. docs/reader-evidence/v122-retention-exact/requested-checks.json.');
project=project.replaceAll('prod migration 016 ve deploy bekliyor.','prod migration 016 ve v122 deploy tamam.');
project=project.replace(/^- Sıradaki operasyonel adım:.*$/m,'- v122 GO uygulandı: taze yedek/restore → DB admin 016 → sabit 8b598a3 imajı → smoke 16/16 ve Edge 14/14. İlk otomatik app-role retention geçti. 016 ve v121 rollback imajı korunur. docs/deployments/2026-10-24-v122.md.');fs.writeFileSync('PROJECT-STATE.md',project);
for(const file of ['docs/ANNOTATION-RECEIPT-HARDENING.md','docs/ANNOTATION-RECEIPT-HARDENING-ACCEPTANCE-2026-10-24.md']){
 let text=fs.readFileSync(file,'utf8');text=text.replace('\n\n','\n\n**Dağıtım güncellemesi — '+local(state.completedAt)+' Europe/Istanbul:** Kullanıcı GO sonrası **prod v122/8b598a3**, migration **001–016**. Taze restore/016 çift uygulama, smoke **16/16**, canlı Edge **14/14**, JS hatası 0 ve ilk otomatik retention geçti. Aşağıdaki deploy yapılmadı ifadeleri önceki teknik kabul koşusunun tarihsel kapsamıdır. [v122 dağıtım kaydı](deployments/2026-10-24-v122.md).\n\n');fs.writeFileSync(file,text);
}
const all=[];function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=d+'/'+e.name;if(e.isDirectory())walk(f);else if(e.name!=='manifest.json')all.push(f);}}walk(dir);
fs.writeFileSync(dir+'/manifest.json',JSON.stringify({createdAt:new Date().toISOString(),release:'v122',sourceCommit:state.sourceCommit,releaseImage:state.releaseImage,smoke:16,browser:{passed:14,total:14,independent:false},automaticRetention:true,privateBackupsPublished:false,artifacts:Object.fromEntries(all.sort().map(f=>[f.slice(dir.length+1),{bytes:fs.statSync(f).size,sha256:hash(fs.readFileSync(f))}]))},null,2)+'\n');console.log(JSON.stringify({record:'docs/deployments/2026-10-24-v122.md',artifacts:all.length,productionVersion:122,source:state.sourceCommit}));
