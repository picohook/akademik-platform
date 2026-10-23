# Çevrimdışı not düzenleme — v119

Tarih: 2026-10-24. Bu paket kaynak kodudur; üretim v118 olarak kalır. Deploy yapılmadı. PostgreSQL migration veya IndexedDB sürüm değişikliği gerekmiyor.

## Davranış

- PDF ve EPUB not metni/etiketleri çevrimdışı düzenlenebilir. Yerel not ve gönderim işlemi aynı IndexedDB transaction'ında kaydedilir; yeniden yükleme taslağı korur. Bekleyen notta “Eşitleme bekliyor” görünür.
- Bağlantı ve geçerli oturum gelince değişiklikler sunucuya gönderilir. HTTP/bağlantı hatasında taslak ve kuyruk korunur; eski sunucu cevabı bekleyen taslağı ezmez. Bağlantı dönüşü açık, kaydedilmemiş düzenleyiciyi kapatmaz.
- Henüz gönderilmemiş notun düzenlenmesi mevcut create işlemini günceller. Create isteği sürerken yeni düzenleme yapılırsa cevap sonrası PATCH gönderilir; silinirse telafi DELETE gönderilir. Silme kuyruğu eski GET cevabından notun geri gelmesini engeller.
- Yeni işlemler kullanıcı kimliğine bağlıdır. Başka hesap kuyruğu gönderemez; POST/PATCH içindeki ownerId mevcut oturumla uyuşmazsa sunucu 403 döner.
- Önceki sürümden kalan, sahibi doğrulanamayan yerel kayıtlar okuma/JSON dışa aktarma için korunur. Bunlar otomatik olarak yeni hesaba atanmaz veya gönderilmez; düzenleme uyarı verir. Online sunucu cevabıyla eşleşen kayıtlar doğrulanmış kullanıcı bilgisiyle önbelleklenebilir.

## Kapsam sınırı

Bu paket tam çakışma çözümü değildir: mevcut sunucu PATCH davranışı son yazanı kabul eder. Cihazlar arası sürüm kontrolü/birleştirme, sekmeler arası eşzamanlama kilidi ve cevabı kaybolmuş POST için sunucu idempotency garantisi eklenmedi. Çevrimdışı yer imi oluşturma da sonraki pakettir. Eski sahibisiz kuyrukların otomatik aktarılmaması bilinçli güvenlik sınırıdır.

## Kanıt

Uygulayan ajan tarafından gerçek Edge, service worker ve IndexedDB ile izole demo sunucusunda **14/14** kabul; **0** sayfa hatası, **3/3** cleanup. Üretim/geliştirme servisleri veya verileri kullanılmadı. Bu, başka ajan tarafından bağımsız retest veya gerçek ekran okuyucu denetimi değildir.

Nihai koşu: [results.json](reader-evidence/v119-offline-edit/3b2df968-972e-43d2-97e4-bf0677c709ab/results.json). Önceki 10 ve 12 senaryolu ara koşular aynı kanıt dizininde korunur. Kaynak dosyalarının hash'leri koşu başı/sonu karşılaştırılır.

Kabul senaryoları:

1. PDF ve EPUB: offline not/etiket düzenle, tekrar düzenle, offline reload, gerçek HTTP ile eşitle.
2. Her iki formatta önbellek okuyucusunda online düzenlemenin bekleyen durumunun temizlenmesi.
3. Her iki formatta bağlantı dönüşünde kaydedilmemiş düzenleyicinin korunması.
4. Gönderilmemiş create düzenlemesi: tek POST.
5. Create sürerken düzenleme: POST → PATCH.
6. Create sürerken silme: POST → DELETE; not geri gelmez.
7. Kontrollü 401/403/500: taslak korunur; eski GET ezmez; gerçek HTTP ile retry.
8. Başka hesap kuyruk göndermez; yanlış ownerId ile POST/PATCH 403.
9. Düzenle → sil: yalnız DELETE; eski GET notu geri getirmez.
10. Native DataCloneError: not ve kuyruk birlikte rollback olur.
11. Sahibi bilinmeyen eski taslak korunur, sessizce yeni hesaba atanmaz.

Ayrıca PostgreSQL 16, ayrıcalıksız uygulama rolü ve iki Node süreciyle mevcut güvenlik entegrasyonu **3 senaryo / 68 HTTP-DB kontrolü** geçti: publisher izolasyonu, gerçek grant SQL hatasında fail-closed, eşzamanlı login/seat sınırları. [Ham çıktı](reader-evidence/v119-offline-edit/security.txt). Tarayıcı koşusu PostgreSQL'e bağlı değildi; bu iki doğrulama ayrı kanıttır.

## Tekrar çalıştırma

`PLAYWRIGHT_MODULE` kurulu Playwright modülünü göstermeli; test Edge kanalını kullanır. Repo bağımlılıkları kurulu olmalıdır.

```powershell
node spike/app/test/offline-edit.browser.mjs
node spike/app/test/security.integration.mjs
```

İlk test yalnız kendi geçici sunucu/Edge profilini oluşturur; ikinci test Docker'da kendi geçici PostgreSQL konteynerini kullanır. Kaynak/kanıt hash listesi: [manifest.json](reader-evidence/v119-offline-edit/manifest.json).
