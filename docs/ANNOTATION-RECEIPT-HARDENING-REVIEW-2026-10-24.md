# v122 bağımsız inceleme — HOLD — 2026-10-24

**4300f1f nihai güncelleme: PASS.** Aşağıdaki tarihsel blocker’lar gerçek app-role/HTTP/Edge kabulünde kapandı: **11/11**, birim **65/65**. Prod v121 değişmedi. [Güncel nihai kabul](ANNOTATION-RECEIPT-HARDENING-ACCEPTANCE-2026-10-24.md).


**7fff4e0 retest güncellemesi:** Aşağıdaki c7f40db F1/F2 bulguları gerçek app-role/HTTP testinde kapandı. Purge eşik anında yeni bir anahtar kaybı nedeniyle genel HOLD sürüyor. [Güncel retest](ANNOTATION-RECEIPT-HARDENING-RETEST-2026-10-24.md).

İncelenen commit: **c7f40db206b896142172173e548da9b03c5a4d88**. Uygulama kodu değiştirilmedi. **Prod v121; migration 016 veya deploy yapılmadı.** v122 için önerilen koşullu PASS, aşağıdaki gerçek PostgreSQL bulguları nedeniyle verilemez.

## F1 — Purge uygulama rolüyle çalışmıyor (blocker)

[annotation-sync.mjs](../spike/app/annotation-sync.mjs:94) receipt seçimini `FOR UPDATE SKIP LOCKED` ile yapıyor. [Migration 016](../db/migrations/016-annotation-receipt-retention.sql:52) ise yalnız SELECT/INSERT/DELETE veriyor; UPDATE izni veya UPDATE policy'si eklemiyor.

Taze prod yedeği restore edilip 016 iki kez uygulanan kopyada, gerçek `akademik_app` rolü ve `app.maintenance=on` transaction'ı ile:

1. Değiştirilmemiş izinlerde: **42501 permission denied for table annotation_operations**.
2. Yalnız kopyada geçici UPDATE izni eklenince: **0 moved / 0 deleted**; 91 günlük uygun receipt kalıyor. UPDATE RLS policy'si de eksik.
3. Yalnız kopyada UPDATE izni + maintenance UPDATE policy'si eklenince: **42501 new row violates row-level security policy for table annotation_operation_tombstones**. Tombstone SELECT policy'si `app.user_id` ister, maintenance istisnası yoktur; INSERT ... RETURNING yolu görünürlük kontrolünden geçemez.

Geçici izin/policy değişiklikleri yalnız test kopyasında yapılıp geri alındı. Prod'a ek yetki verilmedi. Sadece GRANT UPDATE eklemek yeterli değildir: kilit/UPDATE RLS ve tombstone bakım görünürlüğü birlikte düzeltilmeli. Bu halde 90 günlük içerik temizleme taahhüdü çalışmaz. Tombstone silme yolu da bakım bağlamında ayrıca sınanmalı.

## F2 — v121 rollback sonrası idempotency bozuluyor (blocker)

016 tablo olarak additive olsa da, purge edilmiş işlemler açısından v121'e yazılabilir rollback güvenli değildir. v121 `annotation_operations` okur; yeni tombstone tablosunu kontrol etmez.

Silinmiş bir notun eski POST anahtarı için tombstone hâlâ aktifken gerçek DB sonucu:

| Çalıştırılan kod | Aynı POST sonucu |
|---|---|
| v122 HTTP | **410 operation_expired** |
| Sabit 933615a v121 mutasyon modülü | **201**, yeni annotation ID; silinmiş not yeniden oluşur |
| Yeniden v122 HTTP | **201**, rollback sırasında yazılmış yeni receipt replay edilir |

v121 modülü Git'ten sabit commit ile alınıp gerçek ayrıcalıksız PostgreSQL transaction'ında, v121'in unset-user bağlamıyla çalıştırıldı. İkinci bir v121 HTTP sunucusu başlatılmadı; v122'nin öncesi/sonrası gerçek HTTP'dir.

Çözüm: tombstone protokolünü bilen bir rollback sürümü veya rollback sırasında eski annotation mutasyonlarını engelleyen bir koruma. Salt okunur rollback seçeneği de açıkça tasarlanabilir. “v121 çalışır; sadece kullanıcı RLS kaybolur” açıklaması eksiktir. Migration'ı geri almak önerilmez.

## F3 — Tombstone penceresi sonrası eski POST yeniden kabul ediliyor (belgelenmiş sınır / ürün kararı)

Tombstone'un `purged_at` yaşı kontrollü biçimde 366 güne çekilip mevcut bakım fonksiyonu DB admin bağlamında çalıştırıldı; aynı silinmiş POST **201** ile yeni not oluşturdu. Bu test uygulama rolündeki purge hatasını geçmek için yalnız kopyada admin kullanır; app-role purge'ün çalıştığını kanıtlamaz.

Bu sınır yazarın dokümanında zaten yazılıdır; yeni veya gizlenmiş bir bulgu değildir. Varsayılanda tombstone süresi receipt'in kaldırıldığı andan itibaren 365 gündür (normal akışta ilk 90 güne ek). Ancak eski istek için sunucunun doğrulayabildiği bir zaman/epoch alt sınırı yoktur; yalnız UUID anahtarı taşır. “En fazla şu kadar offline kalın” açıklaması sunucuda eski POST'u reddetmez.

Pencere sonrası yeniden uygulama kabul edilecekse idempotency güvencesi açıkça bu pencereyle sınırlandırılmalı. Kabul edilmeyecekse eski anahtarı reddeden doğrulanabilir bir protokol veya kalıcı içeriksiz işlem izi gerekir. Bu inceleme saklama süresinin kurumsal uygunluğunu onaylamaz.

## Diğer sınırlar

- Kullanıcı ayarı verildiğinde owner A'nın receipt'i A'ya görünür, B'ye görünmez; transaction sonunda ayar temizlenir. **Unset-user fallback tenant erişimini sürdürüyor**; kullanıcı RLS'i bütün SQL yolları için fail-closed değildir.
- Tek koşu en fazla 1000 receipt, 6 saatte bir: tek süreç için nominal 4000 receipt/gün. Backlog/delay ölçülmeden “her içerik tam 90 günde silinir” denemez. Uyarı/izleme ve batch boşaltma stratejisi ayrıca doğrulanmalı.
- Kopyalama ve silmenin aynı anahtar kümesiyle yapıldığı, batch sınırında ve iki bakım sürecinde ayrıca test edilmeli. Bu koşu eşzamanlı purge güvenliğini onaylamaz.

## Geçen doğrulamalar

- **64/64 birim**, 0 fail: [TAP](reader-evidence/v122-retention-review/units.tap.txt).
- Taze prod yedeğinde migration 016 **iki kez**; 7 notun içerik hash'i ve 2 asset korundu.
- Normal POST/replay, PATCH/version 2, stale 409, DELETE/replay.
- Kullanıcı bazlı SELECT ve transaction-local ayar reset'i.
- Elle DB'ye konmuş gerçek tombstone üzerinden HTTP **410 / farklı hash 409**; silinmiş not v122'de yeniden oluşmadı.
- Gerçek Edge/IndexedDB: commit olmuş POST cevabı kontrollü kaybedildi → admin ile tombstone'a taşındı → gerçek HTTP 410 → taslak + conflict kuyruğu korundu → reload → açıklama ve “Yerel taslağı kaldır” çalıştı. **410 sonucu HTTP mock değildir; tombstone hazırlığı admin fixture'ıdır. Purge'ün geçtiği iddiası yoktur.**
- Final koşu 10 kontrol/diagnostic içinde bir başarısız kabul ve dokuz başarılı doğrulama/repro: **genel sonuç FAILED/HOLD**. Bug'ı yeniden üreten diagnostic PASS'leri ürün kabulü sayılmaz. 0 JS hatası; cleanup **5/5**.
- [Final sonuç](reader-evidence/v122-retention-review/d3816c7f-fc67-463d-8f42-cfbd4bc676d9/results.json), [ilk koşu](reader-evidence/v122-retention-review/61f98f59-2e66-4a09-82c7-ec5c7cdb39c3/results.json), [manifest](reader-evidence/v122-retention-review/review-manifest.json), [prod değişmedi](reader-evidence/v122-retention-review/production-unchanged.json).

## Tekrar çalıştırma ve kapanış

[annotation-retention.integration.mjs](../spike/app/test/annotation-retention.integration.mjs) kendi PostgreSQL konteyneri/iki geçici sunucusu/Edge profilini oluşturur. İlk koşu prod'dan yalnız read-only pg_dump alır; sonra tüm mutation ve izin denemeleri test kopyasındadır. Ham backup Git dışında kalır. `--reuse-backup <backups/...dump> <sha256>` yalnız doğrulanmış, backups içindeki bu inceleme yedeğini yeniden kullanır. Playwright için PLAYWRIGHT_MODULE ve Edge gerekir.

F1/F2 düzeltildikten sonra restore kopyasında gerçek app-role purge, rollback, batch/iki süreç ve HTTP/Edge regresyonu geçmeden deploy edilmemeli. **Bu turda uygulama kodu/migration düzeltilmedi veya prod'a uygulanmadı; yeniden üretilebilir test, kanıt ve inceleme kaydı eklendi.**
