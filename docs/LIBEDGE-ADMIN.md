# LibEdge E-Kütüphane adaptörü

`spike/app/libedge-admin.mjs`, mevcut okuyucu PostgreSQL modeli üzerine dar bir
sunucular arası yönetim API'si ekler. Yeni katalog, dosya veya grant deposu kurmaz.
LibEdge'deki eş deponun `docs/ELIBRARY-ADMIN.md` belgesi veri sahipliği, API, staging
doğrulaması ve dağıtım sırasını ayrıntılı açıklar.

Runtime secret `LIBEDGE_ADMIN_TOKEN` en az 32 karakter olmalıdır; boşsa adaptör
kapalıdır. Production compose yalnız bu opsiyonel environment değerini geçirir.
Secret'ı frontend'e veya Git'e koymayın. TLS endpoint'i gerçek Worker'dan erişilebilir
olmalıdır. LibEdge Worker `E_LIBRARY_API_URL`, `E_LIBRARY_ADMIN_TOKEN` ve
`E_LIBRARY_READER_URL` kullanır. Bu çalışmada gerçek adres/secret verilmedi ve canlı
AWS bağlantısı doğrulanmadı; production deploy veya Actions çalıştırılmadı.

API tabanı `/api/libedge/v1`; Bearer service token yalnız bu tabanda kabul edilir.
`X-LibEdge-Tenant` mevcut tenant UUID'si, `X-LibEdge-Actor` doğrulanmış LibEdge admin
ID'sidir. Health hariç actor zorunludur. Bu kimlikler Worker'ın güncel D1 rol ve kurum
kontrolünden gelir. Service token tenant'lar arası yönetim sırrıdır; okuyucu kullanıcı
oturumu açmaz. Tarayıcıya geçmez.

- `GET health`: gerçek tenant/DB sorgusu, `mode=db`, bridge sürümü 1, runtime
  `APP_VERSION`, `BUILD_SHA`. Demo/DB yokluğu sağlıklı dönmez.
- `GET catalog`: `works → editions → assets` üzerinden gruplu görünüm.
- `GET collections`, `GET grants`, `GET grant-audit`: mevcut tablolar; son 50 audit.
- `PATCH works/:id`: mevcut eser metadata'sı ve açıkça belirtilen tek baskı.
  `title`, `language`, `cover_url`, `variant_group`, `edition_id`, `publisher`,
  `publication_year`, `edition`, `isbn13`. Asset kimlikleri/dosyaları değiştirilmez.
- `POST grants`, `PATCH grants/:id`: yalnız tenant subject + collection scope;
  `collection_id`, `valid_from`, `valid_to`, `status`. İptal status değişimidir,
  satır silinmez. Grant ve `grant_audit` before/after kaydı aynı transaction'dadır.

Tenant bağlamı transaction-local `set_config` ile kurulur; RLS atlanmaz. App DB rolü
tablo sahibi/superuser/BYPASSRLS olamaz. Ortak/global eserler adaptörde salt okunur.
Mevcut 001–016 migration'ları yeterlidir; yeni PostgreSQL migration'ı gerekmez.
Kapak ve gruplama mevcut `works.metadata.cover_url/variant_group` alanlarını kullanır.
Başlık benzerliğiyle otomatik birleştirme yapılmaz. Kapak URL'si HTTPS'tir; okuyucu
CSP'sinde HTTPS image izni ve referer göndermeyen img kullanılır. Yeni depolama yoktur.

`grant-policy.mjs` artık boş aktif grant listesini yalnız henüz hiç grant
yapılandırılmamış tenant için açık erişim sayar. Mevcut kalıcı
`tenants.download_grants_required` bayrağı kullanılır; son grant süresi dolduğunda,
geleceğe alındığında veya iptal edildiğinde çevrimiçi katalog, dosya, arama, OCR,
OPDS ve download yolları yeniden açılmaz. Başka geçerli grant erişim sağlayabilir.
Önceden indirilmiş/çevrimdışı kaydedilmiş kopyaların cihazdan geri alınması bu pakette yoktur.
Mevcut deployment tenant'ına bağlı giriş/provisioning/SSO bu değişiklikle yeniden kurulmadı.

Yerel kontroller (`spike/app`):

```text
node --test test/*.test.mjs
npm run test:security
```

Security testi kendi geçici PostgreSQL 16 konteynerini ve non-superuser app rolünü
oluşturur; gerçek bir mevcut DB kabul etmez. Metadata ve grant audit rollback'i,
tenant izolasyonu, asset/progress kimlikleri, süre sonu, ileri başlangıç ve iptal
gerçek HTTP + PostgreSQL üzerinden doğrulanır. Diğer izole testlerin server kaynak
kopyalama listelerine iki yeni server modülü eklendi.

Dosya kimliği düzeltmesi: okuyucunun PDF/EPUB, kitap içi arama, indirme ve paylaşım
bağlantıları work ID yerine asset ID kullanır. Çevrimdışı kitap anahtarı ve yerel
ilerleme anahtarı da asset ID'dir. IndexedDB v2→v3 geçişi eski kayıttaki gerçek
asset ID üzerinden blob'u taşır; notları ve bekleyen annotation işlemlerini korur.
Eski work düzeyi ilerleme dosyası belirsiz olduğundan başka dosyalara kopyalanmaz.
Önceden üzerine yazılarak kaybolmuş çevrimdışı dosyalar/ilerleme yeniden üretilemez.

`test/asset-identity.browser.mjs` gerçek Chromium IndexedDB geçişini ve aynı eserin
PDF/EPUB indirme/depolama ayrımını doğrular. Mevcut testlerle aynı şekilde, gerekirse
kurulu Playwright modülüne `PLAYWRIGHT_MODULE` environment değeriyle yol verilir.

Yerel sonuç: 69/69 birim testi, 107 HTTP/DB kontrolü içeren 4 güvenlik entegrasyon
senaryosu ve Chromium dosya/IndexedDB kimlik testi geçti. Canlı AWS doğrulaması yapılmadı.
