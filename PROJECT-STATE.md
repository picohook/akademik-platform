# Project state — 2026-10-21

Bu dosya yeni bir oturumda bağlam taşımak için kısa hafızadır. Uzun konuşma geçmişini tekrar okumayın.

## Sürümler

- Web: **v59** (`spike/app/public/index.html`), stiller **v35**
- DB migration: **001–008** (`db/migrations/`)
- Prod: **v52 + 008** deploy edildi (2026-10-21) — Caddy HTTPS, smoke **16/16**; kök/tam kelime/bulanık prod'da doğrulandı.
- Son commit: dil düzeltmesi (bu commit)
- EPUB kararı: **ADR-012** — MVP/V1a için epub.js, `EpubEngine` adapter arkasında, pinli; Readium/R2D2BC geçiş eşikleri yazılı.

## Çalışanlar

- PDF okuyucu: tek/çift sayfa/sürekli kaydırma, küçük resimler, TOC, arama, vurgu/not/etiket/tarih, yer imi, atıf, dışa aktarma, temalar.
- Yükleme/silme: PDF + EPUB upload; yalnızca `source_system='upload'` kitaplar librarian/admin/publisher tarafından silinebilir; DB cascade + dosya silme.
- EPUB: `.epub` upload/format algılama; ana okuyucuda `EpubEngine` ile açılıyor (TOC, tema, ilerleme/CFI, bölüm içi arama). Not/vurgu oluşturma ve CFI arama indeksi henüz yok; EPUB indirme 501.
- Auth: login, scrypt, CSRF, rate limit, session_version, user_sessions + seat limit (varsayılan 3).
- Erişim: kopyalama/indirme/yazdırma/filigran; `/api/books/:id/download`.
- Arama: sunucu sayfa indeksi (`asset_pages`); diakritik katlama, **tam kelime**, **bulanık** (pg_trgm), **kök** eşleşmesi (tr/en FTS, `text_tsv`/`text_tsv_en`); dil-duyarlı katalog araması (`works.language`), eşleşme sayısı + tür etiketi (`exact`/`folded`/`word`/`stem`/`fuzzy`).
- Pilot: `docker-compose.prod.yml`, Caddy TLS, yedek scriptleri, `docs/PILOT.md`, `docs/SMOKE.md`, `scripts/smoke.mjs`.

## Açık işler (sırayla)

1. **EPUB CFI not/vurgu + arama indeksi:** seçimden CFI üret, notu CFI ile sakla, EPUB metnini ayrı indeksle.
2. **WCAG 2.2 AA denetimi:** odak tuzağı/klavye/aria temel olarak eklendi; ekran okuyucu ve kontrast denetimi kaldı.
3. **Grant/entitlement:** koleksiyon/yayıncı görünürlüğü + seat limit entegrasyonu.
4. **500 MB / 2.000 sayfa:** fixture gelince performans; sürekli kaydırma belleği.
5. **Interop:** MARC21/OPDS/OAI-PMH/COUNTER.
6. **Mobil/PWA/offline**, sonra analitik/AI.

## Bilinen açıklar / riskler

- 500 MB fixture yok; 697 sayfa ölçümü `spike/measurement.md` (cold first page ~3–4 sn, hedef <2 sn).
- Sürekli kaydırmada zoom her seferinde 697 pane yeniden kuruyor; ağır olabilir.
- Eski oturumlar `sid` taşımadığı için yeniden giriş gerekir.
- Seat limiti aynı tarayıcı sekmelerinde artmaz; ayrı profil/tarayıcı gerekir.
- Demo modunda parola değiştirme/oturum iptali 501.
- OCR otomasyonu yok; hOCR manuel/CLI.
- EPUB okuyucu tarayıcıda otomatik test edilmedi; not/vurgu oluşturma ve EPUB metin indeksi yok. EPUB indirme 501. v59: EPUB.js’e `.epub` uzantılı URL veriliyor (`/api/books/:id/book.epub`), aksi hâlde `META-INF/container.xml` isteyip 404 alıyordu; hâlâ boşsa konsol + `#epubView iframe` çıktısı gerekli.
- Erişilebilirlik: modal odak tuzağı, tab/aria-current, skip link, `aria-busy`, reduced-motion eklendi; **tam WCAG 2.2 AA denetimi yapılmadı**.
- Prod'daki mayenit kitabı 2026-10-21'de `language='en'` yapıldı (İngilizce sözlükle kök arama çalışıyor). Ingest `--language` verilmezse sessizce `tr` yazar; İngilizce kitaplar için `--language en` şart.
- İçerik hakları ve gerçek yayıncı kitapları hâlâ yok.

## Komutlar

```powershell
docker compose up -d --build
docker compose exec db psql -U akademik -d akademik -f /migrations/008-page-search.sql
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
