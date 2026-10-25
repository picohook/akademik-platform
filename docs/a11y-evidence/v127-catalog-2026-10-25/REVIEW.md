# Canlı katalog — yayın erişilebilirliği incelemesi

**İnceleme tamamlandı, bulgular açık. Uygunluk kararı değildir.** 2026-10-25 Europe/Istanbul; prod **v127/fbeed6e**. Kütüphaneci hesabına görünen 2 katalog kaydının ikisi de PDF; görünür aktif EPUB yok. Tenant genelinde atomik DB snapshot’ı veya diskteki her dosyanın yayında olduğu iddia edilmez.

Her dosya normal oturum/grant kontrollü okuyucu `/file` akışından tamamen okunup SHA-256’sı yerel kaynakla karşılaştırıldı: **2/2 eşleşme**. İki dosyanın **18 fiziksel sayfası** eksiksiz kaynak taramasından geçti. Katalog metadata’sındaki 17+6 toplamı gerçek sayfa sayısı değildir; ikinci dosya gerçekte 1 sayfa. Sayfa numaraları aşağıda fiziksel PDF sayfasıdır, basılı etiket eşlemesi varsayılmadı.

Kitap/dosya/metadata, runtime/env/migration/deploy veya grant değiştirilmedi. Oturum kapatıldı; normal auth/erişim/usage kayıtları kalabilir. Son katalog asset kümesi ve config değişmedi. [Ham katalog incelemesi](catalog-review.json), [envanter](inventory.json), [yapı ayrıntıları](structure-detail.json). Bunlar kitap metni/sayfa görüntüsü içermez. Yayıncı PDF’leri ve geçici render edilmiş sayfalar repoya eklenmedi.

## 1. Mayenit makalesi

Katalog başlığı: **Influence of synthesis parameters on the structural formation of**. Asset `ca9ef7bb-2bdb-4f81-bb65-a922393e21b5`; SHA-256 `6ef24df5cc72de3c2bf4ea7d78b9f4c4d907ff9834216d64808f2790ad19babc`.

| Kontrol | Kaynak sonucu | Karar |
| --- | --- | --- |
| Dosya/sayfa | 17 gerçek sayfa, metadata17, canlı/yerel hash aynı | Kaynak kimliği doğrulandı |
| Metin/dil | 17/17 sayfada metin, kaynak dil en; OCR yan dosyası yok | Bu sürümde OCR hazırlama ihtiyacı saptanmadı |
| Yapı ağacı | 17/17 sayfada mevcut | Yapı varlığı, doğru/anlamlı etiketleme garantisi değildir |
| Başlık rolleri | Yalnız PDF1’de H1/H2; PDF2–17’de H1…Hn yok | PDF2’de görünen bölüm başlığı kaynakta heading rolü taşımıyor; makale gövdesi hiyerarşisi yeniden etiketlenmeli/doğrulanmalı |
| Görsel alternatifleri | 23 Figure; 20’sinde Alt yok ve referanslı metin içeriği de yok | 20 inceleme bayrağı, 20 otomatik kesin ihlal kararı değildir; çevre metni/dekoratif amaç insan tarafından değerlendirilir |
| Tablolar | PDF6,9,11,13: 4 Table, toplam165 TD, **0 TH** | Başlık hücreleri ve veri ilişkileri kaynak/gerçek okuyucu üzerinden düzeltilip tekrar test edilmeli |

Alternatif inceleme dağılımı: PDF2 **1**, PDF4 **1**, PDF5 **2**, PDF6 **1**, PDF7 **2**, PDF8 **1**, PDF9 **5**, PDF10 **1**, PDF11 **1**, PDF12 **5**.

Tüm sayfaların düzeni yerel contact sheet ile AI tarafından gözden geçirildi; ayrıntılı görsel örnekler **PDF2 ve PDF9** idi. Gövde genel olarak tek sütunlu; PDF9’daki çoklu SEM panelleri okunacak iki metin sütunu olarak değerlendirilmez. Bu gözlem, tüm metnin anlamlı sırasının insan/AT ile baştan sona onayı değildir.

PDF2’deki tek Figure bayrağı lisans simgesi gibi dekoratif/tamamlayıcı bir öğe olabilir; gerekirse yeterli lisans metni korunup Artifact olarak sınıflandırılır. Diğer sayfalarda işlem şeması, eğriler ve mikrograflar görünür. Komşu açıklama/altyazıların bilgiyi yeterince karşılayıp karşılamadığı alan uzmanı/yayıncı incelemesidir. Bilimsel grafiklerin anlamını tahmin edip doğrulanmış alternatif diye kaydetmedim.

**İstenen yayın düzeltmesi:** doğru gövde başlıkları; programatik tablo başlık/ilişkileri; dekoratif öğelerin ayrımı; bilgi taşıyan çizimlerin yeterli, doğrulanmış alternatifleri veya erişilebilir eşdeğer yayın. Kaynak dosya sağlandıktan sonra yeni hash ile yeniden tarama ve gerçek okuyucu/AT testi gerekir. Mevcut PDF’nin sessizce üzerine yazılmadı.

## 2. Seed/demo kaydı

Katalog başlığı: **Diş Hekimliğinde İmplant Komplikasyonları**. Asset `55555555-5555-5555-5555-555555555555`; SHA-256 `3df79d34abbca99308e79cb94461c1893582604d68329a41fd4bec1885e6adb4`.

Kaynak dosya **1 sayfalık İngilizce dummy PDF**; metadata **6 sayfa / tr / diş hekimliği başlığı** diyor. Kaynakta 14 metin karakteri, dil ve yapı ağacı yok; OCR yok. Bu bir gerçek altı sayfalı klinik yayın veya onun erişilebilirlik kabulü olarak kullanılamaz.

**İstenen içerik kararı:** kaydı açıkça demo olarak etiketleyip başlık/dil/sayfa metadata’sını gerçek dosyayla eşleştirmek **veya** amaçlanan uygun/erişilebilir örnek dosyayla değiştirmek. Hangi içerik tutulacağı ürün/içerik kararıdır; bu incelemede canlı içerik/metadata değiştirilmedi.

## Kalan kabul

- **VoiceOver/Safari: NOT RUN — kullanıcı Mac erişimi olmadığını doğruladı.** [Gerçek Mac şablonu](../../A11Y-VOICEOVER-ACCEPTANCE.md) hazır; başka platform sonucu buraya PASS yazılmaz.
- **Kontrollü Türkçe insan dinlemesi HL-TR-01 PASS.** Kullanıcı önce eski koşuyu dinlemediğini bildirdi; beklemeli yeni NVDA okuması sonrasında “dinledim, iyiydi” teyidini verdi. [Ayrı insan gözlemi ve koşu](../v127-human-listening-2026-10-25/ACCEPTANCE.md). Bu teyit, makale/formül/çok dilli yayının tamamına genişletilmez; anlamlı bütün yayın incelemesi ayrı kalır.
- Mevcut katalog için otomatik kaynak taraması **tamamlandı**; yukarıdaki yayın düzeltmeleri/insan kabulü tamamlanmış sayılmaz. ACR matrisi kısmi destek/açık kapsamı korur. Yeni uygulama sürümü/deploy üretilmedi.

## Tekrar üretim

[Envanter](inventory.mjs) ve [canlı kaynak kontrolü](check.mjs) için önce bu klasördeki `.mjs` dosyalarını `tmp/acr-catalog-v127` altına kopyalayın; sonra repo kökünden `node tmp/acr-catalog-v127/inventory.mjs`, ardından `node tmp/acr-catalog-v127/check.mjs` çalıştırın. Playwright API context yalnız yerel HTTPS ve normal oturum kullanır. Test hesabı env ile verilebilir; credential/cookie rapora yazılmaz. [Yapı ayrıntıları](structure-detail.mjs) metinli marked-content varlığını sayar; makale metnini kaydetmez. [Görsel yordamı](visual.mjs) yalnız ignored tmp altında yerel görüntü üretir; yayıncı sayfaları Git’e eklenmemelidir. Kaynak denetleyici hash’i ve tam tarama sonuçları ham JSON’dadır. Bu rapor yeni bir NVDA/VoiceOver veya genel regresyon koşusu değildir. [Son durum kontrolü](final-state.json) özgün kaynakların/kataloğun değişmediğini ve dinleme örneğinin temizlendiğini ayrıca doğrular.
