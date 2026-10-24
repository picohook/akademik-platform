# v122 receipt hardening — nihai teknik kabul — 2026-10-24

**PASS — HOLD kaldırıldı.** Test edilen uygulama commit'i **4300f1f8d742229f245e891055281b1b6784e0e6**, state **2e6713a**. Önceki purge izin/RLS, v121 rollback ve eşik anında tombstone'suz receipt silme bulguları kapandı. **Prod hâlâ v121; migration 016 veya deploy yapılmadı.**

## Sonuç

- Gerçek PostgreSQL / ayrıcalıksız app rolü / iki Node süreci / gerçek v121 HTTP / Edge-IndexedDB kabulü: **11/11**.
- Bağımsız birim regresyonu: **65/65**, 0 fail.
- JS hatası **0**; cleanup **6/6**.
- Testin başı/sonunda uygulama kaynak hash'leri aynı; incelenen uygulama koduna müdahale edilmedi.

[Final sonuç](reader-evidence/v122-retention-final/01aa91f7-f18d-4096-bca6-441b83f25271/results.json), [TAP](reader-evidence/v122-retention-final/units.tap.txt), [manifest](reader-evidence/v122-retention-final/acceptance-manifest.json), [prod değişmedi](reader-evidence/v122-retention-final/production-unchanged.json).

## Eşik anı — kapanan son blocker

A receipt'i 91 günlük, B receipt'i 90 günlük sınıra 5 saniye uzak hazırlandı. İlk tombstone INSERT'ten sonra aynı DB transaction'ında kontrollü `pg_sleep(5.2)` ile gerçek saat ilerletildi; B satırı arada değiştirilmedi.

| Kontrol | Sonuç |
|---|---|
| İlk purge | **1 moved / 1 deleted** |
| Arada eşiği geçen B | **Receipt yerinde kaldı**; ilk seçime sonradan eklenmedi |
| Sonraki purge | **1 moved / 1 deleted** |
| A ve B tombstone sayısı | **2** |
| İkinci purge sonrası kalan A/B receipt | **0** |

İkinci purge aynı transaction içinde tekrar çağrıldı; her iki anahtarın tombstone'u gerçek app-role sorgusuyla doğrulandı. Probe sonunda transaction rollback edildi; test kopyası cleanup'ta silindi. Eski 7fff4e0 koşusundaki **1 moved / 2 deleted / B tombstone 0** artık oluşmadı. 4300f1f, INSERT ve DELETE için tek SELECT'ten alınmış aynı tenant/user/operation dizilerini kullanıyor.

## Diğer 10 kontrol

1. **Restore/migration:** Taze read-only prod DB yedeği ayrı PostgreSQL'e restore edildi. Önce c7f40db'nin 016'sı, ardından son kaynaktaki 016 iki kez uygulandı. 7 notun içerik özeti ve 2 asset korundu.
2. **Normal mutasyon:** POST/replay, PATCH sürüm 2, stale CAS 409, DELETE/replay.
3. **Kullanıcı RLS:** A kendi receipt'ini okur, B okuyamaz; transaction-local kullanıcı ayarı temizlenir. Unset-user fallback'in tenant erişimi sürer.
4. **App-role purge:** UPDATE izni olmadan 91 günlük receipt **1/1** taşınır/silinir; içeriksiz tombstone oluşur. 366 günlük tombstone app-role DELETE ile temizlenir.
5. **İki Node süreci:** İlk transaction tenant advisory lock'u tutarken ikinci ayrı Node süreci `skipped=true`, silme 0 döndürür. Commit sonrası lock serbest kalır.
6. **Atomiklik:** Yalnız test kopyasında DELETE yetkisi geçici kaldırılır; gerçek SQL hatasında receipt kalır ve yeni tombstone rollback olur. Yetki geri verilip temizlik geçer.
7. **Batch:** 1.005 eski receipt → önce **1.000**, sonra **5**. Her silinen anahtar için tombstone doğrulanır.
8. **Gerçek v121 HTTP rollback:** Sabit 933615a kaynaklarıyla açılmış ayrı sunucuda tombstone'lu eski POST **500** alır; eski mutasyon kodunun gerçek transaction'ında **P0001** görülür. Not sayısı artmaz. Sonraki v122 HTTP hâlâ **410** döndürür. v121'de yeni anahtarla oluşturma **201**, silme **200** geçer.
9. **v122 HTTP:** Gerçek app-role purge'üyle oluşan tombstone aynı istek için **410**, farklı payload için **409** verir; silinmiş not yeniden oluşmaz.
10. **Edge/IndexedDB:** Gerçek POST commit olur, cevap kontrollü kaybedilir → receipt fixture yaşı 91 güne çekilir → **gerçek app-role purge** → gerçek HTTP **410** → taslak ve conflict kuyruğu korunur → reload → conflict açıklaması ve açık yerel taslak kaldırma çalışır. HTTP 410 mock veya elle tombstone INSERT kullanılmadı.

İki Node ve Edge profilleri aynı host üzerindedir; kapasite veya fiziksel iki cihaz garantisi değildir. Yalnız hata deneyi için clone DELETE yetkisi değiştirildi. Prod'da mutation, migration, imaj değişimi veya servis restart'ı yapılmadı. Backup içeriği Git'e alınmadı; yalnız adı/hash'i kanıtta bulunur.

## Tekrar çalıştırma

[annotation-retention.retest.mjs](../spike/app/test/annotation-retention.retest.mjs) Docker PostgreSQL 16, Edge ve PLAYWRIGHT_MODULE gerektirir. Kendi geçici DB/sunucularını oluşturur; prod'a yalnız read-only inspection/pg_dump erişimi vardır.

~~~powershell
node spike/app/test/annotation-retention.retest.mjs
~~~

## Devam eden belgelenmiş sınırlar ve deploy

90 günlük receipt / sonrasındaki 365 günlük tombstone varsayılanları sınırlı bir deduplication penceresidir. Tombstone da silinince çok eski işlem kanıtı kalmaz. Unset-user rollback fallback'inde kullanıcı bazlı RLS yoktur; tombstone'lu eski anahtar v121'de 410 yerine 500 alır. Tek süreçte 1.000/6 saat bakım kapasitesi ve backlog izlemesi ayrıca işletilmelidir. Bu kabul, bu sınırları sınırsız idempotency veya kurumsal saklama uygunluğu onayına dönüştürmez.

**v122 teknik olarak deploy'a hazırdır; bu tur yalnız retest yapıldı.** Dağıtımda taze yedek → restore kontrolü → DB admin ile 016 → sabit 4300f1f imajı → smoke + normal not/PATCH/DELETE + 410/offline kabul sırası korunmalı. APP_VERSION/BUILD_SHA dağıtım sırasında güncellenir; mevcut .env.production değiştirilmedi. v121 rollback imajı korunmalı; **016 geri alınmamalı**.
