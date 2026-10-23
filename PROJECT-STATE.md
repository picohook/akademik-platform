# Project state — 2026-10-23

Bu dosya yeni bir oturumda bağlam taşımak için kısa hafızadır. Uzun konuşma geçmişini tekrar okumayın.

## Sürümler

- Web kaynak: **v118** (`spike/app/public/index.html`), stiller **v44**, SW cache **v9**
- DB migration kaynak: **001–014** (`db/migrations/`); prod **001–012**, 013–014 henüz uygulanmadı.
- Prod: **v116** (2026-10-23), kaynak **8e1347c**, imaj `sha256:fff613f6…`; HTTPS smoke **16/16**, health/restart `healthy/0`. Kopyalama paketi + giriş havuzu düzeltmesi canlı. Rollback: dağıtım öncesi salt okunur doğrulanan v115 imajı (`sha256:163465e8…`); eski kayıt v114 diyordu. Kayıt: `docs/deployments/2026-10-23-v116.md`. Migration yok; 001–012 korundu.
- Son kod doğrulaması: **v118 P0 kabulü dar ürün kapsamında geçti**. Önceki **55 birim / 295 DB / 68 güvenlik** kanıtları korunuyor; kullanıcı bağımsız 62 birimde 0 hata bildirdi. Yeni kabul: **8/8 Edge (varsayılan 7 + kontrollü kota 1), 0 JS hatası, 4/4 cleanup**; yedekten **013→014 + tekrar uygulama + 15 sunucu smoke**, cleanup **3/3**. EPUB açılış ResizeObserver yarışı guard ile düzeltildi, ilgili birim **7/7** tekrar geçti. Kaynak/hash sınırları: `docs/V118-PREDEPLOY-2026-10-23.md`. Prod hâlâ 8e1347c/v116, health 200; üretim migration/deploy yok.
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

- **P0 v118 dar kapsam kabulü ve üretim öncesi testler tamam; deploy yok.** Normal ve yeni Çevrimdışı ↓ indirme ortak biletli/filigranlı POST yolunu kullanır; PDF beyaz kutusu kaldırıldı, yalnız %28 opak metin var. Kullanıcı/tenant başına DB-ortak 10 issue ve 40 ticket-route isteği/60 sn; 429/Retry-After, sınırlı audit özeti; otomatik başlangıç+60 sn, tenant kapsamlı 1000’lik purge. Migration 013–014 gerekir. **Kullanıcı dar kapsamı açıkça kabul etti: sosyal filigran + erişim kontrolü. Ham okuyucu akışı, eski offline kopyalar, screenshot/fotoğraf, filigran kaldırma ve her kopyanın izlenebilirliği kapsam dışı.** Eski blob'lar korunur; zorunlu yeniden indirme yok. Kota testi native tahmin kabul kontrolüdür, fiziksel disk doluluğu/transaction QuotaExceededError kanıtı değildir. `docs/SOCIAL-DRM.md`; AES at-rest P1.
- Kopyalama paketi v116 canlı: PDF/EPUB izin tutarlılığı, seçimden Kopyala / Atıfla kopyala. Citation 17/17 + EPUB izin 7/7 birim testi ve gerçek Edge kabulü 13/13 geçti (uygulayan AI). Seçim/vurgu/not korunur. Kanıtlar: `docs/COPYING-TESTS.md`.
- Kapasite retesti geçti: yalnız async scrypt yeterli olmadı; parola doğrulaması `withTenant` dışına taşınıp havuz bağlantısı erken bırakıldı (`8e1347c`). Tenant/user advisory lock ve seat limit korundu; güvenlik 60/60. Aynı kısa taramada 10/25/50/100 girişlerin tamamı kabul, 6200 API isteğinde 0 hata; 50/100 giriş p95 **2,637 / 5,182 sn**. Bu, prod kapasitesi garantisi değildir. Önceki başarısız koşular değişmeden korundu. Kanıt: `docs/CAPACITY-TEST.md`.
- Manuel NVDA/VoiceOver ve tam EPUB iframe denetimi paralel; gerçek ekran okuyucu gözlemi olmadan ACR tam uyum iddiası yok.
- Sonraki büyük kod paketi: çevrimdışı not düzenleme + yer imi kuyruğu + çakışma çözümü.
- Müşteriye bağlı: ilk istenen SSO protokolü; sertifikalı COUNTER alım şartıysa ayrı iş paketi.
- Sonraki okuyucu işleri: not içe aktarma / açıklamalı PDF, EPUB görünüm seçenekleri; El aracı küçük P2 iş. Fixed-layout/MathML/RTL içerikle doğrulanacak. 500 MB görsel PDF kapsam dışında.

## Açık işler (sırayla)

1. **WCAG 2.2 AA manuel denetimi:** NVDA/VoiceOver, tam EPUB iframe axe ve native kontrast teması; hedefli F1–F5/zoom retestleri geçti.
2. **Sosyal filigran / erişim kontrolü:** P0 v118 dar sözleşme kapsamı kabul edildi; gerçek offline/IndexedDB ve yedekten migration kabulü geçti. Üretim migration 013–014 ve ayrı deploy kaldı. `docs/V118-PREDEPLOY-2026-10-23.md`, `docs/SOCIAL-DRM.md`. AES at-rest P1; chunked range/LCP yalnız gerçek yayıncı şartıyla.
3. **Görsel ağırlıklı >300 MB:** kapsam dışı; yalnızca gerçek yayıncı talebi olursa önizleme/derivative pipeline.
4. **Interop:** OPDS/OAI/MARC/SUSHI/CSV/OPDS API-key hazır; sertifikalı COUNTER ve OAI resumption/set kaldı (`docs/INTEROP.md`).
5. **Mobil/PWA:** shell + swipe + çevrimdışı kitaplık ve not kuyruğu hazır; çevrimdışı not düzenleme, yer imi kuyruğu ve çakışma çözümü kaldı.
6. **Okuyucu paketi 2:** not içe aktarma, açıklamalı PDF, EPUB sürekli/çift sayfa; El aracı küçük P2.
7. **Kuruma bağlı:** ilk istenen SSO protokolü; sertifikalı COUNTER alım şartıysa ayrı paket.

## Bilinen açıklar / riskler

- 2.000 sayfa sentetik PDF v89: 20 Mbps cold cache 3 run — ilk sayfa **1.404/1.614/1.647 ms**, PDF load 1.129–1.383 ms, 20 render ort. 29–43 ms (max 278 ms), heap 4–7 MB; **hedef geçildi**. 500 MB görsel fixture (`tmp/large-500mb.pdf`, 188 sayfa, JPEG-only) ilk sayfa **7.368 ms**, render ort. 4.238 s, canvas 3.03 s; **hedef kaldı**. JPEG/canvas darboğazı; gerçek tarama veya önizleme pipeline’ı gerekli.
- Sürekli kaydırmada zoom her seferinde 697 pane yeniden kuruyor; ağır olabilir.
- Eski oturumlar `sid` taşımadığı için yeniden giriş gerekir.
- Seat limiti aynı tarayıcı sekmelerinde artmaz; ayrı profil/tarayıcı gerekir. Limit sayımı son **2 saat** içinde görülen oturumlardır; eski satırlar `docs/SESSIONS.md` ile temizlenir.
- Demo modunda parola değiştirme/oturum iptali 501.
- OCR otomasyonu yok; hOCR manuel/CLI.
- EPUB okuyucu tarayıcıda otomatik test edilmedi; EPUB indirme açık; `watermark=false` değilse XHTML sayfalarına kullanıcı/e-posta/tarih filigranı ekleniyor; `allow_download` uygulanıyor. v78: tam kelime/bulanık birbirini dışlıyor; fuzzy yalnızca exact sonuç <3 iken ve `word_similarity >= 0.6` ile çalışıyor. Arama `<body>` ve gerçek chapter etiketi. Eski indeksler için `index-text --all --force`.
- Erişilebilirlik: modal odak tuzağı, tab/aria-current, skip link, `aria-busy`, reduced-motion eklendi; F1–F5 hedefli retestlerle kapandı, v106 prod’da; NVDA/VoiceOver ve tam iframe taraması açık. `docs/A11Y-RESULTS.md`.
- Prod'daki mayenit kitabı 2026-10-21'de `language='en'` yapıldı (İngilizce sözlükle kök arama çalışıyor). Ingest `--language` verilmezse sessizce `tr` yazar; İngilizce kitaplar için `--language en` şart.
- İçerik hakları ve gerçek yayıncı kitapları hâlâ yok.
- i18n kısmi: statik UI ve yaygın dinamik etiketler EN; bazı toast/doğrulama/yardım metinleri ve kitap metadata’sı çevrilmiyor.
- Grants: `010`–`012` uygulanmalı. Grant yoksa katalog eskisi gibi açık. Seat limit `users.max_sessions` ile birlikte çalışır. **Grup subject + üye ekle/çıkar**, kullanıcı/grup grant’leri, koleksiyon/başlık seçicileri, audit log ve kullanım sayacı var.

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
