# Project state — 2026-10-21

Bu dosya yeni bir oturumda bağlam taşımak için kısa hafızadır. Uzun konuşma geçmişini tekrar okumayın.

## Sürümler

- Web: **v51** (`spike/app/public/index.html`), stiller **v29**
- DB migration: **001–007** (`db/migrations/`)
- Prod: v51 + 007 doğrulandı (2026-10-21) — Caddy HTTPS, smoke **16/16** (tekrarlanabilir), seat limit 3 profil + 4. login 429; oturumlar temiz.
- Son commit: prod doğrulama (bu commit)
- EPUB kararı: **ADR-012** — MVP/V1a için epub.js, `EpubEngine` adapter arkasında, pinli; Readium/R2D2BC geçiş eşikleri yazılı.

## Çalışanlar

- PDF okuyucu: tek/çift sayfa/sürekli kaydırma, küçük resimler, TOC, arama, vurgu/not/etiket/tarih, yer imi, atıf, dışa aktarma, temalar.
- Auth: login, scrypt, CSRF, rate limit, session_version, user_sessions + seat limit (varsayılan 3).
- Erişim: kopyalama/indirme/yazdırma/filigran; `/api/books/:id/download`.
- Arama: sunucu sayfa indeksi (`asset_pages`), Türkçe karakter katlama, eşleşme sayısı; eşleşen alt dize `<mark>`.
- Pilot: `docker-compose.prod.yml`, Caddy TLS, yedek scriptleri, `docs/PILOT.md`, `docs/SMOKE.md`, `scripts/smoke.mjs`.

## Açık işler (sırayla)

1. **Arama kalitesi:** stemming/fuzzy/tam kelime; dil-duyarlı katalog araması.
2. **EPUB adapter + epub.js spike:** ADR-012 sözleşmesi; tek EPUB; CFI/vurgu/TOC/arama.
3. **Erişilebilirlik:** WCAG 2.2 AA, odak tuzağı, ekran okuyucu.
4. **Grant/entitlement:** koleksiyon/yayıncı görünürlüğü + seat limit entegrasyonu.
5. **500 MB / 2.000 sayfa:** fixture gelince performans; sürekli kaydırma belleği.
6. **Interop:** MARC21/OPDS/OAI-PMH/COUNTER.
7. **Mobil/PWA/offline**, sonra analitik/AI.

## Bilinen açıklar / riskler

- 500 MB fixture yok; 697 sayfa ölçümü `spike/measurement.md` (cold first page ~3–4 sn, hedef <2 sn).
- Sürekli kaydırmada zoom her seferinde 697 pane yeniden kuruyor; ağır olabilir.
- Eski oturumlar `sid` taşımadığı için yeniden giriş gerekir.
- Seat limiti aynı tarayıcı sekmelerinde artmaz; ayrı profil/tarayıcı gerekir.
- Demo modunda parola değiştirme/oturum iptali 501.
- OCR otomasyonu yok; hOCR manuel/CLI.
- İçerik hakları ve gerçek yayıncı kitapları hâlâ yok.

## Komutlar

```powershell
docker compose up -d --build
docker compose exec db psql -U akademik -d akademik -f /migrations/007-user-sessions.sql
node scripts/smoke.mjs http://localhost:8080
```

Prod:

```powershell
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.production exec db psql -U akademik -d akademik -f /migrations/007-user-sessions.sql
```

## Token tasarrufu kuralları

- Tek turda tek iş; “hepsini yap” deme.
- Önce bu dosyayı oku; eski konuşmayı özetleme.
- Hata çıktısının ilk 20 satırını ver; tam logu değil.
- Büyük dosyaları baştan okumam; hedefli `grep`/offset kullanırım.
- Uzun açıklama yerine kod + 3–5 satır özet.
- Her iş tek commit/push; GitHub limiti için batch.
