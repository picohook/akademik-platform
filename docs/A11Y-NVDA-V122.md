# v122 — NVDA + Edge manuel kabul oturumu

**Durum: IN PROGRESS — kullanıcı gözlemlerine ek olarak PDF/modal/EPUB için 16 hedefli klavye/odak kontrolü ve gerçek NVDA Speech Viewer kanıtı eklendi. Tam konuşma/ACR kabulü açık.** Bu formdaki adımlar otomatik olarak geçti sayılmaz. Ürün sahibi Windows/NVDA + Edge ortamını seçti; VoiceOver ayrı testtir.

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
| S01 | IN PROGRESS — hata duyurusu, alan adları, parola gizliliği ve başarılı giriş PASS | Kullanıcı tam hata mesajının okunduğunu doğruladı; ardından Tab ile e-posta/parola/Giriş yap alan adlarının doğru okunması, parola karakterlerinin gizli kalması ve doğru parolayla girişin tamamlanması sorusuna “evet” yanıtı verdi. Birebir konuşma dökümü verilmedi. | Kullanıcı gözlemi, 2026-10-24; Edge 155.0.4283.45 64-bit / NVDA 2026.2 (2026.2.0.57664). Başlık duyurusu ayrıca bekleniyor; tüm S01 henüz PASS sayılmadı. |
| S02 | IN PROGRESS — arama duyurusu ve Oku adı PASS | Kullanıcı, kitap aramasında sonuç değişiminin duyurulması ve Tab ile Oku düğmesine gelindiğinde kitap adı/işlevinin anlaşılır okunması sorusuna “evet” yanıtı verdi. | Kullanıcı gözlemi, 2026-10-24; aynı NVDA/Edge ortamı. Başlıklar, filtreler ve sonucu açma ayrıca doğrulanmadı. |
| S03 | IN PROGRESS — ad/odak/çıkış 6/6 PASS | Upload, Password, Grants, Offline, Edit, Citation: NVDA pencere adını okudu; Tab/Shift+Tab içeride kaldı; klavyeyle kapatma ve açan düğmeye dönüş geçti. Bazı alanlarda ilk Escape belgeye ulaşmadı; ikinci Escape kapattı. | 2026-10-25 otomatik NVDA Speech Viewer + klavye kanıtı. Her alanın tek tek ses kalitesi ve tüm hata/dolu durumları için genel PASS verilmedi. |
| S04 | IN PROGRESS — PDF hedefli 4/4 PASS | PDF klavyeyle açıldı, NVDA “Okuyucu” dedi. 38 ileri + 38 geri Tab adımında kaçış yok; gerçek Tab/Shift+Tab sınırları ve Escape sonrası açan karta dönüş geçti. | Koşu 2026-10-24; 2026-10-25 kayda alındı. Tek karakter kısayolları ve browse-mode arka plan izolasyonu ayrıca açık. |
| S05 | NOT RUN | — | — |
| S06 | NOT RUN | — | — |
| S07 | IN PROGRESS — okuyucudan odak dönüşü PASS | PDF Escape ve EPUB kapatma sonrası odak açan kitap düğmesine döndü. Notes Escape için önceki DOM kanıtı korunuyor. | Tam Notes aç/filtre/kapama konuşma akışı bu koşuda tamamlanmadı. |
| S08 | IN PROGRESS — iframe/okuma/çıkış hedefli PASS | Gerçek NVDA çıktısında bölüm başlığı, paragraf, Türkçe bölüm metni, tablo başlığı/satır-sütun etiketleri, bağlantı ve dipnot metni var. İframe içeriğine girildi; gerçek Tab ile okuyucu kontrollerine dönüldü; 66 odak adımında kaçış yok. | 2026-10-25. Örnek reflow EPUB ve değişmeyen sandbox allow-same-origin; telaffuz/otomatik ses değişimi ve tam iframe axe açık. |
| S09 | IN PROGRESS — bölüm bağlantısı klavyeyle PASS | Gerçek Tab ile two.xhtml bağlantısına ulaşıldı; Enter trusted click üretti ve Chapter two görüntülendi. | Yeni bölüm adının otomatik konuşması UNVERIFIED; ilgili yakalamada yalnız “dialog Okuyucu” var. Yer imi/ayarların NVDA akışı ayrıca açık. |
| S10 | IN PROGRESS — v122 duyuru eksik; v123 hedefli PASS | PDF notu gerçek tarayıcı offline modunda yerelde korundu ve online eşitlendi. v122 bekleme duyurusu 6 saniyede yakalanmadı; v123 adayı açıkça okudu. | Tam offline reload/yer imi konuşma akışı ayrıca açık. |
| S11 | IN PROGRESS — v122 duyuru eksik; v123 hedefli PASS | Yerel demo sunucusunda gerçek CAS çatışması üretildi, iki sürüm gösterildi ve sunucu sürümüyle çözüldü. v123 adayı çakışmayı NVDA ile duyurdu. | İkinci yazıcı aynı hesabın API isteği; fiziksel ikinci cihaz veya tam klavye karar akışı iddiası yok. |
| S12 | IN PROGRESS — v123 kontrollü 410 açıklaması PASS | Kontrollü HTTP 410 ile taslak korundu ve açıklama görünürdü. v122 sesli açıklama yoktu; v123 adayı süre dolduğunu ve taslağın korunduğunu açıkça okudu. | Bu a11y koşusu sayfa route’unda 410 taklididir; canlı receipt değişmedi. Gerçek purge/410 backend kabulü ayrı kanıtta. |

## Kapanış

- Tüm görevlerin sonucu kaydedildi: [ ]
- Engeller bulgu/owner/hedef sürüm ile kaydedildi: [ ]
- Gerekli düzeltmeler aynı ekran okuyucuyla tekrar denendi: [ ]
- Gerçek test eden / onaylayan / tarih: DOLDURULACAK

Bu oturum ekran okuyucu bölümünü tamamlar. [ACR](ACR.md) içindeki diğer kriterlerin kontrast, metin aralıkları, güncel zoom/reflow ve içerik değerlendirmeleri ayrıca kanıtlanır; otomatik tarama veya yalnız bu akış tam AA uyumu anlamına gelmez.


## 2026-10-25 ajan doğrulaması

[16 kontrol ve kapsam özeti](a11y-evidence/v122-nvda-2026-10-25/summary.json). Kanıtlar sabit v122 kopyasına aittir; prod değiştirilmedi. Speech Viewer, NVDA’nın ürettiği konuşma metnini gösterir; insanın sesi dinleyip telaffuzu doğrulaması yerine geçmez. İlk Escape’in NVDA tarafından belgeye iletilmediği durumlarda sonraki Escape veya erişilebilir Kapat düğmesiyle çıkış ayrıca kaydedilir.


## F6 remediation candidate — v123

Kod **e8ddb3d07b6ac07863739de5c0e1ea681666ee97**; prod’a çıkmadı. [NVDA 3/3 ve regresyon 4/4](a11y-evidence/v123-live-status-2026-10-25/summary.json). v122’deki üç durum işlevsel olarak geçti ancak duyurulmadı; bu yüzden tüm S10–S12 veya ACR için PASS verilmedi.
