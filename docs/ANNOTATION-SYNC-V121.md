# Not ve yer imi eşitleme — v121

2026-10-24. Kaynak **v121**, CSS **v45**, SW shell **v13**. Bağımsız kod incelemesi **koşullu PASS**; **prod v121**, migration 015 ve canlı kabul tamam. Aşağıdaki ilk kabul koşuları geliştirme sırasındaki izole testlerdir; ayrı dağıtım güncellemesi sondadır. PostgreSQL migration **015** zorunlu; IndexedDB sürümü **2** olarak korunur.

## Davranış

- PDF/EPUB not, vurgu ve yer imi değişiklikleri online kullanımda da önce aynı atomik IndexedDB kayıt/kuyruk yoluna girer. Oturum doğrulanınca gönderilir; HTTP/oturum hatalarında taslak ve istek korunur.
- Sunucu her nota `version` verir. PATCH/DELETE, okunan sürümü `baseVersion` ile gönderir; satır kilidi ve sürüm karşılaştırması eski düzenlemenin güncel veriyi sessizce ezmesini engeller. Her başarılı UPDATE, DB trigger'ıyla sürümü artırır.
- İki cihaz/sekme aynı notu değiştirirse panel iki sürümü gösterir: **Bu taslağı kullan**, **Diğer sürümü kullan**, **İkisini de sakla**. İlk seçenek güncel sürümle yeni bir CAS denemesi yapar; arada tekrar değişiklik olmuşsa tekrar çatışma gösterilir. Otomatik alan birleştirmesi veya sürüm geçmişi yoktur.
- Diğer cihaz silmişse kullanıcı silinmeyi kabul edebilir veya kendi taslağını açıkça yeni not olarak kaydedebilir. Bekleyen yerel silme ile uzak düzenleme çatışırsa silme de kullanıcı kararıyla güncel sürüme uygulanır.
- Aynı tarayıcıdaki açık editörler yerel `localRevision` üzerinden de denetlenir. Eski editör ikinci taslağı saklayan bir çatışma oluşturur; zaten çatışmış kayda üçüncü eski editörün yazması reddedilir, açık editördeki metni korunur. Çatışma metinleri `textContent` ile gösterilir.

## Kaybolan cevap ve çoklu sekme

Gönderilecek istek, HTTP başlamadan önce IndexedDB'ye değişmez bir UUID `operationId`, payload ve `baseVersion` ile yazılır. Cevap kaybolursa aynı zarf yeniden gönderilir. Kullanıcı o sırada düzenler/silerse önce bilinmeyen isteğin sonucu öğrenilir, sonra yeni sürüme bağlı PATCH/DELETE kuyruklanır.

PostgreSQL `annotation_operations` tablosu tenant + kullanıcı + işlem anahtarına bağlı isteğin hash'ini ve cevabını saklar. İşlem kilidi, not değişikliği ve cevap kaydı **aynı DB transaction'ındadır**; cevap kaydı başarısızsa not değişikliği de geri alınır. Aynı anahtar/istek önceki cevabı döndürür, farklı payload `409 idempotency_key_reused` alır. Not silinse bile eski POST tekrarı yeni not oluşturmaz. İki Node süreci ve süreç yeniden başlatması test edildi.

Bu, **aynı işlem anahtarının DB etkisinin tekrarlanmaması** güvencesidir. Ağ üzerinden yalnız bir istek gönderilmesi veya farklı anahtarlarla oluşturulan benzer notların otomatik tekilleştirilmesi taahhüdü değildir. DB'siz demo modunda cevap kayıtları yalnız süreç belleğindedir.

Sekmeler kullanıcı bazlı Web Locks ile eşitlemeyi sıraya alır; Web Locks yoksa da çalışan ortak IndexedDB lease'i kullanılır. Lease 15 saniyeliktir, 4 saniyede yenilenir; sekme kapanınca diğer sekme süre dolunca devralır. Lease kaybında istek iptal edilir; eski geç cevabın yeni kuyruk durumunu ezmesi işlem anahtarı kontrolüyle engellenir. Sunucudaki idempotency/CAS, lease süresi aşımında çakışan göndericileri de korur. BroadcastChannel yalnız değişiklik sinyali taşır; not metni taşımaz.

Çıkış ve başka sekmede hesap değişimi eski kullanıcı notlarını temizler. Gecikmiş `/api/me` cevapları oturum epoch kontrolü sayesinde çıkıştan sonra eski kimliği geri getiremez. Yerel kayıt/kuyruk yalnız tam `ownerId` eşleşmesiyle okunur ve gönderilir.

## API ve eski kayıtlar

Yeni istemci `/api/annotations/v1` kullanır. GET `assetId` ve `ownerId` alır; farklı owner `403` alır. POST gövdesi `operationId`, `ownerId`, `assetId`, `anchor` ve not alanlarını içerir. PATCH/DELETE `/api/annotations/v1/:id` gövdesinde ayrıca pozitif tam sayı `baseVersion` ister. Eksik işlem/sürüm `428`; eski sürüm `409 annotation_conflict` ve `current`; bulunamayan not `404 annotation_not_found` döndürür. Kök `/api/annotations` da v121 sunucusunda aynı önkoşulları uygular; eski istemciler önkoşulsuz yazamaz.

- v120'ye rollback sırasında yeni sürümlü yolun genel `404` cevabı silinmiş not sayılmaz; bilinmeyen istek ve taslak korunur.
- Eski, sahibi bilinen ama işlem protokolü/sürümü bilinmeyen kuyruklar körlemesine gönderilmez. Kullanıcıya çatışma olarak gösterilir. Teslimatı bilinmeyen eski create için önce notlarını kontrol etmesi, sonra açıkça yeni kayıt veya yerel taslağı kaldırma seçmesi gerekir; eski create'in teslimatını geriye dönük kanıtlayamayız.
- Sahipsiz eski kayıtlar gizli ve saklı kalır; otomatik sahiplenilmez.
- İşlem cevapları **TTL/purge olmadan** tutulur: çok eski bir offline isteğin silinen notu yeniden oluşturması engellenir. Kullanıcı/tenant silinince cascade ile temizlenir. Not içeriğini de içeren bu tablo her kaydedilen işlem/çatışma için büyür; gelecekte saklama politikası değişecekse eski anahtarları reddeden bir protokolle birlikte tasarlanmalıdır.

## Kabul kanıtı

Bunlar uygulayan ajanın testleridir; bağımsız reviewer veya üretim kabulü değildir.

| Koşu | Sonuç | Ortam / kanıt |
|---|---|---|
| Çatışma/idempotency | **27/27**, 0 JS hatası, cleanup 5/5 | Ayrı PostgreSQL 16, ayrıcalıksız app rolü, iki Node süreci, gerçek Edge/IndexedDB; [sonuç](reader-evidence/v121-annotation-sync/87e88d84-72ae-4f6f-99a4-5f49d7dc3d9b/results.json) |
| Offline not/gizlilik regresyonu | **20/20**, 0 JS hatası, cleanup 3/3 | Ayrı demo sunucusu ve gerçek Edge; [sonuç](reader-evidence/v121-offline-edit/218c3129-a98f-418b-8c3f-cb55afbdf78f/results.json). PostgreSQL kanıtı değildir. |
| Offline yer imi regresyonu | **17/17**, 0 JS hatası, cleanup 4/4 | Ayrı PostgreSQL ve gerçek Edge; [sonuç](reader-evidence/v121-bookmark-regression/aac8ca8b-b9e3-4e5e-80b4-20e555d98082/results.json) |
| Güvenlik regresyonu | **3 senaryo / 68 kontrol** | Ayrı PostgreSQL, iki Node süreci; [ham çıktı](reader-evidence/v121-annotation-sync/security.txt). Sonradan eklenen UI oturum epoch kontrolünden önce, aynı sunucu/schema/modül üzerinde koşuldu. |
| Birim regresyonu | **62/62** | Citation, search, downloads, maintenance, watermark, EPUB policy; [TAP](reader-evidence/v121-annotation-sync/units.tap.txt) |

27 senaryo; migration 015'in taze şema ve v120 şema kopyasında çift uygulanmasını, 12 paralel POST'u, CAS kazanan/kaybedeni, silme/tekrar POST'un diriltmemesini, gerçek SQL yetki hatasında transaction rollback'ini, süreç restart'ını, tenant/owner izolasyonunu, POST/PATCH/DELETE cevap kayıplarını, Web Locks ve lease fallback'ini, lease devralma/geç ACK'i, gerçek sekme kapanmasını, eski sunucu 404'ünü, eski kuyrukları, iki cihaz PDF/EPUB çatışma seçimlerini, tekrar CAS çatışmasını ve çıkış/hesap değişimi yarışını kapsar.

Cevap kaybı HTTP cevabı gerçek commit sonrasında kesilerek oluşturuldu. Lease kaybı kontrollü heartbeat durdurma/süre aşımıyla, sekme kapanması ise gerçekten sekme kapatılarak test edildi. Bunlar fiziksel disk doluluğu, her tarayıcı, manuel ekran okuyucu veya genel kapasite testi değildir. Ara başarısız koşular düzeltilmiş kaynak kabulü yerine sayılmaz; ham kayıtlar korunur. [Ortak kaynak/artifact manifesti](reader-evidence/v121-annotation-sync/acceptance-manifest.json) final üç koşunun kaynak eşleşmesini ve tarihsel koşuları ayrı kaydeder.

Tekrar çalıştırma; Docker PostgreSQL 16, Microsoft Edge ve `PLAYWRIGHT_MODULE` ile kurulu Playwright gerektirir. Testler kendi konteyner/geçici sunucularını oluşturur; prod/dev DB'ye bağlanmaz:

~~~powershell
node spike/app/test/annotation-sync.integration.mjs
node spike/app/test/offline-edit.browser.mjs
node spike/app/test/offline-bookmarks.browser.mjs
node spike/app/test/security.integration.mjs
node --test spike/app/test/citations.test.mjs spike/app/test/search.test.mjs spike/app/test/downloads.test.mjs spike/app/test/download-maintenance.test.mjs spike/app/test/social-watermark.test.mjs spike/app/test/epub-copy-policy.test.mjs
~~~

## Dağıtım sırası — henüz uygulanmadı

Bağımsız inceleme sonrası taze yedek alın; migration'ı önce yedekten restore edilmiş kopyada DB admin ile doğrulayın. Bu koşuda v120 şemasından oluşturulan izole kopyada veri koruma/çift uygulama testi yapıldı; **taze üretim yedeğinin restore testi değildir**.

~~~powershell
.\scripts\backup.ps1
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T db psql -v ON_ERROR_STOP=1 -U akademik -d akademik -f /migrations/015-annotation-sync.sql
~~~

`akademik` burada DB admin rolüdür; kuruma göre değiştirin. Migration başarıyla bitmeden v121 sunucusunu başlatmayın. `.env.production` içindeki `APP_VERSION=121`, `BUILD_SHA` ve `BUILD_DATE` dağıtılacak commit'e göre ayarlanmalıdır; kaynak compose varsayılanını artırmak mevcut `.env.production` değerini değiştirmez. Ardından build/restart, smoke ve gerçek PDF/EPUB offline edit/yer imi + iki cihaz çatışması + A→B→A kabulü gerekir.

Rollback'te migration 015'i geri almayın; v120, ek sürüm sütunu/trigger/receipt tablosuyla çalışabilir. v120 istemcisi CAS uygulamaz; rollback sırasında bu yeni güvence verilmez. v121 kuyruğu sürümlü endpoint bulunmazsa saklanır; v121'e dönüşte aynı anahtarla devam eder. v120 rollback imajı korunmalıdır.


## Dağıtım güncellemesi — 2026-10-24

Kullanıcı deploy edilebilir olarak koşullu PASS bildirdi; bağımsız reviewer 62/62 birimi tekrarladı, tarayıcı koşturamadı. Taze prod yedeği restore edildi; migration 015 çift uygulandı ve not içeriği özeti korundu. Ardından prod DB admin migration 015 ve sabit 933615a imajıyla v121 web başlatıldı. HTTPS smoke **16/16**, gerçek prod PostgreSQL/Edge offline edit/yer imi, iki bağımsız bağlamda PDF/EPUB CAS çatışması ve A→B→A dahil **14/14**, 0 JS hatası, cleanup 4/4. v120 rollback korunur; 015 geri alınmaz.

Receipt not metninin silme sonrası saklanması ve büyüme politikası çözülmüş sayılmaz: müşteri üretimi öncesi süre/silme/tombstone protokolü kararı gerekir. Yalnız annotation ID tombstone’u eski POST’u tanımaya yetmez; operationId eşlemesi korunmalı veya eski işlemler açıkça reddedilmelidir. Tenant-only receipt RLS kullanıcı policy’si için takip işidir. [Dağıtım ve açık kararlar](deployments/2026-10-24-v121.md).

## v122 hardening

v122 closes these two follow-ups: 90-day full receipts followed by content-free 365-day operation tombstones, user-scoped receipt RLS, and **410 `operation_expired`** for old offline retries (local draft preserved). See [ANNOTATION-RECEIPT-HARDENING.md](ANNOTATION-RECEIPT-HARDENING.md). Migration 016 must run before the v122 server. A v121 rollback can create new operations, but an insert for a tombstoned operation key is rejected by a DB trigger, so it cannot recreate a deleted note; it returns 500 for that case and does not get the 410/user-scoped defense until v122 is restored.
