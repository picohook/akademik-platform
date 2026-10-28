# E-Kütüphane — yapılacaklar

Son güncelleme: 2026-10-28. Canlı: elibrary.libedge.com **v135** (`c88a778`), mode `db`, tenant LibEdge `5799f2a5-…`.
Önce `docs/HANDOFF-2026-10-27.md` ve `docs/DEPLOY.md` okunmalı. Bir madde bitince buradan silinir veya "tamamlandı" altına taşınır.

## Tamamlandı (2026-10-28)

- **v135 canlı ve doğrulandı** (`c88a778`, imaj `libedge-v135`, ID `81327c586a02`): 409 audit satırı artık **kitabı adlandırıyor** (`book_id`/`object_id`, `auditDenied()` opsiyonel `book` alıyor) ve `?v=` etiketi **build'den** türüyor — `curl /` → `/app.js?v=c88a778`. SW cache `v25` → `v26`. **Migration yok.** Rollback: `libedge-v134` + `.env.r2.bak-v134`. Bkz. `docs/deployments/2026-10-28-v135.md`.

- **v134 canlı ve doğrulandı** (`b6aa81a`, imaj `libedge-v134`, ID `00bf4340bca2`): EPUB indirmede 409 artık **nedeniyle** audit'e düşüyor (`delivery_failed` + `error` + `format`), okuyucuya **anlaşılır mesaj** gösteriliyor, **damgalanamayan EPUB yüklemede 422 ile reddediliyor** (`inspectWatermarkable`), `--dry-run` inceleme var. Ayrıştırıcı **değişmedi** — doğru davranıyordu, bozuk olan veri. Tarayıcıda (Altan): anlaşılır mesaj, konsolda yalnız 409, yakalanmamış hata yok. Rollback: `libedge-v133` + `.env.r2.bak-v133`. Bkz. `docs/deployments/2026-10-28-v134.md`.
- Migration yok (001–020); build öncesi `docker rmi libedge-v132` ile disk açıldı (%85).

- **v133 canlı ve doğrulandı** (`5225149`, imaj `libedge-v133`): CSP `style-src`'ye `blob:` (#25) — EPUB yayıncı stili + tema + yazı boyutu artık çalışıyor; `/favicon.ico` 200 (#26) — kök neden hem eksik `<link rel="icon">` hem de `serveStatic` allowlist'i; `mobile-web-app-capable` standart meta; SW cache `v24` → `v25` — çevrimiçi navigasyon network-first olduğu için eski CSP'li kabuk çevrimdışı açılışta kalıyordu. Bkz. `docs/deployments/2026-10-27-v133.md`.
- v131 → v132: fail-closed yetki (#21) — her istek oturumdaki tenant'a bağlı, `grantAllows` boş listede `false`.
- Migration runner (#19): `db/migrate.mjs` + `schema_migrations`; 001–017 baseline, 018/019/020 runner ile uygulandı.
- 020 (#22): LibEdge tenant'ına `all` kapsamlı, süresiz grant (collection grant 12 kitap kapsıyordu; upload'lar koleksiyona eklenmiyor).
- Demo hesaplar silindi (017, #17). README canlı duruma göre yeniden yazıldı (#18).
- Yedek: `backups/pre-v132-20261027-1540.dump`. **Güncel geri dönüş: `libedge-v134` + `.env.r2.bak-v134`** (`libedge-v133` v135 build'inden önce silindi).
- 26 Ekim kesintisinin kök nedeni: `LIBEDGE_IMAGE=... sudo docker compose` — sudo değişkeni siliyordu. Image adı artık `.env.r2` içinde `LIBEDGE_IMAGE`.

## 1. Hemen — dokümanlar

- ~~PROJECT-STATE, HANDOFF, DEPLOY güncellemesi; `docs/deployments/2026-10-27-v132.md`.~~ — v134 için yapıldı: `docs/deployments/2026-10-28-v134.md`, `PROJECT-STATE.md` (2026-10-28), bu dosya.
- DEPLOY.md kuralları: image adı `.env.r2` `LIBEDGE_IMAGE` ile; sunucuda bir önceki sürüm dışında image tutulmaz (8 GB disk). **v134'te uygulandı:** `docker rmi libedge-v132`, rollback `libedge-v133`.

## 2. v133 — kapatıldı (canlı ve doğrulandı)

- ~~**CSP:** `style-src`'ye `blob:`~~ — **v133'te yapıldı ve canlıda doğrulandı** (`spike/app/security-headers.mjs`), bkz. `docs/deployments/2026-10-27-v133.md`.
- ~~`favicon.ico` (404) ve `<meta name="mobile-web-app-capable" content="yes">`~~ — **v133'te yapıldı ve canlıda doğrulandı**: `/favicon.ico` → 200; `public/favicon.ico` (`scripts/build-favicon.mjs` ile üretilir) + `server.mjs` allowlist/MIME, `index.html`'de `rel="icon"` ve standart meta.
- ~~SW cache `v24` → `v25`~~ — **v133'te yapıldı**: yeni CSP'nin çevrimdışı açılışa ulaşması için cache adı artırıldı. Çevrimdışı açılış **test edildi**, SW `v25` tarafı sorun değil (aşağıdaki kalem).
- **Çevrimdışı doğrulama yapıldı (Altan, 2026-10-27) — SW `v25` OK, ama yeni hata bulundu:** çevrimdışı **EPUB indirme 409** dönüyor; **PDF çevrimdışı indirme çalışıyor** (Discrete Mathematics, 20:19 başarılı). Yani service worker/cache tarafı beklendiği gibi; sorun indirme (delivery) yolunda.

## 2b. v134 — kapatıldı (canlı ve doğrulandı); EPUB onarımı açık

**Belirti:** çevrimdışıyken EPUB indirme isteği `409` alıyor. Kullanıcıya hata **gösterilmiyor**, yalnız konsolda.

**Kök neden (ölçüldü):** `watermarkEpub` → `bodyOpeningEnd` → **“mismatched XML closing tag”**. Ayrıştırıcı **doğru davranıyor (fail-closed)**; bozuk olan EPUB'un kendisi — **well-formed değil**.

| Alan | Değer |
| --- | --- |
| Kitap | Scientific Writing for Health Research |
| Asset | `4773fe55-…` |
| R2 | `r2://libedge/uploads/7ef29929-dbbd-415d-a008-c18f99362c98.epub` |
| Bozuk dosya | `EPUB/text/ch003.xhtml` |
| Bozuk yer | `<li>Hypothesis and aims` / `<p></li>` — kapanmayan `<p>` (Pandoc çıktısı) |

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

- [x] **İçerik düzeltmesi (kod değil, ayrı iş) — yapıldı:** tüm XHTML'ler tarandı, `<p></li>` kalıbı düzeltildi, `mimetype` ilk ve **STORE** olacak şekilde yeniden paketlendi, watermark doğrulaması **OK** verdi, R2'ye **yeni key** (`…-r1.epub`) yüklendi ve `assets.storage_key` + `assets.source_checksum` tek `UPDATE` ile güncellendi. **Kayıt ve kalan değerler: `docs/runbooks/epub-repair-2026-10-27.md` §11.** Eski nesne (§10'a kadar) geri dönüş için R2'de duruyor.
- [ ] **Katalog taraması:** katalogdaki **tüm EPUB'ları** aynı dry-run ile tara ve listele (kaç tanesi indirilemez durumda). Komut: runbook §9.

## 3. İlk kurum / dış kullanıcıdan önce (zorunlu)

- `download-tickets` ve `/opds` hâlâ env tenant'ıyla kurulu → oturum tenant'ı (bugün reddeder, sızdırmaz).
- Zamanlayıcı işleri (download ticket süpürme, annotation retention) tek tenant varsayıyor → tüm tenant'lar üzerinde dönmeli.
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
- Host nginx'in diğer vhost'lar için durumu gözden geçirilmeli.

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
