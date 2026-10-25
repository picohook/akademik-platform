# v127 — insan dinlemesi / kontrollü Türkçe OCR

**HL-TR-01 PASS — kullanıcı tarafından sesli dinleme teyidi.** Prod **127/fbeed6e**, Windows, gerçek NVDA **2026.2 / 2026.2.0.57664**, Edge **155.0.4283.45**; 2026-10-25 Europe/Istanbul.

Kullanıcı önce önceki koşuyu sesli dinlemediğini bildirdi; o koşu insan kabulü olarak kullanılmadı. Ardından dinleme açıkça duyuruldu ve gerçek okuyucudaki kontrollü Türkçe tarama örneği yeniden açıldı. NVDA'nın native gezinme tuşlarıyla okumasında ilk dört satır arasında 5 saniye beklenerek sözün tamamlanmasına fırsat verildi. Konuşma metni enjekte edilmedi.

Kontrol cümleleri:

- “Türkçe okuma örneği”
- “Diş hekimliğinde araştırma”
- “İnsan denetimi gereklidir.”

Kullanıcı okuma sırasında **“dinledim, iyiydi”** dedi. [İnsan gözlemi](human-observation.json), [ham konuşma/uygulama sonucu](results.json). Böylece yalnız bu Türkçe örneğin anlaşılabilirliği doğrulandı; tüm dillerin/formüllerin/yayınların telaffuzuna veya VoiceOver’a genişletilmez. Ses aygıtı/voice/rate için nesnel ses ölçümü yapılmadı.

Makine koşusu **7/7**, JS **0**; bunlar insan gözlemiyle birleştirilip yeni bir otomatik test toplamı yapılmaz. Ham rapordaki `humanListening=awaiting_user_observation` toplanma anını gösterir; sonradan gelen kullanıcı teyidi ayrı JSON’da korunur. NVDA’nın mevcut normal oturumu ve Speech Viewer yeniden kullanıldı; ham rapordaki setup alanı bu sürecin önceki açılışını tarif eder, yeni bir restart veya sentetik konuşma değildir.

Sadece yeni test kitabı ve kendisine ait hOCR dosyası/boş UUID klasörü kaldırıldı; oturum/yalnız teste ait Edge kapatıldı. Normal usage/progress/audit kayıtları kalabilir. Mevcut yayınlar, runtime/env/migration/deploy ve rollback değiştirilmedi. [Yordam](test.mjs), [native klavye](native-keys.ps1), [yalnız yeni konuşma suffix’i](speech.ps1). Eski Speech Viewer geçmişi, gerçek credential/cookie/profile veya yayıncı sayfa görüntüleri kaydedilmedi.

Tekrar üretmek için repo kökünü kullanın; iki `.ps1` yardımcısını `tmp/nvda-live-v127` altına kopyalayın, gerçek NVDA/Speech Viewer’ı açın ve test yordamını çalıştırın. Yordamın hedefi canlı yerel prod ve yeni geçici test içeriğidir; deploy komutu içermez. Sonuçtaki otomatik konuşma eşleşmesi insan dinlemesi sayılmaz; operatör ayrıca gerçekten dinleyip gözlemini kaydetmelidir.

**Açık:** kullanıcı Mac erişimi olmadığını doğruladı; gerçek VoiceOver/Safari NOT RUN. [Gerçek katalog kaynak incelemesindeki](../v127-catalog-2026-10-25/REVIEW.md) yayıncı düzeltmeleri ve kapsamlı yayın/çok dilli insan incelemesi sürer. Tam WCAG AA iddiası yok.
