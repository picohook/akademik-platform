# Project state — 2026-10-28

Bu dosya yeni bir oturumda bağlam taşımak için kısa hafızadır. Uzun konuşma geçmişini tekrar okumayın.

## Sürümler
- **v135 canlı ve doğrulandı (2026-10-28 ~11:31 TRT):** Prod: **v135**, kaynak **c88a778** (`main`, PR #32), buildDate **2026-10-28**. Kanıt: `/api/config` → `135`/`c88a778`/`2026-10-28`; `/api/health` → `ok`, `db`, `5799f2a5-…`; R2 **PASS**; `curl / | grep -o '/app.js?v=[^\"]*'` → **`/app.js?v=c88a778`**. İmaj `libedge-v135` (ID `81327c586a02`, LABEL `c88a778`/`135`), `.env.r2`: `LIBEDGE_IMAGE=libedge-v135`, `APP_VERSION=135`, `BUILD_SHA=c88a778`, `BUILD_DATE=2026-10-28`. Build öncesi `docker rmi libedge-v133` (disk 5.6G/6.7G, 1023M boş, %85). **Migration yok** (001–020). Rollback: **`libedge-v134`** + **`.env.r2.bak-v134`**. `docs/deployments/2026-10-28-v135.md`.
- **v135 ne yaptı:** (1) 409 audit satırı **kitabı adlandırıyor** — `auditDenied()` opsiyonel `book` alıyor, `invalid_storage_key`/`delivery_failed` geçiriyor; kitap çözülmeden düşen yollar `null` kalıyor. (2) `?v=` etiketi `BUILD_SHA`'dan türetiliyor (`asset-version.mjs` + `server.mjs` enjeksiyonu, `content-length` yeniden hesaplanıyor), SW cache `v25`→`v26`.
- **EPUB onarımı yapıldı:** *Scientific Writing for Health Research* asset `4773fe55-2f2d-51d5-b7cb-740d477e75fa`; R2 key `…/7ef29929-…-r1.epub`, DB `storage_key` tek `UPDATE` ile `-r1`'e alındı, `source_checksum` yenilendi; watermark doğrulaması **OK**. Eski nesne geri dönüş için duruyor. Kayıt: `docs/runbooks/epub-repair-2026-10-27.md` §11. **Katalog taraması hâlâ açık** (runbook §9).
- **Canlı sürüm doğrulaması (2026-10-28 01:43 TRT):** Prod: **v134**, kaynak **b6aa81a** (`main`), buildDate **2026-10-27** (sunucu UTC). Kanıt `GET https://elibrary.libedge.com/api/config`: `134` / `b6aa81a` / `2026-10-27`; `/api/health` → `ok:true, mode:db`, tenant `5799f2a5-…`; R2 **PASS**. İmaj `libedge-v134` (ID `00bf4340bca2`, LABEL `b6aa81a`/`134`), adı **`.env.r2` içindeki `LIBEDGE_IMAGE=libedge-v134`** ile veriliyor. Build öncesi `docker rmi libedge-v132` (disk %85, 1023 MB boş). **DB migration yok** (001–020). Rollback: **`libedge-v133`** + **`.env.r2.bak-v133`**. docs/deployments/2026-10-28-v134.md, docs/DEPLOY.md.
- **v134 ne yaptı:** EPUB indirmede **409 artık nedeniyle birlikte** kaydediliyor (`delivery_failed` / `invalid_storage_key` audit'e `error`+`format` ile), okuyucuya **anlaşılır mesaj** gösteriliyor, **bozuk EPUB yüklemede reddediliyor** (`inspectWatermarkable`), `--dry-run` inceleme mümkün. Ayrıştırıcı **değişmedi** — doğru davranıyordu, bozuk olan veri. Tarayıcıda (Altan) doğrulandı: anlaşılır mesaj, konsolda yalnız 409, yakalanmamış hata yok.
- **v133 (2026-10-27):** CSP `style-src`'ye `blob:` (EPUB yayıncı stili + tema + yazı boyutu), `/favicon.ico` 200, `mobile-web-app-capable`, SW cache `v24`→`v25`. docs/deployments/2026-10-27-v133.md.
- **Migration runner (2026-10-27):** `db/migrate.mjs` + `schema_migrations` (filename, checksum, applied_at, duration_ms). Her dosya kendi registry satırıyla aynı transaction'da. `--status`, `--dry-run`, `--baseline`. Sunucuda node yok; runner throwaway `node:22-alpine` container'ında, repo `:ro` mount + anonim `node_modules` volume ile çalışır (`db/README.md`).
- **Erişim fail-closed (2026-10-27):** `grantAllows` boş grant listesinde artık `false`; `withTenant` env yerine request'in tenant'ını (`AsyncLocalStorage`, `spike/app/tenant-context.mjs`) kullanıyor; bağlam yoksa **patlar**. `019` bozuk seed grant'ı düzeltti, `020` LibEdge tenant'ına **all** kapsamlı grant ekledi.
- **Grant'ler (canlı):** `77777777-…` collection kapsamlı, **`valid_to = 2027-01-23`** — o tarihte koleksiyon grant'i düşer. `20202020-…` all kapsamlı, **süresiz** (`valid_to = null`). Koleksiyon grant'i süresi dolduğunda erişim all grant'ı üzerinden devam eder; yeni upload'lar hiçbir koleksiyona eklenmediği için collection kapsamı tek başına yetmez.
- **Image disiplini (2026-10-27):** Deploy öncesi `docker rmi` ile eski imajlar temizlendi (disk %95 doluydu). **Kural: çalışan imaj dışında bir şey saklama** — `prune -a` çalışan imajı zaten korur, artık imajları siler.
- **Deploy prosedürü artık yazılı (2026-10-26):** docs/DEPLOY.md — iki varyant (`docker-compose.prod.yml` ve `+ docker-compose.libedge.yml`), `--env-file` zorunluluğu, `.env.production`/`.env.r2` sunucuda (git dışında), sürüm doğrulama `curl /api/config`.
- **Build metadata (2026-10-26):** `APP_VERSION` varsayılanı **`0-dev`** (eski: `130`) — env unutulursa sahte sürüm göstermez. `spike/app/Dockerfile` artık `ARG BUILD_SHA/APP_VERSION/BUILD_DATE` + `org.opencontainers.image.*` LABEL taşır (yalnız `docker inspect` görünürlüğü; runtime env'i compose `environment` veriyor).
- **`/api/config` kimlik doğrulamasız kalacak** (karar 2026-10-26): build metadata düşük hassasiyetli, `/api/health` zaten `mode`/`tenantId` veriyor. Yeniden değerlendirme koşulu docs/DEPLOY.md "Bilinen sınırlar"da.

- **Güncel ACR takibi (2026-10-25):** kontrollü Türkçe insan dinlemesi **HL-TR-01 PASS**, kullanıcı beklemeli gerçek NVDA okuması ardından “dinledim, iyiydi” dedi. Mac erişimi **yok**, VoiceOver NOT RUN. Canlı görünür 2 PDF/18 gerçek sayfa tam kaynak taraması ve 2/2 hash eşleşmesi: makalede 20 Figure alternatif inceleme bayrağı, 4 tabloda 0 TH, gövde başlık rolleri eksik; yayıncı/içerik düzeltmesi açık. Demo metadata düzeltildi: **“Demo PDF — Dummy PDF file” / EN / 1 sayfa**, sahte ISBN/lisans kaldırıldı, arama indeksi ve MARC güncellendi, dosya hash’i değişmedi; audit **133**, commitler `c639285`, `199e8dd`, yedek `backups/demo-metadata-20251025-170615.dump`. Kod/yayınlar/env/migration/deploy değiştirilmedi; prod v127 yeniden başlatılmadı. docs/a11y-evidence/v127-catalog-2026-10-25/REVIEW.md, DEMO-METADATA-FOLLOWUP.md ve docs/a11y-evidence/v127-human-listening-2026-10-25/ACCEPTANCE.md.

- Web kaynak ve prod: **v127/fbeed6e**, CSS **v49**, SW **v19**; app-only deploy tamam. Yerel hedefli26/26, araç10/10, regresyon74/74, birim65/65, 34 axe/0 ihlal, JS0. Canlı Türkçe OCR/NVDA kabulü **PASS: 7/7, JS0**; 3 paragraf/13 OCR kelimesi ve `tr` dili. Test kitabı/yan dosyası/boş UUID klasörü kaldırıldı. docs/a11y-evidence/v127-production-nvda-2026-10-25/ACCEPTANCE.md.
- DB migration kaynak ve prod **001–016**. Taze restore kopyasında 016 çift uygulandı; annotation/receipt fingerprint’leri korundu. DB admin 016 → v122 web sırası tamam. 016 rollback’te korunur; v123–v127 migration değiştirmedi.
- Prod: **v127** (2026-10-25 15:38:04 Europe/Istanbul), kaynak **fbeed6e**, imaj `sha256:62897b6f929251f8d95acdf731ae4558c7e3dd8afb8a76ab01d25cee4036c235`, etiket akademik-platform-prod-web:v127-fbeed6e; healthy/0, smoke **16/16**, config **127/fbeed6e**. v126 rollback (`v126-90c7b72`) korunur. Canlı OCR/NVDA kabulü PASS 7/7; ACR açık. docs/deployments/2026-10-25-v127.md.
- Son doğrulama v122/4300f1f: istenen birebir app-role retest **11/11**, 0 JS hatası, cleanup **6/6**. İki 91 günlük receipt aynı turda **2 moved / 2 deleted / 2 tombstone**; batch **1000+5**; iki ayrı Node sürecinde kazanan **2/2** ve 2 tombstone, diğeri skipped/0 silme. Gerçek v121 HTTP **500/P0001** ile not sayısı sabit; v122 **410**, Edge taslak/reload geçti. Önceki aynı kod **65/65** birim kanıtı korunur; yeniden koşulmadı. Bu izole retest sırasında prod değiştirilmedi; ardından GO ile v122/001–016 deploy tamamlandı. docs/reader-evidence/v122-retention-exact/requested-checks.json.
- **Receipt hardening v122 ürün sahibi tarafından kapatıldı.** Bilinçli sınırlar: tombstone purge’den 365 gün sonra çok eski POST yeniden kabul edilebilir; v121 rollback 500/P0001 ve kullanıcı RLS/410 yok; 016 geri alınmaz. Haftalık retention logu ve annotation_operations boyutu kontrolü operasyonel takip; süre müşteri sözleşmesinde açık yazılmalı.
- Bağımlılık: `npm audit --omit=dev` **0**; tam audit’te yalnız dev-only `epubjs/@xmldom` (2 uyarı).
- EPUB kararı: **ADR-012** — MVP/V1a için epub.js, `EpubEngine` adapter arkasında, pinli; Readium/R2D2BC geçiş eşikleri yazılı.

## Çalışanlar

- PDF okuyucu: tek/çift sayfa/sürekli kaydırma, küçük resimler, TOC, arama, vurgu/not/etiket/tarih, yer imi, atıf, dışa aktarma, temalar.
- Yükleme/silme: PDF + EPUB upload; `source_system` **upload** veya **ingest** olan kitaplar librarian/admin/publisher tarafından silinebilir; seed korunur. DB cascade + dosya silme.
- EPUB: `.epub` upload/format; ana okuyucuda `EpubEngine` (TOC, tema, ± font/zoom, ‹ ›, CFI/ilerleme, seçimden CFI vurgu/not, bölüm arama). EPUB bölüm metni `asset_pages` (`source='epub'`, `locator=href`) olarak indeksleniyor; v72 sonrası XHTML `<body>` dışındaki `<title>` metni indekse girmiyor. Arama DB indeksinden; sonuçta geçerli bölümde eşleşmeler işaretleniyor. EPUB indirme açık; `watermark=false` değilse XHTML sayfalarına kullanıcı/e-posta/tarih filigranı ekleniyor; `allow_download` uygulanıyor. v110–v113: EPUB yer imi (benzersiz CFI + seçili yer imi kimliği + görünür CFI aralığı, bölüm/yüzde/sıra etiketi) ve kullanıcı/kitap bazlı `readerEpubFontSize` + kullanıcı bazlı `readerTheme` kalıcılığı; İngilizce “Yer imi” metni çevrildi.
- Auth: login, scrypt, CSRF, rate limit, session_version, user_sessions + seat limit (varsayılan 3).
- Entitlement: `grants` tablosu (all/publisher/subject/collection/title); katalog + dosya/arama/indirme filtreli; `seat_limit` kurum oturum sayısını sınırlar. **Erişim** modalından grant ekle/sil (librarian/admin); collection kapsamı `collection_items` ile uygulanıyor.
- Interop: `GET /opds`, `/oai` (OAI-PMH oai_dc), `/sushi` (COUNTER-5-shaped IR), `GET /api/books/:id/marc`, `GET /api/reports/usage.csv`. Ayrıntı `docs/INTEROP.md`; OAI/SUSHI sertifikalı değil.
- Erişilebilirlik: hedefli v105 toolbar axe taraması 0 ihlal; F1–F4 v105, F5 v106 retest geçti (10/10, %100/%400). F1–F5 kapandı; NVDA/VoiceOver ve tam iframe taraması açık. `docs/A11Y-RESULTS.md`.
- 1. paket bağımsız Edge retest: v110 **17/19**, v112 **20/21**, sabit v113/f572f3c **21/21, ACCEPTED**. R1/R2 kapandı: Notes açılınca görünür yer iminin yıldızı korunuyor; dönüş/silme, yakın farklı konumlar, kullanıcı/kitap ayarları, İngilizce etiketler, PDF ve offline regresyonları geçti. Bu retestte prod değiştirilmedi. Kanıtlar: `docs/READER-PACKAGE1-V113-RETEST-2026-10-23.md`. 2. paket v114 uygulandı: PDF sayfa etiketleri ve atıf eşlemesi; eksik/null etiketler yalnız ilgili sayfada fallback yapar. Birim testleri 15/15; diğer AI kod incelemesi sonrası gerçek Edge tarayıcı kabulü 4/4 geçti. İstenen dört kabul koşulu kapandı; bu dar koşu 21 testlik bağımsız regresyon iddiası değildir. Prod v113 olarak kaldı. Kabul planı: `docs/PAGE-LABELS-TESTS.md`.
- Arayüz **TR/EN**: `i18n.mjs`; header/login `data-lang-toggle`, `localStorage.uiLang`, sayfa yenilenerek uygulanır. Statik metinler + yaygın dinamik etiketler çevrildi; bazı toast/yardım metinleri hâlâ Türkçe.
- Erişim: kopyalama/indirme/yazdırma/filigran; `/api/books/:id/download`.
- Arama: sunucu sayfa indeksi (`asset_pages`); diakritik katlama, **tam kelime**, **bulanık** (pg_trgm), **kök** eşleşmesi (tr/en FTS, `text_tsv`/`text_tsv_en`); dil-duyarlı katalog araması (`works.language`), eşleşme sayısı + tür etiketi (`exact`/`folded`/`word`/`stem`/`fuzzy`).
- Pilot: `docker-compose.prod.yml`, Caddy TLS, yedek scriptleri, `docs/PILOT.md`, `docs/SMOKE.md`, `scripts/smoke.mjs`.
- Mobil/PWA: `manifest.webmanifest`, `sw.js` app-shell cache, ikonlar, kurulabilir PWA; PDF/EPUB alanında dokunmatik swipe, mobil toolbar sadeleştirme.
- Çevrimdışı: kitap dosyaları IndexedDB’de (`offline.mjs`), karttan ↓ ile indirilir; **Çevrimdışı** modalından açılır/silinir, çevrimdışı açılışta yerel katalog ve son konum kullanılır. Vurgu/notlar çevrimdışı yerel kuyruğa yazılır, `online` olunca `/api/annotations`’a senkronlanır; silmeler de kuyruklanır.
- Güvenlik: `/uploads`, `/seed`, `/ocr` statik erişime kapalı; statik allowlist çözümlenmiş yol üzerinden; `/ocr` ve `/opds` oturum ister; malformed URL 400; grant sorgusu fail-closed; publisher yalnız kendi upload’ını düzenler, grant yönetemez; tenant seat kontrolü tenant advisory lock ile serileştirildi. Ayrıntı `docs/SECURITY.md`.
- PostgreSQL güvenlik testleri (2026-10-23): `cd spike/app; npm run test:security` — publisher API uçtan uca, gerçek grant SQL hatası, iki Node sürecinden eşzamanlı login; **3 senaryo / 60 kontrol geçti**. OPDS grant hatasında başlıklar erken gönderildiği için oluşan süreç kapanması düzeltildi. Test ortamı geçici Docker konteynerinde; ayrıntı `docs/SECURITY-TESTS.md`.
- İçerik limiti: PDF/EPUB upload **300 MB**; 2.000 sayfa test edildi. SLO ve 500 MB kararı `docs/CONTENT-LIMITS.md`.

## Güncel geliştirme sırası

- **v121 çakışma/idempotency canlı; bağımsız kod koşullu PASS.** CAS/version, kalıcı operation receipt, kayıp cevap retry, Web Locks + IDB lease ve açık çatışma seçimleri. İzole 27/27 + not 20/20 + yer imi 17/17; güvenlik 68, birim 62/62 (reviewer da birimi tekrarladı). Prod migration 015 + smoke 16/16 + iki cihaz/offline/A→B→A dahil Edge 14/14 geçti. Bağımsız tarayıcı koşusu yok. Receipt saklama/kullanıcı RLS için v122 teknik kabulü 11/11 + 65/65 PASS; prod migration 016 ve v122 deploy tamam. docs/ANNOTATION-SYNC-V121.md.
- **v120 offline yer imi kuyruğu bağımsız kod PASS; canlı.** PDF/EPUB ekle/kaldır, reload/konuma dönüş, login/online eşitleme, A→B→A sahip izolasyonu. Güncel server_id ile atomik silme ve login tetikleyicisi eklendi; aynı PDF sayfasına dönüş gereksiz render başlatmaz. Ayrı PostgreSQL/Edge **17/17**, not/gizlilik regresyonu **20/20**, JS hatası 0, cleanup 4/4 + 3/3. Migration yok; canlı kabul 10/10, prod v120. docs/OFFLINE-BOOKMARKS-V120.md.
- **v119 gizlilik blocker kapandı; bağımsız kod PASS, canlıya alındı.** Uygulayan ajanın yerel Edge 20/20; reviewer bağımsız tarayıcı koşturamadı. Gerçek prod PostgreSQL/Edge 9/9: PDF/EPUB offline edit/relogin, A→B→A izolasyonu; 0 JS hatası. Sahipsiz eski notlar DB'de korunur, normal listeden gizlidir. docs/deployments/2026-10-24-v119.md.
- **v119 çevrimdışı not düzenleme canlı.** PDF/EPUB not metni ve etiketleri atomik IndexedDB kuyruğunda; reload sonrası korunur, oturum doğrulanınca eşitlenir. Yeni kuyruk kullanıcıya bağlı; eski sahibisiz taslaklar korunur ve otomatik gönderilmez. Edge kabul **14/14**, 0 JS hatası, cleanup 3/3; PostgreSQL güvenlik regresyonu **3 senaryo / 68 kontrol** geçti. Bu, uygulayan ajanın testidir; bağımsız retest iddiası yok. Tam çakışma çözümü ve offline yer imi oluşturma kapsam dışında. `docs/OFFLINE-NOTE-EDIT-V119.md`.
- **P0 v118 dar kapsamla canlı; migration 013–014 ve deploy tamam.** Normal ve yeni Çevrimdışı ↓ indirme ortak biletli/filigranlı POST yolunu kullanır; PDF beyaz kutusu kaldırıldı, yalnız %28 opak metin var. Kullanıcı/tenant başına DB-ortak 10 issue ve 40 ticket-route isteği/60 sn; 429/Retry-After, sınırlı audit özeti; başlangıç+60 sn, tenant kapsamlı 1000’lik purge. **Kullanıcı dar kapsamı kabul etti: sosyal filigran + erişim kontrolü. Ham okuyucu akışı, eski offline kopyalar, screenshot/fotoğraf, filigran kaldırma ve her kopyanın izlenebilirliği kapsam dışı.** Eski blob'lar korunur; zorunlu yeniden indirme yok. Kota testi native tahmin kabul kontrolüdür, fiziksel disk doluluğu/transaction QuotaExceededError kanıtı değildir. `docs/SOCIAL-DRM.md`; AES at-rest P1.
- Kopyalama paketi v116 canlı: PDF/EPUB izin tutarlılığı, seçimden Kopyala / Atıfla kopyala. Citation 17/17 + EPUB izin 7/7 birim testi ve gerçek Edge kabulü 13/13 geçti (uygulayan AI). Seçim/vurgu/not korunur. Kanıtlar: `docs/COPYING-TESTS.md`.
- Kapasite retesti geçti: yalnız async scrypt yeterli olmadı; parola doğrulaması `withTenant` dışına taşınıp havuz bağlantısı erken bırakıldı (`8e1347c`). Tenant/user advisory lock ve seat limit korundu; güvenlik 60/60. Aynı kısa taramada 10/25/50/100 girişlerin tamamı kabul, 6200 API isteğinde 0 hata; 50/100 giriş p95 **2,637 / 5,182 sn**. Bu, prod kapasitesi garantisi değildir. Önceki başarısız koşular değişmeden korundu. Kanıt: `docs/CAPACITY-TEST.md`.
- **NVDA + Edge kabulü:** v124 yerel Windows değerlendirmesi 74/74, 65/65 birim, 28 axe taraması 0 ihlal; canlı v124 NVDA offline kayıt duyurusu **PASS**, JS hatası 0. VoiceOver, yayın semantiği, native AT seçim başlangıcı ve mesaj süreleri sınırları ACR’de; tam AA iddiası yok. docs/ACR.md.
- v122 GO uygulandı: taze yedek/restore → DB admin 016 → sabit 8b598a3 imajı → smoke 16/16 ve Edge 14/14. İlk otomatik app-role retention geçti. 016 ve v121 rollback imajı korunur. docs/deployments/2026-10-24-v122.md.
- Müşteriye bağlı: ilk istenen SSO protokolü; sertifikalı COUNTER alım şartıysa ayrı iş paketi.
- Sonraki okuyucu işleri: not içe aktarma / açıklamalı PDF, EPUB görünüm seçenekleri; El aracı küçük P2 iş. Fixed-layout/MathML/RTL içerikle doğrulanacak. 500 MB görsel PDF kapsam dışında.

## Açık işler (sırayla)

0. **EPUB onarımı + katalog taraması (v134 sonrası, sıradaki iş):** bozuk dosya *Scientific Writing for Health Research* (`4773fe55-…`, `EPUB/text/ch003.xhtml` → `<p></li>`). v134 hatayı görünür kıldı ama dosyayı onarmadı. Adım adım: `docs/runbooks/epub-repair-2026-10-27.md` (§1–§8 onarım, §9 katalog taraması, §10 geri dönüş). Yeni key `…-r1.epub` (aynı key'e yazılamıyor: `IfNoneMatch: '*'`).
1. **WCAG 2.2 AA / ACR:** v122 güncel kanıtı ve 55 kriter taslağı hazır; NVDA + Edge S01–S12 konuşma gözlemleri, sandbox iframe tam taraması, native kontrast ve güncel dinamik reflow açık. docs/ACR.md.
2. **Sosyal filigran / erişim kontrolü:** P0 v118 dar sözleşme kapsamında canlı; 013–014 ve deploy tamam, 16 smoke + 6 canlı senaryo geçti. Sonraki iş AES at-rest P1; chunked range/LCP yalnız gerçek yayıncı şartıyla. `docs/deployments/2026-10-23-v118.md`, `docs/SOCIAL-DRM.md`.
3. **Görsel ağırlıklı >300 MB:** kapsam dışı; yalnızca gerçek yayıncı talebi olursa önizleme/derivative pipeline.
4. **Interop:** OPDS/OAI/MARC/SUSHI/CSV/OPDS API-key hazır; sertifikalı COUNTER ve OAI resumption/set kaldı (`docs/INTEROP.md`).
5. **Mobil/PWA:** not düzenleme v119, offline yer imi v120 ve çakışma/idempotency v121 canlı. v122 receipt retention/kullanıcı RLS teknik kabulü PASS; prod migration 016 ve v122 deploy tamam.
6. **Okuyucu paketi 2:** not içe aktarma, açıklamalı PDF, EPUB sürekli/çift sayfa; El aracı küçük P2.
7. **Kuruma bağlı:** ilk istenen SSO protokolü; sertifikalı COUNTER alım şartıysa ayrı paket.

## Bilinen açıklar / riskler

- 2.000 sayfa sentetik PDF v89: 20 Mbps cold cache 3 run — ilk sayfa **1.404/1.614/1.647 ms**, PDF load 1.129–1.383 ms, 20 render ort. 29–43 ms (max 278 ms), heap 4–7 MB; **hedef geçildi**. 500 MB görsel fixture (`tmp/large-500mb.pdf`, 188 sayfa, JPEG-only) ilk sayfa **7.368 ms**, render ort. 4.238 s, canvas 3.03 s; **hedef kaldı**. JPEG/canvas darboğazı; gerçek tarama veya önizleme pipeline’ı gerekli.
- Sürekli kaydırmada zoom her seferinde 697 pane yeniden kuruyor; ağır olabilir.
- Eski oturumlar `sid` taşımadığı için yeniden giriş gerekir.
- Seat limiti aynı tarayıcı sekmelerinde artmaz; ayrı profil/tarayıcı gerekir. Limit sayımı son **2 saat** içinde görülen oturumlardır; eski satırlar `docs/SESSIONS.md` ile temizlenir.
- Demo modunda parola değiştirme/oturum iptali 501.
- OCR yükleme sırasında otomatik değil. v127 `spike/ocr/prepare-pdf.mjs` PDF→hOCR ve açık okuma bölgelerini, `scripts/a11y-pdf-check.mjs` kaynak kontrolünü sağlar; yalnız yerel modeller, insan incelemesi zorunlu. Araçlar operatör iş istasyonunda kalır; prod servisi değildir. docs/PUBLICATION-ACCESSIBILITY.md.
- EPUB okuyucu tarayıcıda otomatik test edilmedi; EPUB indirme açık; `watermark=false` değilse XHTML sayfalarına kullanıcı/e-posta/tarih filigranı ekleniyor; `allow_download` uygulanıyor. v78: tam kelime/bulanık birbirini dışlıyor; fuzzy yalnızca exact sonuç <3 iken ve `word_similarity >= 0.6` ile çalışıyor. Arama `<body>` ve gerçek chapter etiketi. Eski indeksler için `index-text --all --force`.
- Erişilebilirlik: modal odak tuzağı, tab/aria-current, skip link, `aria-busy`, reduced-motion; F1–F5 tarihsel hedefli retestlerle kapandı. Prod v125; canlı NVDA bildirim kabulü PASS. VoiceOver, insan telaffuz dinlemesi ve belgelenmiş PDF/yayın semantiği sınırları açık; tam WCAG AA iddiası yok. `docs/A11Y-RESULTS.md`.
- Prod'daki mayenit kitabı 2026-10-21'de `language='en'` yapıldı (İngilizce sözlükle kök arama çalışıyor). Ingest `--language` verilmezse sessizce `tr` yazar; İngilizce kitaplar için `--language en` şart.
- İçerik hakları ve gerçek yayıncı kitapları hâlâ yok.
- i18n kısmi: statik UI ve yaygın dinamik etiketler EN; bazı toast/doğrulama/yardım metinleri ve kitap metadata’sı çevrilmiyor.
- Grants: `010`–`012` uygulanmalı. **~~Grant yoksa katalog eskisi gibi açık~~ — 2026-10-27'den beri YANLIŞ.** Erişim fail-closed: eşleşen grant yoksa katalog **kapalı** (0 kitap). Kural: kullanıcının tenant'ında ya da üzerinde `active` + süresi geçmemiş bir grant olmalı. Canlıda LibEdge tenant'ı için all kapsamlı süresiz grant (`20202020-…`) var; `77777777-…` collection grant'i 2027-01-23'te sona erer. Seat limit `users.max_sessions` ile birlikte çalışır. **Grup subject + üye ekle/çıkar**, kullanıcı/grup grant’leri, koleksiyon/başlık seçicileri, audit log ve kullanım sayacı var.
- `download-tickets` ve `/opds` hâlâ **env tenant'ı** ile kurulu (`tenantId: TENANT_ID`). İkinci tenant'ta bu yollar reddeder (`tenant_mismatch` / 401); **sızdırmaz** ama kırılır. Ayrı PR.
- `2026-10-28` itibarıyla bilinen açıklar (v134): **bozuk EPUB dosyası hâlâ bozuk** — indirme 409 veriyor ama artık **nedeni audit'te ve okuyucuda görünüyor**; **katalogda kaç kitabın aynı durumda olduğu bilinmiyor** (tarama yapılmadı). Onarım: `docs/runbooks/epub-repair-2026-10-27.md`.
- **Download deny audit'inde `book_id` (v135'te çözüldü):** `auditDenied()` artık opsiyonel `book` alıyor; `server.mjs`'te 409 üreten iki çağrı `book`'u geçiriyor, böylece "hangi kitap indirilemiyor" sorusu audit'ten cevaplanabiliyor. Kitap çözülmeden düşen yollar (`csrf_invalid`) doğru şekilde `null` kalıyor.
- **`app.js?v=` etiketi (v135'te çözüldü):** v130'dan beri sabit `?v=130-ui-copy` idi; artık `asset-version.mjs` token'ı `BUILD_SHA`'dan türetiyor ve `server.mjs` `index.html`'i servis ederken enjekte ediyor.

## Komutlar

```powershell
docker compose up -d --build
docker compose exec db psql -U akademik -d akademik -f /migrations/008-page-search.sql
docker compose exec db psql -U akademik -d akademik -f /migrations/009-epub-pages.sql
docker compose exec db psql -U akademik -d akademik -f /migrations/010-grant-scope-key.sql
docker compose exec db psql -U akademik -d akademik -f /migrations/011-grant-audit.sql
docker compose exec db psql -U akademik -d akademik -f /migrations/012-groups.sql
docker compose exec web node index-text.mjs --all --force
node scripts/smoke.mjs http://localhost:8080
```

Prod:

```powershell
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.production exec db psql -U akademik -d akademik -f /migrations/008-page-search.sql
```

## Token tasarrufu kuralları

- Tek turda tek iş; “hepsini yap” deme.
- Önce bu dosyayı oku; eski konuşmayı özetleme.
- Hata çıktısının ilk 20 satırını ver; tam logu değil.
- Büyük dosyaları baştan okumam; hedefli `grep`/offset kullanırım.
- Uzun açıklama yerine kod + 3–5 satır özet.
- Her iş tek commit/push; GitHub limiti için batch.


## v124 accessibility deployment — 2026-10-25

Code: 52c846c11f539b57ca3c531b72658da80c13976a. Original EPUB iframe zoom/axe, chapter announcements, keyboard selection tools/native annotation position buttons, shortcut opt-out, background isolation, focus restoration, note confirmation and responsive/theme/target fixes. [Windows acceptance](docs/A11Y-NVDA-V124.md), [evidence](docs/a11y-evidence/v124-2026-10-25/ACCEPTANCE.md). v124 is live (config 124/52c846c); v123 remains the rollback image. Canlı NVDA offline kayıt kabulü PASS (`d55daa0`). Full WCAG AA/VoiceOver/publication conformance is not claimed.


## v125 accessibility deployment — 2026-10-25

Code **10546bfb91c643ffa1a0ebc8aa8f28b72d824874**. Gerçek NVDA Native Selection ile PDF/EPUB sıfırdan seçim → kopya → vurgu ve MathML/tablo/görsel okuması doğrulandı. Boş KeyboardEvent.code için key fallback; kalıcı, son 200 oturum bildirimini tutan ve hesap/giriş değişiminde temizlenen Bildirimler penceresi eklendi. Okurken liste sabit; iç içe form verisi/odak ve arka planda biten formun kapalı kalması korundu. Yerel: 74 regresyon, 65 birim, 6 native, 14 içerik/form ve 6 native zoom kontrolü; JS0. Kanıt docs/a11y-evidence/v125-2026-10-25/ACCEPTANCE.md.

Açık: VoiceOver/insan dinlemesi, etiketsiz sütun sırası, OCR’siz taramalar ve yayıncı içerik/alternatifleri. v125’te saptanan kaynak tagged PDF başlık/formül açıklaması eksiği v126’da kapandı. Sentetik MathML/RTL/fixed-layout EPUB örnekleri geçti; genel yayın uyumu iddia edilmez. v126 canlı (config 126/90c7b72); canlı NVDA başlık/formül kabulü PASS 6/6/JS0, v125 rollback korunur.

## v126 PDF structure deployment — 2026-10-25

Code **90c7b727e50d41def50486bd621789a39cdb8826**, CSS49/SW18. PDF.js marked text + source structure → unique, local aria-owns; no duplicate hidden text or inferred heading/order. Formula with source alternate text is an atomic image alternative, not invented MathML; missing alternative preserves raw text. Native NVDA H heading jump, description reading without invalid-math warning, native selection/copy/highlight passed. Spread/scroll/zoom/rotation, OCR, decode fallback, delayed old-book response and offline module cache checked. Targeted19/19, regression74/74, units65/65, 32 clean axe/0 violations, JS0. All test content was isolated demo fixtures. v126 is live (config126/90c7b72); v125 remains rollback; live NVDA heading/formula acceptance PASS 6/6/JS0. ACR open. docs/deployments/2026-10-25-v126.md.

## v127 OCR / publication preparation deployment — 2026-10-25

Code **fbeed6e6fefcad00f13ddb80b98b91fb9ef67351**, CSS49/SW19, app-only deploy; no new production dependency/migration. Source hOCR paragraph order and per-word/paragraph/root language survive rendering; eng/tur normalize en/tr. Local PDF inspection reports facts/review flags, not AA; OCR tool renders PDFs and uses installed local Tesseract models, no upload/CDN, no overwrites. Explicit normalized reading regions/PSM can define header→left→right, with overlapping regions rejected and boxes translated back to page coordinates. Real OCR eng/tur tests10/10, reader/NVDA26/26, regression74/74, units65/65; 34 clean axe/0 violations, JS0. VoiceOver template12 NOT RUN rows; publication review runbook prepared. Default full-page OCR initially interleaved; final explicit PSM3 also reads this sample correctly; reviewed region output was independently tested in NVDA. No generic order/accuracy guarantee. Original PDF and offline blobs do not embed/package OCR sidecars. v127 is live (config127/fbeed6e); v126 remains rollback; live Turkish OCR/NVDA acceptance PASS 7/7/JS0. ACR open. docs/deployments/2026-10-25-v127.md.

## v132 tenant/access hardening + migration runner — 2026-10-27

Code **8df115f** on `main`. Three PRs: #19 (`db/migrate.mjs` + `schema_migrations`, PR merge), #21 (fail-closed tenant binding, squash), #22 (`020` all-scope grant, squash). First deploy that used the runner on production: `--baseline` marked 001–017 without executing them, then 018/019/020 ran under `pg_advisory_lock` in one transaction each. `019` repaired the seed grant whose `subject_id` pointed at the Demo tenant; `020` added the LibEdge tenant's `all`-scope grant because the existing grant is collection-scoped (12 works) and new uploads join no collection, so they would have been invisible under fail-closed.

Verified live: `/api/config` → `132/8df115f`, `mode:db`; login, 13 works, PDF and EPUB all working. Tests on the merged tree: `tenant-access` 4 scenarios/12 checks, `security` 68, `social-drm` 295, `db/migrate.test.mjs` 9/9, `db/019.test.mjs` 6/6, unit 113/113.

Image name now comes from **`.env.r2` → `LIBEDGE_IMAGE=libedge-v132`**; the compose default (`${LIBEDGE_IMAGE:-libedge-v131}`) is only a fallback. **The 2026-10-26 outage root cause is corrected:** the variable was in use all along, it was simply never set, and `LIBEDGE_IMAGE=... sudo docker compose` drops it because `sudo` strips the environment — so compose fell through to the old `libedge-r2` image. Old images were pruned with `docker rmi` before deploying (disk was at 95%). Rule: keep no images except the previous version's rollback.

Open for v133: EPUB publisher stylesheet blocked by `style-src` (blob: URL), `favicon.ico` 404, missing `mobile-web-app-capable` meta; `download-tickets` and `/opds` still bound to the env tenant. docs/deployments/2026-10-27-v132.md.

## v133 CSP `blob:` + favicon/meta + SW `v25` — 2026-10-27

Code **5225149** on `main` (squash of #26; #25 added `blob:` and is `31ba6f8`). Live and verified.

Three fixes, all reached the reader through the same failure mode — a silent block with no error in the console:

1. **EPUB theme/size ignored.** `style-src` had no `blob:`, and epub.js injects its theme stylesheet as a `blob:` URL. With `allowScriptedContent: false` the chapter iframe runs `sandbox="allow-same-origin"` only, so it inherits the parent document's CSP rather than getting its own — the parent's `style-src` applied inside every chapter and dropped the stylesheet. CSP now lives in one place, `spike/app/security-headers.mjs` (`APP_CSP`), so it is testable without booting the server.
2. **`/favicon.ico` 404, two stacked causes.** `index.html` declared no `<link rel="icon">` so browsers self-requested it, **and** `serveStatic` is an allowlist, so even a present root file is refused. Fixing only one would still have 404'd. `public/favicon.ico` is generated by `scripts/build-favicon.mjs` from the same 192px source as the manifest (16/32/48 px, hand-written ICO container, 705 B, committed); `server.mjs` gained the `.ico` MIME and an explicit `/favicon.ico` allowlist entry. `mobile-web-app-capable` added next to the deprecated Apple variant.
3. **SW cache `v24` → `v25`.** Navigations are network-first, so the new CSP applied immediately while online. Offline, the catch branch serves `caches.match('/')` — the shell captured under the *old* CSP header, which the browser still enforces. `activate` only deletes caches whose name differs, so without a rename the stale shell survived every deploy and the blob: fix never reached offline EPUB reading.

Auditing the cache name surfaced a separate pre-existing defect: five browser tests pinned it as a literal (`v13` in four, `v9` in one) while `sw.js` was on `v24`, and `caches.open()` *creates* an unknown cache — those assertions were checking a cache they had just created empty. The name is now read from `public/sw.js` (`shellCacheName()` / `ensureShell()` in `test/helpers/server-files.mjs`).

Verified live: image `libedge-v133` (ID `541b98daa159`, LABEL `5225149`/`133`), `/api/config` → `133/5225149/2026-10-27`, `/api/health` → `ok/db/5799f2a5`, `/favicon.ico` → `200 OK`, R2 put/read/range/delete PASS. Browser: favicon visible, SW **v25** registered, EPUB publisher CSS + light/sepia/dark + font size confirmed by Altan. Tests on the merged tree: unit **123/123**, `security-headers` **3/3**, `tenant-access` 4 scenarios/12 checks, `social-drm` 295.

**Rollback is now `libedge-v132`** — `libedge-v131` was removed with `docker rmi`; `.env.r2.bak-v132` kept.

**Open:** an offline-launch EPUB was not exercised this round, so it is unproven that `v25` is actually served instead of a leftover `v24` shell (see `docs/TODO.md`). Still open from earlier: `download-tickets` and `/opds` bound to the env tenant; SSO. docs/deployments/2026-10-27-v133.md.

## v135 audit attribution and real cache-busting — 2026-10-28

Branch `fix/v135-audit-book-id-and-asset-version`. No deploy yet, no migration. Both items are the follow-ups found while verifying v134, and they ship together because each is a few lines with one test file.

**1. A deny row now names the book.** `auditDenied()` hard-coded `book = null`, so every `download.ticket.deny` row carried `payload.book_id: null` and `object_id: null` — the v134 evidence chain could say *what* failed (`delivery_failed`, with the parser message) but not *which title*. `server.mjs` held the `book` at the 409 site and simply did not pass it. The signature gained an optional trailing `book`; `invalid_storage_key` and `delivery_failed` now pass it. Paths that deny before the book is resolved (`csrf_invalid`, `post_required`) keep passing nothing — `null` is the truthful value there, and the fix does not fabricate an id. This had to land **before** the catalog scan: the scan answers "how many titles are in this state?" by reading audit. Test `test/download-audit.test.mjs` drives the service with a fake client and asserts `object_id`/`payload.book_id`; reverting the one-word change makes it fail with `null !== 'asset-1'`.

**2. `?v=` is now derived from the build, not typed by hand.** `public/index.html` carried `?v=130-ui-copy` from v130 onward, so v131–v134 each served a new `app.js` behind an unchanged URL. The v134 reader messages only appeared if the browser happened to revalidate; `Cache-Control: no-cache` and the service worker's network-first rule made that likely but never guaranteed, and nothing in the build tied the URL to the code. The token now comes from `assetVersionToken(BUILD_SHA, APP_VERSION)` in the new side-effect-free `asset-version.mjs` (`BUILD_SHA`, else `APP_VERSION`, else no token — an unknown build gets no invented version), and `serveStatic` stamps it into `index.html` at response time, recomputing `content-length`. Rewriting is anchored to an allowlist of the twelve shell modules plus `styles.css`, so a token cannot land in arbitrary HTML and API URLs keep their own query. `sw.js` cache bumped **v25 → v26** per the rule v133 established: the cached `/` body changed.

Verified by starting the real server: `BUILD_SHA=b6aa81a APP_VERSION=134 node server.mjs` → `/` returns `200`, `content-length` 26859 **matching the actual body**, `cache-control: no-cache`, unchanged CSP, and `/styles.css?v=b6aa81a` / `/app.js?v=b6aa81a` in the body. Tests: full unit suite **135/135** across 20 files; the two new files are 7/7 and 2/2.

**Not done:** ~~nothing is deployed as v135 yet~~ — **superseded: v135 is live and verified** (2026-10-28 ~11:31 TRT, `c88a778`, image `libedge-v135`); see the versions block at the top and `docs/deployments/2026-10-28-v135.md`. The catalog scan is still independent and open.

## v134 EPUB download 409 made visible — 2026-10-28

Code **b6aa81a** on `main` (PR #29). Live and verified 2026-10-28 01:43 TRT.

The reader got a bare **409** on EPUB download with **nothing shown to the user** — the reason existed only in console output, so a permanently undownloadable title stayed invisible for weeks. Root cause was data, not code: `EPUB/text/ch003.xhtml` in *Scientific Writing for Health Research* contains `<p></li>` (unclosed `<p>`, Pandoc output), so the file is **not well-formed**. Reading worked because the reader hands XHTML to the browser as-is; watermarking parses it as XML and failed. **The parser was correct (fail-closed) and was not changed.**

Three changes: the 409 reason is written to audit (`delivery_failed` / `invalid_storage_key` with `error` + `format`), the reader is shown a human-readable message on all three 409 paths, and ingest now refuses an EPUB that cannot be stamped (`inspectWatermarkable`, 422) so no new title can enter the catalog undownloadable. `watermarkEpub` takes `{ inspectOnly }` so dry-run and the real stamp use the same candidate list. No unwatermarked fallback was added — returning the bytes would silently break the watermark contract in `docs/SOCIAL-DRM.md`.

Verified live: image `libedge-v134` (ID `00bf4340bca2`, LABEL `b6aa81a`/`134`), `/api/config` → `134/b6aa81a/2026-10-27` (server is UTC; the TRT deploy time is 2026-10-28 01:43), `/api/health` → `ok/db/5799f2a5`, R2 PASS. Browser (Altan): clear on-screen message, only the 409 request in the console, no uncaught error. Server side, all three layers agree: log `[download] epub delivery failed: Invalid EPUB package: mismatched XML closing tag`, audit `{"error":"Invalid EPUB package: mismatched XML closing tag","format":"epub","reason":"delivery_failed","book_id":null}`. Tests on the merged tree: unit **126/126**, `social-watermark` **17/17**, `social-drm` 295, `security-headers` 3/3, `tenant-access` 4 scenarios/12 checks. Negative control: stashing the fix drops the suite with `does not provide an export named 'inspectWatermarkable'`.

**Rollback is now `libedge-v133`** — `libedge-v132` was removed with `docker rmi` before the build (disk at 85%, 1023 MB freed); `.env.r2.bak-v133` kept. No migration.

**The book itself is still broken.** v134 only built the correct failure path; the reader still cannot download it. Repair and catalog scan are the next work, in that order: `docs/runbooks/epub-repair-2026-10-27.md`.

**Open:** `download-tickets` and `/opds` bound to the env tenant; SSO; offline-launch EPUB never exercised. Both follow-ups found during this deploy were closed in v135. docs/deployments/2026-10-28-v134.md.
