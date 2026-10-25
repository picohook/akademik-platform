# v124 — Windows / NVDA kabul sonucu

Tarih: 2026-10-25 Europe/Istanbul. Test eden: Codex ajanı; gerçek NVDA Speech Viewer/OS klavyesi, Edge ve DOM/axe birlikte. NVDA 2026.2 (2026.2.0.57664), Edge 155.0.4283.45. İnsan telaffuz dinlemesi yapılmadı.

Bu kayıt v122 oturumunu silmez; [eski form](A11Y-NVDA-V122.md) tarihsel kalır. [Güncel ACR](ACR.md) yalnız tanımlı Windows/örneklem kapsamını değerlendirir. Prod v123’tür; v124 yerel adaydır.

| Görev | Sonuç | Kanıt / sınır |
| --- | --- | --- |
| S01 giriş/hata | PASS | Gerçek NVDA “E-posta veya parola hatalı.”; alert, field label/autocomplete ve başarılı giriş. Parola metni yayınlanmadı. |
| S02 katalog | PASS — örneklem | Önceki kullanıcı konuşma gözlemi; yeni katalog/arama düğmeleri ve responsive akış. Tüm kurum katalogları taranmadı. |
| S03 modallar | PASS | Upload/Edit/Grants/Password/Offline %100/%200/%400; Citation ayrı son kaynak koşusu. Tab/Shift+Tab, arka plan inert ve kapanış odağı. |
| S04 okuyucu | PASS | Footer/main/header izolasyonu, kontrol adları, modifier tuşları ve kullanıcı bazlı tek tuş kısayolu kapatma/reload. |
| S05 PDF sayfaları | PASS — hedefli native koşu | PageLabels fixture i, ii, 1…; citation birim testleri korunur. Son kaynak native-pages kaydı fiziksel 3/basılı 1 duyurusunu içerir; genel karmaşık PDF sırası değildir. |
| S06 seçim/not | PASS — araçlar ve not; seçim başlangıcı açık | PDF/EPUB Range fixture → Alt+Shift+H → araçlar; klavye not kaydet/düzenle/onaylı sil. NVDA sanal imlecinden seçimi sıfırdan başlatma değerlendirilmedi. |
| S07 Notes/odak | PASS | Escape bir kez paneli kapatır, toggle’a döner; yenileme/silme/araç kapanışı odağı korur. |
| S08 EPUB iframe | PASS — reflow fixture | Eski gerçek NVDA başlık/paragraf/tablo/dipnot okuması + yeni orijinal iframe axe negatif kontrolü ve iki bölümde temiz tarama. İframe’den Tab çıkışı geçti. |
| S09 EPUB gezinme | PASS | Gerçek NVDA “Bölüm: Chapter two”; native bağlantı, yer imi ve panel konum düğmesinden klavyeyle dönüş. TR/EN dil metadata’sı doğrulandı. |
| S10 offline | PASS — fixture | Yerel sentetik blob; gerçek browser offline, not düzenle, reload/katalogdan aç, online eşitle. Bilet/filigran backend testi değildir. |
| S11 CAS | PASS | Aynı kullanıcı API ikinci yazıcısı; gerçek demo CAS; iki sürüm görünür, NVDA duyurur, klavyeyle sunucu sürümü seçilir. Fiziksel ikinci cihaz değildir. |
| S12 410 | PASS — kontrollü cevap | HTTP route 410; NVDA açık expiry açıklaması; taslak korunur, klavyeyle yeni not seçilir. Prod receipt değiştirilmedi. |

Konuşma metinleri ve kaynak hash’leri [kanıt dizinindedir](a11y-evidence/v124-2026-10-25/ACCEPTANCE.md). Başarılı otomatik alt kontroller tüm WCAG kriterlerini kapatmaz. VoiceOver/Safari NOT RUN; yayın belgesi semantiği, native AT seçim başlangıcı ve tüm mesaj süreleri ACR’de ayrı kalır.
