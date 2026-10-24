# v122 düzeltme retesti — HOLD — 2026-10-24

İncelenen uygulama commit'i **7fff4e07d50bf034bad11a819cc94a84ec3a56b0**, state commit'i **4d59377**. **Önceki F1/F2 düzeltmeleri gerçek app-role testinde geçti.** Ancak önceki incelemede açık bırakılan “kopyalanan ve silinen anahtar kümesi aynı mı?” kontrolü bir blocker üretti. Uygulama kodu değiştirilmedi; prod **v121**, migration 016 uygulanmadı.

## Tek blocker — iki ayrı seçim arasında 90 günlük eşiği geçen receipt tombstone'suz siliniyor

[purgeAnnotationReceipts](../spike/app/annotation-sync.mjs:86), aynı `stale` SELECT metnini iki ayrı SQL komutunda çalıştırıyor:

1. İlk SELECT → tombstone INSERT.
2. İkinci SELECT → receipt DELETE.

Her seçim `clock_timestamp()` ile yeni bir cutoff hesaplıyor. Tenant advisory lock başka bakım sürecini durdurur; geçen zamanı veya iki komut arasındaki seçim farkını durdurmaz.

Gerçek PostgreSQL, ayrıcalıksız uygulama rolü ve düzeltilmiş migration 016 ile:

| Gözlem | Sonuç |
|---|---:|
| İlk komutta tombstone'a taşınan receipt | **1** |
| İkinci komutta silinen receipt | **2** |
| Eşiği arada geçen ikinci receipt kaldı mı? | **Hayır, 0** |
| İkinci anahtarın tombstone'u var mı? | **Hayır, 0** |

A receipt'i 91 günlük, B receipt'i 90 günlük sınıra 5 saniye uzak olacak biçimde **test kopyasında** hazırlandı. İlk INSERT gerçek DB'de çalıştıktan sonra aynı transaction'da `pg_sleep(5.2)` ile süre geçişi oluşturuldu. Arada B satırı değiştirilmedi; gerçek saat ilerledi. İkinci SELECT B'yi de uygun saydı. İki sorgu arasında süre geçmesi uzun sorgu, bağlantı gecikmesi veya işlem duraklamasıyla da olabilir.

Bu kayıp, 365 günlük tombstone penceresinin sonundaki belgelenmiş sınır değildir: B için **hiç tombstone oluşmuyor**. Receipt ve tombstone birlikte kaybolduğu için eski işlem anahtarı artık tanınamaz; idempotency koruması erken kaybolur.

**Düzeltme:** uygun satır/anahtar kümesini bir kez seçip INSERT ve DELETE için aynı kümeyi kullanın; örneğin tek SQL/CTE veya transaction içinde bir kez alınmış sabit anahtar listesi. “Aynı SELECT metni” aynı satır kümesi garantisi değildir. Bu test düzeltilmiş kaynakta geçmeden deploy edilmemeli.

Eşik testi gözlemi transaction commit edilmeden denetlendi ve **rollback edildi**. Tüm test DB'si de cleanup'ta silindi.

## Önceki F1 — kapandı

- Taze read-only prod DB yedeği ayrı PostgreSQL'e restore edildi.
- Önce eski **c7f40db migration 016**, sonra düzeltilmiş **7fff4e0 migration 016 iki kez** uygulandı. 7 notun içerik özeti ve 2 asset korundu.
- Gerçek `akademik_app` rolü, **UPDATE izni false**: 91 günlük receipt **1 moved / 1 deleted**; içeriksiz tombstone var. 366 günlük tombstone gerçek app-role DELETE ile temizlendi.
- İki ayrı Node süreci: ilk transaction kilidi tutarken ikinci süreç **skipped=true**, silme **0**. Commit sonrası kilit serbest.
- Yalnız kopyada geçici DELETE yetkisi kaldırılarak gerçek SQL hatası üretildi: receipt korundu, yeni tombstone rollback oldu; yetki geri verilip temizlik geçti.
- **1.005** eski receipt için varsayılan batch: önce **1.000**, sonra **5**; her silinen anahtarın tombstone'u vardı. Bu test eşik anını kapsamaz; yukarıdaki ayrı test o yüzden gereklidir.

## Önceki F2 — kapandı

Sabit **933615a** v121 kaynaklarıyla ayrı gerçek HTTP sunucusu başlatıldı. Aktif tombstone'lu eski POST:

- v121 mutasyon modülünde **P0001**, transaction rollback.
- Gerçek v121 HTTP'de **500**; annotation sayısı artmadı, silinmiş not oluşmadı.
- Sonraki gerçek v122 HTTP aynı istek için **410** döndürdü; yeni receipt ile kirlenme olmadı.
- v121'de yeni işlem anahtarıyla oluşturma **201**, silme **200** geçti.

Bu koşu hem eski modülün gerçek SQL transaction'ını hem de ayrı v121 HTTP yolunu kapsar; önceki incelemedeki yalnız modül seviyesindeki kanıttan daha geniştir.

## v122 / Edge ve diğer doğrulamalar

- Normal POST/replay, PATCH sürüm 2, stale CAS 409, DELETE/replay geçti.
- Owner A receipt'ini okuyabildi, B okuyamadı; transaction-local kullanıcı ayarı temizlendi. Unset-user fallback devam ediyor.
- **Gerçek uygulama rolü purge'üyle** oluşturulan tombstone üzerinden aynı HTTP istek **410**, değişik payload **409**, silinmiş not korunmuş durumda.
- Gerçek Edge/IndexedDB: commit sonrası POST cevabı kontrollü kaybedildi → receipt yaşı fixture olarak 91 güne çekildi → **app-role purge** → gerçek HTTP **410** → taslak/çatışma kuyruğu korundu → reload ve conflict UI → açık yerel taslak kaldırma çalıştı. HTTP 410 mock veya elle tombstone INSERT kullanılmadı.
- Bağımsız **65/65 birim**, 0 fail. [TAP](reader-evidence/v122-retention-retest/units.tap.txt).
- Final sonuç **10/11**, **0 JS hatası**, cleanup **6/6**: [sonuç](reader-evidence/v122-retention-retest/44117f39-34b3-4251-974e-a9caacffe0c9/results.json).
- [Manifest](reader-evidence/v122-retention-retest/retest-manifest.json), [prod değişmedi](reader-evidence/v122-retention-retest/production-unchanged.json).
- [Tekrar çalıştırılabilir test](../spike/app/test/annotation-retention.retest.mjs): varsayılanda kendi taze read-only prod yedeğini alır; tüm mutation ve izin denemeleri ayrı test DB'sindedir. Backup Git dışında tutulur. Docker, Edge ve PLAYWRIGHT_MODULE gerekir.

365 günlük tombstone penceresi, rollback'teki kullanıcı RLS fallback'i ve tek süreçte 1.000/6 saat bakım kapasitesi önceki belgelenmiş sınırlar olarak sürer. Bu retest bu politikaları sınırsız garantiye veya kurumsal uygunluk onayına dönüştürmez.

**Karar:** F1/F2 kapanır; eşik anındaki anahtar kaybı düzeltilene kadar v122 **HOLD**. Bu turda prod migration/deploy yapılmadı.
