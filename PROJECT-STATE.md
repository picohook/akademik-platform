# Project state — 2026-10-21

Bu dosya yeni bir oturumda bağlam taşımak için kısa hafızadır. Uzun konuşma geçmişini tekrar okumayın.

## Sürümler

- Web: **v93** (`spike/app/public/index.html`), stiller **v38**
- DB migration: **001–011** (`db/migrations/`)
- Prod: **v52 + 008** deploy edildi (2026-10-21) — Caddy HTTPS, smoke **16/16**; kök/tam kelime/bulanık prod'da doğrulandı.
- Son commit: dil düzeltmesi (bu commit)
- EPUB kararı: **ADR-012** — MVP/V1a için epub.js, `EpubEngine` adapter arkasında, pinli; Readium/R2D2BC geçiş eşikleri yazılı.

## Çalışanlar

- PDF okuyucu: tek/çift sayfa/sürekli kaydırma, küçük resimler, TOC, arama, vurgu/not/etiket/tarih, yer imi, atıf, dışa aktarma, temalar.
- Yükleme/silme: PDF + EPUB upload; yalnızca `source_system='upload'` kitaplar librarian/admin/publisher tarafından silinebilir; DB cascade + dosya silme.
- EPUB: `.epub` upload/format; ana okuyucuda `EpubEngine` (TOC, tema, ± font/zoom, ‹ ›, CFI/ilerleme, seçimden CFI vurgu/not, bölüm arama). EPUB bölüm metni `asset_pages` (`source='epub'`, `locator=href`) olarak indeksleniyor; v72 sonrası XHTML `<body>` dışındaki `<title>` metni indekse girmiyor. Arama DB indeksinden; sonuçta geçerli bölümde eşleşmeler işaretleniyor. EPUB indirme 501.
- Auth: login, scrypt, CSRF, rate limit, session_version, user_sessions + seat limit (varsayılan 3).
- Entitlement: `grants` tablosu (all/publisher/subject/collection/title); katalog + dosya/arama/indirme filtreli; `seat_limit` kurum oturum sayısını sınırlar. **Erişim** modalından grant ekle/sil (librarian/admin); collection kapsamı `collection_items` ile uygulanıyor.
- Erişilebilirlik: WCAG temel denetimi `docs/ACCESSIBILITY.md`; manuel test planı `docs/A11Y-TEST-PLAN.md` (axe, NVDA/VoiceOver, %200 zoom, EPUB iframe).
- Arayüz **TR/EN**: `i18n.mjs`; header/login `data-lang-toggle`, `localStorage.uiLang`, sayfa yenilenerek uygulanır. Statik metinler + yaygın dinamik etiketler çevrildi; bazı toast/yardım metinleri hâlâ Türkçe.
- Erişim: kopyalama/indirme/yazdırma/filigran; `/api/books/:id/download`.
- Arama: sunucu sayfa indeksi (`asset_pages`); diakritik katlama, **tam kelime**, **bulanık** (pg_trgm), **kök** eşleşmesi (tr/en FTS, `text_tsv`/`text_tsv_en`); dil-duyarlı katalog araması (`works.language`), eşleşme sayısı + tür etiketi (`exact`/`folded`/`word`/`stem`/`fuzzy`).
- Pilot: `docker-compose.prod.yml`, Caddy TLS, yedek scriptleri, `docs/PILOT.md`, `docs/SMOKE.md`, `scripts/smoke.mjs`.
- Mobil/PWA: `manifest.webmanifest`, `sw.js` app-shell cache, ikonlar, kurulabilir PWA; PDF/EPUB alanında dokunmatik swipe, mobil toolbar sadeleştirme.
- Çevrimdışı: kitap dosyaları IndexedDB’de (`offline.mjs`), karttan ↓ ile indirilir; **Çevrimdışı** modalından açılır/silinir, çevrimdışı açılışta yerel katalog ve son konum kullanılır. Notlar/atıflar çevrimdışı yerel değil.
- İçerik limiti: PDF/EPUB upload **300 MB**; 2.000 sayfa test edildi. SLO ve 500 MB kararı `docs/CONTENT-LIMITS.md`.

## Açık işler (sırayla)

1. **WCAG 2.2 AA manuel denetimi:** ekran okuyucu, axe, %200 zoom, EPUB iframe.
2. **Görsel ağırlıklı >300 MB:** kapsam dışı; yalnızca gerçek yayıncı talebi olursa önizleme/derivative pipeline.
3. **EPUB indirme/filigran:** PDF dışı indirme 501; lisans/watermark kararı.
4. **Interop:** MARC21/OPDS/OAI-PMH/COUNTER.
5. **Mobil/PWA:** shell + swipe + temel çevrimdışı kitaplık hazır; çevrimdışı not/atıf senkronu ve native kararı kaldı, sonra analitik/AI.
6. **Grant grup/audit:** group subject, kullanım raporu, grant geçmişi.

## Bilinen açıklar / riskler

- 2.000 sayfa sentetik PDF v89: 20 Mbps cold cache 3 run — ilk sayfa **1.404/1.614/1.647 ms**, PDF load 1.129–1.383 ms, 20 render ort. 29–43 ms (max 278 ms), heap 4–7 MB; **hedef geçildi**. 500 MB görsel fixture (`tmp/large-500mb.pdf`, 188 sayfa, JPEG-only) ilk sayfa **7.368 ms**, render ort. 4.238 s, canvas 3.03 s; **hedef kaldı**. JPEG/canvas darboğazı; gerçek tarama veya önizleme pipeline’ı gerekli.
- Sürekli kaydırmada zoom her seferinde 697 pane yeniden kuruyor; ağır olabilir.
- Eski oturumlar `sid` taşımadığı için yeniden giriş gerekir.
- Seat limiti aynı tarayıcı sekmelerinde artmaz; ayrı profil/tarayıcı gerekir. Limit sayımı son **2 saat** içinde görülen oturumlardır; eski satırlar `docs/SESSIONS.md` ile temizlenir.
- Demo modunda parola değiştirme/oturum iptali 501.
- OCR otomasyonu yok; hOCR manuel/CLI.
- EPUB okuyucu tarayıcıda otomatik test edilmedi; EPUB indirme 501. v78: tam kelime/bulanık birbirini dışlıyor; fuzzy yalnızca exact sonuç <3 iken ve `word_similarity >= 0.6` ile çalışıyor. Arama `<body>` ve gerçek chapter etiketi. Eski indeksler için `index-text --all --force`.
- Erişilebilirlik: modal odak tuzağı, tab/aria-current, skip link, `aria-busy`, reduced-motion eklendi; **tam WCAG 2.2 AA denetimi yapılmadı**.
- Prod'daki mayenit kitabı 2026-10-21'de `language='en'` yapıldı (İngilizce sözlükle kök arama çalışıyor). Ingest `--language` verilmezse sessizce `tr` yazar; İngilizce kitaplar için `--language en` şart.
- İçerik hakları ve gerçek yayıncı kitapları hâlâ yok.
- i18n kısmi: statik UI ve yaygın dinamik etiketler EN; bazı toast/doğrulama/yardım metinleri ve kitap metadata’sı çevrilmiyor.
- Grants: `010-grant-scope-key.sql` + `011-grant-audit.sql` uygulanmalı. Grant yoksa katalog eskisi gibi açık. Seat limit `users.max_sessions` ile birlikte çalışır (küçük olan geçerli). Grup subject yok; audit log API’de (`/api/grants/audit`) ve modalda kullanım sayacı var.

## Komutlar

```powershell
docker compose up -d --build
docker compose exec db psql -U akademik -d akademik -f /migrations/008-page-search.sql
docker compose exec db psql -U akademik -d akademik -f /migrations/009-epub-pages.sql
docker compose exec db psql -U akademik -d akademik -f /migrations/010-grant-scope-key.sql
docker compose exec db psql -U akademik -d akademik -f /migrations/011-grant-audit.sql
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
