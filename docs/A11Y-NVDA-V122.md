# v122 — NVDA + Edge manuel kabul oturumu

**Durum: IN PROGRESS — S01 hata duyurusu kullanıcı tarafından doğrulandı; diğer konuşma kontrolleri açık.** Bu formdaki adımlar otomatik olarak geçti sayılmaz. Ürün sahibi Windows/NVDA + Edge ortamını seçti; VoiceOver ayrı testtir.

## Hazırlık

1. [Canlı v122](https://localhost/?v=122) aç; altbilgi/config sürümünü doğrula. Gerçek müşteri notu yerine yalnız sana ait test kitabı/notu kullan. Paylaşılan cihazda başka kişinin ekranını/konuşmasını kaydetme.
2. NVDA’yı başlat. NVDA menüsü → Tools/Araçlar → Speech Viewer/Konuşma Görüntüleyici’yi aç; duyuruları görev görev kopyalayabilirsin. [Resmî NVDA kılavuzu](https://api.nvaccess.org/documentation/userGuide.html#SpeechViewer).
3. Tarayıcı ilk tur %100; NVDA+Space browse/focus geçişi yapar. Yerleşik yardım için NVDA+1. TR ve EN ses/dil seçeneklerini kaydet; telaffuzu sessiz logdan PASS sayma.
4. Metin katmanı olan çok sayfalı PDF ve başlık/tablo/bağlantılı iki bölümlü reflow EPUB hazırla. Yerel audit’in üretildiği EPUB kanıt klasöründedir. PDF tarama/OCR, fixed-layout/MathML/RTL için ayrı içerik ve karar gerekir.
5. S10/S11 yalnız test verisiyle. S12 hazır izole retention test ortamı gerektirir; canlı DB’ye eski tarih yazma veya gerçek receipt temizleme yapma. Hazır değilse NOT RUN yaz.

| Oturum bilgisi | Değer |
| --- | --- |
| Test eden / tarih / saat | DOLDURULACAK |
| Ürün / commit | v122 / 8b598a3; gerçekten görülen sürümü teyit et |
| Windows sürümü | DOLDURULACAK; Windows ortamı kullanıcı tarafından seçildi |
| Edge sürümü | 155.0.4283.45 (Official build), 64-bit — kullanıcı bildirimi, 2026-10-24 |
| NVDA sürümü | 2026.2 (2026.2.0.57664) — kullanıcı bildirimi, 2026-10-24 |
| NVDA dil / sentezleyici / ses / konuşma hızı | DOLDURULACAK |
| Ekran ölçeği / tarayıcı zoom | DOLDURULACAK |
| PDF / EPUB adı, dil, metin/OCR ve içerik özellikleri | DOLDURULACAK |
| Ortam / URL; gerçek veya emüle offline | DOLDURULACAK |

## Görevler

| ID | Alan | Adım | Beklenen gözlem | İlgili SC |
| --- | --- | --- | --- | --- |
| S01 | Login / hata | NVDA açıkken sayfayı yenile. Başlık ve etiketleri oku; bir kez hatalı parola gönder, ardından doğru giriş yap. | Alan adları ve hata duyulmalı; parola metni okunmamalı; hata sonrası giriş tamamlanmalı. | 3.3.1, 3.3.2, 3.3.8, 4.1.2, 4.1.3 |
| S02 | Katalog / arama | Başlıkları ve kartları browse mode ile oku; arama yap, filtrele ve sonucu aç. | Başlık/kitap adı ve eylemler anlaşılır; sonuç değişimi takip edilebilir. | 1.3.1, 1.3.2, 2.4.4, 2.4.6, 4.1.3 |
| S03 | Modallar | Upload/Edit/Grants/Password/Citation/Offline pencerelerini aç; Tab/Shift+Tab ve Escape ile dolaş. Kaydetmeden kapat. | Pencere adı anlaşılır; alan/eylem adları okunur; odak kaçmaz ve açan düğmeye döner. | 2.1.1, 2.1.2, 2.4.3, 4.1.2 |
| S04 | Okuyucu / kısayollar | PDF’yi klavyeyle aç; NVDA+Space ile browse/focus modlarını karşılaştır. İçindekiler/arama sekmelerini kullan. | Okuyucu adı duyulur; katalog/altbilgi araya girmez; uygulama kısayolları metin okumasını bozmaz. | 2.1.1, 2.1.2, 2.1.4, 2.4.3 |
| S05 | PDF sayfa / metin | Çok sayfalı metin PDF’de ilk iki sayfayı ve basılı etiketli sayfayı oku; sayfa değiştir, iç arama sonucu aç. | Okuma sırası anlamlı; metin tekrarlanmaz/kaybolmaz; konum ve sonuç duyuruları yeterli ve aşırı tekrarsız. | 1.3.2, 2.4.6, 4.1.3 |
| S06 | Seçim / kopya / not | Metin seç, Kopyala/Atıfla kopyala ve not eklemeyi klavyeyle dene; notu düzenle/sil. | Eylemler adlandırılmıştır; seçilen metin ve not okunur; kaydetme sonucu anlaşılır. Kullanılamayan işlev kaydedilir. | 2.1.1, 3.3.4, 4.1.2, 4.1.3 |
| S07 | Notes odak | Notes filtresine git. Bir Escape ile paneli, ikinci Escape ile okuyucuyu kapat. Yeniden açıp kapat düğmesini dene. | Panel kapanınca Notlar düğmesine, okuyucu kapanınca kitap kartına dönülür; odak görünür ve duyulur. | 2.1.2, 2.4.3, 2.4.7, 2.4.11 |
| S08 | EPUB iframe / dil | Reflow EPUB aç; Tab ve browse mode ile içeriğe gir, başlık/tablo/bağlantıyı ve TR/EN bölümünü oku; kontrollere geri dön. | Frame adı ve içerik erişilebilir; başlık/tablo ilişkileri anlamlı; uygun dil/ses değişimi ve iframe’den çıkış var. | 1.3.1, 1.3.2, 2.1.1, 2.1.2, 3.1.1, 3.1.2 |
| S09 | EPUB gezinme / yer imi | Bölüm değiştir, arama sonucuna ve yer imine git; yazı boyutunu değiştirip kitabı yeniden aç. | Doğru konum korunur; ilerleme anlaşılır; odak kaybolmaz ve iframe yeniden okunabilir. | 2.4.3, 4.1.2, 4.1.3 |
| S10 | Offline / reload | Yalnız test kitabını offline kaydet. Ağ kapalıyken notu/yer imini değiştir, yeniden yükle, sonra ağı aç. | Offline/bekliyor/eşitlendi durumu takip edilebilir; taslak ve odak kaybolmaz; tekrar çevrimiçi olunabilir. | 2.1.1, 3.3.1, 4.1.3 |
| S11 | İki cihaz çatışması | Aynı test notunu iki ayrı tarayıcı profili/cihazda değiştir; ikincide 409 oluşsun. Taslağı ve diğer sürümü okuyup bilinçli seçim yap. | Çatışma duyulur; iki metin/eylemler ayırt edilir; yalnız klavyeyle karar verilir ve sonuç anlaşılır. | 1.3.1, 2.1.1, 2.4.3, 3.3.4, 4.1.3 |
| S12 | 410 / taslak koruma | Yalnız hazırlanmış izole 410 senaryosunda taslağı aç, yeniden yükle ve yeni not olarak kaydet/kaldır kararını incele. | Süre dolumu ve taslağın korunduğu anlaşılır; karar düğmeleri okunur; veri sessizce kaybolmaz. Hazır ortam yoksa NOT RUN. | 3.3.1, 3.3.4, 4.1.3 |

## Sonuç formu

Her satıra PASS / FAIL / IN PROGRESS / NOT RUN; gerçekten duyulan metin, klavye adımları ve kanıt dosyası ekle. Hata varsa etkiyi (engelleyici/ciddi/orta/düşük), yeniden üretim adımlarını ve sürümü yaz. Beklenen metni kopyalamak gözlem değildir.

| ID | Sonuç | Duyulan / fiilen olan | Kanıt / etki |
| --- | --- | --- | --- |
| S01 | IN PROGRESS — hata duyurusu PASS | Kullanıcı önce “okuyor, alert”, ardından “okuyor tüm mesajı” bildirdi. Tam hata mesajı NVDA ile duyuluyor; birebir mesaj dökümü verilmedi. | Kullanıcı gözlemi, 2026-10-24; Edge 155.0.4283.45 64-bit / NVDA 2026.2 (2026.2.0.57664). Başlık/alan adları, parola gizliliği ve başarılı giriş ayrıca bekleniyor. |
| S02 | NOT RUN | — | — |
| S03 | NOT RUN | — | — |
| S04 | NOT RUN | — | — |
| S05 | NOT RUN | — | — |
| S06 | NOT RUN | — | — |
| S07 | NOT RUN | — | — |
| S08 | NOT RUN | — | — |
| S09 | NOT RUN | — | — |
| S10 | NOT RUN | — | — |
| S11 | NOT RUN | — | — |
| S12 | NOT RUN | — | — |

## Kapanış

- Tüm görevlerin sonucu kaydedildi: [ ]
- Engeller bulgu/owner/hedef sürüm ile kaydedildi: [ ]
- Gerekli düzeltmeler aynı ekran okuyucuyla tekrar denendi: [ ]
- Gerçek test eden / onaylayan / tarih: DOLDURULACAK

Bu oturum ekran okuyucu bölümünü tamamlar. [ACR](ACR.md) içindeki diğer kriterlerin kontrast, metin aralıkları, güncel zoom/reflow ve içerik değerlendirmeleri ayrıca kanıtlanır; otomatik tarama veya yalnız bu akış tam AA uyumu anlamına gelmez.
