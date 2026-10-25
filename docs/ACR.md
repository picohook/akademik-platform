# Accessibility Conformance Report — v125 / Windows değerlendirmesi

**Windows/NVDA için bu değerlendirme turu tamamlandı; ürün geneli WCAG 2.2 AA iddiası yok.** Bu, bağımsız sertifika veya tamamlanmış çok platformlu VPAT değildir. Doğrulanan PDF sınırlamaları ve yayın içeriği kapsamı aşağıda açıkça korunur.

- Tarih/test eden: **2026-10-25 Europe/Istanbul**, Codex ajanı; gerçek NVDA Speech Viewer + OS klavyesi/zoom + Playwright/axe. İnsan ses/telaffuz değerlendirmesi yapılmadı.
- Değerlendirilen sürüm: **v125**, CSS **v48**, SW **v17**, kod **10546bfb91c643ffa1a0ebc8aa8f28b72d824874**; üretime alındı.
- Üretim: **v125/10546bf**; [dağıtım](deployments/2026-10-25-v125.md), [gerçek canlı NVDA bildirim kabulü](a11y-evidence/v125-production-nvda-2026-10-25/ACCEPTANCE.md): **6/6**, JS **0**. Canlı NVDA retestinde prod/env/migration/deploy değiştirilmedi; v124 rollback korunur. Bu dar canlı kabul, aşağıdaki yerel test kapsamını veya açık PDF/VoiceOver sınırlarını genişletmez.
- Ortam: Windows 25H2 build 26200.9711; Edge **155.0.4283.45**; NVDA **2026.2 / 2026.2.0.57664**; axe **4.13.0**.
- Kapsam: giriş/katalog, Upload/Edit/Grants/Password/Offline ve önceki Citation kanıtı, PDF/EPUB okuyucu kontrolleri, seçim araçları, not/yer imi, offline reload, CAS ve kontrollü 410. Sentetik altı sayfalı PageLabels PDF ve iki bölümlü reflow EPUB kullanıldı.
- [v125 sonuçları ve kanıt](a11y-evidence/v125-2026-10-25/ACCEPTANCE.md), [genel sonuçlar](A11Y-RESULTS.md), [önceki Windows oturumu](A11Y-NVDA-V124.md), [arşivlenmiş v124 değerlendirmesi](a11y-evidence/v124-2026-10-25/ACR-assessment.md).

## Kararın kapsamı

Tablodaki **Supports**, yalnız belirtilen arayüz/örneklem ve Windows ortamı için kanıta dayanır. **Not Applicable** gerekçeli uygulanabilirlik kararıdır. **Not Evaluated** test açığıdır, PASS değildir. Bu ayrım yayıncıdan gelen her kitabın, her tarayıcının ve yardımcı teknolojinin uyumlu olduğu anlamına gelmez.

Orijinal EPUB iframe’leri parent-realm axe ile **kendi document/layout’ları üzerinde** tarandı; sandbox **allow-same-origin** olarak kaldı, allow-scripts açılmadı. Negatif kontrol, geçici eksik alt/lang için beklenen ihlalleri buldu; ardından fixture geri yüklendi. Kopya HTML taraması yapılmadı.

Offline a11y testinde blob sentetik fixture olarak IndexedDB’ye hazırlandı; demo backend biletli indirme sunmuyor. Bu koşu filigran/bilet güvenlik kabulünün yerine geçmez. CAS ikinci yazıcısı aynı hesabın API isteğidir; fiziksel ikinci cihaz değildir. 410 tarayıcı route’unda kontrollü cevaptır; prod receipt tarihi değiştirilmedi.

## WCAG 2.2 A/AA matrisi

55 kriter; kaldırılan 4.1.1 dahil değil. Yayın belgesi/voice platformuna ait açık kapsam, tablonun ardından ayrıca belirtilmiştir.

| SC | Düzey | Kriter | Arayüz/örneklem sonucu | Kanıt / sınır |
| --- | --- | --- | --- | --- |
| 1.1.1 | A | Metin alternatifleri | Partially Supports | Arayüz simge adları ve EPUB görsel alt metni doğrulandı. Görüntüden oluşan PDF fixture’ında metin/OCR alternatifi yok; bütün yayınlar için destek iddia edilmez. |
| 1.2.1 | A | Önceden kaydedilmiş ses/video | Not Applicable | Arayüzde kayıt ses/video oynatıcısı yok. |
| 1.2.2 | A | Kayıt altyazıları | Not Applicable | Arayüzde kayıt video yok. |
| 1.2.3 | A | Sesli betimleme alternatifi | Not Applicable | Arayüzde kayıt video yok. |
| 1.2.4 | AA | Canlı altyazılar | Not Applicable | Canlı yayın özelliği yok. |
| 1.2.5 | AA | Sesli betimleme | Not Applicable | Arayüzde kayıt video yok. |
| 1.3.1 | A | Bilgi ilişkileri | Partially Supports | EPUB başlık/tablo ilişkileri NVDA’da okundu. Tagged PDF kaynağındaki H1/Formula yapısı mevcut okuyucuda semantik rol olarak aktarılmıyor; doğrulanmış okuyucu sınırı. |
| 1.3.2 | A | Anlamlı okuma sırası | Partially Supports | Arayüz/örnek EPUB sırası uygun. Adversarial etiketsiz iki sütunlu PDF’de DOM sırası RIGHT SECOND → LEFT FIRST; görsel sıra tersi. Kaynak/reader sınırlaması doğrulandı. |
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
| 2.1.1 | A | Klavye kullanımı | Supports | v125’te gerçek NVDA Native Selection modu ile sıfırdan PDF/EPUB seçimi → pano kopyası → vurgu geçti. DOM Range enjekte edilmedi. Kısayol code boşken key üzerinden de çalışır. Bu sonuç test edilen metinli örneklerle sınırlı. |
| 2.1.2 | A | Klavye tuzağı | Supports | İframe’den Tab ile çıkış, okuyucu/modal döngüsü ve Escape/Kapat ile çıkış kanıtlı. |
| 2.1.4 | A | Tek karakter kısayolları | Supports | Tek tuş kısayolları kullanıcı/cihaz kapsamında kapatılabiliyor; reload/offline kimliği korunuyor. Ctrl/Alt/Meta/Shift seçim kombinasyonları sayfa çevirmiyor. |
| 2.2.1 | A | Süre ayarları | Supports | Geçici toast bilgisi son 200 kayıtlık, zamansız oturum geçmişinden yeniden okunabilir; açık liste otomatik yenilenmez, form verisi korunur. Çıkış/hesap değişimi/giriş kapısında temizlenir. Yedi günlük session TTL 20 saat istisnasından uzun; diğer UI timer’ları yanıt penceresi oluşturmuyor. Yayın lisans koşulları için genel karar verilmez. |
| 2.2.2 | A | Duraklatma ve gizleme | Supports | Reduced-motion kuralı var; otomatik ilerleyen kitap/reklam/marquee yok; yükleme spinner’ı dışında sürekli hareket yok. |
| 2.3.1 | A | Yanıp sönme | Supports | Arayüzde yanıp sönen içerik yok; sürekli spinner flaş olarak kullanılmıyor. Kullanıcı yayın içeriği ayrı. |
| 2.4.1 | A | Blokları atlama | Supports | Skip link, ana alan ve okuyucu/panel region’ları; modal arka planı inert. |
| 2.4.2 | A | Sayfa başlığı | Supports | TR/EN belge başlıkları ve açık kitap adı var; sekme başlığı gözlendi. |
| 2.4.3 | A | Odak sırası | Supports | Notes/seçim odağı ve iç içe bildirim/form kapanışında odak dönüyor. Arka plan kayıt tamamlanırsa biten form yeniden açılmıyor. |
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
| 3.1.2 | AA | Bölüm dili | Supports | Örnek EPUB’da lang=tr ve lang=ar parçaları korunuyor; RTL direction ve dil metadata’sı doğrulandı. İnsan telaffuz dinlemesi yapılmadı. |
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
2. **PDF belgesinin semantiği/alternatifleri:** tagged PDF kaynağındaki H1/Formula yapısı okuyucuda rol olarak aktarılmıyor. Etiketsiz iki sütunlu örnekte DOM ve görsel sıra farklı; metin/OCR alternatifi olmayan tarama örneği erişilebilir değil. Bunlar doğrulanan sınırlamalardır. 1.1.1/1.3.1/1.3.2 sonuçları bütün yayınlara genişletilmez.
3. **Native seçim ve UI mesaj süresi hedefli açıkları v125’te kapandı:** gerçek NVDA + Windows tuşlarıyla seçim/kopyalama/vurgulama; zamansız bildirim geçmişi ve form/hesap gizliliği test edildi. Tüm yardımcı teknolojiler/işletim sistemlerine genişletilmez.
4. **MathML/RTL/fixed-layout örnekleri:** sentetik EPUB tablo/görsel/formül NVDA çıktısı, Arapça dil/direction ve iki pre-paginated sayfa gezinmesi geçti. Her yayının karmaşık formülü, etkileşimli MathCAT gezinmesi, ses/video alternatifi veya tüm sabit düzenlerin AA uyumu doğrulanmadı.
5. **İnsan dinlemesi:** Speech Viewer üretilen konuşma metnini gösterir; telaffuz ve gerçek dinleme kalitesi ayrıca insan değerlendirmesidir.

Bu sınırlar raporu saklamayı engellemez; **tam AA/“her kitap erişilebilir” satış iddiasını engeller**. Bu turdaki kısayol/mesaj düzeltmeleri v125 yerel adayındadır. PDF yapı/okuma sırası eksikleri bu paketle düzeltilmiş sayılmaz. Canlıya aktarım ayrı işlemdir.

Normatif çerçeve: [WCAG 2.2](https://www.w3.org/TR/WCAG22/). [Tek karakter kısayolları](https://www.w3.org/WAI/WCAG22/Understanding/character-key-shortcuts.html), [reflow ve iki boyutlu içerik istisnası](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html), [veri hatasını önleme](https://www.w3.org/WAI/WCAG22/Understanding/error-prevention-legal-financial-data.html) birincil kaynaklarla kontrol edildi. Standart kapsamı ile müşteri kabul şartı aynı şey değildir.
