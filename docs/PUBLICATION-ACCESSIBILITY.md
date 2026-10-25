# Yayın erişilebilirliği — kontrol ve OCR hazırlama

Bu süreç yayın başına uygulanır. Arayüzün NVDA testinin geçmesi, yüklenen PDF/EPUB’un erişilebilir olduğunu göstermez. Araçlar **yerel operatör araçlarıdır**; yükleme API’sinde otomatik kalite kapısı, yeni servis veya OCR kuyruğu kurulmadı. OCR, özgün PDF’ye gömülmez; okuyucu ayrı hOCR katmanını kullanır. İndirilen özgün PDF’nin erişilebilirliği ayrıca değerlendirilir.

## 1. PDF kaynak kontrolü

Repo kökünden, mevcut `spike/app` bağımlılıklarıyla:

```powershell
node scripts/a11y-pdf-check.mjs --pdf incoming/book.pdf --out tmp/book-check.json
```

Rapor sayfa bazında metin varlığını, kaynak yapı rollerini, Figure/Formula açıklaması eksiklerini ve varsa hOCR kelime kayıtlarını gösterir. Kitap metnini rapora dökmez. `--pages 1,3-5` örneklemdir; `scope.complete=false` tam kitap kontrolü değildir. `no_readable_text` boş veya taranmış sayfa olabilir; görsel inceleme gerekir. `no_source_structure` okuma sırasının yanlış olduğunun tek başına kanıtı değildir; kontrol gerektirdiğini belirtir. `no_automatic_findings` **AA/PASS değildir**; `conformance=not_assessed` korunur. Mevcut JSON dosyası üzerine yazılmaz.

## 2. Taranmış PDF’den hOCR

Mevcut `spike/ocr` bağımlılıkları ve yerel `eng.traineddata`/`tur.traineddata` gerekir; ayrıca PDF.js’in mevcut Node canvas bağımlılığı kullanılır. Yeni komut model indirmez ve belgeyi başka servise göndermez. Eksik modelde işlem durur. Diğer diller, yerel üç harfli model ve ayrı doğrulama gerektirir; bu turda İngilizce/Türkçe test edildi.

```powershell
node spike/ocr/prepare-pdf.mjs --pdf incoming/book.pdf --out tmp/book-ocr-001 --lang tur --pages 1-5
node scripts/a11y-pdf-check.mjs --pdf incoming/book.pdf --hocr-dir tmp/book-ocr-001 --out tmp/book-after-ocr.json
```

`--pages` zorunlu; tüm kitap için açıkça `--pages all` kullanılır. Varsayılan render 150 dpi, izin verilen aralık 72–300; sayfa 16 milyon pikseli aşarsa daha düşük DPI gerekir. PDF sınırı 300 MiB. Çıktı `page-001.hocr` biçiminde ve kaynak SHA-256/dil/kapsam/güven/bölge bilgili `report.json` olarak yazılır. Her çıktı `reviewRequired=true` taşır; güven puanı doğruluk garantisi değildir. Var olan hedef dosyalar üzerine yazılmaz. Hata sonrası kısmi çıktılar varsa yeni klasörle devam edin; bunları tamamlanmış iş olarak yayımlamayın.

## 3. Çok sütunlu içerikte açık okuma planı

İlk worker varsayılanlarıyla OCR iki sütunu satır satır karıştırdı; son aracın açık PSM3 tam sayfa ayarı temiz örneğimizde sırayı doğru çıkardı. Bu, başka yayınlar için garanti değildir. Yayın hazırlayan kişi bölgeleri **istenen okuma sırasında** ayrıca belirleyebilir. Aşağıdaki örnek yalnız test düzenimiz içindir; başka kitabın sayfa düzenine körlemesine uygulanmaz.

`tmp/book-regions.json`:

```json
{
  "pages": {
    "1": [
      { "left": 0, "top": 0, "width": 1, "height": 0.11, "psm": 7 },
      { "left": 0, "top": 0.11, "width": 0.5, "height": 0.89, "psm": 6 },
      { "left": 0.5, "top": 0.11, "width": 0.5, "height": 0.89, "psm": 6 }
    ]
  }
}
```

```powershell
node spike/ocr/prepare-pdf.mjs --pdf incoming/book.pdf --out tmp/book-ordered-001 --lang eng --pages 1 --regions tmp/book-regions.json
```

Koordinatlar sayfanın üst/solundan 0–1 oranındadır. Liste örnekte önce tam genişlikli başlığı, sonra sol sütunu, sonra sağ sütunu verir. Araç belirtilen parçaları kırpar; OCR kutularını tam sayfa koordinatlarına taşır. Bölgeler örtüşürse çift metin oluşmaması için işlem reddedilir. Sayfa başına en fazla 32 bölge vardır. `psm=7` tek satır, `6` tek metin bloğu; `3` otomatik sayfa, `11` seyrek metin, `13` ham satırdır. Uygun seçimi operatör yapar. Planda bulunmayan seçili sayfa tam sayfa OCR’ye düşer; rapor `readingOrderMode` ile bunu açıkça gösterir. `coverageRatio=1` yalnız geometrik kapsama bilgisidir, metin bütünlüğü/alternatifler garantisi değildir.

Gerçek görselle OCR’yi karşılaştırın: başlık, **sol sütunun sonu → sağ sütunun başı**, dipnotlar, tablo hücreleri, sayfa numaraları, tireler ve Türkçe karakterler. hOCR sıra/dil/paragrafları okuyucuda korunur; yeni başlık/tablo/formül yapısı çıkarılmaz. Default yön ve kutu hizalaması bu turda test edildi; döndürülmüş OCR hizalaması genel destek iddiasına dahil değildir.

## 4. Yayıncıdan istenecekler

- Dijital PDF: kaynakta doğru başlık düzeyleri, okuma sırası, tablo ilişkileri ve anlamlı Figure/Formula açıklamaları. Sadece font büyüklüğü veya OCR, bunların yerine geçmez.
- Tarama: doğrulanmış OCR metni, dil bilgisi ve okuma sırası. Şekil/diyagramın anlamını OCR üretmez; açıklama veya erişilebilir eşdeğer yayın gerekir.
- EPUB: belge/bölüm dili, mantıklı başlıklar, tablo başlıkları, anlamlı görsel alternatifleri, dipnot/bağlantı bağlamı; karmaşık matematik ve sabit düzen ayrıca test edilir. Dekoratif görsel ile bilgi taşıyan görsel ayrımı insan kararıdır.

Platformun okumadığı ayrı bir JSON’a alternatif yazmak, kullanıcıya alternatif sunulduğu anlamına gelmez. Açıklamayı desteklenen kaynak PDF/EPUB yapısına yerleştirin veya kullanıcıya sunulan erişilebilir eşdeğeri hazırlayın.

## 5. Dev’de doğrulama ve kayıt

Üretilen PDF’nin SHA-256’sını, yüklenen dosyayla eşleştirin. Yalnız yetkili içerik işlemi olarak hOCR dosyalarını **ilgili asset UUID’sinin** dev klasörüne (`data/dev-ocr/<asset-uuid>/page-001.hocr`) taşıyın. Kitabı kapat/aç; hOCR route’u oturum/grant ister. Arama indeksi gerekiyorsa mevcut dev yordamı:

```powershell
docker compose exec web node index-text.mjs --asset <asset-uuid>
```

Bu paket prod’a içerik taşımaz, DB/migration/env değiştirmez. Offline kitap blob’u hOCR’yi otomatik paketlemez; çevrimiçi yan dosya desteği, offline OCR garantisi değildir. Uygulama modülünün SW cache’te olması da kitap OCR verisinin offline bulunduğunu göstermez.

Her yayın için kaydedin: kaynak SHA-256, varsa düzeltilmiş hOCR hash’leri, araç raporu, kontrol edilen **tüm sayfalar/örneklem ayrımı**, sütun sırası, metin doğruluğu, açıklama yeterliliği, ekran okuyucu çıktısı, kontrol eden kişi/tarih ve açık kalanlar. İnsan onayı ve gerçek AT testi olmadan otomatik yayına uygunluk kararı verilmez. Yeni API zorlaması uygulanmadığından bu süreç operasyonel olarak takip edilir.

Teknik dayanak: [W3C PDF7 — OCR ve metin/sıra doğrulaması](https://www.w3.org/WAI/WCAG22/Techniques/pdf/PDF7), [W3C PDF3 — okuma sırası](https://www.w3.org/WAI/WCAG22/Techniques/pdf/PDF3), [W3C PDF1 — görsel alternatifleri](https://www.w3.org/WAI/WCAG22/Techniques/pdf/PDF1). Bunlar teknik örneklerdir; otomatik uygunluk sertifikası değildir.
