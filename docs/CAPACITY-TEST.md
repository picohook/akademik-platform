# Eşzamanlı kullanıcı kapasitesi testi

Kapasite ölçümü açık işler listesine eklendi. Mevcut fonksiyonel testlerden bir eşzamanlı kullanıcı garantisi çıkarılamaz. `scripts/load-capacity.mjs` bu ölçüm için ilk, izole API yük testi aracıdır; tam üretim kapasitesi kabulü henüz yapılmadı.

## Çalıştırma

Node.js 22+, Docker Desktop, yerelde `postgres:16-alpine` imajı ve `spike/app` bağımlılıkları gerekir. Araç imaj indirmez veya mevcut servise bağlanmaz.

```powershell
# Önce aracın kısa doğrulaması; kapasite sonucu değildir.
node scripts/load-capacity.mjs --run --stages 2 --duration 3 --books 2

# Planlanan basamaklar: her biri 30 saniyelik aktif API kullanımı.
node scripts/load-capacity.mjs --run --stages 10,25,50,100 --duration 30 --books 20

# Daha uzun gözlem; basamak başına üst sınır 120 saniye.
node scripts/load-capacity.mjs --run --stages 10,25,50,100 --duration 120 --books 20 --think-ms 1000
```

Seçenekler: `--stages` en fazla dört basamak, 1–100 kullanıcı; `--duration` 1–120 saniye; `--think-ms` 100–10000; `--timeout-ms` 1000–30000; `--books` 1–200; `--output` rapor klasörü. Varsayılan çıktı `tmp/load-capacity-<zaman>/results.json`.

## İzolasyon ve iş yükü

- Her çalıştırma yalnız kendisine ait, etiketli ve rastgele adlandırılmış PostgreSQL konteyneri başlatır. Veriler geçici bellektedir; port yalnız `127.0.0.1` üzerinde yayımlanır.
- Uygulama sunucusu ayrı geçici klasöre kopyalanır. Kaynak dosya SHA-256 değerleri raporlanır; mevcut dev/prod değiştirilmez. Dış hedef URL veya bağlantı dizesi seçeneği yoktur; ortamdan gelen `DATABASE_URL` kullanılmaz.
- Uygulama PostgreSQL'e süper kullanıcı olmayan `akademik_app` rolüyle, mevcut beş bağlantılı havuzla bağlanır; RLS devrededir.
- Her sanal okuyucu ayrı hesapla giriş yapar. Hesap başına bir oturum, kurum grant koltuk sınırı en yüksek test basamağı kadardır. Böylece tek hesap oturum limiti yük testini yanlışlıkla engellemez.
- Her basamakta girişler aynı anda başlatılır ve ayrı raporlanır. Sonrasında her kullanıcı sırayla katalog, katalog araması, indeksli kitap içi arama, PDF Range, ilerleme yaz/oku, not oluştur/düzenle/listele/sil işlemlerini yapar. Döngü sonunda düşünme süresi bekler. Bu, kapalı döngü modelidir; basamak kullanıcı sayısı aynı anda açık HTTP isteği sayısı değildir.
- HTTP durumuna ek olarak arama isabeti, Range boyutu, kaydedilen ilerleme ve not içeriği doğrulanır. Basamak sonunda oturumlar kapatılır; hata olan basamaktan sonra daha yüksek yük denenmez.
- Normal bitişte, hatada ve yakalanan kesme sinyalinde test sunucusu durdurulur, kimliği etiketten doğrulanan test konteyneri silinir ve geçici uygulama kaldırılır. Zorla süreç öldürülmesi veya Docker erişiminin kaybı temizliği engelleyebilir; bu durumda rapordaki `cleanup` alanına ve yalnız `akademik-capacity-` önekli konteynerlere bakılır.

## Raporun yorumlanması

Her uç için istek/hata sayısı, hata oranı, aktarılan bayt, p50/p95/p99 ve en uzun süre tutulur. Süre, yanıt gövdesinin tamamının alınmasını içerir. Giriş patlaması ve çıkış ayrı ölçülür. Node CPU, RSS ve event-loop p95 saniyelik örneklenir; PostgreSQL CPU/bellek bilgisi her basamak sonunda anlık Docker ölçümüdür.

`functionalPass`, tüm kullanıcıların giriş yapması ve doğrulanan HTTP işlemlerinin hatasız bitmesi anlamına gelir. **Bir performans SLA'sı veya üretim kapasitesi garantisi değildir.** Kabul edilebilir p95, hata oranı ve kaynak payı hedef kurumun kullanım beklentisiyle ayrıca belirlenmelidir. Uzun giriş gecikmesi varsa sırf okuma döngüsü hızlı diye basamak kabul edilmemelidir.

Bu ilk senaryo küçük altı sayfalık örnek PDF'yi kullanan sentetik katalogdur. Tarayıcı render, EPUB iframe, büyük taranmış PDF, indirmede filigran, TLS/proxy, gerçek ağ, mobil ve çevrimdışı senkronizasyonu ölçmez. İstemci, Node sunucusu ve Docker aynı bilgisayarı paylaşır; gerçek prod donanımıyla karşılaştırma yapılamaz. Satışta kapasite sözü vermeden önce temsilî lisanslı içerikle, ayrı yük üreticisiyle, hedef sunucuda ve kaynak gözlemiyle daha uzun kabul testi gerekir.

## Doğrulama kaydı — 2026-10-23

- `node --check scripts/load-capacity.mjs`: geçti.
- `node scripts/load-capacity.mjs --help`: geçti.
- Kısa smoke: 2 kullanıcı, 80 API isteği, 0 hata. Süre birimi düzeltmesinden sonra 2→3 kullanıcı / basamak başına 2 saniye: toplam 80 API isteği, 0 hata; geçici sunucu/veritabanı/klasör temizliği geçti.
- Ardından **tek** kısa tarama çalıştırıldı:

```powershell
node scripts/load-capacity.mjs --run --stages 10,25,50,100 --duration 10 --books 20
```

| Hedef kullanıcı | Giriş yapan | Giriş p95 | Okuma/not API isteği | API hata | API p95 | Sonuç |
|---|---:|---:|---:|---:|---:|---|
| 10 | 10 | 4.19 sn | 730 | 0 | 241.90 ms | Fonksiyonel geçti |
| 25 | 25 | 6.05 sn | 1590 | 0 | 357.16 ms | Fonksiyonel geçti |
| 50 | 49 | 9.99 sn | 1960 | 0 | 485.80 ms | Girişte 1/50 zaman aşımı; basamak başarısız |
| 100 | — | — | — | — | — | Önceki basamak başarısız olduğundan çalıştırılmadı |

50 kullanıcının aynı anda girişinde bir istek 10 saniyelik istemci zaman aşımına ulaştı. 49 kabul edilen kullanıcının API döngülerinde hata oluşmadı; bu, 50 kullanıcılık kabulün geçtiği anlamına gelmez. Kodda parola doğrulamasının `scryptSync` kullanması ve giriş koltuk kontrolünün tenant düzeyinde serileşmesi görüldü; hangisinin ne kadar etkili olduğu ayrıca profil çıkarılmadan kesinleştirilemez. Giriş p95, 10 ve 25 kullanıcıda da yüksektir; yalnız API p95'e bakıp bu basamaklara üretim kapasitesi denmemelidir.

Koşu başarısız basamakta beklenen biçimde `exit 1` ile sonlandı. Test sunucusu durduruldu, yalnız test konteyneri silindi, geçici uygulama kaldırıldı (`cleanup`: üçü de `true`). Dev/prod'a istek gönderilmedi ve deploy yapılmadı.

Ham rapor: [screening.json](capacity-evidence/2026-10-23/screening.json). Node `v22.16.0`, Windows, 8 mantıksal CPU, yaklaşık 16 GiB host RAM; test istemcisi ve Docker aynı hostta. Sunucu/indeks/arama modülü, örnek PDF ve şema/seed SHA-256 değerleri ham raporda kayıtlıdır. Bu kısa sentetik tarama **25 kişi üretimde sorunsuz çalışır** iddiasını doğrulamaz; sonraki iş eşzamanlı giriş gecikmesini gidermek ve temsilî hedef ortamda ölçmektir.

Kalıcı kanıtlar: [manifest/hashler](capacity-evidence/2026-10-23/manifest.json), [düzeltilmiş kısa smoke](capacity-evidence/2026-10-23/smoke.json).

## Asenkron scrypt sonrası aynı tarama — 2026-10-23

`7d0282e` parola doğrulamasını asenkron scrypt'e geçirdi. Bu değişikliği içeren `15401362210b91ba1338e2952e507c2e8bd03cf8` üzerinde yukarıdaki **aynı komut bir kez** çalıştırıldı; ek mikrotest veya ikinci yük koşusu yapılmadı. Çalışma ağacındaki sunucu dosyası sabit commit'in `9538b0a0d5e208ef63ad3e71c33bf97013fcdefb` Git blob'u ile eşleşti. Testin kopyaladığı sunucu SHA-256 değeri manifestte kaydedildi.

| Hedef | Önce giriş | Sonra giriş | Önce giriş p95 | Sonra giriş p95 | Önce API p95 | Sonra API p95 |
|---|---:|---:|---:|---:|---:|---:|
| 10 | 10/10 | 10/10 | 4.19 sn | 3.16 sn | 241.90 ms | 454.51 ms |
| 25 | 25/25 | 9/25 | 6.05 sn | 10.55 sn | 357.16 ms | 1262.67 ms |
| 50 | 49/50 | Çalıştırılmadı | 9.99 sn | — | 485.80 ms | — |
| 100 | Çalıştırılmadı | Çalıştırılmadı | — | — | — | — |

**Sonuç: iyileşme doğrulanmadı; kapasite kabulü başarısız.** 25 aynı anda giriş isteğinin 16'sı 10 saniyelik istemci zaman aşımına uğradı. Giriş yapabilen 9 kullanıcının 180 API isteği hatasızdı; 10 kullanıcı basamağında da 500 API isteği hatasızdı. 25 kullanıcı giriş kabulü başarısız olduğu için araç 50 ve 100 basamaklarını çalıştırmadan beklenen `exit 1` ile durdu. Sonraki tabloda API p95, kabul edilmiş kullanıcıların iş yükünü gösterir; 25 hedefi için önce 25, sonra yalnız 9 kullanıcı çalıştığından eşdeğer yük altında bir hız kıyası değildir.

Bu, ortak Windows/Docker hostunda sürüm başına tek kısa sentetik koşudur. Sonuçlardan asenkron scrypt'in tek başına kesin bir regresyona yol açtığı veya üretim kapasitesinin düştüğü çıkarılamaz. Scrypt'e geçiş bu ortamda giriş kabulünü iyileştirdi diye de raporlanamaz. Girişte parola hash'i beklenirken PostgreSQL havuz bağlantısının tutulması, tenant kilidindeki bekleme ve host kaynakları ayrı profil çıkarılarak incelenmelidir. Süre sınırı yükseltilmedi, test hesabı/koltuk kuralları değiştirilmedi.

Temizlik üç alanda da başarılıdır: test sunucusu durduruldu, test PostgreSQL konteyneri silindi, geçici uygulama kaldırıldı. Dev/prod'a yük verilmedi, uygulama/auth kodu değiştirilmedi ve deploy yapılmadı.

Yeni kalıcı kanıt: [ham sonuç](capacity-evidence/2026-10-23/async-scrypt-1540136/results.json), [commit, komut ve SHA-256 manifesti](capacity-evidence/2026-10-23/async-scrypt-1540136/manifest.json). Önceki ölçüm değiştirilmeden korundu.

## Havuz bağlantısını hash öncesi bırakma sonrası — 2026-10-23

`loginUser` yalnız kullanıcı satırını `withTenant` içinde alacak, ardından bağlantıyı bırakıp `verifyPassword` bekleyecek şekilde düzeltildi. Aynı izole **10/25/50/100 × 10 saniye**, 20 kitap komutu bir kez daha çalıştırıldı; ek mikrotest veya tekrar yük koşusu yapılmadı. Ölçüm sırasında kaynak, `1540136` tabanı üstünde **henüz commit edilmemiş sunucu değişikliğiydi**. Test edilen Git blob'u `28586273dbfe60779b60b466c442c544edf45c20`, ham sunucu SHA-256 değeri `cca2ed11efc65618c08da42acd38da654b48114f0f0875e4c80eb7c742002400`. Tam sunucu kopyası kanıt klasörüne kaydedildi; yalnız taban commit bu koşuyu yeniden üretmez.

| Hedef kullanıcı | Giriş yapan | Giriş p95 | API isteği | API hata | API p95 | Sonuç |
|---|---:|---:|---:|---:|---:|---|
| 10 | 10/10 | 0.476 sn | 1040 | 0 | 112.77 ms | Geçti |
| 25 | 25/25 | 1.086 sn | 1620 | 0 | 225.38 ms | Geçti |
| 50 | 50/50 | 2.637 sn | 1540 | 0 | 834.75 ms | Geçti |
| 100 | 100/100 | 5.182 sn | 2000 | 0 | 1093.98 ms | Geçti |

Girişlerde ve çıkışlarda da hata/zaman aşımı oluşmadı. Toplam **6200 API isteği** hatasız tamamlandı; test `exit 0` ile sonlandı. Önce yalnız async scrypt ile 25 basamağında 9/25 giriş kabulü ve 16 zaman aşımı görülürken, bağlantıyı erken bırakan bu sürümde tüm dört basamak kabul edildi. İlk senkron sürümde 50 girişten 49'u kabul edilmiş ve giriş p95 9.99 saniye olmuştu; son koşuda 50/50 kabul ve 2.637 saniye gözlendi.

**Bu kısa sentetik kabul geçti; üretimde 100 kişi sorunsuz çalışır garantisi değildir.** 100 hedefinde giriş p95 hâlâ yaklaşık 5.2 saniye, API p95 yaklaşık 1.1 saniyedir. Basamaklar 10 saniyelik aktif kullanım hedefidir; başlamış döngüler tamamlanana kadar gözlem biraz daha sürer. Kaynaklar ortak hostta olduğundan koşular arası farklar tek başına kontrollü performans deneyi sayılmaz. Büyük PDF, gerçek ağ, tarayıcı render ve uzun süreli kullanım sınırlamaları geçerlidir.

Temizlik üç alanda da başarılı: geçici uygulama durdu, yalnız test veritabanı konteyneri silindi, geçici klasör kaldırıldı. Bu ölçüm görevi uygulama veya auth koduna müdahale etmedi; dev/prod'a yük verilmedi ve deploy yapılmadı.

Kalıcı kanıt: [ham sonuç](capacity-evidence/2026-10-23/pool-release-wip-2858627/results.json), [kaynak ve hash manifesti](capacity-evidence/2026-10-23/pool-release-wip-2858627/manifest.json), [test edilen sunucu dosyası](capacity-evidence/2026-10-23/pool-release-wip-2858627/server.mjs).

Ölçümden sonra aynı sunucu değişikliği **`8e1347c60d1b3f1009b0fff1684f377fb4ff32e6`** olarak commit edildi. Commit'teki sunucu Git blob'u yukarıdaki `28586273…` ile aynıdır; kanıt klasörünün `wip` adı, ölçüm sırasındaki durumu korur. Ayrıca bu kodla PostgreSQL güvenlik entegrasyonu **3 senaryo / 60 HTTP/DB kontrolü** geçti: publisher izolasyonu, grant sorgusu hatasında kapalı kalma ve iki süreçten eşzamanlı kullanıcı/tenant oturum sınırları. Parola doğrulaması sırasında havuz bağlantısı tutulmaz; oturum sayımı/insert transaction'ı ve advisory lock korunur. [Güvenlik çıktısı](capacity-evidence/2026-10-23/pool-release-wip-2858627/security-validation.txt). Ardından v116 canlıya alındı; [dağıtım kaydı](deployments/2026-10-23-v116.md).
