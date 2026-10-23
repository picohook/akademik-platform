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
