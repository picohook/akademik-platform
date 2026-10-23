# Project state — 2026-10-23

Bu dosya yeni bir oturumda bağlam taşımak için kısa hafızadır. Uzun konuşma geçmişini tekrar okumayın.

## Sürümler

- Web: **v113** (`spike/app/public/index.html`), stiller **v42**
- DB migration: **001–012** (`db/migrations/`)
- Prod: **v110** (2026-10-23), kaynak **81a5fc5**, imaj `sha256:2b653dbc…`; dağıtım kaydında smoke **16/16**, health/restart `healthy/0`. Bağımsız HTTPS kontrolü v110/v42 dosyalarını doğruladı. v112 retest **20/21, HOLD**; v112 deploy edilmedi. Kayıt: `docs/deployments/2026-10-23-v110.md`.
- Son test edilen kod commit’i: **d0e01c9** — v112, EPUB yer imi etiketleri; prod kaynağı **81a5fc5**.
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
- 1. paket bağımsız Edge retest: v110 **17/19**, sabit v112/d0e01c9 **20/21, HOLD**. Kullanıcı/kitap ayarları, İngilizce Bookmark, yakın farklı konumlar ve etiketler geçti; Notes doğrudan açılınca görünür yer iminin yıldızı hâlâ sönüyor. Dev v110 ayrı uploads/OCR bağlamalarıyla yenilendi; bu retestte prod değiştirilmedi. Kanıtlar: `docs/READER-PACKAGE1-RETEST-2026-10-23.md`.
- Arayüz **TR/EN**: `i18n.mjs`; header/login `data-lang-toggle`, `localStorage.uiLang`, sayfa yenilenerek uygulanır. Statik metinler + yaygın dinamik etiketler çevrildi; bazı toast/yardım metinleri hâlâ Türkçe.
- Erişim: kopyalama/indirme/yazdırma/filigran; `/api/books/:id/download`.
- Arama: sunucu sayfa indeksi (`asset_pages`); diakritik katlama, **tam kelime**, **bulanık** (pg_trgm), **kök** eşleşmesi (tr/en FTS, `text_tsv`/`text_tsv_en`); dil-duyarlı katalog araması (`works.language`), eşleşme sayısı + tür etiketi (`exact`/`folded`/`word`/`stem`/`fuzzy`).
- Pilot: `docker-compose.prod.yml`, Caddy TLS, yedek scriptleri, `docs/PILOT.md`, `docs/SMOKE.md`, `scripts/smoke.mjs`.
- Mobil/PWA: `manifest.webmanifest`, `sw.js` app-shell cache, ikonlar, kurulabilir PWA; PDF/EPUB alanında dokunmatik swipe, mobil toolbar sadeleştirme.
- Çevrimdışı: kitap dosyaları IndexedDB’de (`offline.mjs`), karttan ↓ ile indirilir; **Çevrimdışı** modalından açılır/silinir, çevrimdışı açılışta yerel katalog ve son konum kullanılır. Vurgu/notlar çevrimdışı yerel kuyruğa yazılır, `online` olunca `/api/annotations`’a senkronlanır; silmeler de kuyruklanır.
- Güvenlik: `/uploads`, `/seed`, `/ocr` statik erişime kapalı; statik allowlist çözümlenmiş yol üzerinden; `/ocr` ve `/opds` oturum ister; malformed URL 400; grant sorgusu fail-closed; publisher yalnız kendi upload’ını düzenler, grant yönetemez; tenant seat kontrolü tenant advisory lock ile serileştirildi. Ayrıntı `docs/SECURITY.md`.
- PostgreSQL güvenlik testleri (2026-10-23): `cd spike/app; npm run test:security` — publisher API uçtan uca, gerçek grant SQL hatası, iki Node sürecinden eşzamanlı login; **3 senaryo / 60 kontrol geçti**. OPDS grant hatasında başlıklar erken gönderildiği için oluşan süreç kapanması düzeltildi. Test ortamı geçici Docker konteynerinde; ayrıntı `docs/SECURITY-TESTS.md`.
- İçerik limiti: PDF/EPUB upload **300 MB**; 2.000 sayfa test edildi. SLO ve 500 MB kararı `docs/CONTENT-LIMITS.md`.

## Açık işler (sırayla)

1. **WCAG 2.2 AA manuel denetimi:** NVDA/VoiceOver, tam EPUB iframe axe ve native kontrast teması; hedefli F1–F5/zoom retestleri geçti.
2. **Görsel ağırlıklı >300 MB:** kapsam dışı; yalnızca gerçek yayıncı talebi olursa önizleme/derivative pipeline.
3. **EPUB filigran:** XHTML filigranı açık; şifreli EPUB 409 döner, lisans metni kararı kaldı.
4. **Interop:** OPDS/OAI/MARC/SUSHI/CSV hazır; sertifikalı COUNTER, OAI resumption/set ve OPDS auth kaldı (`docs/INTEROP.md`).
5. **Mobil/PWA:** shell + swipe + çevrimdışı kitaplık ve not kuyruğu hazır; çakışma/çoklu cihaz çözümü ve native kararı kaldı.
6. **Grant grup/audit:** group subject, kullanım raporu, grant geçmişi.

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
