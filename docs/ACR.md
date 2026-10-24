# Accessibility Conformance Report — v122 draft

**OPEN — NVDA + Edge manual acceptance pending.** Bu rapor tamamlanmış VPAT veya sertifika değildir; tam WCAG 2.2 AA uyumu iddia etmez. Önceki v113 taslağındaki seçili kriterler v122’ye otomatik taşınmadı.

- Ürün/sürüm: Akademik Platform, **v122**, CSS **v45**, SW **v14**.
- Değerlendirilen kaynak: **8b598a37416aabbe18ce1c846a052a9787b4f0b1**; 2026-10-24.
- Canlı sürüm: [v122 dağıtımı](deployments/2026-10-24-v122.md). Yeni audit ayrı, yalnız fixture kullanan demo kopyasındadır; prod değişmedi.
- Hedef: WCAG 2.2 A/AA. Aşağıda **55 kriterin tamamı** bulunur; 4.1.1 WCAG 2.2’den çıkarıldığı için bu matrise dahil değildir.
- Kapsam: login, katalog, modallar, PDF/EPUB okuyucu, seçim/kopyalama/not/yer imi, offline ve çatışma/410 durumları. Yayın içeriği örnekleri arayüzden ayrı kayıtlanır; tüm yayınların erişilebilir olduğu varsayılmaz.
- Ortam: Windows 25H2 build 26200.9711, Edge 155.0.4283.45, axe-core 4.13.0. Güncel otomasyon headless Edge kullanır; gerçek NVDA kabulünün yerine geçmez.
- Seçilen manuel ortam: **NVDA + Edge / Windows** (ürün sahibi). Kullanıcı 2026-10-24 tarihinde **Edge 155.0.4283.45 (Official build), 64-bit** ve **NVDA 2026.2 (2026.2.0.57664)** bildirdi. Windows sürümü, ses/sentezleyici, TR/EN ayarları ve test eden kişi henüz kaydedilmedi. Kullanıcı S01’de “alert” ve tüm hata mesajının okunduğunu doğruladı: **hata duyurusu alt kontrolü PASS**. Birebir konuşma dökümü sağlanmadı; başlık/alan adları, parola gizliliği ve başarılı giriş dahil S01’in kalanı ve genel kabul açık.
- VoiceOver + Safari: **NOT RUN**, Windows kapsamında yok; ayrı ortam kabulü gerektirir.

## Kanıt ve durum kullanımı

Güncel sonuç: **10 axe taraması / 0 ihlal**, **1 Notes odak kontrolü geçti**, **2 orijinal EPUB frame taraması BLOCKED**; JS hatası 0. [v122 kanıt özeti](a11y-evidence/v122-2026-10-24/summary.json). Kontrastın manuel inceleme maddeleri ve gerçek NVDA konuşması açıktır.

[Sonuçlar](A11Y-RESULTS.md), [v122 manuel oturum formu](A11Y-NVDA-V122.md), [genel plan](A11Y-TEST-PLAN.md). v104/v105/v106 kanıtları tarihsel hedefli testlerdir. v122 dağıtımındaki Edge 14/14 işlevsellik testidir; ekran okuyucu kabulü değildir.

**Supports** yalnız tanımlı kapsamda yeterli kanıtla; **Partially Supports** kanıtlanan eksiklikle; **Does Not Support** doğrulanmış başarısızlıkla; **Not Applicable** gerekçeli kapsam kararıyla kullanılır. **Not Evaluated**, bu taslağın tamamlanmamış değerlendirmesidir; nihai uygunluk sonucu değildir. Test eksikliği başarısızlık veya kısmi destek diye sunulmaz. Otomatik alt kontrolün geçmesi tüm kriteri kapatmaz.

## WCAG 2.2 A/AA matrisi

Kriter açıklamaları kısa Türkçe etiketlerdir; normatif metin için [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/) esas alınır. Durumlar ürün geneli hakkındadır; açıklamalardaki hedefli geçişler daha dar kanıttır.

| SC | Düzey | Kısa açıklama | v122 durumu | Kanıt / kalan değerlendirme |
| --- | --- | --- | --- | --- |
| 1.1.1 | A | Metin alternatifleri | Not Evaluated | Arayüz ve yayın içeriği ayrı incelenmeli; taranmış/OCR’siz PDF alternatifi ayrıca değerlendirilir. |
| 1.2.1 | A | Önceden kaydedilmiş ses/video | Not Evaluated | Kriterin kapsamı/uygulanabilirliği ve yeterli kanıtı henüz kaydedilmedi; varsayılan PASS/NA yok. |
| 1.2.2 | A | Kayıt altyazıları | Not Evaluated | Kriterin kapsamı/uygulanabilirliği ve yeterli kanıtı henüz kaydedilmedi; varsayılan PASS/NA yok. |
| 1.2.3 | A | Sesli betimleme alternatifi | Not Evaluated | Kriterin kapsamı/uygulanabilirliği ve yeterli kanıtı henüz kaydedilmedi; varsayılan PASS/NA yok. |
| 1.2.4 | AA | Canlı altyazılar | Not Evaluated | Kriterin kapsamı/uygulanabilirliği ve yeterli kanıtı henüz kaydedilmedi; varsayılan PASS/NA yok. |
| 1.2.5 | AA | Sesli betimleme | Not Evaluated | Kriterin kapsamı/uygulanabilirliği ve yeterli kanıtı henüz kaydedilmedi; varsayılan PASS/NA yok. |
| 1.3.1 | A | Bilgi ilişkileri | Not Evaluated | Güncel DOM/axe kanıtı mevcut; EPUB tablo/başlık semantiği NVDA ile doğrulanmadı. |
| 1.3.2 | A | Anlamlı okuma sırası | Not Evaluated | DOM veya ekran görüntüsü konuşma/okuma sırası kanıtı değildir. S05/S08. |
| 1.3.3 | A | Duyusal yönergeler | Not Evaluated | Kriterin kapsamı/uygulanabilirliği ve yeterli kanıtı henüz kaydedilmedi; varsayılan PASS/NA yok. |
| 1.3.4 | AA | Ekran yönü | Not Evaluated | Kriterin kapsamı/uygulanabilirliği ve yeterli kanıtı henüz kaydedilmedi; varsayılan PASS/NA yok. |
| 1.3.5 | AA | Girdi amacı | Not Evaluated | Kriterin kapsamı/uygulanabilirliği ve yeterli kanıtı henüz kaydedilmedi; varsayılan PASS/NA yok. |
| 1.4.1 | A | Renk kullanımı | Not Evaluated | Kriterin kapsamı/uygulanabilirliği ve yeterli kanıtı henüz kaydedilmedi; varsayılan PASS/NA yok. |
| 1.4.2 | A | Ses kontrolü | Not Evaluated | Kriterin kapsamı/uygulanabilirliği ve yeterli kanıtı henüz kaydedilmedi; varsayılan PASS/NA yok. |
| 1.4.3 | AA | Metin kontrastı | Not Evaluated | Güncel axe çıktılarında color-contrast manuel inceleme maddeleri var. |
| 1.4.4 | AA | Metin büyütme | Not Evaluated | v105/v106 tarihsel 200/400% kanıtı var; tüm v122 durumları için yeniden karar gerekir. |
| 1.4.5 | AA | Metin görselleri | Not Evaluated | Kriterin kapsamı/uygulanabilirliği ve yeterli kanıtı henüz kaydedilmedi; varsayılan PASS/NA yok. |
| 1.4.10 | AA | Yeniden akış | Not Evaluated | Yeni not/çatışma kontrolleri ve EPUB için 320 CSS px kapsamı açık. |
| 1.4.11 | AA | Arayüz kontrastı | Not Evaluated | Native Windows contrast theme ve manuel oran ölçümü açık. |
| 1.4.12 | AA | Metin aralıkları | Not Evaluated | Metin aralığı override deneyi yapılmadı. |
| 1.4.13 | AA | Hover/odak içeriği | Not Evaluated | Kriterin kapsamı/uygulanabilirliği ve yeterli kanıtı henüz kaydedilmedi; varsayılan PASS/NA yok. |
| 2.1.1 | A | Klavye kullanımı | Not Evaluated | Notes Escape hedefli DOM testi geçti; tam klavye/iframe akışı S04–S11 açık. |
| 2.1.2 | A | Klavye tuzağı | Not Evaluated | Hedefli kapatma testi geçti; EPUB içerikten geri çıkış ve yeni dinamik durumlar açık. |
| 2.1.4 | A | Tek karakter kısayolları | Not Evaluated | NVDA browse/focus modlarıyla uygulama kısayollarının etkileşimi S04/S08. |
| 2.2.1 | A | Süre ayarları | Not Evaluated | Kriterin kapsamı/uygulanabilirliği ve yeterli kanıtı henüz kaydedilmedi; varsayılan PASS/NA yok. |
| 2.2.2 | A | Duraklatma ve gizleme | Not Evaluated | Kriterin kapsamı/uygulanabilirliği ve yeterli kanıtı henüz kaydedilmedi; varsayılan PASS/NA yok. |
| 2.3.1 | A | Yanıp sönme | Not Evaluated | Kriterin kapsamı/uygulanabilirliği ve yeterli kanıtı henüz kaydedilmedi; varsayılan PASS/NA yok. |
| 2.4.1 | A | Blokları atlama | Not Evaluated | Kriterin kapsamı/uygulanabilirliği ve yeterli kanıtı henüz kaydedilmedi; varsayılan PASS/NA yok. |
| 2.4.2 | A | Sayfa başlığı | Not Evaluated | Kriterin kapsamı/uygulanabilirliği ve yeterli kanıtı henüz kaydedilmedi; varsayılan PASS/NA yok. |
| 2.4.3 | A | Odak sırası | Not Evaluated | Odak geçişi ve reader dışı içerik NVDA ile incelenmeli; S04/S07/S08. |
| 2.4.4 | A | Bağlantı amacı | Not Evaluated | Kriterin kapsamı/uygulanabilirliği ve yeterli kanıtı henüz kaydedilmedi; varsayılan PASS/NA yok. |
| 2.4.5 | AA | Birden çok yol | Not Evaluated | Kriterin kapsamı/uygulanabilirliği ve yeterli kanıtı henüz kaydedilmedi; varsayılan PASS/NA yok. |
| 2.4.6 | AA | Başlık ve etiketler | Not Evaluated | Kriterin kapsamı/uygulanabilirliği ve yeterli kanıtı henüz kaydedilmedi; varsayılan PASS/NA yok. |
| 2.4.7 | AA | Görünür odak | Not Evaluated | v105/v106 hedefli tarihsel kanıt; v122 dinamik durumlar ve native contrast açık. |
| 2.4.11 | AA | Örtülmeyen odak | Not Evaluated | Güncel Notes Escape/odak hedefli kontrolü geçti; genel kriter kapanmadı. |
| 2.5.1 | A | İşaretçi hareketleri | Not Evaluated | Kriterin kapsamı/uygulanabilirliği ve yeterli kanıtı henüz kaydedilmedi; varsayılan PASS/NA yok. |
| 2.5.2 | A | İşaretçiyi iptal etme | Not Evaluated | Kriterin kapsamı/uygulanabilirliği ve yeterli kanıtı henüz kaydedilmedi; varsayılan PASS/NA yok. |
| 2.5.3 | A | Etiketteki ad | Not Evaluated | Kriterin kapsamı/uygulanabilirliği ve yeterli kanıtı henüz kaydedilmedi; varsayılan PASS/NA yok. |
| 2.5.4 | A | Hareketle çalıştırma | Not Evaluated | Kriterin kapsamı/uygulanabilirliği ve yeterli kanıtı henüz kaydedilmedi; varsayılan PASS/NA yok. |
| 2.5.7 | AA | Sürükleme alternatifleri | Not Evaluated | Kriterin kapsamı/uygulanabilirliği ve yeterli kanıtı henüz kaydedilmedi; varsayılan PASS/NA yok. |
| 2.5.8 | AA | Hedef boyutu | Not Evaluated | v105 renk düğmesi düzeltmesi tarihsel; yeni kopyalama/çatışma kontrolleri ayrıca ölçülmeli. |
| 3.1.1 | A | Sayfa dili | Not Evaluated | Güncel örnek iframe html[lang]=en doğrulandı; yayın örneklemi ve konuşma kontrolü açık. |
| 3.1.2 | AA | Bölüm dili | Not Evaluated | Örnekteki tr bölümü NVDA dil değişimiyle okunmalı. S08. |
| 3.2.1 | A | Odakta bağlam | Not Evaluated | Kriterin kapsamı/uygulanabilirliği ve yeterli kanıtı henüz kaydedilmedi; varsayılan PASS/NA yok. |
| 3.2.2 | A | Girdide bağlam | Not Evaluated | Kriterin kapsamı/uygulanabilirliği ve yeterli kanıtı henüz kaydedilmedi; varsayılan PASS/NA yok. |
| 3.2.3 | AA | Tutarlı gezinme | Not Evaluated | Kriterin kapsamı/uygulanabilirliği ve yeterli kanıtı henüz kaydedilmedi; varsayılan PASS/NA yok. |
| 3.2.4 | AA | Tutarlı tanımlama | Not Evaluated | Kriterin kapsamı/uygulanabilirliği ve yeterli kanıtı henüz kaydedilmedi; varsayılan PASS/NA yok. |
| 3.2.6 | A | Tutarlı yardım | Not Evaluated | Kriterin kapsamı/uygulanabilirliği ve yeterli kanıtı henüz kaydedilmedi; varsayılan PASS/NA yok. |
| 3.3.1 | A | Hata tanımlama | Not Evaluated | S01 tam login-hata duyurusu kullanıcı gözlemiyle PASS; diğer hata durumları ve kriter geneli değerlendirilmedi. Çatışma/410 S11/S12. |
| 3.3.2 | A | Etiket ve yönergeler | Not Evaluated | Güncel login/modallar axe taraması geçti; tüm iş akışına ilişkin sonuç verilmedi. |
| 3.3.3 | AA | Hata önerisi | Not Evaluated | Kriterin kapsamı/uygulanabilirliği ve yeterli kanıtı henüz kaydedilmedi; varsayılan PASS/NA yok. |
| 3.3.4 | AA | İşlem hatasını önleme | Not Evaluated | Not silme/çatışma kararı/410 taslak davranışı kullanılabilirlik açısından S06/S11/S12. |
| 3.3.7 | A | Tekrarlı girdi | Not Evaluated | Kriterin kapsamı/uygulanabilirliği ve yeterli kanıtı henüz kaydedilmedi; varsayılan PASS/NA yok. |
| 3.3.8 | AA | Erişilebilir kimlik doğrulama | Not Evaluated | Parola yöneticisi, yapıştırma ve kimlik doğrulama tam kullanıcı akışı test edilmeli. |
| 4.1.2 | A | Ad/rol/değer | Not Evaluated | Güncel axe ve AX/DOM kanıtı kısmi; iframe/dinamik kontrollerin tamamı kapanmadı. |
| 4.1.3 | AA | Durum mesajları | Not Evaluated | aria-live/role=status varlığı konuşma kanıtı değildir. S01/S05/S10–S12. |

## Açık kapılar

1. **NVDA + Edge:** S01–S12 sonuçları, gerçekten duyulan metin, browse/focus geçişi, iframe okuma/çıkış ve hata/çatışma duyuruları. S12 için yalnız izole ortamda 410 senaryosu; prod receipt tarihleri değiştirilmeyecek.
2. **EPUB orijinal sandbox iframe:** güncel içerik taraması zaman aşımına uğradı. Kopyalanmış standalone HTML veya shell taraması tam iframe PASS sayılmaz; allow-scripts açılarak test kolaylaştırılmaz.
3. Native Windows contrast theme, manuel kontrast, metin aralıkları, v122 dinamik ekranlarının 200/400%/320 CSS px kontrolleri.
4. PDF’de gerçek metin/okuma sırası ve OCR’siz tarama alternatifi; EPUB başlık/tablo/bağlantı/iki dil örneklemi. Fixed-layout/MathML/RTL ayrı doğrulama kapsamıdır; çalışıyor/çalışmıyor diye varsayılmaz.
5. Her satıra kanıta dayalı sonuç, etkilenen ekran/içerik, bilinen eksiklik ve test eden/tarih yazılmalı. ACR bilinen sınırlamaları raporlayabilir; yalnız NVDA akışının geçmesi tam AA iddiasına yetmez.

WCAG tam uyum iddiası tüm ilgili A/AA kriterlerini, tam sayfaları ve eksiksiz süreçleri kapsar; [W3C uygunluk koşulları](https://www.w3.org/TR/WCAG22/#conformance-reqs). Bu taslak değerlendirme hazırlığıdır ve müşteri görüşmesinde tamamlanmış uygunluk belgesi olarak sunulmaz.

Sorumlu: proje sahibi; test eden ve son onay henüz atanmadı.
