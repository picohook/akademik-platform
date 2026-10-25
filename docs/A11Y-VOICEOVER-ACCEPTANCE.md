# VoiceOver + Safari — gerçek Mac kabulü

**NOT RUN.** Bu Windows oturumunda gerçek macOS/VoiceOver/Safari yok. NVDA, Windows WebKit emülasyonu veya axe sonucu VoiceOver kabulü yerine yazılmaz. Prod **v127/fbeed6e**; canlı Türkçe NVDA kabulü ayrı kanıttır ve VoiceOver yerine geçmez. Test edilen sürüm/build aşağıda açıkça belirtilir; yerel sürüm kanıtı canlıya aktarılmaz.

2026-10-25: ürün sahibi **Mac erişimi olmadığını** açıkça doğruladı. Bu satırlar ortam olmadığı için açık kalır; Windows otomasyonu veya kullanıcı tarafından dinlenmemiş ses PASS gerekçesi değildir.

Kaydedilecek ortam: tarih, macOS sürümü/build, Safari sürümü/build, VoiceOver, arayüz/konuşma dili, URL, `/api/config` sürüm/build, zoom ve test eden kişi. Parola/cookie, özel kitap metni ve gerçek kullanıcı notu kanıta eklenmez; mevcut sentetik örnekler ve geçici not kullanılır.

Apple yönergesine göre VO varsayılan olarak Control+Option veya Caps Lock’tur. Rotor menüsü **VO+U**, kategori sağ/sol, öğe yukarı/aşağı, seçmek Return/Space; Escape seçim yapmadan kapatır. Sisteminizdeki klavye/Quick Nav ayarını kaydedin. [Apple’ın resmi rotor yönergesi](https://support.apple.com/en-ie/guide/voiceover/mchlp2719/mac).

| ID | Gerçek kullanıcı akışı ve beklenen | Sonuç | Duyulan metin / hata |
| --- | --- | --- | --- |
| V01 | Login alanları etiketli; tek hatalı girişte tam hata duyulur; doğru girişte katalog erişilir | NOT RUN | |
| V02 | Karttan PDF açılır; odağın okuyucu içinde sırası anlamlı, arka plan kapalı; Kapat doğru yere döner | NOT RUN | |
| V03 | Tagged PDF başlıkları rotor’da görünür; örnek H1 ve H2 düzeyleri ve metinleri doğru | NOT RUN | |
| V04 | Kaynak Formula açıklaması okunur; sahte/bozuk MathML uyarısı ve yinelenen metin yok | NOT RUN | |
| V05 | EPUB iframe’e girilir/çıkılır; başlık/tablo/dil değişimi ve bölüm geçişi duyurusu doğrulanır | NOT RUN | |
| V06 | PDF/EPUB metni gerçek klavye/AT ile sıfırdan seçilir; Kopyala/Vurgula çalışır; injected Range kullanılmaz | NOT RUN | |
| V07 | Not aç/düzenle/sil/iptal; Escape ve kapatma odağı doğru yere döndürür | NOT RUN | |
| V08 | Offline not bekleme ve kontrollü çatışma/expiry mesajı duyulur; taslak korunur | NOT RUN | |
| V09 | Toast kaybolduktan sonra Bildirimler’den aynı mesaj okunur; form alanları/odak korunur | NOT RUN | |
| V10 | %200/%400 zoom, klavye kaydırma ve panel/modallar; hiçbir gerekli kontrol kırpılmadan erişilir | NOT RUN | |
| V11 | Değerlendirilen sürümde OCR yan dosyası varsa kaynak paragraf/dil ve açık sütun sırası okunur; yoksa test eksikliği yazılır | NOT RUN | |
| V12 | Türkçe/İngilizce metin gerçek sesle insan tarafından dinlenir; telaffuz, duraklama ve anlaşılabilirlik kaydedilir | NOT RUN | |

Her satır PASS/FAIL/NOT RUN ve somut gözlem içerir. JS hata sayısı Safari Web Inspector ile ayrıca kaydedilir. Erişim/indirme kısıtları veya eksik fixture varsa PASS yazılmaz. Test notunu/kitabını temizleyin; oturumu kapatın. Kanıtlar yalnız değerlendirilen build içindir. Başarılı VoiceOver koşusu da her yayın için tam AA iddiası oluşturmaz; [yayın kontrolü](PUBLICATION-ACCESSIBILITY.md) ve [ACR](ACR.md) sınırları korunur.
