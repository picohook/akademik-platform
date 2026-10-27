# E-Kütüphane — yapılacaklar

Son güncelleme: 2026-10-27. Canlı: elibrary.libedge.com **v132** (`8df115f`), mode `db`, tenant LibEdge `5799f2a5-…`.
Önce `docs/HANDOFF-2026-10-27.md` ve `docs/DEPLOY.md` okunmalı. Bir madde bitince buradan silinir veya "tamamlandı" altına taşınır.

## Tamamlandı (2026-10-27)

- v131 → v132: fail-closed yetki (#21) — her istek oturumdaki tenant'a bağlı, `grantAllows` boş listede `false`.
- Migration runner (#19): `db/migrate.mjs` + `schema_migrations`; 001–017 baseline, 018/019/020 runner ile uygulandı.
- 020 (#22): LibEdge tenant'ına `all` kapsamlı, süresiz grant (collection grant 12 kitap kapsıyordu; upload'lar koleksiyona eklenmiyor).
- Demo hesaplar silindi (017, #17). README canlı duruma göre yeniden yazıldı (#18).
- Yedek: `backups/pre-v132-20261027-1540.dump`. Geri dönüş: image `libedge-v131` + `.env.r2.bak-v131`.
- 26 Ekim kesintisinin kök nedeni: `LIBEDGE_IMAGE=... sudo docker compose` — sudo değişkeni siliyordu. Image adı artık `.env.r2` içinde `LIBEDGE_IMAGE`.

## 1. Hemen — dokümanlar

- PROJECT-STATE, HANDOFF, DEPLOY güncellemesi; `docs/deployments/2026-10-27-v132.md`.
- DEPLOY.md kuralları: image adı `.env.r2` `LIBEDGE_IMAGE` ile; sunucuda bir önceki sürüm dışında image tutulmaz (8 GB disk).

## 2. v133 — küçük PR'lar

- ~~**CSP:** `style-src`'ye `blob:`~~ — **v133'te yapıldı** (`spike/app/security-headers.mjs`), bkz. `docs/deployments/2026-10-27-v133.md`.
- `favicon.ico` (404) ve `<meta name="mobile-web-app-capable" content="yes">`.

## 3. İlk kurum / dış kullanıcıdan önce (zorunlu)

- `download-tickets` ve `/opds` hâlâ env tenant'ıyla kurulu → oturum tenant'ı (bugün reddeder, sızdırmaz).
- Zamanlayıcı işleri (download ticket süpürme, annotation retention) tek tenant varsayıyor → tüm tenant'lar üzerinde dönmeli.
- Upload edilen kitaplar koleksiyona eklenmiyor → collection grant'li kurumlarda yeni kitapların nereye düşeceği kararı.

## 4. SSO — LibEdge ile tek giriş

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