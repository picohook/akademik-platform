# Pilot kurulumu

Bu doküman tek sunuculu, tek kiracılı bir kurum pilotu içindir. Üretim sertleştirmesi için `docs/PLATFORM-SPEC.md` ve güvenlik açık maddeleri ayrıca kapatılmalıdır.

Sosyal DRM kapsamı uygulamadaki **İndir** ve yeni **Çevrimdışı ↓** kayıtlarıdır.
`/file` ve `/book.epub` okuyucu akışları oturum/grant kontrolüyle ham dosya verir;
yetkili okuyucu bunları kaydedebilir. **“Tüm kopyalar izlenebilir” veya “tüm
indirmeler filigranlı” taahhüdü verilmez.** Eski offline kopyalar geriye dönük
damgalanamaz. Güncel sınırlar ve migration 013–014: [SOCIAL-DRM.md](SOCIAL-DRM.md).

## 1. Gereksinimler

- Docker + Docker Compose
- Sunucuya açık **80/443** portları
- `DOMAIN` için DNS A kaydı (ör. `books.example.edu.tr`)
- Yedekler için ayrı disk veya uzak kopya

## 2. Ayarlar

```powershell
Copy-Item .env.production.example .env.production
```

`.env.production` içinde en az şunları doldurun:

- `DOMAIN`
- `POSTGRES_PASSWORD` — uzun rastgele
- `SESSION_SECRET` — en az 32 rastgele byte
- `BRAND_NAME`, `BRAND_TAGLINE`
- `DATABASE_URL` — ilk açılışta scaffold app parolasıyla; aşağıda rotate edilecek

`SESSION_SECRET` ve `POSTGRES_PASSWORD` için örnek üretim:

```powershell
-join ((48..57) + (65..90) + (97..122) | Get-Random -Count 48 | ForEach-Object { [char]$_ })
```

## 3. İlk açılış

```powershell
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.production ps
```

Caddy gerçek domainde otomatik TLS alır. `localhost` ile denerseniz Caddy internal CA kullanır; tarayıcı uyarısı normaldir.

Sağlık kontrolü:

```powershell
curl.exe https://books.example.edu.tr/api/health
```

## 4. Mevcut DB migration'ları

Taze volume `schema.sql` + `seed.sql` ile gelir. Daha önce açılmış bir volume varsa:

```powershell
docker compose -f docker-compose.prod.yml exec db psql -U akademik -d akademik -f /migrations/001-asset-pages.sql
docker compose -f docker-compose.prod.yml exec db psql -U akademik -d akademik -f /migrations/002-users-password.sql
docker compose -f docker-compose.prod.yml exec db psql -U akademik -d akademik -f /migrations/003-librarian-user.sql
docker compose -f docker-compose.prod.yml exec db psql -U akademik -d akademik -f /migrations/004-session-version.sql
docker compose -f docker-compose.prod.yml exec db psql -U akademik -d akademik -f /migrations/005-annotation-tags.sql
docker compose -f docker-compose.prod.yml exec db psql -U akademik -d akademik -f /migrations/006-access-policies.sql
docker compose -f docker-compose.prod.yml exec db psql -U akademik -d akademik -f /migrations/007-user-sessions.sql
docker compose -f docker-compose.prod.yml exec db psql -U akademik -d akademik -f /migrations/008-page-search.sql
docker compose -f docker-compose.prod.yml exec db psql -U akademik -d akademik -f /migrations/009-epub-pages.sql
docker compose -f docker-compose.prod.yml exec db psql -U akademik -d akademik -f /migrations/010-grant-scope-key.sql
docker compose -f docker-compose.prod.yml exec db psql -U akademik -d akademik -f /migrations/011-grant-audit.sql
docker compose -f docker-compose.prod.yml exec db psql -U akademik -d akademik -f /migrations/012-groups.sql
docker compose -f docker-compose.prod.yml exec db psql -U akademik -d akademik -f /migrations/013-download-tickets.sql
docker compose -f docker-compose.prod.yml exec db psql -U akademik -d akademik -f /migrations/014-download-ticket-limits.sql
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T db psql -v ON_ERROR_STOP=1 -U akademik -d akademik -f /migrations/015-annotation-sync.sql
```

**v121:** Önce taze yedek ve restore kopyasında doğrulama, sonra migration **015**'i DB admin ile uygulayın; ardından v121 web'i başlatın. Migration rollback'te korunur. Eski istemciler sürüm/işlem anahtarı olmadan yazamaz. Kuyruk geçişi, API ve kabul ayrıntıları: [ANNOTATION-SYNC-V121.md](ANNOTATION-SYNC-V121.md). Bu sıra mevcut volume yükseltmesi içindir; taze `schema.sql` zaten 015'i içerir.

## 5. App rolü parolasını değiştir

`schema.sql` scaffold parolası `akademik_app_dev` ile gelir. İlk açılıştan sonra değiştirin:

```powershell
docker compose -f docker-compose.prod.yml exec db psql -U akademik -d akademik -c "alter role akademik_app password 'YENI_GUCLU_PAROLA';"
```

`.env.production` içindeki `DATABASE_URL`'i güncelleyin:

```text
DATABASE_URL=postgres://akademik_app:YENI_GUCLU_PAROLA@db:5432/akademik
```

Sonra web'i yeniden oluşturun:

```powershell
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --force-recreate web
```

## 6. Demo hesapları ve içerik

Seed iki kullanıcı ve demo içerik oluşturur:

- `reader@example.edu.tr` / `demo1234`
- `librarian@example.edu.tr` / `demo1234`

Pilot öncesi:

1. Librarian ile giriş yapıp **Parola** ile parolayı değiştirin.
2. Reader hesabını silin veya parolasını değiştirin.
3. Demo kitapları kaldırın; yalnızca yazılı izinli içeriği yükleyin.
4. `seed.sql`'i üretimde kullanmayacaksanız ilk kurulumdan sonra kaldırın.

## 7. Duman testi

1. `https://DOMAIN` → login.
2. Librarian girişi; **+ Kitap ekle** ile test PDF'i yükle.
3. Okuyucuda sayfa geçişi, içindekiler, arama, vurgu, not, atıf.
4. Reader ile giriş: upload/düzenle butonları görünmemeli; API 403.
5. Parola değiştir → yeniden giriş.
6. İki tarayıcıda oturum aç → **Tüm cihazlardan çıkış** → diğer oturum 401.

## 8. Yedek ve geri yükleme

```powershell
.\scripts\backup.ps1
```

Bu komut `backups/` altına:

- `akademik-<zaman>.dump` — PostgreSQL custom dump
- `files-<zaman>.tgz` — `uploads/` + `ocr/`

Restore:

```powershell
.\scripts\restore.ps1 -Dump akademik-20261020-220000.dump
```

Dosya arşivi ayrıca:

```powershell
docker compose -f docker-compose.prod.yml exec -T web tar xzf /backups/files-<zaman>.tgz -C /app/public
```

Yedeği sunucu dışına kopyalayın; aynı diskte tek kopya yeterli değildir.

## 9. Bilinen sınırlar

- Tek kiracı; kurum başına ayrı kurulum.
- SSO/MFA yok; yerel parola.
- 500 MB / 2.000 sayfa performans testi yapılmadı.
- Otomatik OCR hattı yok; OCR hâlâ manuel/CLI.
- MARC/OPDS/COUNTER ve yayıncı entegrasyonları yok.
- Yedekler otomatik değil; zamanlanmış görev ekleyin.
- İçerik hakları ve lisanslar kurum sorumluluğundadır.

## 10. Go-live kontrolü

- [ ] TLS sertifikası geçerli
- [ ] `SESSION_SECRET` ve DB parolaları gerçek
- [ ] Demo kullanıcılar/parolalar değiştirildi
- [ ] Demo içerik kaldırıldı
- [ ] İlk yedek alındı ve geri yükleme denenmedi
- [ ] 697 sayfalık kitap açıldı, arama/vurgu/atıf çalıştı
- [ ] Reader rolüyle upload/düzenle 403
- [ ] Log ve disk izleme kuruldu
