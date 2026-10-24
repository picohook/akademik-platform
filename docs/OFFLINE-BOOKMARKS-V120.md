# Çevrimdışı yer imi kuyruğu — v120

2026-10-24. Kaynak v120, CSS v44, SW shell v12. Prod v120; app-only dağıtım tamam. PostgreSQL migration veya IndexedDB sürüm değişikliği yok.

## Davranış

- PDF yer imi fiziksel sayfayı; EPUB yer imi CFI, href ve yüzdeyi saklar. Ekleme, yerel kayıt ve create kuyruğunu aynı IndexedDB transaction'ında yazar. Online kullanım da aynı yolu izler; bağlantı/oturum varsa arka planda gönderir.
- Gönderilmemiş yer imini tekrar kaldırmak create işlemini iptal eder. Sunucuda bulunan yer imini offline kaldırmak canonical server_id ile DELETE kuyruklar. Tombstone, eski GET cevabından kaydın yeniden görünmesini engeller.
- POST onayı ile UI yenilemesi arasındaki silme yarışı düzeltildi: silme güncel yerel satırı aynı transaction içinde okuyarak yeni server_id'yi bulur. Devam eden POST sırasında silme için mevcut telafi DELETE yolu korunur.
- Offline hard reload yer imlerini korur; panelden fiziksel sayfa/CFI'ya dönülür. Başarılı eşitleme yerel id'yi korur, pending durumunu temizler. 401/403/429/500 ve bağlantı hataları kuyruğu silmez.
- Login formunda tekrar giriş artık mevcut kullanıcı kuyruğunu da başlatır. Önbellek okuyucusunda online ekleme/silme eşitlenir. Başka kitap/hesaba geçildiyse arka plan sonucu aktif okuyucuya uygulanmaz; açık not düzenleyicisi korunur.
- Kimlik yoksa yeni yer imi oluşturulmaz. Yerel okuma yalnız tam ownerId eşleşmesini döndürür. Başka hesap A'nın kuyruğunu göndermez; eski sahibisiz kayıtların gizlenmesi ve çıkışta kimlik temizliği v119'daki gibi korunur.
- PDF'te zaten açık olan sayfaya gezinme yeniden render başlatmaz; aynı yer imine tekrar tıklamanın yarattığı gereksiz canvas render yarışı önlenir.

## Kabul

Uygulayan ajanın testidir; bağımsız reviewer onayı bekler. Prod/dev servislerine dokunulmadı.

- Ayrı PostgreSQL 16, ayrıcalıksız uygulama rolü (superuser/bypassrls false), gerçek Edge/IndexedDB/SW: **17/17**, **0** JS hatası, cleanup **4/4**. [Sonuç](reader-evidence/v120-offline-bookmarks/37effe27-cd1e-402c-9527-bbacd108e606/results.json).
- Önceki offline not düzenleme/gizlilik regresyonu, ayrı demo sunucusu ve Edge'de: **20/20**, **0** JS hatası, cleanup **3/3**. [Sonuç](reader-evidence/v120-offline-edit/8105ddd9-7895-4012-8adb-0b55cdb1c01d/results.json). Bu ikinci koşu PostgreSQL kanıtı değildir.
- Kaynak hash'leri her koşunun başı/sonunda eşleşir. [Ortak kabul manifesti](reader-evidence/v120-offline-bookmarks/acceptance-manifest.json). Üç başarısız yer imi ara koşusu ve önceki not regresyonları ham sonuçlarıyla korunur; final kabul yerine sayılmaz.

17 senaryo: gerçek biletli offline PDF/EPUB blob'ları (2), SW12 shell (1), her formatta gönderilmemiş ekle→kaldır (2), offline ekle→reload→panelden dönüş→tek onaylı POST (2), offline sil→eski GET→reload→gerçek DELETE (2), önbellek okuyucusunda online ekle/sil (2), kontrollü HTTP hataları ve gerçek PostgreSQL retry + eski UI alias'ıyla silme (1), B hesabında A'nın bekleyen kuyruğunun gizli/korunmuş kalması (2), A tekrar girişinde kendi kuyruğunun gönderilip B kaydının korunması (2), çıkış sonrası offline kimliksiz okuma/ekleme engeli (1).

A→B testi gerçek login/logout, sunucu kullanıcı filtresi ve DB satır sayımı kullanır. A'nın gönderilmemiş kuyruğunu hesap değişimine kadar tutmak için POST'a kontrollü 403 uygulanır; B'ye geçince kaldırılır. Retry senaryosundaki 401/403/429/500 de kontrollü HTTP cevaplarıdır; bunlar gerçek grant iptali veya gerçek rate-limit deneyi diye sunulmaz. B'nin kendi kaydı gerçek API ile oluşturulur; A'nın kuyruğu B oturumunda gönderilmez, A dönünce gönderilir.

## Kapsam sınırı

Cihazlar arası çakışma/birleştirme, sunucuda CAS/version kontrolü ve bilinmeyen POST teslimatı için idempotency yoktur. Aynı sekmedeki hızlı ekle/kaldır ve bilinen POST onayı test edildi; çoklu sekme/cihaz için exactly-once garantisi verilmez. IndexedDB kullanılamazsa yer imi kaydedilemez; kullanıcıya hata gösterilir. Sahipsiz eski kayıtları sahiplenme/dışa aktarma aracı, büyük PDF/MathML/RTL/fixed-layout ve manuel ekran okuyucu testi kapsam dışında.

## Tekrar çalıştırma

Kurulu Playwright modülü PLAYWRIGHT_MODULE ile gösterilmeli; Microsoft Edge ve Docker PostgreSQL imajı gerekir. Test yalnız kendi konteynerini oluşturur, dış DATABASE_URL/target kabul etmez.

~~~powershell
node spike/app/test/offline-bookmarks.browser.mjs
node spike/app/test/offline-edit.browser.mjs
~~~

## Bağımsız inceleme ve toast düzeltmesi — 2026-10-24

Kullanıcı bağımsız kod incelemesini PASS olarak bildirdi; reviewer kendi sandbox’ında tarayıcı koşturamadı. Küçük UX notu düzeltildi: yer imi/not silme mesajı artık “bu cihazdan kaldırıldı” der; online kullanıcıya “çevrimdışı” denmez. Bu iki mesaj ve çevirileri dışında ürün davranışı değiştirilmedi. Online not panelinden yer imi silerken mesaj kontrolü eklendi.

Dağıtılacak kaynakla ayrı PostgreSQL/Edge kabulü tekrar **17/17**, 0 JS hatası, cleanup 4/4: [sonuç](reader-evidence/v120-offline-bookmarks/f15aeccc-c090-4aa5-b4ef-0d6f4dea7b18/results.json), [kaynak/artifact manifesti](reader-evidence/v120-offline-bookmarks/f15aeccc-c090-4aa5-b4ef-0d6f4dea7b18/manifest.json). Önceki 20/20 not regresyonu ve 68 güvenlik kanıtı ayrı tarihsel doğrulamalar olarak korunur; toast değişikliği için yeniden koşturulmadı.

## Dağıtım güncellemesi

v120 app-only canlı: smoke 16/16; gerçek prod PostgreSQL/Edge offline im ekle/kaldır ve A→B→A dahil 10/10, 0 JS hatası, cleanup 4/4. Migration yok, v119 rollback korunur. Önceki onay/deploy bekleme ifadeleri ilgili testlerin tarihsel durumudur. [Dağıtım kaydı](deployments/2026-10-24-v120.md).
