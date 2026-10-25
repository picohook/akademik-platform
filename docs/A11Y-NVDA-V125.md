# v125 — NVDA ile faresiz seçim ve bildirimler

Yerel aday **10546bfb91c643ffa1a0ebc8aa8f28b72d824874**; prod v124. Test: 2026-10-25, Windows/NVDA 2026.2 + Edge 155.0.4283.45. [Kanıt ve kapsam](a11y-evidence/v125-2026-10-25/ACCEPTANCE.md).

## Faresiz seçim

1. PDF/EPUB’u açın. Gerekirse tek tuş uygulama kısayollarını kapatın.
2. NVDA browse modunda **NVDA+Shift+F10** ile yerel seçimi etkinleştirin.
3. Okuma imlecini metne taşıyın; **Shift+ok** veya **Shift+Ctrl+sağ ok** ile seçin.
4. **Alt+Shift+H** seçim araçlarını açar ve not alanına odaklanır.
5. Tab ile **Kopyala** veya **Atıfla kopyala** düğmesine gidip Enter kullanın; **Vurgula** için de aynı yolu kullanabilirsiniz.

Gerçek Windows tuşları/NVDA ile PDF ve EPUB’ta seçim sıfırdan oluşturuldu; test Range enjekte etmedi. Pano eşleşmesi ve vurgu kaydı geçti. NVDA’nın varsayılan sanal seçimi ile tarayıcının gerçek seçimi aynı şey değildir; bu akış yerel seçim moduyla doğrulandı. Diğer AT/browsers için otomatik destek iddia edilmez.

## Bildirimler

Görsel toast kaybolsa da **Bildirimler** penceresinden yeniden okunabilir. Açık liste kendiliğinden değişmez; formlardan açıldığında alanlar ve odak korunur. Son 200 kayıt bu sayfa oturumundadır; temizleme, sayfa yenileme, çıkış ve hesap/giriş değişiminde kaybolur. Hesaplar arasında devralınmaz. Gerçek %200/%400 zoom ve klavye kaydırma kontrol edildi.

## Örnek içerikler

NVDA örnek EPUB’un tablo başlıklarını, şekil açıklamasını ve MathML formülünü okudu; RTL ve fixed-layout örnekleri çalıştı. Tagged PDF başlık/formül rollerinin okuyucuda aktarılmadığı, etiketsiz sütun sırasının farklı olabildiği ve OCR’siz tarama örneğinin metinsiz olduğu doğrulandı. Bunlar düzeltilmiş sayılmadı.

**VoiceOver/insan dinlemesi yapılmadı. Tam WCAG AA iddiası yok.** Güncel kriter kararları [ACR](ACR.md) içindedir.
