# 2026-11-01 — LibRead production kaydı (Oracle, v137)

> **Bu kayıt, 1 Kasım 2026 itibarıyla canlı okuyucunun güncel dayanağıdır.** Oracle'a
> geçişi anlatan `2026-10-30-oracle-cutover.md` tarihsel kalır; bu kayıt ondan sonraki
> durumu (v137, SSO, bridge, OA koleksiyonu) tutar. Değerler görüşme çıktılarından ve
> kullanıcının tarayıcı doğrulamasından alındı; bu belge hazırlanırken sunuculara
> bağlanılmadı. Sunucuda ölçümle uyuşmayan bir ad çıkarsa yeni ad uydurulmaz, bu kayıt
> düzeltilir.
>
> **Sır yok.** Token, parola, private key ve bağlantı dizesi bu dosyaya yazılmaz.

## 1. Sonuç

LibRead production'da çalışıyor. LibEdge ürün kartından okuyucuya geçiş kullanıcı
tarafından tarayıcıda doğrulandı. Tamamlananlar tekrar kurulmaz: Oracle taşıması, v137,
SSO, bridge, indirme yetki düzeltmesi, OA koleksiyonu, ürün kartı.

Kalan operasyon işi: düzenli otomatik ve sunucu dışı yedek
(`docs/runbooks/oracle-backup-restore.md`).

## 2. Canlı ortam

| Bileşen | Değer |
| --- | --- |
| Okuyucu | `https://elibrary.libedge.com/` |
| Sunucu | `ubuntu@92.5.157.233`, ARM64 |
| Canlı kök | `/home/ubuntu/libedge-oracle-v136` (ad tarihsel; Git checkout değil) |
| Web container | `libedge-oracle-v136-web` (ad tarihsel; **v137** çalıştırır) |
| İmaj | `libedge-oracle-v137:d85e3fb-arm64` |
| Uygulama kaynak SHA | `d85e3fb3abd632639d29d3d45b0a04733522e671` |
| DB container | `libedge-oracle-v136-db`, PostgreSQL 16 |
| Canlı DB adı | **`akademik`** (container'ın `POSTGRES_DB=postgres` değeri yanıltıcıdır) |
| Docker ağı | `libedge-oracle-v136`; DB takma adı `db` |
| DB volume | `libedge-oracle-v136-pgdata` |
| Portlar | `127.0.0.1:3001` ve `127.0.0.1:3004` → container `3000` |
| Başlatma | `docker run` (Compose değil); web `restart unless-stopped` |
| Tünel | `libedge-oracle-live-tunnel`, giriş `127.0.0.1:3001` |

### 2.1 Web container'ının üç env dosyası

Web yeniden oluşturulurken **üçü de** verilir; yalnız ilkiyle başlatmak SSO/bridge
entegrasyonunu ve katalog bağlantısını düşürür.

1. `/home/ubuntu/libedge-oracle-v136/config/web-runtime.env`
2. `/home/ubuntu/libedge-oracle-v137/releases/d85e3fb-20261031T203431Z/config/web-release.env` (katalog bağlantısı, sürüm bilgisi)
3. `/home/ubuntu/libedge-oracle-v137/config/production-integration/reader-integration.env` (SSO public ayarları, bridge tokenları)

`admin.env` web'e verilmez. Dotenv dosyaları shell ile `source` edilmez; DB URL
parolaları percent-encode edilir.

### 2.2 Mount'lar

| Host | Container | Erişim |
| --- | --- | --- |
| `/home/ubuntu/libedge-oracle-v136/data/uploads` | `/app/public/uploads` | RW |
| `/home/ubuntu/libedge-oracle-v136/data/ocr` | `/app/public/ocr` | RW |
| `/home/ubuntu/libedge-oracle-v136/seed` | `/app/public/seed` | RO |
| `/home/ubuntu/libedge-oracle-v136/backups` | `/backups` | RW |

### 2.3 DB rolleri

- Sahip/admin: `akademik`. Web: `akademik_app`. Katalog: `akademik_catalog`. Uygulama
  rolleri superuser/BYPASSRLS değildir.
- `DATABASE_URL` app, `DATABASE_CATALOG_URL` katalog, `DATABASE_ADMIN_URL` yalnız
  migration işlemleri içindir.
- Container'ın bootstrap parolası restore edilmiş sahibin gerçek parolasıyla eşleşmedi
  (`28P01`). Doğru admin bağlantısı orijinal korumalı config'den hazırlanıp doğrulandı.
  **Parolayı döndürerek çözmeye çalışma.**
- DB ağına `disconnect`/`connect` yapılmaz. Health 200, yanlış DB rolünü tek başına
  yakalamaz; rol kontrolü ayrıca yapılır.

### 2.4 SSO / bridge

Korumalı klasör: `/home/ubuntu/libedge-oracle-v137/config/production-integration`.
Public kid: `oracle-production-20261101-e30b39de8b7d`.

```text
LIBEDGE_SSO_ISSUER=https://libedge.com
LIBEDGE_SSO_AUDIENCE=https://elibrary.libedge.com
LIBEDGE_SSO_HANDOFF_URL=https://libedge.com/elibrary/handoff
LIBEDGE_SSO_SESSION_HOURS=12
```

Klasörde `reader-integration.env`, `reader-public-keys.json`, `worker-settings.env`,
`worker-private-key.txt`, `bridge-entitlements.token`, `bridge-catalog.token` bulunur.
Son üçünün değerleri paylaşılmaz; worker private key reader'a mount edilmez ve repoya
girmez. Production ve staging anahtar/tokenları ayrıdır.

Not: koddaki varsayılanlar (`libedge`, `elibrary.libedge.com`) production değerleri
**değildir**; production değerleri yukarıdadır ve env ile verilir.

## 3. Repo, migration, erişim

Repo: `picohook/akademik-platform`.

- Merge edilenler: #50 (SSO), #51 (indirme erişimi), #53 (abonelik FK sırası),
  #54 (runner/runbook), #55 (OA migration).
- #52 geçici birleşik denetim PR'ıydı; kapatıldı, merge edilmedi.
- #54 sonrası uygulama SHA `d85e3fb…`. #55 yalnız migration/test/belge içerdiğinden
  çalışan imajın d85 olması beklenir. #55 sonrası bilinen `main`:
  `9775ef76be87db8c398489dd133c75c2f435ac96`.
- 021/022/024/025/026/027 canlıya uygulandı; **023 daha sonra**. Registry toplamı
  **27**, en büyük dosya adı `027-reader-sso.sql`.
- Uygulanmış SQL, checksum ve registry değiştirilmez; baseline tekrarlanmaz;
  023/025/027 tekrar çalıştırılmaz.
- Runner'ın PL/pgSQL `end;` yanlış tespiti #54 ile düzeltildi (14 test).

### 3.1 OA verisi

| Varlık | UUID / karşılık |
| --- | --- |
| Staff tenant | `5799f2a5-3d90-41b1-90de-9da07d776052`, `staff/libedge` |
| Individual tenant | `b2c00000-0000-4000-8000-000000000001`, `individual/b2c` |
| OA koleksiyonu | `74149e93-39dd-50ba-b120-a75415d9b0ca` (LibEdge Open Academic Collection) |
| Individual grant | `b2c00000-0000-4000-8000-000000000002`, yalnız **collection** kapsamı |
| Demo work / koleksiyon | `33333333-…` / `66666666-…`, taşınmadı |

12 gerçek work, edition ve asset globaldir; OA koleksiyonunda tam 12 üye vardır.
Individual için `all` grant **yoktur**. Kullanıcı/not/ilerleme globalleştirilmedi.

`db/023-app.test.mjs` (95 kontrol), koleksiyon dışı 13. global kitapla daraltmayı
kanıtlar: katalogda yok, `/file` 404, ticket 403; grant `all` yapılınca açılır,
collection'a dönünce kapanır. Bridge yönetim kataloğunun tüm global metadata'yı
listelemesi okuma lisansı değildir.

İndirme issue ve consume, `/file` ile aynı `canAccessBook` kararını kullanır; consume
güncel yetkiyi yeniden değerlendirir. Grantsız kurum, başka kullanıcının ticket'ı,
iptal ve expiry sonrası eski ticket reddi staging'de gerçek abonelik/outbox zinciriyle
PASS aldı. Bu kontroller gevşetilmez.

## 4. Ürün kararı

| Alan | Karar |
| --- | --- |
| Ad | **LibRead** (LibBot gibi yazılır); teknik slug `libedge-elibrary` |
| Kategori | `Yapay Zeka` (`yapay-zeka`) — kullanıcı tercihi |
| Bölge | `Dünya` |
| Buton | Yalnız **Erişim Linki** |
| Hedef | `https://elibrary.libedge.com/auth/libedge/start?ctx=individual` |
| Üst menü | Bağımsız E-Kütüphane bağlantısı yok |

`ctx=individual` kasıtlıdır; OA koleksiyonuna bireysel erişim sağlar. Özetleme/açıklama
henüz uygulanmadığından üründe AI özelliği çalışıyormuş gibi vaat yazılmaz. Website
tarafı: `docs/LIBREAD-PRODUCTION.md` (`picohook/libedge-website`).

## 5. Yedekler ve rollback

Yedek **vardı**: manuel dump'lar, checksum doğrulaması, gerçek restore provaları.
Eksik olan **düzenli otomatik ve sunucu dışı güncel yedekti**; bu, aşağıdaki runbook ile
kapatılır.

| Yol | İçerik |
| --- | --- |
| `/home/ubuntu/libedge-migration/pre-v137-20261031T203431Z` | v137 öncesi |
| `/home/ubuntu/libedge-migration/pre-live-v137-20261031T204758Z` | canlıya almadan önce |
| `/home/ubuntu/libedge-oracle-v137/releases/oa-9775ef7-20261101T041647Z/backup/pre-live-20261101T041956Z` | OA migration öncesi (023 öncesi) |
| `/home/ubuntu/libedge-migration/cutover-20261030T003845Z-7dff6f78` | Eski AWS final paketi; PC'de checksum doğrulamalı kopya var |

OA öncesi yedek, sonrasındaki JIT kullanıcı/yazmaları **içermez**. Yeni yedeklerin
PC/R2'ye aktarımı henüz doğrulanmadı.

Korunan eski web container'ları (silme):

- `libedge-oracle-v136-web-prev-20261031T205209Z` — eski v136.
- `libedge-oracle-v136-web-before-sso-20261101T044231Z` — SSO öncesi v137.

## 6. Korunacak ortamlar

- **Reader staging:** `https://elibrary-oracle.libedge.com`, kök
  `/home/ubuntu/libedge-elibrary-staging`, web `libedge-elibrary-staging-web`,
  `127.0.0.1:3002`, DB `libedge-oracle-test-db-1` içinde `libedge_staging`, ağ
  `libedge-oracle-test_default`, tünel `libedge-oracle-tunnel`. Canlı tünelden farklıdır;
  "test konteyneri/tüneli" diye topluca silinmez.
- **AWS e-library** `i-0b0c3d5032408d855`: **stopped**, terminate edilmedi. `54.87.37.7`
  canlı adres değildir. Rollback saklama hedefi en az 6 Kasım 2026; tarih tek başına
  silme izni değildir (yeni geri yüklenebilir yedek ve sahiplik doğrulanmadan silinmez).
  EBS/snapshot maliyeti sürebilir.
- **Research / D-022** `i-0e21a600a0eeeca39`: ayrı kaynak, dokunulmaz.
