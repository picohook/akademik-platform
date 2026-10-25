# LibEdge okuyucu: dil/format ve ücretsiz AI kararları

Durum: Kullanıcı tarafından kabul edilen kapsam; henüz uygulanmadı veya deploy edilmedi.
Bu belge uygulama, migration, AI kaynağı veya ücretli servis oluşturmaz.

## Uygulama sırası

1. Aynı eseri katalogda tek kartta göster; mevcut dil, baskı ve PDF/EPUB seçeneklerini kartta ve okuyucuda seçilebilir yap. Yetki kontrolü seçilen asset için sunucuda yapılmalı. Asset bazındaki ilerleme, notlar, çevrimdışı kayıtlar ve indirme biletleri korunmalı; format değiştirme otomatik dosya dönüştürme değildir.
2. Mevcut OA koleksiyonu için sürümlenmiş, kontrol edilerek yayımlanan kalıcı özetler.
3. Açık kitaba kaynaklı soru-cevap, seçili metni açıklama ve bölüm özeti; sınırlı ücretsiz AI pilotu.
4. Araştırma Panosu'na kaynaklı not kaydetme, mevcut kimlik/kurum entegrasyonu tamamlandığında.

## Kalıcı kitap özeti

Özet kullanıcı isteği başına üretilmez. İlk aşamada yönetici kontrollü bir hazırlama sürecinde oluşturulur, gözden geçirilir ve yayımlanır. Henüz hazırlanmadıysa kullanıcıya bu durum gösterilir; arka planda sınırsız otomatik üretim başlatılmaz.

Önerilen kayıt kimliği:
- kurum/erişim kapsamı;
- edition/content revision kimliği ve dosya içerik özeti;
- özet dili;
- kısa veya ayrıntılı kapsam;
- özet/prompt şeması sürümü.

Kayıt ayrıca model, üretim zamanı, kaynak bölüm/sayfa bağlantıları, kapsam durumu ve inceleme/yayım bilgilerini taşır. Yayımlanmış kayıt değiştirilmeden yeni sürüm hazırlanır; eski notlar kaynak sürümünü korur. Dosya/metin değişirse yeni özet gerekir. Eşzamanlı aynı iş için tek üretim kilidi ve benzersiz kayıt kullanılır.

Tam kitap özeti bütün bölümlerin işlenmesini ve kapsam kontrolünü gerektirir. Soruya benzer birkaç parçanın bulunması tam kitap özeti sayılmaz. Eksik metin/OCR varsa kapsam açıkça belirtilir ve tamlık iddiasıyla yayımlanmaz. Uzun kitaplar bölüm bazında işlenip birleştirilebilir; bu hazırlık da ücretsiz bütçeden tüketir ve günlere yayılabilir.

PDF ve EPUB yalnızca aynı içerik/baskı olduğu doğrulanmışsa ortak özet kullanabilir. Başlık veya ISBN eşleşmesi tek başına yeterli değildir. Çeviri ve farklı baskılar otomatik birleştirilmez. Yanıt dili, kaynak kitabın dilinden ayrı tutulur. Sayfa bağlantıları asset ve sürüme bağlıdır; EPUB konumu ile PDF sayfası eşdeğer kabul edilmez.

## Soru-cevap önbelleği

Her istekte önbellek aramasından önce oturum, kurum ve seçili esere/sürüme erişim sunucuda doğrulanır. Sonuç gösterilmeden erişim tekrar geçerli olmalı; erişim iptali cache ile aşılamaz.

Anahtar şunları kapsar: yetki kapsamı, seçili asset/metin sürümü, yanıt dili, görev türü, soru, kullanılan konuşma bağlamı, seçili metin/sayfa kapsamı ve model/prompt sürümü. İlk pilotta yalnızca bağımsız ve aynı kapsamlı sorular için kesin eşleşme kullanılır; anlam benzerliğiyle otomatik yanıt paylaşılmaz. Soruda büyük/küçük harf veya noktalama anlamını değiştiren agresif normalizasyon yapılmaz.

Özel dosyalar ve kişisel notlara dayalı yanıtlar kullanıcıya özeldir. Kurumlar arası cache paylaşımı varsayılan kapalıdır. LibEdge ortak OA içeriği için paylaşım ancak açıkça ortak kapsamla ve mevcut erişim denetimiyle yapılabilir. Yanıtlar yalnızca doğrulanmış kaynak parçalarının asset/sayfa/bölüm kimliklerini kullanır; modelin ürettiği sayfa numarası kaynak kabul edilmez. Kitap metni içindeki talimatlar güvenilmeyen içeriktir.

Yanıt bulunamadığında bunu belirt. Başarısız, eksik veya kaynak doğrulamasından geçmeyen çıktıyı yayımlanmış cevap gibi kaydetme.

## Ek AI ücreti oluşturmama kuralı

Workers AI'nin ücretsiz planda kullanılabilen bir modeliyle pilot yapılacak. Ücretli model, harici ücretli sağlayıcı, ön ödemeli kredi veya otomatik ücretli fallback açılmayacak. Mevcut Cloudflare hesabının Workers planı uygulanmadan önce doğrulanmalı; ücretli plandaki ücretsiz tahsis otomatik maliyet tavanı değildir.

Kullanıcı, kurum ve toplam kullanım için sunucu tarafında kalıcı sayaç, atomik rezervasyon, eşzamanlı istek sınırı ve giriş/çıkış metin sınırı gerekir. Cache hit yeni model çağrısı yapmaz. İndeksleme, embedding, özet hazırlama, tekrar denemeler ve soru-cevap aynı bütçe değerlendirmesine dahil edilir. Gateway hız sınırı tek başına parasal tavan sayılmaz.

Ücretsiz kota, sayaç veya sağlayıcı erişimi belirsizse yeni üretim durur; hazır ve yetkili özetleri okumak devam eder. Kullanıcıya kota mesajı gösterilir. Kota aşımında ücretli devam yok. Vectorize eklenirse onun ve diğer kullanılan Cloudflare kaynaklarının ücretsiz sınırları da ayrıca uygulanır.

Kesin günlük soru sayısı ve model adı henüz belirlenmedi; gerçek Türkçe/İngilizce kalite ve tüketim ölçümüne göre seçilecek. AWS ve R2'nin mevcut maliyetleri AI'nin ücretsiz olmasıyla ortadan kalkmaz. Kitap lisansları ve kurumların AI işlemeye izinleri içerik bazında korunur.

## Kabul kontrolleri

- Aynı sürüm/dil/özet türünü iki kullanıcı açtığında yayımlanmış aynı kayıt gösterilir ve yeni AI çağrısı yapılmaz.
- Farklı baskı, dosya değişikliği, farklı yanıt dili veya özel kullanıcı bağlamı yanlış cache hit üretmez.
- Eşzamanlı aynı hazırlama işi bir kez çalışır.
- Erişim iptal edilmiş kitap için kayıtlı cevap ve kaynaklar okunamaz.
- Özel kullanıcı/kurum içeriği başka kapsamda görünmez.
- Tüm kitap özeti bölüm kapsamı ve inceleme tamamlanmadan yayımlanmaz.
- Kota sınırında paralel istekler bütçeyi aşmaz; ücretli fallback yoktur.
- AI veya kota servisi yokken mevcut okuyucu ve hazırlanmış yetkili özetler çalışır.
