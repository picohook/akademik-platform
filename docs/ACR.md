# Accessibility Conformance Report — v124 / Windows değerlendirmesi

**Windows/NVDA için bu değerlendirme turu tamamlandı; ürün geneli WCAG 2.2 AA iddiası yok.** Bu, bağımsız sertifika veya tamamlanmış çok platformlu VPAT değildir. Not Evaluated satırları ve yayın içeriği sınırları aşağıda açıkça korunur.

- Tarih/test eden: **2026-10-25 Europe/Istanbul**, Codex ajanı; gerçek NVDA Speech Viewer + OS klavyesi/zoom + Playwright/axe. İnsan ses/telaffuz değerlendirmesi yapılmadı.
- Yerel düzeltme adayı: **v124**, CSS **v47**, SW **v16**, kod **52c846c11f539b57ca3c531b72658da80c13976a**. **Deploy edilmedi.**
- Üretim: **v123/e8ddb3d**; [dağıtım ve gerçek üretim NVDA kabulü](deployments/2026-10-25-v123.md) değişmedi. Env/migration/deploy değişikliği yok; v122 rollback korunur.
- Ortam: Windows 25H2 build 26200.9711; Edge **155.0.4283.45**; NVDA **2026.2 / 2026.2.0.57664**; axe **4.13.0**.
- Kapsam: giriş/katalog, Upload/Edit/Grants/Password/Offline ve önceki Citation kanıtı, PDF/EPUB okuyucu kontrolleri, seçim araçları, not/yer imi, offline reload, CAS ve kontrollü 410. Sentetik altı sayfalı PageLabels PDF ve iki bölümlü reflow EPUB kullanıldı.
- [Nihai sonuç ve kanıt dizini](a11y-evidence/v124-2026-10-25/ACCEPTANCE.md), [genel sonuçlar](A11Y-RESULTS.md), [Windows oturum sonucu](A11Y-NVDA-V124.md).

## Kararın kapsamı

Tablodaki **Supports**, yalnız belirtilen arayüz/örneklem ve Windows ortamı için kanıta dayanır. **Not Applicable** gerekçeli uygulanabilirlik kararıdır. **Not Evaluated** test açığıdır, PASS değildir. Bu ayrım yayıncıdan gelen her kitabın, her tarayıcının ve yardımcı teknolojinin uyumlu olduğu anlamına gelmez.

Orijinal EPUB iframe’leri parent-realm axe ile **kendi document/layout’ları üzerinde** tarandı; sandbox **allow-same-origin** olarak kaldı, allow-scripts açılmadı. Negatif kontrol, geçici eksik alt/lang için beklenen ihlalleri buldu; ardından fixture geri yüklendi. Kopya HTML taraması yapılmadı.

Offline a11y testinde blob sentetik fixture olarak IndexedDB’ye hazırlandı; demo backend biletli indirme sunmuyor. Bu koşu filigran/bilet güvenlik kabulünün yerine geçmez. CAS ikinci yazıcısı aynı hesabın API isteğidir; fiziksel ikinci cihaz değildir. 410 tarayıcı route’unda kontrollü cevaptır; prod receipt tarihi değiştirilmedi.

## WCAG 2.2 A/AA matrisi

55 kriter; kaldırılan 4.1.1 dahil değil. Yayın belgesi/voice platformuna ait açık kapsam, tablonun ardından ayrıca belirtilmiştir.

| SC | Düzey | Kriter | Arayüz/örneklem sonucu | Kanıt / sınır |
| --- | --- | --- | --- | --- |
| 1.1.1 | A | Metin alternatifleri | Supports | Simge kontrollerine metinsel ad; dekoratif canvas AT’den gizli. Yayın içi şekil/alternatif metin kapsam dışı. |
| 1.2.1 | A | Önceden kaydedilmiş ses/video | Not Applicable | Arayüzde kayıt ses/video oynatıcısı yok. |
| 1.2.2 | A | Kayıt altyazıları | Not Applicable | Arayüzde kayıt video yok. |
| 1.2.3 | A | Sesli betimleme alternatifi | Not Applicable | Arayüzde kayıt video yok. |
| 1.2.4 | AA | Canlı altyazılar | Not Applicable | Canlı yayın özelliği yok. |
| 1.2.5 | AA | Sesli betimleme | Not Applicable | Arayüzde kayıt video yok. |
| 1.3.1 | A | Bilgi ilişkileri | Supports | Form/region/dialog/tab ilişkileri ve örnek EPUB başlık/tablo semantiği doğrulandı. PDF semantik yapısı ayrıca aşağıda açık. |
| 1.3.2 | A | Anlamlı okuma sırası | Supports | Arayüz odak/DOM sırası ve örnek EPUB NVDA okuması doğrulandı. Karmaşık PDF okuma sırası için genel destek kararı verilmedi. |
| 1.3.3 | A | Duyusal yönergeler | Supports | Yönergeler kontrol adı ve metinle; yalnız renk/konumla verilmiş zorunlu adım yok. |
| 1.3.4 | AA | Ekran yönü | Supports | Dikey/yatay yön kilidi yok; dar/geniş viewport matrisinde aynı işlemler var. |
| 1.3.5 | AA | Girdi amacı | Supports | Girişte username/current-password autocomplete; diğer kişi/kitap metadatası kişinin kendi verisi olarak yorumlanmadı. |
| 1.4.1 | A | Renk kullanımı | Supports | Seçili düğmeler aria-pressed, sınır/ikon; not rengi filtrede metin adı ve erişilebilir kontrol adı taşıyor. |
| 1.4.2 | A | Ses kontrolü | Not Applicable | Uygulama kendiliğinden ses çalmıyor; NVDA bağımsız yardımcı teknoloji. |
| 1.4.3 | AA | Metin kontrastı | Supports | Üç tema ve dinamik hata/not/çatışma taramaları; computed sRGB oranları kanıt dosyasında. |
| 1.4.4 | AA | Metin büyütme | Supports | Gerçek Edge %200/%400 zoom; EPUB viewport zoom kilidi kaldırıldı; yeniden boyutlamada korunuyor. |
| 1.4.5 | AA | Metin görselleri | Not Applicable | Arayüz metni HTML; marka/logo istisnası dışında metin görseli yok. Yayın PDF’leri bu karara dahil değil. |
| 1.4.10 | AA | Yeniden akış | Supports | 1280/640/320 CSS px ve gerçek %400 koşusu; kontroller kaydırılarak erişilebilir. Sabit PDF sayfası iki boyutlu belge alanı olarak ayrı. |
| 1.4.11 | AA | Arayüz kontrastı | Supports | Kontrol sınırları/odak renkleri ölçüldü; native Windows forced-colors ve Chromium emülasyonu çalıştırıldı. Tüm yayın şekilleri değerlendirilmedi. |
| 1.4.12 | AA | Metin aralıkları | Supports | 320 CSS px’de line-height 1.5, paragraph 2em, letter .12em, word .16em override; kontrol erişimi korundu. |
| 1.4.13 | AA | Hover/odak içeriği | Not Applicable | Özel hover/focus popup’ı yok; yerel tarayıcı title balonları ve açık kullanıcı eylemiyle açılan seçim araçları ayrı. |
| 2.1.1 | A | Klavye kullanımı | Not Evaluated | Klavye ile kontrol, not düzenleme/silme, yer imi/CFI, çatışma ve 410 kurtarma geçti. Seçim araçları Range fixture ile test edildi; NVDA sanal imlecinden sıfırdan metin seçimi uçtan uca değerlendirilmedi. |
| 2.1.2 | A | Klavye tuzağı | Supports | İframe’den Tab ile çıkış, okuyucu/modal döngüsü ve Escape/Kapat ile çıkış kanıtlı. |
| 2.1.4 | A | Tek karakter kısayolları | Supports | Tek tuş kısayolları kullanıcı/cihaz kapsamında kapatılabiliyor; reload/offline kimliği korunuyor. Ctrl/Alt/Meta/Shift seçim kombinasyonları sayfa çevirmiyor. |
| 2.2.1 | A | Süre ayarları | Not Evaluated | Not/çatışma taslakları korunuyor. Geçici tüm toast/yardım metinlerinin süre sınırı açısından kapsamlı değerlendirmesi yapılmadı; bu satır PASS değildir. |
| 2.2.2 | A | Duraklatma ve gizleme | Supports | Reduced-motion kuralı var; otomatik ilerleyen kitap/reklam/marquee yok; yükleme spinner’ı dışında sürekli hareket yok. |
| 2.3.1 | A | Yanıp sönme | Supports | Arayüzde yanıp sönen içerik yok; sürekli spinner flaş olarak kullanılmıyor. Kullanıcı yayın içeriği ayrı. |
| 2.4.1 | A | Blokları atlama | Supports | Skip link, ana alan ve okuyucu/panel region’ları; modal arka planı inert. |
| 2.4.2 | A | Sayfa başlığı | Supports | TR/EN belge başlıkları ve açık kitap adı var; sekme başlığı gözlendi. |
| 2.4.3 | A | Odak sırası | Supports | Notes, seçim araçları, yer imi, not yenilemesi/silme ve modal kapanışında odak korunuyor/dönüyor. |
| 2.4.4 | A | Bağlantı amacı | Supports | Oku kitap adıyla; örnek EPUB bölüm/dipnot bağlantıları bağlamlı; not konumu native button. |
| 2.4.5 | AA | Birden çok yol | Supports | Katalog arama/konu filtreleri; kitapta TOC/arama/sayfa veya bölüm gezinmesi. |
| 2.4.6 | AA | Başlık ve etiketler | Supports | Simgelere açık aria-label; form ve panel adları, bölüm duyurusu ve not eylemleri. |
| 2.4.7 | AA | Görünür odak | Supports | Odak outline/border stilleri ve native contrast ekranı gözlendi; form/toolbar kontrolleri erişilebilir. |
| 2.4.11 | AA | Örtülmeyen odak | Supports | Dar panel belge alanını inert yapıyor; başlık araçları ayrı scroll ediyor. Native zoom ve kontrol görünürlüğü matrisleri geçti. Tarayıcı/AT’nin kendi pencereleri ürün arayüzünden ayrıdır. |
| 2.5.1 | A | İşaretçi hareketleri | Supports | Swipe için önceki/sonraki düğmeleri; çoklu parmak zorunlu değil. |
| 2.5.2 | A | İşaretçiyi iptal etme | Supports | Eylemler click/Enter ile; silme iptal/onaylı; pointerdown yalnız eski seçimi temizliyor. |
| 2.5.3 | A | Etiketteki ad | Supports | Görünen metinler erişilebilir adda; yalnız simge düğmelerinde açıklayıcı ad. |
| 2.5.4 | A | Hareketle çalıştırma | Not Applicable | Cihaz hareketiyle işlev tetikleme yok. |
| 2.5.7 | AA | Sürükleme alternatifleri | Supports | Zorunlu sürükleme yok; gezinme/sayfa/yer imi için düğme alternatifleri. |
| 2.5.8 | AA | Hedef boyutu | Supports | Renk, not düzenle/sil, konuma git ve mini düğmeler en az 24 CSS px; ölçümler kanıtta. |
| 3.1.1 | A | Sayfa dili | Supports | Ana html[lang] TR/EN; gerçek EPUB iframe/root en; içerik sandbox’ı değişmedi. |
| 3.1.2 | AA | Bölüm dili | Supports | Örnek EPUB içindeki lang=tr bölümü korundu; dil metadata’sı programatik doğrulandı. İnsan telaffuz dinlemesi yapılmadı. |
| 3.2.1 | A | Odakta bağlam | Supports | Sıradan odak değişimi kaydetme/bağlam değişimi tetiklemiyor. |
| 3.2.2 | A | Girdide bağlam | Supports | Form gönderimi açık eylem; filtre değişimi sonuç alanını güncelliyor; dil düğmesi açık yeniden yükleme eylemi. |
| 3.2.3 | AA | Tutarlı gezinme | Supports | Katalog ve okuyucu kontrolleri aynı sırada; responsive görünüm işlemleri kaldırmıyor. |
| 3.2.4 | AA | Tutarlı tanımlama | Supports | PDF/EPUB ortak not/yer imi/kopyalama kontrolleri tutarlı adlandırıldı. |
| 3.2.6 | A | Tutarlı yardım | Supports | Kısayol/destek konumu footer’da tutarlı; okuyucu içi ayar aynı adla var. |
| 3.3.1 | A | Hata tanımlama | Supports | Gerçek NVDA giriş hatası, offline bekleme, CAS ve expiry mesajları; taslak korunuyor. |
| 3.3.2 | A | Etiket ve yönergeler | Supports | Giriş/modal/not etiketleri, PDF fiziksel sayfa alanı ve seçim araçları adlandırılmış. |
| 3.3.3 | AA | Hata önerisi | Supports | Hatalı giriş, geçersiz/aralık dışı sayfa, çatışmada iki sürüm ve 410’da yeni kayıt/yerel taslak kararları açıklanıyor. |
| 3.3.4 | AA | İşlem hatasını önleme | Supports | Not silme iptal/onay testi; kitap/grant/offline kopya silmede mevcut onaylar; çatışmada sürümler korunur. Normal düzenleme için her kayıtta ek onay istenmez. |
| 3.3.7 | A | Tekrarlı girdi | Supports | Test süreçlerinde aynı veri tekrar istenmedi; parola/kimlik güvenliği ve başka kişi metadatası ayrı. |
| 3.3.8 | AA | Erişilebilir kimlik doğrulama | Supports | Parola autocomplete alanları ve yapıştırma serbest; zorunlu bilişsel bulmaca/CAPTCHA yok. |
| 4.1.2 | A | Ad/rol/değer | Supports | Shell + orijinal iframe axe, AX ağacı, native form/checkbox/button, güncel aria-pressed/expanded. |
| 4.1.3 | AA | Durum mesajları | Supports | NVDA’da Bölüm: Chapter two; offline bekleme; CAS; açık 410 açıklaması; giriş alert’i. Eski F6 kapalı. |

## Kalan kapsam — genel uygunluk iddiasını sınırlar

1. **VoiceOver/Safari: NOT RUN.** Windows’ta gerçek VoiceOver yok; NVDA kanıtı bunun yerine yazılmadı.
2. **PDF belgesinin semantiği/alternatifleri:** mevcut renderer PDF.js TextLayer kullanıyor; tagged PDF yapı ağacı, çok sütunlu okuma sırası, şekil alt metni, karmaşık tablo/formül ve OCR’siz tarama için ürün geneli destek kanıtı yok. 1.1.1/1.3.1/1.3.2 kararları bütün yayınlara genişletilmez. Reflow EPUB örneğinin heading/table/dil semantiği gerçek NVDA ve orijinal iframe ile kanıtlandı.
3. **Sıfırdan native AT metin seçimi:** seçim araçlarına klavye erişimi ve PDF/EPUB Range→CFI/not akışı geçti; NVDA sanal imleciyle seçimi başlatma uçtan uca değerlendirilmedi. 2.1.1 bu nedenle genel PASS değildir.
4. **Süreli tüm arayüz mesajları:** kalıcı readerStatus ve taslak koruması kanıtlı; bütün toast/yardım sürelerinin 2.2.1 değerlendirmesi tamamlanmadı.
5. Fixed-layout/MathML/RTL, ses/video içeren yayınlar ve tüm kurum içerikleri ayrı içerik kabulü gerektirir. Çalışıyor veya çalışmıyor varsayılmadı.

Bu sınırlar raporu saklamayı engellemez; **tam AA/“her kitap erişilebilir” satış iddiasını engeller**. Bu turda tespit edilen arayüz hataları v124’te düzeltildi; canlıya aktarım ayrı işlemdir.

Normatif çerçeve: [WCAG 2.2](https://www.w3.org/TR/WCAG22/). [Tek karakter kısayolları](https://www.w3.org/WAI/WCAG22/Understanding/character-key-shortcuts.html), [reflow ve iki boyutlu içerik istisnası](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html), [veri hatasını önleme](https://www.w3.org/WAI/WCAG22/Understanding/error-prevention-legal-financial-data.html) birincil kaynaklarla kontrol edildi. Standart kapsamı ile müşteri kabul şartı aynı şey değildir.
