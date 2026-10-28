# E-Kütüphane — yapılacaklar

Son güncelleme: 2026-10-28. Canlı: elibrary.libedge.com **v136** (`96cc270`), mode `db`, tenant LibEdge `5799f2a5-…`. Trafik: **cloudflared tunnel → `127.0.0.1:3001`**, nginx kapalı.
Önce `docs/HANDOFF-2026-10-27.md` ve `docs/DEPLOY.md` okunmalı. Bir madde bitince buradan silinir veya "tamamlandı" altına taşınır.

## Tamamlandı (2026-10-28)

- **v136 canlı ve doğrulandı** (`96cc270`, imaj `libedge-v136`, LABEL `96cc270`/`136`, 16:27 TRT): EPUB'taki **dış iframe'ler yeni sekme bağlantı kartına** çevriliyor — YouTube gömmeleri artık "This content is blocked" değil, `target="_blank"` + `rel="noopener noreferrer"` kart. Gizli (page-break) embed'lere dokunulmuyor, adressiz/göreli olanlar kaldırılıyor. **CSP değişmedi.** SW cache `v26` → `v27`. Test **143/143**, negatif kontrol 6/8 düşüyor. `curl /` → `/app.js?v=96cc270`, R2 PASS, migration yok. Rollback: `libedge-v135` + `.env.r2.bak-v135`. Tarayıcıda (Altan) doğrulandı. Bkz. `docs/deployments/2026-10-28-v136.md`.
- **Altyapı — trafik yolu düzeltildi ve ölçüldü (aynı gün):** ön yüz **cloudflared** (Zero Trust tüneli `libedge-elibrary`, Healthy) → `127.0.0.1:3001`. Host nginx `proxy_pass http://localhost:3000` yapıyordu ama **`:3000`'de servis yoktu**; dışarıdan `http://54.87.37.7/api/health` **502** dönüyordu, PM2 boştu. `sudo systemctl disable --now nginx`; AWS güvenlik grubunda **80/443 gelen kaldırıldı** (SSH 22 kaldı). Doğrulandı: `https://elibrary.libedge.com/api/health` **ok**, doğrudan IP erişimi **kapalı**. `libedge-egress-staging` / `libedge-ra-egress` **ayrı makinelerde**, ilgisiz. README/DEPLOY/HANDOFF anlatımı düzeltildi, `docs/deployments/2026-10-28-v136.md` §5.

- **v135 canlı ve doğrulandı** (`c88a778`, imaj `libedge-v135`, ID `81327c586a02`): 409 audit satırı artık **kitabı adlandırıyor** (`book_id`/`object_id`, `auditDenied()` opsiyonel `book` alıyor) ve `?v=` etiketi **build'den** türüyor — `curl /` → `/app.js?v=c88a778`. SW cache `v25` → `v26`. **Migration yok.** Rollback: `libedge-v134` + `.env.r2.bak-v134`. Bkz. `docs/deployments/2026-10-28-v135.md`.

- **v134 canlı ve doğrulandı** (`b6aa81a`, imaj `libedge-v134`, ID `00bf4340bca2`): EPUB indirmede 409 artık **nedeniyle** audit'e düşüyor (`delivery_failed` + `error` + `format`), okuyucuya **anlaşılır mesaj** gösteriliyor, **damgalanamayan EPUB yüklemede 422 ile reddediliyor** (`inspectWatermarkable`), `--dry-run` inceleme var. Ayrıştırıcı **değişmedi** — doğru davranıyordu, bozuk olan veri. Tarayıcıda (Altan): anlaşılır mesaj, konsolda yalnız 409, yakalanmamış hata yok. Rollback: `libedge-v133` + `.env.r2.bak-v133`. Bkz. `docs/deployments/2026-10-28-v134.md`.
- Migration yok (001–020); build öncesi `docker rmi libedge-v132` ile disk açıldı (%85).

- **v133 canlı ve doğrulandı** (`5225149`, imaj `libedge-v133`): CSP `style-src`'ye `blob:` (#25) — EPUB yayıncı stili + tema + yazı boyutu artık çalışıyor; `/favicon.ico` 200 (#26) — kök neden hem eksik `<link rel="icon">` hem de `serveStatic` allowlist'i; `mobile-web-app-capable` standart meta; SW cache `v24` → `v25` — çevrimiçi navigasyon network-first olduğu için eski CSP'li kabuk çevrimdışı açılışta kalıyordu. Bkz. `docs/deployments/2026-10-27-v133.md`.
- v131 → v132: fail-closed yetki (#21) — her istek oturumdaki tenant'a bağlı, `grantAllows` boş listede `false`.
- Migration runner (#19): `db/migrate.mjs` + `schema_migrations`; 001–017 baseline, 018/019/020 runner ile uygulandı.
- 020 (#22): LibEdge tenant'ına `all` kapsamlı, süresiz grant (collection grant 12 kitap kapsıyordu; upload'lar koleksiyona eklenmiyor).
- Demo hesaplar silindi (017, #17). README canlı duruma göre yeniden yazıldı (#18).
- Yedek: `backups/pre-v132-20261027-1540.dump`. **Güncel geri dönüş: `libedge-v135` + `.env.r2.bak-v135`** (v136 canlı; `libedge-v134` v136 build'inden önce silindi).
- 26 Ekim kesintisinin kök nedeni: `LIBEDGE_IMAGE=... sudo docker compose` — sudo değişkeni siliyordu. Image adı artık `.env.r2` içinde `LIBEDGE_IMAGE`.

## 1. Hemen — dokümanlar

- ~~PROJECT-STATE, HANDOFF, DEPLOY güncellemesi; `docs/deployments/2026-10-27-v132.md`.~~ — v134 için yapıldı: `docs/deployments/2026-10-28-v134.md`, `PROJECT-STATE.md` (2026-10-28), bu dosya.
- DEPLOY.md kuralları: image adı `.env.r2` `LIBEDGE_IMAGE` ile; sunucuda bir önceki sürüm dışında image tutulmaz (8 GB disk). **v134'te uygulandı:** `docker rmi libedge-v132`, rollback `libedge-v133`.

## 2. v133 — kapatıldı (canlı ve doğrulandı)

- ~~**CSP:** `style-src`'ye `blob:`~~ — **v133'te yapıldı ve canlıda doğrulandı** (`spike/app/security-headers.mjs`), bkz. `docs/deployments/2026-10-27-v133.md`.
- ~~`favicon.ico` (404) ve `<meta name="mobile-web-app-capable" content="yes">`~~ — **v133'te yapıldı ve canlıda doğrulandı**: `/favicon.ico` → 200; `public/favicon.ico` (`scripts/build-favicon.mjs` ile üretilir) + `server.mjs` allowlist/MIME, `index.html`'de `rel="icon"` ve standart meta.
- ~~SW cache `v24` → `v25`~~ — **v133'te yapıldı**: yeni CSP'nin çevrimdışı açılışa ulaşması için cache adı artırıldı. Çevrimdışı açılış **test edildi**, SW `v25` tarafı sorun değil (aşağıdaki kalem).
- **Çevrimdışı doğrulama yapıldı (Altan, 2026-10-27) — SW `v25` OK, ama yeni hata bulundu:** çevrimdışı **EPUB indirme 409** dönüyor; **PDF çevrimdışı indirme çalışıyor** (Discrete Mathematics, 20:19 başarılı). Yani service worker/cache tarafı beklendiği gibi; sorun indirme (delivery) yolunda.

## 2b. v134 — kapatıldı (canlı ve doğrulandı); EPUB onarımı ve katalog taraması kapatıldı

**Belirti:** çevrimdışıyken EPUB indirme isteği `409` alıyor. Kullanıcıya hata **gösterilmiyor**, yalnız konsolda.

**Kök neden (ölçüldü):** `watermarkEpub` → `bodyOpeningEnd` → **“mismatched XML closing tag”**. Ayrıştırıcı **doğru davranıyor (fail-closed)**; bozuk olan EPUB'un kendisi — **well-formed değil**.

| Alan | Değer |
| --- | --- |
| Kitap | Scientific Writing for Health Research |
| Asset | `4773fe55-…` |
| R2 | `r2://libedge/uploads/7ef29929-dbbd-415d-a008-c18f99362c98.epub` |
| Bozuk dosya | `EPUB/text/ch003.xhtml` (ilk görünen) — **tarama 8/20 bozuk buldu** |
| Bozuk yer | `ch003`: `<li>Hypothesis and aims` / `<p></li>` — kapanmayan `<p>` (Pandoc). Ayrıca `ch004`–`ch008`,`ch013` değersiz `allowfullscreen`, `ch009` kapanmamış `<br>` |

Dosya **çevrimiçi** okunabiliyor (okuyucu XHTML'i olduğu gibi ayrıştırmıyor), yalnız **indirme** yolundan geçen watermark aşamasında patlıyor. Bu yüzden hata v133 deploy'unda görünmedi.

- [x] **v134 kod PR'ı** — PR #29, `main`'e merge edildi, **canlıya alındı ve doğrulandı** (`b6aa81a`, imaj `libedge-v134`). Bkz. `docs/deployments/2026-10-28-v134.md`.
  - (a) **Yapıldı ve canlıda** — `server.mjs`: `delivery_failed` ve `invalid_storage_key` artık yutmuyor; ikisi de `console.warn` + audit payload (`reason` + `format` + `error`). `auditDenied`'e opsiyonel `details` eklendi. `deliveryErrorDetail` mesajı temizler (UUID → `<id>`, e-posta → `<email>`, ASCII dışı, 200 karakter) — audit'i tenant admin okuyor, filigran satırları kimlik taşıyor. **Canlı kanıt:** `{"error":"Invalid EPUB package: mismatched XML closing tag","format":"epub","reason":"delivery_failed"}`.
  - (b) **Yapıldı ve canlıda** — `public/app.js`: 409 alan **üç** yol da mesaj gösteriyor (çevrimdışı kaydet, ana indir butonu, upload). Çevrimdışı: “Bu kitap şu an çevrimdışı indirilemiyor; kütüphaneye bildirildi”. Altan doğruladı: ekranda anlaşılır mesaj, yakalanmamış hata yok.
  - (c) **Yapıldı ve canlıda** — `inspectWatermarkable(buffer, format)` (`social-watermark.mjs`): gerçek parse/validate yolu, kimliksiz, hiçbir şey yazmıyor. `/api/upload` EPUB için çalıştırıyor; filigran eklenemeyecek dosya **422** + bozuk girdi adıyla reddediliyor. `watermarkEpub` `{ inspectOnly }` aldı, böylece dry-run ve gerçek damga **aynı** aday listesini kullanıyor. Hata→status eşlemesi artık `error.statusCode`'a uyuyor.
  - **Testler:** `social-watermark` 17/17 (3 yeni dry-run senaryosu), `test/*.test.mjs` 126/126, `test:security-headers` 3/3, `test:tenant-access` 4 senaryo/12 kontrol, `test:social-drm` PASS (295 kontrol). **Negatif kontrol:** düzeltme stash'lenince süit `does not provide an export named 'inspectWatermarkable'` ile düşüyor.
  - **Not:** ayrıştırıcı **değiştirilmedi** — doğru davranıyor, bozuk olan veri. Bu PR hatayı görünür kılar ve yenilerini engeller.
- [x] **Download deny audit'inde `book_id` null — v135'te yapıldı ve canlıda:** `auditDenied()` artık opsiyonel `book` alıyor (`download-tickets.mjs`), `server.mjs`'te 409 üreten iki çağrı (`invalid_storage_key`, `delivery_failed`) `book`'u geçiriyor. `csrf_invalid`/`post_required` gibi kitap henüz çözülmeden düşen yollar `null` geçmeye devam ediyor — orada `null` doğru değer, uydurulmuyor. Test: `test/download-audit.test.mjs` (fix geri alınınca düşer).
- [x] **`app.js?v=130-ui-copy` sürüm etiketi sabit — v135'te yapıldı ve canlıda:** `asset-version.mjs` token'ı `BUILD_SHA`'dan (yoksa `APP_VERSION`, o da yoksa token yok) türetiyor; `server.mjs` `index.html`'i servis ederken `?v=` etiketlerini bu token'la değiştiriyor ve `content-length`'i yeniden hesaplıyor. **Canlı kanıt:** `curl -s localhost:3001/ | grep -o '/app.js?v=[^"]*'` → `/app.js?v=c88a778`. `index.html`'deki `?v=0-dev` yalnızca yer tutucu; elle güncellenmiyor. `sw.js` cache'i `v25` → `v26` (gövde değişti, v133 kuralı).
- [ ] `import-catalog` dry-run kapsamı: bu yolda içerik ingest'i ayrı bir akıştan geçiyor; upload'daki kabul/ret kuralının oraya da uygulanıp uygulanmayacağına karar ver (şimdilik yalnız `/api/upload` kapalı devre).

- [x] **İçerik düzeltmesi (kod değil, ayrı iş) — yapıldı:** `xmllint` taraması **20 XML/XHTML dosyası, 8'i bozuk** buldu (`ch003` `<p></li>`; `ch004`–`ch008`,`ch013` değersiz `allowfullscreen`; `ch009` kapanmamış `<br>`). Hepsi düzeltildi (18 satır), ikinci tarama temiz. `mimetype` ilk ve **STORE** olacak şekilde yeniden paketlendi, watermark doğrulaması **OK** verdi, R2'ye **yeni key** (`…-r1.epub`, 93340 bayt, geri okuma `eşit: true`) yüklendi ve `assets.storage_key` + `assets.source_checksum` tek `UPDATE` ile güncellendi. `annotations`: **0 satır** (CFI etkisi yok). **Değerler ve kayıt: `docs/runbooks/epub-repair-2026-10-27.md` §11.** Eski nesne (92948 bayt) §10'a kadar geri dönüş için R2'de duruyor.
- [x] **Katalog taraması — yapıldı ve kapandı:** katalogda **1 EPUB** var, o da onarılan kitap. **Başka indirilemez EPUB yok.** Katalog büyüdüğünde runbook §9 tekrar çalıştırılır (v134 `inspectWatermarkable` kapısından önce yüklenmiş kayıtları yakalamak için).

## 3. İlk kurum / dış kullanıcıdan önce (zorunlu)

- **Zamanlayıcı işleri (download ticket süpürme, annotation retention) tek tenant varsayıyor → tüm tenant'lar üzerinde dönmeli.**
  - [x] **Kod tarafı yapıldı, migration bekliyor.** `download-tickets` servisi artık `tenantId`'yi **istekten** okuyor (`requestTenant()`); sabit `TENANT_ID` kalktı. İki zamanlayıcı `maintenanceTenantIds()` üzerinden döngü yapıyor, her tenant kendi `runWithTenant()` + transaction'ında; bir tenant'ın hatası diğerlerini durdurmuyor ve tenant kimliğiyle loglanıyor. `maintenance(tenant)` tenant'sız çağrılırsa **hata atıyor**, sessizce bir tenant seçmiyor.
  - [x] **`select id from tenants` YETMİYOR** — `tenants_self` politikası (`using (id = current_setting('app.tenant_id')::uuid)`) yüzünden app rolü **tek satır** görüyor; döngü sadece env tenant'ı dönerdi ve "düzeltilmiş" görünürdü. Bu yüzden liste `app.maintenance_tenants()` **SECURITY DEFINER** fonksiyonundan (yalnız id döndürür) okunuyor. Fonksiyon **migration 024**'te (`db/migrations/024-maintenance-tenants.sql`), 023'ten **bağımsız** — 023 sözleşme §4.4 listesine bağlı, 024 değil. Ölçüm: `db/024.test.mjs`, **17 kontrol**, 3 tenant'lı fixture'da app rolü **hiçbir tenant bağlı değilken** 3'ünü de görüyor (kıyas: düz sorgu 0 satır; bir tenant bağlıyken 1 satır — ve o bağlı olan).
  - [x] **Yan bulgu, düzeltildi: fallback hiç devreye girmiyordu.** 024 uygulanmamışken `select * from app.maintenance_tenants()` **`42883` değil `3F000`** (`invalid_schema_name`) dönüyor — `app` şeması henüz yok, Postgres şemayı fonksiyondan önce çözer. `server.mjs` yalnız `42883`/`42501` yakalıyordu, yani ziyaretçi sayfalarında **her timer tick'i throw ediyordu** (süit çıktısında `[maintenance] app.maintenance_tenants unavailable (42883)` değil, sessiz stack). Fallback artık `3F000|42P01|42883|42501`. Test bunu iki yönlü ölçüyor: 024 öncesi kod gerçekten `3F000` veriyor, ve `server.mjs` üç kodu da yakalıyor.
  - [ ] **Migration 024 henüz prod'a uygulanmadı.** v137 runbook'u (`docs/runbooks/v137-deploy.md` §4) yalnız 021/022'yi sayıyor; o adım `--status` çıktısında 024'ü de `pending` görecek ve `--dry-run`'ın "yalnız 021 ve 022 listelenir" beklentisi tutmayacak. Ya 024 ayrı bir deploy'da uygulanır (önerilen: runbook zaten Claude incelemesinde, 024'ün eklenmesi onu değiştirir) ya da o beklenti `021/022/024` olarak güncellenir. **024 uygulanana kadar prod davranışı eskisi gibi**: tek tenant süpürülür ve her tick bir uyarı loglar.
- `/opds` hâlâ env tenant'ıyla kurulu → oturum tenant'ı (bugün reddeder, sızdırmaz). *Not: API-key yolu `OPDS_API_KEY` + `OPDS_USER_EMAIL` + `OPDS_TENANT_ID` üçünü birlikte ister (`opdsTokenAuth`); yalnız `OPDS_TENANT_ID` tanımlamak kimlik doğrulamayı açmıyor.*
- Upload edilen kitaplar koleksiyona eklenmiyor → collection grant'li kurumlarda yeni kitapların nereye düşeceği kararı.

## 4. SSO — LibEdge ile tek giriş

- **Kaynak branch:** `origin/feat/elibrary-admin` (`17ef5eb`) — LibEdge library admin bridge ve asset erişim zorlaması; SSO aşamasında başlangıç noktası. Branch **remote'ta korunuyor**, yerel kopyası silindi.
- `/auth/libedge`: libedge.com'dan kısa ömürlü (~60 sn), tek kullanımlık, Ed25519 imzalı token ile handoff; `.libedge.com` ortak cookie değil.
- Kimlik LibEdge kullanıcı id'sine dayanmalı (018 aynı e-posta iki tenant'ta varsa en eskisini seçiyor).
- LibEdge kurumu → tenant, abonelikler → grant eşlemesi. Ön koşul: madde 3.

## 5. Operasyon

- Disk: 8 GB gp3 %95'e çıktı → EBS 20 GB (~1 $/ay).
- Otomatik yedek: günlük `pg_dump` cron + sunucu dışı kopya (ör. R2).
- İzleme: `/api/health` için dış uptime alarmı.
- ~~Host nginx'in diğer vhost'lar için durumu gözden geçirilmeli.~~ **Kapandı (2026-10-28):** nginx hiç kullanılmıyordu (olmayan `:3000`'e proxy), `disable --now` edildi; güvenlik grubunda 80/443 kaldırıldı. Trafik cloudflared → `127.0.0.1:3001`. `docs/deployments/2026-10-28-v136.md` §5.

## 6. Takvime bağlı

- Collection grant `77777777-…` 2027-01-23'te sona eriyor (`all` grant `20202020-…` süresiz).
- t3.micro free tier ~2027-10-24 bitiyor.

## 7. Düşük öncelik

- Boş "Demo Üniversitesi" tenant'ı ve "Demo PDF" kitabı silinsin mi — karar.
- Tarayıcı testleri (annotation, offline) main'de giriş adımında düşüyor.

## 8. Okuyucu AI özellikleri

Kural: `docs/LIBEDGE-READER-AI-PLAN.md` — yalnızca Workers AI ücretsiz kotası, ücretli yedek yok. AI cevapları yetkiye dayandığı için madde 3'ten sonra.

- **Sesli okuma (TR/EN):** Cloudflare'de ücretsiz Türkçe TTS yok (MeloTTS'te Türkçe yok; Eleven Multilingual v2 ücretli, ~60 $/300 sayfa). Adım 1: tarayıcı Web Speech API (sunucu maliyeti sıfır; Edge'de Türkçe doğal sesler), cümle vurgulama + kaldığı yerden devam; EPUB metni hazır, PDF için `asset_pages`. Adım 2 gerekirse: cihazda Piper / sherpa-onnx (WASM, Türkçe sesli).
- **Soru-cevap (kaynaklı):** ilk pilotta parça bulma için mevcut PostgreSQL tam metin araması (TR/EN stem) → Vectorize maliyeti yok; cevaplar doğrulanmış sayfa/bölüm bağlantısı gösterir; model Türkçe kalite ölçümüyle seçilir.
- **Özet:** kitap başına bir kez hazırlanır, incelenir, yayımlanır, saklanır; istek başına üretilmez.
