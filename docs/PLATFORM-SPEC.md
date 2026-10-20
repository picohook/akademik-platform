# Akademik E-Kitap Platformu — Ürün ve Teknik Şartname

**Sürüm:** 1.9 — spike planı, dondurma istisnası ve kabul kriterleri
**Kapsam:** Platform (ticari akışlar hariç)
**Öncelik etiketleri:** `[M]` MVP (24–28 hafta) · `[V1]` V1a 3–4 ay + V1b 3–4 ay (toplam 6–8 ay) · `[V2]` 9–12+ ay · `[X]` kapsam dışı

> **v1.1 değişiklik özeti:** MVP süresi 16–20 haftaya çekildi ve kapsamı kırpıldı; PDF okuyucu için 2 haftalık POC zorunlu hale getirildi; OCR koordinat formatı (hOCR/ALTO) tanımlandı; arama tek motora indirildi ve relevans test seti eklendi; on-prem "ilk günden hazır" mimari kısıt ilan edildi; grup yönetimi, MARC profili, CSV şeması, zip-bomb/CSV injection/webhook imzası gibi güvenlik detayları eklendi; önizleme oranı, oturum süresi, embargo davranışı ve `LicenseTerm` tutarsızlığı düzeltildi.
>
> **v1.2 değişiklik özeti:** AI, çekirdeğe gömülü değil **opsiyonel katman** olarak tanımlandı (16.5). MVP'de kullanıcıya dönük üretken AI yok; V1'de metadata/konu önerisi, anlamsal arama, ilgili başlıklar ve özet; V2'de kaynaklı soru-cevap (RAG), çeviri ve TTS. Yayıncı izni, halüsinasyon kontrolü, maliyet tavanı ve değerlendirme seti şartları eklendi.
>
> **v1.3 değişiklik özeti:** İçerik türleri (makale, tez, bildiri, dergi sayısı, rapor), seri/çok cilt, bölge kısıtı ve süresiz erişim, konsorsiyum/kiracı hiyerarşisi, keşif entegrasyonları (OAI-PMH, Google Scholar, OpenURL, Zotero), koruma/arşivleme, errata/retraction, kötüye kullanım ve adli filigran, operasyon/destek, görsel derin zoom, kullanıcı profili ve walk-in/alumni erişimi eklendi (Bölüm 29).
>
> **v1.4 değişiklik özeti:** Kurumsal arşiv bağlayıcıları eklendi (16.6): DSpace 6/7, EPrints, Islandora, Omeka ve generic OAI-PMH. Kaynak sistem/ID, handle, erişim durumu ve checksum alanları veri modeline girdi; açık erişimde cache, kısıtlı içerikte reference modu tanımlandı.
>
> **v1.5 değişiklik özeti:** Kalan kenar durumlar eklendi (Bölüm 30): EPUB/PDF güvenliği (HTML sanitizasyonu, XXE, PDF JS), SCIM/SLO/IP yönetimi, ders rezervleri, anotasyon paylaşımı, ORCID/ROR/Crossref, lisans URI'leri, DLQ/maintenance/kill switch, event taxonomy, 404/500/maintenance, yazar-yayıncı-seri sayfaları, ToS/subprocessors/ROPA/DPIA, e-posta bounce ve yedekten silme.
>
> **v1.6 değişiklik özeti:** Genişletilebilirlik mimarisi eklendi (Bölüm 31): modüler monolit, 10 port/adapter, yapılandırılabilir metadata, blok tabanlı sayfa/tema, feature flag, domain event + webhook, API/embed, workflow esnekliği ve "yapmamalar" listesi.
>
> **v1.7 değişiklik özeti (ikinci inceleme):** MVP 24–28 haftaya çekildi; PDF POC dosyaları ön koşul oldu, soğuk önbellek/20 Mbps eklendi; arama 50k sentetik doğrulama ve Türkçe stemmer yedek planı; `FieldOverride` şeması; DLQ/retry, event sözlüğü, indeks yeniden kurma, maintenance mode MVP'ye alındı; V1 ikiye bölündü (V1a altyapı, V1b keşif/AI); bölge kısıtı, veri yerelleştirme, adli filigran ve OPDS 2.0 karara bağlandı; MARC/rights/CSP/backup silme düzeltmeleri.
>
> **v1.8 değişiklik özeti (üçüncü inceleme):** Anotasyon/ilerleme **çapa modeli** (text quote + range + CFI) eklendi; arama/faset/öneri izolasyon testi; audit ↔ KVKK silme uzlaşması; OPS taklit yönetişimi; grant cache TTL + atomik kontenjan; kota eşikleri; embedding yaşam döngüsü ve TDM; OCR maliyet modeli; PDF erişilebilirlik beyanı; on-prem lisans kenar durumları; preview alt sınırı; RLS CI testi; bounce/complaint; depolama büyüme modeli. `FieldOverride` MVP'den V1b'ye alındı; 2 haftalık kalibrasyon spike'ı eklendi.
>
> **v1.9 değişiklik özeti (spike planı):** Dondurma istisnası (PDF mimarisi, `text_quote` algoritması, EPUB motoru) eklendi; `text_quote` eşleşme algoritması (normalize + Levenshtein ≤ %20 + yetim adayı) tanımlandı; spike girdileri (3 POC PDF + 2 hedef kitap + izin) ve scaffold/measurement ayrımı yazıldı; Ek 28.8 spike kabul kriterleri eklendi; EPUB motoru kararı V1a'ya taşındı.

---

## 0. Amaç ve okuma kılavuzu

Bu şartname üç soruya cevap verir:

1. Platform hangi işlevleri sunar, hangi kullanıcı hangi işi yapar?
2. Her işlevin kabul kriteri ve önceliği nedir?
3. Hangi alanlar sıklıkla atlanır ve burada nasıl kapatılır?

Bölüm 28'deki kontrol listesi, "eksik alan kalmadı" iddiasının denetim aracıdır. Bir özellik bu dokümanda yoksa bilinçli olarak kapsam dışıdır; unutulmuş değildir.

**Dondurma istisnası (v1.9):** Bu şartname donmuştur. Yalnızca üç kalem spike çıktısına bağlı olarak yeniden açılabilir: **PDF mimarisi** (6.1), **`text_quote` eşleşme algoritması** (6.4/C-01) ve **EPUB motoru** (6.3, V1a). Diğer tüm değişiklik talepleri V1 kapsamına yazılır; şartname değişmez.

---

## 1. Ürün ilkeleri

1. **İzolasyon her şeyden önce gelir.** Bir kiracının özel içeriği, kullanıcısı veya raporu başka kiracıya hiçbir yoldan sızmaz.
2. **Üç tıkta okuma.** Ana sayfadan kitabı açana kadar en fazla üç tık.
3. **Tek kod, üç dağıtım modu:** SaaS, dedicated, on-prem. **On-prem uyumluluğu ilk günden mimari kısıttır**, sonradan eklenmez.
4. **Ticari akış yok, erişim hakkı var.** Ödeme/fatura yok; grant, süre, kontenjan, lisans durumu var.
5. **Önce PDF, sonra EPUB.** PDF deneyimi bozuksa ürün bozuktur.
6. **Her şey denetlenebilir.** Yükleme, yayınlama, erişim değişikliği, kaldırma ve yönetici işlemleri audit log'a yazılır.
7. **Erişilebilirlik sonradan eklenmez.**
8. **Çok dillilik baştan.** Arayüz TR/EN; içerik dili, arama analyzer'ı ve sıralama dil bazlı.
9. **Kalite kapıdan girer.** Düşük kaliteli PDF/OCR otomatik yayına alınmaz.
10. **Dış bağımlılık yasağı.** Çekirdek; dış CDN, dış font, dış arama, dış kimlik ve zorunlu bulut servisi olmadan çalışabilmelidir.

---

## 2. Kapsam

### 2.1 Kapsam içi

- Platform kataloğu ve kiracı kataloğu (kurumun kendi/satın aldığı içerik)
- PDF/EPUB okuma, not/vurgu, ilerleme, atıf
- Arama, keşif, koleksiyonlar
- Kiracı yönetimi, kullanıcı/rol/grup, erişim hakları
- İçerik alma hattı (yükleme, OCR, kalite kapısı, metadata)
- Yönetim konsolları, raporlama, audit
- Çok dillilik, erişilebilirlik, güvenlik, yedekleme, gözlemlenebilirlik
- SaaS / dedicated / on-prem dağıtım
- API, OPDS, MARC, SSO entegrasyonları
- AI katmanı (opsiyonel modül; MVP'de kapalı, kiracı bazlı açılır)

### 2.2 Kapsam dışı `[X]`

- Ödeme, abonelik tahsilatı, fatura, e-arşiv
- Yayıncı–kurum tedarik/sipariş/teklif akışı
- Telif mutabakatı ve gelir paylaşımı
- Fiyatlandırma, kampanya, kupon
- Pazarlama sitesi ve reklam
- DRM (LCP/Adobe) — `[V2]`; MVP'de filigran + erişim kontrolü
- Mobil native uygulama — `[V2]`; MVP'de PWA/responsive
- Sesli/video içerik — `[V2]` opsiyonel

---

## 3. Kullanıcı rolleri ve yetki matrisi

| Rol | Tanım |
|---|---|
| **PA** | Platform yöneticisi |
| **PCE** | Platform içerik editörü |
| **TA** | Kiracı (kurum) yöneticisi |
| **LIB** | Kütüphaneci/küratör |
| **PUB** | Yayıncı kullanıcısı (kiracı içinde kendi içeriği) |
| **R** | Okuyucu |
| **G** | Misafir (yalnızca herkese açık önizleme) |
| **OPS** | Destek/operasyon (salt okunur + denetimli taklit) |

| Yetki | PA | PCE | TA | LIB | PUB | R | G |
|---|---|---|---|---|---|---|---|
| Kiracı oluşturma/silme | ✅ | — | — | — | — | — | — |
| Kiracı ayarları/marka | ✅ | — | ✅ | — | — | — | — |
| Kullanıcı/rol/grup yönetimi | ✅ | — | ✅ | — | — | — | — |
| Platform kataloğu | ✅ | ✅ | — | — | — | — | — |
| Kiracı kataloğu | ✅ | — | ✅ | ✅ | ✅* | — | — |
| İçerik yükleme | ✅ | ✅ | ✅ | ✅ | ✅* | — | — |
| Metadata düzenleme | ✅ | ✅ | ✅ | ✅ | ✅* | — | — |
| Koleksiyon yönetimi | ✅ | ✅ | ✅ | ✅ | ✅* | — | — |
| Erişim hakkı (grant) | ✅ | — | ✅ | — | — | — | — |
| Raporlar | ✅ | ✅ | ✅ | ✅ | ✅* | — | — |
| Audit log | ✅ | — | ✅ | — | — | — | — |
| Kaldırma/takedown | ✅ | ✅ | ✅ | — | — | — | — |
| Sistem sağlığı | ✅ | — | — | — | — | — | — |

`*` Yalnızca kendi yüklediği/izni olan başlıklar. Yetki kontrolü hem arayüzde hem API'de yapılır.

### 3.1 Grup yönetimi

- Grup CRUD; en fazla 3 seviye iç içe.
- Üyelik: manuel, CSV, SSO grup eşlemesi `[V1]`.
- Grup→rol eşlemesi; grant `subject_type=group` için zorunlu.
- Bir kullanıcı birden çok grupta olabilir; yetkiler birleşir, kısıtlar daraltır.
- Grup silindiğinde grant'ler `revoked` olur; audit kaydı tutulur.

### 3.2 Destek (OPS) taklit yönetişimi

- Süreli: en fazla 60 dk; gerekçe zorunlu.
- Kullanıcıya uygulama içi bildirim; ayrı audit kaydı.
- Varsayılan **salt okunur**; yazma gerekiyorsa TA onayı.
- Taklit sırasında PII maskeli görünüm.
- KVKK aydınlatmasında "destek amaçlı erişim" olarak belirtilir.

---

## 4. İçerik modeli ve metadata

### 4.1 Varlıklar

| Varlık | Açıklama | Öncelik |
|---|---|---|
| `Tenant` | Kurum/kiracı | M |
| `User`, `Role`, `Group`, `Membership` | Kimlik ve yetki | M |
| `Publisher` | İçerik sahibi/tedarikçi | M |
| `Work` | Bibliyografik eser | M |
| `Edition` | Baskı/versiyon | M |
| `Asset` | PDF/EPUB dosyası | M |
| `Chapter` | Bölüm/içindekiler | M |
| `Subject` | Kanonik konu ağacı | M |
| `Collection`, `CollectionItem` | Küratörlük | M |
| `Grant` | Erişim hakkı | M |
| `FieldOverride` | Kaynak metadata'ya alan bazlı düzeltme | V1b |
| `ReadingProgress` | Konum/ilerleme | M |
| `Annotation` | Vurgu, not, yer imi | M (PDF), V1 (EPUB) |
| `ReadingList` | Kullanıcı listesi | V1 |
| `ImportJob` | İçe aktarma işi | M |
| `AuditEvent` | Denetim kaydı | M |
| `Notification` | Bildirim | M |
| `TakedownRequest` | Kaldırma talebi | V1 |
| `FeatureFlag`, `Setting` | Yapılandırma | M |

> **Düzeltme:** v1.0'daki `LicenseTerm` kaldırıldı. Lisans koşulları `Grant` üzerinde taşınır; kullanıcıya gösterilecek lisans metni `Edition.license_note` alanındadır. Yeniden kullanılabilir grant şablonu ihtiyacı doğarsa `[V1]`'de `GrantTemplate` olarak eklenir.

`FieldOverride`: `entity_type`, `entity_id`, `field_name`, `source_value`, `override_value`, `overridden_by`, `overridden_at`, `source_checksum_at_override`. Amaç: DSpace/OAI gibi kaynaklardan gelen metadata'nın platformda düzeltilmesi ve sonraki harvest'ta ezilmemesi. Override yoksa kaynak değer kazanır; override varsa kaynak checksum'ı değişene kadar platform değeri korunur, checksum değişince çakışma uyarısı üretilir.

**Öncelik düzeltmesi:** `FieldOverride` yalnızca DSpace/OAI bağlayıcısıyla anlam kazanır; MVP'de uygulanmaz. Şema, bağlayıcıyla birlikte **V1b**'de freeze edilir; MVP'de yalnızca bu paragraflık tasarım notu tutulur.

### 4.2 Work/Edition/Asset ayrımı

- **Work:** başlık, yazarlar, dil, konu, özet.
- **Edition:** yayıncı, yıl, baskı, ISBN, DOI, sayfa sayısı, `license_note`.
- **Asset:** dosya, format, kalite, OCR, depolama anahtarı.

### 4.3 Zorunlu metadata

| Alan | Zorunlu | Not |
|---|---|---|
| `title` | ✅ | |
| `language` | ✅ | BCP 47 (`tr`, `en`) |
| `authors[]` | ✅ | en az bir |
| `publisher_id` | ✅ | |
| `publication_year` | ✅ | |
| `subjects[]` | ✅ | en az bir kanonik düğüm |
| `abstract` | ✅ | 80–2.000 karakter |
| `cover` | ✅ | yoksa üretilir |
| `isbn13` / `doi` / `handle` | — | varsa |
| `edition`, `series`, `volume` | — | |
| `original_title`, `translators[]` | — | çeviri ise |
| `keywords[]` | — | en az 3 önerilir |
| `license_uri` | — | makine-okunur lisans (CC/SPDX) |
| `license_note` | — | kullanıcıya görünen lisans/atıf metni |
| `rights_note` | — | hukuki hak beyanı (yükleyen/kaynak) |
| `audience` | — | akademik/profesyonel/öğrenci |

**Hak alanları hiyerarşisi:** `license_uri` makine-okunur gerçeği, `license_note` kullanıcıya gösterilen metni, `rights_note` ise hukuki beyanı taşır. Üçü çelişirse `license_uri` esas alınır; görünen metin buna göre üretilir.

### 4.4 Asset alanları

`format`, `storage_key`, `size_bytes`, `sha256`, `page_count`, `text_coverage_pct`, `ocr_status`, `dpi_estimate`, `quality_score`, `virus_scan_status`, `version`, `is_primary`, `visibility`, `source_system`, `source_id`, `source_url`, `source_checksum`, `harvested_at`, `access_status`.

### 4.5 Kanonik konu taksonomisi

- Tek ağaç; `label_tr`, `label_en`, `code` (LCC/DDC opsiyonel), `parent_id`.
- Yayıncı kategorileri bu ağaca eşlenir; serbest etiket ayrıca saklanır.
- Bir başlık 1–5 düğüme bağlanır.
- Eşlenemeyen kategori "Diğer" altında toplanır ve raporlanır `[V1]`.

---

## 5. İçerik alma (ingestion) hattı

### 5.1 Akış

```
yükleme → virüs tarama → arşiv/format doğrulama → metadata çıkarma
→ metin çıkarma → (gerekirse) OCR → kapak/önizleme
→ kalite puanı → inceleme kuyruğu → yayınlama
```

`ImportJob`: `queued → scanning → validating → extracting → ocr → review → completed | failed | cancelled`.

**Yeniden deneme:** Başarısız adımlar 3 kez exponential backoff ile denenir; tükenen işler **DLQ**'ya düşer ve admin panelden replay edilir. Aynı dosya için idempotent job anahtarı kullanılır. `[M]`

### 5.2 Format ve limitler

- PDF 1.4–2.0; EPUB 2.0/3.0.
- Maksimum dosya: 1 GB; maksimum sayfa: 5.000.
- Şifreli PDF kabul edilmez.
- **Zip-bomb koruması:** açılmış toplam boyut ≤ 2 GB, sıkıştırma oranı ≤ 100:1, giriş sayısı ≤ 10.000, path traversal reddedilir.
- EPUB `epubcheck` `[V1]`.

### 5.3 Kalite kapıları

| Kapı | Eşik | Başarısızsa |
|---|---|---|
| Metin kapsamı | ≥ %90 sayfada metin | OCR kuyruğuna |
| OCR güveni | ≥ %80 ortalama | Manuel inceleme |
| Sayfa yönü | Tüm sayfalar dik | Uyarı + inceleme |
| Görsel DPI | ≥ 150 (metin), ≥ 300 (atlas) | Uyarı |
| Metadata bütünlüğü | Zorunlu alanlar dolu | Yayınlanamaz |
| Kapak | Var veya üretilebilir | Otomatik üretim |

`quality_score` 0–100; 70 altı otomatik yayına alınmaz.

### 5.4 Tekilleştirme ve sürümleme

- `sha256` ile birebir tekrar engellenir.
- Aynı ISBN + farklı dosya "yeni sürüm" olarak işaretlenir.
- Asset değişimi eski sürümü arşivler; okuma konumu locator ile korunur.
- Farklı baskı ayrı `Edition`.

### 5.5 OCR ve koordinatlar

- Tesseract; `tur+eng` varsayılan, `ota`/`ara` opsiyonel.
- Çıktı **hOCR** olarak saklanır; kelime kutuları sayfa bazlı koordinatlandırılır. ALTO'ya dönüşüm `[V1]`.
- Koordinatlar, taranmış PDF üzerinde vurgu/seçim hizalaması için zorunludur; düz metin yeterli değildir.
- OCR sonucu orijinal PDF'e gömülmez; ayrı katman + arama indeksi.
- Sayfa bazlı ilerleme ve iptal.
- **Maliyet modeli:** Sayfa başına ortalama süre/CPU ölçülür; yükleme sırasında tahmini süre kullanıcıya gösterilir; kuyruk önceliği küçük dosya önce; günlük OCR kotası ve raporu.

### 5.6 Kapak ve önizleme

- Kapak yoksa ilk sayfadan üretilir.
- **Önizleme kuralı:** `preview_pages = min(30, max(2, ceil(0.1 × n)))`; `n < 20` ise `min(2, n)`. Yayıncı 0–%30 arasında geçersiz kılabilir; ancak **misafir önizleme için alt sınır 2 sayfa**dır. Yayıncı 0 verirse platform varsayılanı uygulanır ve gerekçe audit'e yazılır.
- Küçük resimler: grid, detay, sosyal.

### 5.7 Yükleme yolları

- Tek dosya (form)
- Toplu: ZIP + CSV `[M]` — şema Ek 28.5
- API `[V1]`
- İzlenen klasör / S3 prefix `[V1]`

### 5.8 Yayınlama ve geri çekme

- `draft → in_review → published → embargoed → unpublished → archived`
- Yayınlama yetkisi: PCE/TA/LIB (kapsama göre).
- Geri çekme anında etkili; önbellek temizlenir.
- Planlı yayın `[V1]`.

---

## 6. Okuma deneyimi

### 6.1 PDF mimarisi (MVP'nin ilk kararı)

**POC zorunlu:** İlk 2 haftada üç gerçek dosyayla test edilir: 50 MB metin PDF, 300 MB taranmış PDF, 500 MB görsel ağırlıklı PDF.

**Ön koşul:** Bu üç dosya proje başlamadan (hafta 0) temin edilmiş olmalıdır; dosyalar yayıncıdan/kurumdan gelir. Dosya yoksa POC başlamaz ve MVP takvimi kayar. Sorumlu: ürün sahibi; tarih: hafta 0.

**Soğuk önbellek:** Test, önbellek/CDN boşken ve 20 Mbps bağlantıda yapılır. 500 MB PDF'te xref/trailer dosya sonunda olabileceği için range request zinciri ilk sayfayı geciktirebilir; bu senaryo ayrıca ölçülür.

| Metrik | Eşik |
|---|---|
| İlk sayfa | < 2 sn (soğuk önbellek, 20 Mbps) |
| Bellek | < 500 MB |
| Zoom 400% | Donma yok |
| Sayfa geçişi | < 300 ms |

**Varsayılan:** PDF.js istemci tarafı, range request, worker, sayfa sanallaştırma, metin katmanı.
**Yedek plan:** POC eşiği geçmezse büyük/taranmış dosyalar için sunucu tarafı sayfa görüntüsü + metin overlay'i; önbellekli. Karar POC sonunda yazılı verilir. **Yedek plan devreye girerse MVP takvimine +4–6 hafta eklenir.**

### 6.2 PDF okuyucu `[M]`

- Sürekli ve sayfa modu; zoom %50–400; sığdır/döndür.
- Küçük resim, içindekiler, sayfaya git.
- Metin seçimi, kopyalama (izin varsa), vurgu.
- Kitap içi arama, sonuçtan sayfaya atlama.
- Masaüstünde çift sayfa; mobilde pinch-zoom.
- 500 MB / 2.000 sayfa hedefi; bellek taşması yok.

### 6.3 EPUB okuyucu

- `[M]` temel reflow, TOC, tema (açık/sepia/koyu), yazı boyutu, konum (CFI) ve yer imi.
- `[V1]` gelişmiş tipografi, dipnot popup, MathML, RTL, fixed-layout, heceleme.
- `[V1]` CFI tabanlı vurgu/not. MVP'de EPUB notu yok; yalnızca yer imi ve konum.

**Motor seçimi:** Readium mu epub.js mi? Bu karar spike'ta değil, **V1a başında** verilir; MVP temel reflow ile ilerler. Seçim kriteri: CFI doğruluğu, MathML/RTL desteği, paket boyutu, bakım. Karar ADR'ye yazılır.

### 6.4 Not, vurgu, yer imi

- `[M]` PDF: dört renk, not, yer imi; yan panel; filtre; konuma atlama; Markdown/CSV/JSON dışa aktarma.
- `[V1]` EPUB vurgu/not; cihazlar arası çevrimdışı birleştirme.
- Varsayılan gizli; kiracı yöneticisi bireysel notları göremez.

**Çapa modeli (MVP):** Her `Annotation` ve `ReadingProgress` kaydı `anchor jsonb` taşır:

```json
{ "asset_version_id": "...", "type": "pdf|epub", "page": 12,
  "rects": [[x1,y1,x2,y2]], "cfi": "epubcfi(...)",
  "text_quote": { "prefix": "...", "exact": "...", "suffix": "..." },
  "text_position": { "start": 120, "end": 180 } }
```

Asset yeni sürüme geçtiğinde çapa, `text_quote` eşleşmesiyle yeniden konumlanır (W3C Web Annotation TextQuoteSelector + RangeSelector). Eşleşme başarısızsa anotasyon **"yetim"** işaretlenir, **silinmez**; kullanıcıya gösterilir. EPUB'ta CFI birincil, `text_quote` yedektir. Çevrimdışı birleştirmede aynı çapaya iki not düşerse ikisi de saklanır, kullanıcı seçer.

**Eşleşme algoritması (C-01):** Normalize: whitespace tek, büyük/küçük harf katlama, Türkçe noktalama normalizasyonu. Sıra: (1) `exact` eşleşme; (2) `prefix+suffix` bağlamında Levenshtein ≤ %20; (3) bulunamazsa `page + rects` ile yerelleştir ve **"yetim adayı"** işaretle. Kullanıcı onayı olmadan silme yok; toplu "yetim temizleme" yok.

### 6.5 Atıf `[M]`

- APA 7, MLA 9, Chicago 17, IEEE; BibTeX/RIS `[V1]`.
- Sayfa aralığı; dil bazlı yerelleştirme; eksik alanda uyarı.

### 6.6 İlerleme `[M]`

- PDF sayfa + kaydırma oranı; EPUB CFI; yüzde; son okuma.
- "Okumaya devam et" rafı; cihazlar arası senkron.
- Çakışmada en son konum kazanır; kullanıcıya bildirilir.

### 6.7 İzinler

- Görüntüleme, indirme, yazdırma, kopyalama ayrı.
- İndirmede filigran (kullanıcı + tarih).
- Kopyalama kısıtlıysa seçim engellenir, neden gösterilir.
- Eşzamanlı oturum limiti aşılırsa açıklayıcı mesaj.

### 6.8 Okuyucu durumları

Yükleniyor, hata, erişim yok, süresi dolmuş, kontenjan dolu; her biri için mesaj ve çıkış yolu.

---

## 7. Arama ve keşif

### 7.1 Tek motor kararı `[M]`

MVP'de **tek motor**: Postgres FTS (`tsvector` + GIN, `turkish`/`english`, `unaccent`, `pg_trgm`). İki motorlu hibrit yapı yok.

OpenSearch'e geçiş eşiği (yazılı karar): p95 > 500 ms **veya** > 50.000 başlık **veya** relevans hedefi tutmuyor.

**Canlı öncesi doğrulama:** Geçiş kararı üretimde değil, canlıya çıkmadan önce **50.000 sentetik başlık + relevans seti** ile verilir. Eşik aşılıyorsa OpenSearch MVP'ye girer; aşmıyorsa V1'de izlenir.

### 7.2 İndekslenen alanlar

Başlık, alt başlık, yazar, editör, çevirmen, özet, anahtar kelime, konu, yayıncı, bölüm başlıkları, tam metin.

### 7.3 Davranış

- Tek arama kutusu; başlık + yazar + tam metin.
- Dil algılama; TR `turkish`, EN `english`.
- Eşleşme vurgusu ve bağlam.
- Yanlış yazım toleransı `[V1]`.
- Eşanlamlı/alias sözlüğü (`idare hukuku` ↔ `yönetim hukuku`) `[M]` altyapı, içerik `[V1]`.

**Türkçe stemmer yedek planı:** precision@10 0,60'ın altına düşerse (a) `simple` + trigram + synonym sözlüğü, (b) OpenSearch `turkish` analyzer. Karar, 20–30 gerçek PDF'lik test setiyle verilir; sonuç yazılı ADR'ye girer.

### 7.4 Fasetler ve sıralama

Konu, dil, yayıncı, yıl, format, koleksiyon, erişim. Sıralama: ilgi, başlık (yerel alfabe), yıl, eklenme, popülerlik.

### 7.5 Relevans test seti `[M]`

- 50 sorgu × beklenen ilk 10 sonuç.
- Ölçüt: precision@10 ≥ 0.70; aylık gözden geçirme.
- Test seti olmadan "arama çalışıyor" kabul edilmez.

### 7.6 Keşif

- `[M]` yeni eklenenler, seçkiler, popüler, sıfır sonuç analitiği.
- `[V1]` ilgili başlıklar, kayıtlı arama, yeni sonuç uyarısı.
- `[V2]` kişiselleştirilmiş öneri.

### 7.7 İzolasyon ve herkese açık keşif

- Platform + kiracı kataloğu; kiracı özel içeriği başka kiracıda görünmez; önbellek kiracı bazlı.
- `[V1]` SEO: SSR, `Book` yapılandırılmış verisi, sitemap, `hreflang`; özel içerik `noindex`.
- Misafir önizleme: 5.6 kuralı; indirme yok.

---

## 8. Koleksiyonlar ve küratörlük

- `[M]` manuel koleksiyon, sıralama, kapak, görünürlük, toplu ekleme/çıkarma, analitik.
- `[V1]` akıllı koleksiyon (kural bazlı), platformdan kiracıya seçki, koleksiyon kopyalama.
- `[M]` kiracı görünümünde platform + kiracı başlıkları karışabilir; başka kiracıya sızmaz.
- Öne çıkanlar ana sayfa vitrini; gizli koleksiyon arama dışı.

---

## 9. Çok kiracılılık, görünürlük ve izolasyon

### 9.1 Kiracı alanları

`name`, `slug`, `custom_domain`, `logo`, `colors`, `default_locale`, `timezone`, `status`, `storage_quota`, `user_quota`, `features[]`.

**Kota uygulaması:** Yumuşak eşik %90 (uyarı), sert eşik %100 (yükleme/davet reddi). Kontrol, işlem öncesi yapılır; artırım TA yetkisinde ve audit'li. Depolama büyüme modeli 18'de tanımlıdır.

### 9.2 İzolasyon katmanları

1. Veritabanı: `tenant_id` + row-level security.
2. Depolama: kiracı prefix'i; imzalı URL kiracıya bağlı.
3. Arama: kiracı filtresi; özel başlıklar platform indeksine yazılmaz.
4. Önbellek: kiracı anahtarı.
5. Arka plan işleri: kiracı bağlamı taşınır.
6. Loglar: kiracı etiketli; erişim yetkisi ayrı.

### 9.3 Görünürlük

- `platform`: tüm kiracılar görür; grant yoksa kilitli.
- `tenant`: yalnızca sahibi kiracı; kullanıcılarına otomatik açık.
- `private`: yükleyen + yetkili küratör.
- Koleksiyon görünürlüğü başlık görünürlüğünü genişletemez.

### 9.4 Kiracı yaşam döngüsü

Oluşturma, askıya alma, yeniden açma, kapatma. Kapatmada dışa aktarma (JSON/CSV + dosyalar), 30 gün bekleme, kalıcı silme; KVKK silme prosedürü.

### 9.5 Dağıtım modları

SaaS (RLS), dedicated (ayrı DB/depolama), on-prem (tek kiracı, çevrimdışı, lisans dosyası).

---

## 10. Kimlik, oturum ve SSO

- `[M]` e-posta/parola; doğrulama, sıfırlama, parola politikası; oturum yönetimi.
- `[V1]` MFA (TOTP), OIDC, SAML 2.0, LDAP/AD, JIT, grup→rol eşlemesi.
- `[V1]` IP aralığı; `[V2]` EZproxy uyumu.
- `[V1]` misafir/deneme erişimi.
- Hız limiti, hesap kilitleme, şüpheli giriş bildirimi.
- Giriş/çıkış ve rol değişiklikleri audit log'da.
- Aynı e-posta yerel + SSO: varsayılan SSO kazanır; yerel parola devre dışı.

---

## 11. Erişim hakları (entitlement)

### 11.1 Grant modeli

| Alan | Değer |
|---|---|
| `subject_type` | tenant / group / user |
| `scope_type` | all / publisher / subject / collection / title |
| `valid_from`, `valid_to` | tarih |
| `seat_limit` | eşzamanlı oturum |
| `source` | subscription / trial / purchase / manual |
| `status` | pending / active / expired / revoked |

**Ayrım:** `access_model` içeriğin nasıl sunulduğunu (`subscription`/`perpetual`/`trial`), `grant.source` ise kiracının bu hakkı nasıl aldığını (`subscription`/`trial`/`purchase`/`manual`) anlatır. İki katman ayrıdır; bir grant, access_model'e birebir uymak zorunda değildir (ör. hediye/manuel grant).

### 11.2 Kontrol akışı

`kullanıcı → kiracı → grup → grant → başlık/koleksiyon → süre → kontenjan`

**Hiyerarşi:** Grant çözümlemesi kiracı ağacını yukarı doğru izler (departman → kurum → konsorsiyum). En spesifik grant kazanır; çakışmada **kısıtlayıcı olan** uygulanır. MVP'de hiyerarşi tek seviye; V2'de çok seviye. Şema (`tenant.parent_id`) MVP'de hazırdır.

- Sonuç: `allow` veya `deny(reason)`.
- Nedenler: abonelik yok, süre doldu, kontenjan dolu, kapsam dışı, kiracı askıda.
- Hedef < 200 ms; önbellek **max TTL 60 sn**; `revoked`/`expired` olayları cache'i anında temizler. İptal sonrası erişim en fazla 60 sn sürebilir; bu süre sözleşmede belirtilir.

### 11.3 Oturum ve kontenjan

- **Hareketsizlik: 60 dk.** Okuyucu görünürken 5 dk'da bir heartbeat; `visibilitychange`/`pagehide` üzerinde `sendBeacon` ile oturum bırakılır.
- **Kontenjan sayacı:** Redis'te atomik `INCR/DECR`; çökme sonrası 60 dk hareketsizlikle düşer; yarış koşulunda ret, kuyruk değil.
- Limit aşımında kuyruk değil, açıklayıcı ret.

### 11.4 Görünürlük

- Erişimi olmayan başlık kilitli gösterilir veya gizlenir (kiracı ayarı).
- Kilitli başlıkta neden + kütüphaneci iletişimi.

### 11.5 Yönetim

- `[M]` manuel grant, süre uzatma/iptal, geçmiş.
- `[M]` toplu CSV.
- `[V1]` Grant API + webhook (yenileme otomasyonu); API olmadan her yenileme manuel operasyon olur.
- `[V1]` deneme erişimi otomatik süre sonu.

---

## 12. Yönetim konsolları

### 12.1 Platform (PA/PCE)

Kiracılar, yayıncılar, platform kataloğu, taksonomi, kullanıcılar, koleksiyonlar, import kuyruğu, audit, raporlar, sistem sağlığı, feature flag, takedown.

### 12.2 Kiracı (TA/LIB)

Dashboard, kullanıcı/grup/rol, katalog, koleksiyonlar, grant'ler, marka, raporlar, audit, SSO `[V1]`.

### 12.3 Yayıncı (PUB)

Kendi başlıkları, metadata, asset/sürüm, koleksiyonlar, kendi kullanım raporu.

### 12.4 Kütüphaneci araçları

- `[V1]` MARC21 dışa aktarma — profil Ek 28.6.
- `[V1]` KBART.
- `[V1]` toplu metadata düzenleme.
- `[V1]` kalite raporu (OCR'sız, metadatsız, kapaksız).

### 12.5 Arayüz gereksinimleri

Tablo sıralama/filtre/sayfalama/toplu seçim/kayıtlı görünüm; satır içi düzenleme; yıkıcı işlemde onay + soft delete; klavye; boş/yükleniyor/hata durumları.

---

## 13. Raporlama ve analitik

- `[M]` dört metrik: aktif kullanıcı, açılan başlık, okuma süresi, arama/sıfır sonuç.
- `[V1]` koleksiyon performansı, tamamlanma, dil/konu/yayıncı kırılımı, depolama/kuyruk, zamanlanmış rapor.
- `[V2]` COUNTER 5.1 / SUSHI.
- Kiracı yalnızca kendi verisini görür; bireysel okuma geçmişi varsayılan gizli.
- Dışa aktarma CSV/XLSX; **CSV injection koruması** (bkz. 17.1).

---

## 14. Çok dillilik

- `[M]` TR/EN arayüz; içerik dili, `original_language`, çevirmen.
- `[M]` dil bazlı analyzer ve `Intl.Collator`.
- `[M]` atıf yerelleştirmesi; tarih/sayı biçimi.
- `[V1]` ek arayüz dilleri, RTL, başlık/özet çevirisi.
- E-posta ve hata mesajları çevrilebilir; eksik çeviri İngilizceye düşer.
- `hreflang`, dil değiştirici, kiracı/kullanıcı varsayılanı.

---

## 15. Erişilebilirlik

Hedef **WCAG 2.2 AA**: klavye, odak, landmark, etiket, kontrast ≥ 4.5:1, %200 zoom, `prefers-reduced-motion`, alt metin, EPUB erişilebilirlik metadata'sı, erişilebilirlik beyanı `[V1]`. Otomatik (axe) + manuel ekran okuyucu testi. Kritik axe ihlali 0.

**PDF beyanı:** Platform, yüklenen PDF'lerin yapısal etiketlemesini garanti etmez. Erişilebilirlik beyanında "PDF'lerde yapısal etiketleme yükleyici sorumluluğundadır; platform metin katmanı, hOCR ve ekran okuyucu uyumlu görüntüleyici sağlar" yazar. Kabul kriteri buna göre daraltılır.

---

## 16. Entegrasyonlar ve API

- `[M]` REST API çekirdeği (katalog, grant, arama) + token.
- `[V1]` webhook (HMAC), OPDS 1.2/2.0, MARC21, KBART, SSO, S3, SMTP, Matomo.
- `[V2]` ONIX 3.0, DOI/Crossref, LTI 1.3, OpenURL, SUSHI.
- API: sürümleme, hız limiti, idempotency, hata formatı, sayfalama, deprecated politikası.

---

### 16.5 AI katmanı (opsiyonel modül)

**İlke:** AI çekirdek değil, katmandır. Kapalıyken platform tüm işlevlerini eksiksiz yerine getirir. Her kiracı ayrı açar; her AI çıktısı kaynak gösterir ve "doğrulanmalı" etiketi taşır.

| Kullanım | Değer | Risk | Öncelik |
|---|---|---|---|
| Metadata/özet çıkarma | içe aktarma hızı | hatalı künye | V1 (insan onaylı) |
| Konu sınıflama | tutarlılık | yanlış eşleme | V1 |
| Anlamsal arama | doğal dil sorgusu | relevans | V1 |
| İlgili başlıklar | keşif | yanlış öneri | V1 |
| Özet (extractive) | hızlı tarama | bağlam kaybı | V1 |
| Alt metin üretimi | erişilebilirlik | yanlış açıklama | V1 |
| Kaynaklı soru-cevap (RAG) | araştırma | halüsinasyon | V2 |
| Çeviri (özet/abstract) | erişim | kalite | V2 |
| Metin okuma (TTS) | erişilebilirlik | — | V2 |
| Kişiselleştirme | keşif | filtre balonu | V2 |
| Destek botu | operasyon | — | V2 |

**Mimari**

- `ai-gateway` ayrı servis; sağlayıcı soyutlaması (bulut / yerel model).
- Embeddings: **pgvector** (Postgres); ayrı vektör veritabanı yok.
- **Embedding yaşam döngüsü:** `embedding_model` alanı; model/versiyon değişiminde kademeli yeniden embed job'u (DLQ'li); pgvector indeks yeniden kurma süresi ölçülür; eski embedding'ler silinir. Maliyet kalemleri: token + embedding + saklama; kiracı kotasına yazılır.
- Chunking: bölüm/sayfa; her chunk'ta kitap, bölüm, sayfa metadata'sı.
- Hybrid retrieval: BM25 + vektör; gerekirse rerank.
- Cevap sözleşmesi: `answer`, `citations[]` (kitap/bölüm/sayfa), `confidence`, `refused`.
- Kaynak yoksa cevap üretilmez; "bulunamadı" döner.
- Kiracı bazlı kota, **aylık USD maliyet tavanı** (varsayılan $50, yapılandırılabilir) ve önbellek; tavan aşımında AI devre dışı kalır, admin panelden açılır.
- Sağlayıcıya yalnızca gerekli chunk gider; "no training" ve sıfır/30 gün saklama sözleşmesi.
- On-prem: yerel model (GPU) opsiyonel; GPU yoksa AI kapalı.

**Güven ve hukuk**

- Yayıncı sözleşmesinde **AI işleme ve TDM izni** ayrı maddeler (opt-in); izin yoksa metin embed edilmez, yalnızca metadata indekslenir. AB DSM 4. m. / Türkiye karşılığı için hukuk görüşü alınana kadar varsayılan opt-in.
- AI cevabı akademik/hukuki tavsiye değildir; kullanıcı kaynağı doğrular.
- Değerlendirme: V1'de **50 soru**, V2 RAG'de **100 soru**; citation precision ≥ 0.90, refusal doğruluğu ≥ 0.80.
- KVKK: kişisel veri modele gitmez; loglarda PII yok.
- Model/versiyon kaydı; cevap zamanı ve kaynak sürümü saklanır.

**Sürümler**

- **MVP:** yok. AI, MVP kapsamına girmez; metadata önerisi dahil tüm AI özellikleri V1'dedir.
- **V1:** metadata/konu önerisi, anlamsal arama, ilgili başlıklar, extractive özet, alt metin. Anlamsal arama **"sohbet" olarak değil, kaynaklı arama** olarak sunulur: doğal dil sorgusuna sayfa/bölüm atıflı pasajlar döner; serbest metin cevap üretmez.
- **V2:** RAG soru-cevap, çeviri, TTS, kişiselleştirme, on-prem yerel model.

**Kabul (V1)**

- AI kapalıyken tüm çekirdek akışlar çalışır.
- V1'de 50 soruluk sette citation precision ≥ 0.90; V2 RAG'de 100 soru.
- Kiracı maliyet tavanı aşılmaz; aşımda AI devre dışı.
- Her AI çıktısında kaynak ve "doğrulanmalı" etiketi bulunur.

---

### 16.6 Kurumsal arşiv bağlayıcıları (DSpace ve benzeri)

**İlke:** Kurumun arşivi **kayıt kaynağı** olarak kalır; platform okuma ve keşif katmanıdır. Kopyalama yalnızca haklar ve erişim korunarak yapılır.

| Kaynak | Protokol | Öncelik |
|---|---|---|
| DSpace 6/7 | OAI-PMH + REST | V1 |
| EPrints | OAI-PMH | V1 |
| Islandora/Fedora | OAI-PMH / REST | V2 |
| Omeka | OAI-PMH | V2 |
| Digital Commons, CONTENTdm | OAI-PMH | V2 |
| Generic OAI-PMH | OAI-PMH | V1 |

**Senkronizasyon**

- Tam + artımlı harvest (`from`/`until`, `resumptionToken`).
- Silinen kayıt (`header@status=deleted`) platformda unpublish edilir.
- Gece job'u; manuel tetikleme; hata raporu; kaynak hız limitine saygı.
- Upsert anahtarı: `source_system` + `source_id`.
- Çakışma: kaynak sistem kazanır; platformda yapılan alan bazlı metadata düzeltmeleri korunur (override kaydı ile).

**Metadata eşlemesi**

| Kaynak alanı | Platform alanı |
|---|---|
| `dc:title` | `title` |
| `dc:creator` | `authors[]` |
| `dc:date.issued` | `publication_year` |
| `dc:identifier.uri` | `handle` / permalink |
| `dc:description.abstract` | `abstract` |
| `dc:subject` | `subjects[]` |
| `dc:language` | `language` |
| `dc:type` | `content_type` (thesis/article/book/report) |
| `dc:publisher` | `publisher` |
| `dc:rights` | `rights_note` |

Handle/DOI korunur; platform kalıcı bağlantı üretir. Eşlenemeyen alanlar `source_metadata` JSON'unda saklanır.

**Erişim ve haklar**

- Varsayılan: yalnızca **açık erişimli** bitstream'ler.
- Kısıtlı bitstream harvest edilmez; metadata + kaynak linki gösterilir.
- Kurum SSO'su ile kısıtlı içeriğe erişim `[V2]`; DSpace yetkisi asla atlanmaz.
- Lisans/atıf bilgisi görünür; yeniden barındırma izni yoksa kopya tutulmaz.

**Depolama modları**

- `reference`: yalnızca URL + metadata; okuma kaynaktan.
- `cache`: açık erişimli PDF kopyalanır, metin çıkarılır/OCR yapılır; kaynak checksum ile tazelenir.
- Varsayılan: açık erişimde `cache` (okuma performansı), kısıtlıda `reference`.

**Kabul**

- 1.000 OAI kaydı harvest; artımlı güncelleme; silinen kayıt unpublish.
- Handle korunur; "Kaynak: DSpace" rozeti görünür.
- Kısıtlı bitstream platformda açılmaz.

**Neden:** Kurumlar DSpace'i bırakmaz; okuma/keşif katmanı için yeni ürün alır. Bu, satışı kolaylaştırır ve platformu "DSpace alternatifi" değil, "DSpace'in okuma katmanı" yapar.

---

## 17. Güvenlik, gizlilik ve uyum

### 17.1 Uygulama güvenliği

- OWASP ASVS L2 hedefi; RBAC + kiracı izolasyonu; her endpoint'te yetki.
- Yükleme: MIME sniffing, boyut, uzantı, ClamAV, işleme izolasyonu, **zip-bomb limitleri** (5.2).
- İmzalı URL, kısa süre, kiracıya bağlı.
- TLS 1.2+, HSTS, güvenli çerez, CSRF, XSS/SSRF.
- **CSP** (nonce tabanlı, `unsafe-inline` yok), üçüncü taraf için **SRI**. PDF.js worker ve blob URL için istisna: `worker-src 'self' blob:`, `frame-src 'self' blob:`, `img-src 'self' data: blob:`.
- Sırlar secret manager'da; **90 günde rotasyon**; repoda sır yok.
- **CSV/XLSX injection:** `=`, `+`, `-`, `@` ile başlayan hücreler kaçırılır.
- **Webhook:** HMAC-SHA256 + zaman damgası + idempotency; 5 deneme, exponential backoff; tükenen olay **DLQ + manuel replay** `[V1]`.
- Hız limiti, WAF, DDoS.
- `[M]` threat model (STRIDE), SAST, bağımlılık taraması.
- `[V1]` harici sızma testi; gerçek kurum verisiyle pilottan **önce** zorunlu.

### 17.2 Gizlilik ve uyum

KVKK/GDPR: aydınlatma, minimizasyon, saklama süresi, veri sahibi hakları, ihlal bildirimi, çerez politikası. Kurum veri sorumlusu, platform veri işleyen; DPA. Veri yerelleştirme seçeneği `[V1]`.

**Audit ↔ silme uzlaşması:** Silme talebinde audit kayıtlarının PII alanları maskelenir; olay kaydı (kim/ne/ne zaman — anonim) denetim için saklanır. Saklama: audit olayı **2 yıl**, PII **90 gün**. KVKK aydınlatmasında bu ayrım açıkça yazılır.

### 17.3 Telif ve kaldırma

Hak beyanı kaydı; şikayet → inceleme → geçici kapatma → karar → audit. Kaldırılan içerik anında erişim dışı.

### 17.4 Yedekleme

Günlük tam, saatlik artımlı `[V1]`; şifreli, ayrı bölge; üç ayda bir geri yükleme tatbikatı. **Yedek saklama 30 gün**; silme talebi yedeklerde en geç 30 gün içinde yayılır ve GDPR/KVKK uyumu bu süreyle belgelenir.

---

## 18. Performans ve ölçeklenebilirlik

| Metrik | Hedef |
|---|---|
| Sayfa açılışı p95 | < 2 sn |
| Arama p95 | < 500 ms (10.000 başlık) |
| Okuyucu ilk sayfa | < 2 sn (500 MB PDF) |
| Grant kontrolü | < 200 ms |
| Yükleme kuyruğu | 100 dosya/saat (tek worker) |
| Eşzamanlı okuyucu | MVP kabul 50; V1 hedef 100 (tek node); yatay ölçek |
| Kullanılabilirlik | Pilot %99,5; hedef %99,9 |
| RPO / RTO | 24 saat / 4 saat (pilot); 1 saat / 1 saat (hedef) |

CDN yalnızca herkese açık kapak/önizleme için; çekirdek dış bağımlılıksız. Yavaş sorgu logu, kuyruk ayrımı, durumsuz uygulama, Redis oturum. `[V1]` 100 eşzamanlı / 10.000 başlık yük testi.

**Depolama büyüme modeli:** ortalama asset boyutu × başlık sayısı × sürüm çarpanı (varsayılan 1,3). Kota ve arşiv politikası bu modelle hesaplanır; sürüm arşivi ayrı sayılır.

**OCR kuyruğu:** ayrı worker; günlük kota; küçük dosya önce; sayfa başına süre ve CPU metriği; 10.000 sayfalık işin tahmini süresi kullanıcıya gösterilir.

---

## 19. Dağıtım, operasyon ve bakım

### 19.1 Servisler

`web`, `worker`, `postgres`, `redis`, `minio/s3`, `caddy/nginx`; OpenSearch yalnızca eşik aşılırsa.

### 19.2 Ortamlar

`dev`, `staging`, `prod`; konfigürasyon ortam değişkeni; staging'de anonim veri.

### 19.3 Kurulum

Docker Compose (pilot/on-prem); Kubernetes `[V2]`. Tek komut, sağlık kontrolü, seed admin, otomatik migration, rollback prosedürü.

**RLS kuralı:** Her yeni tablo `tenant_id` + RLS policy ile gelir; CI'da policy kapsam testi çalışır ve `tenant_id`'siz tablo build'i kırar. Migration geri alma + yedekten doğrulama runbook'u MVP'dedir.

### 19.4 On-prem / air-gap

**Karar: ilk günden "on-prem-ready", kurulum paketi `[V1a]`.**

- `[M]` Dış bağımlılık yasağı: dış CDN/font/arama/kimlik/telemetri yok; S3 uyumlu depolama; SMTP.
- `[M]` Lisans kancası + feature flag; imzalı lisans dosyası doğrulama. Saat geri alma toleransı ±24 saat; grace **30 gün**; süre bitiminde **salt okunur mod** (yükleme/not kapalı, okuma açık); konsorsiyum lisansı `parent_id` hiyerarşisini kapsar; denetim tamamen çevrimdışı.
- `[M]` Kurulumun çevrimdışı çalışacağı varsayımıyla bağımlılık seçimi.
- `[M]` Air-gap'te bulut secret manager yok; **HashiCorp Vault (self-hosted)** veya şifreli dosya tabanlı store kullanılır.
- `[V1a]` Çevrimdışı kurulum paketi, güncelleme paketi, rollback, iç CA ile TLS.
- `[V1]` Kullanım raporu dışa aktarma (yayıncı/dernek için): `tenant, title_id, isbn, format, sessions, pages_viewed, downloads, period_start, period_end` kolonlarıyla CSV.

### 19.5 Gözlemlenebilirlik

JSON log (kiracı etiketli, PII maskeli), metrik, trace, alarm (5xx, kuyruk, disk, yedek hatası), operasyon ve iş dashboard'u ayrı.

### 19.6 CI/CD

Lint, tip, unit, integration, e2e; imaj build + tarama; staging otomatik, prod onaylı; migration testi.

### 19.7 Dokümantasyon

Yönetici/kullanıcı kılavuzu, API dokümanı, kurulum/yedek runbook'u, SSS `[V1]`.

---

## 20. Mobil ve çevrimdışı

- `[M]` responsive web (320 px–4K), iOS Safari/Android Chrome.
- `[V1]` PWA: yüklenebilir, çevrimdışı kabuk, son okunan sayfa önbelleği.
- `[V2]` çevrimdışı indirme, native/React Native, push.

---

## 21. Bildirimler

Uygulama içi + e-posta: hoş geldin, parola, davet, yeni başlık, koleksiyon, erişim süresi, import, kota, takedown. Tercihler; kritik güvenlik bildirimi kapatılamaz. TR/EN şablon; SPF/DKIM/DMARC; hız limiti; günlük özet `[V1]`.

**Teslim edilebilirlik:** Bounce/complaint webhook'u; sert bounce → hesap işaretlenir; complaint → bildirim durur; itibar günlük raporu. Kritik güvenlik e-postası bu kurallardan muaftır.

---

## 22. İçerik yaşam döngüsü ve kaldırma

- `draft`, `in_review`, `published`, `embargoed`, `unpublished`, `archived`.
- **Embargo davranışı:** Katalogda ve aramada **görünmez**; doğrudan URL "yayın tarihi: X" der; SEO'ya kapalı; tarihte otomatik yayınlanır.
- Planlı yayın/bitiş `[V1]`; sürüm arşivi; kaldırma (geçici/süresiz) + audit; saklama süresi sonunda silme; yinelenen birleştirme `[V1]`; metadata kalite paneli.

---

## 23. Fonksiyonel olmayan gereksinimler

| Alan | Gereksinim |
|---|---|
| Tarayıcı | Chrome/Edge/Firefox/Safari son 2 sürüm; iOS Safari 16+ |
| Ekran | 320 px–4K; dokunmatik + klavye |
| Dil | TR/EN arayüz; içerik dili sınırsız |
| Erişilebilirlik | WCAG 2.2 AA |
| Güvenlik | ASVS L2; yıllık sızma testi |
| Gizlilik | KVKK/GDPR |
| **Kullanılabilirlik** | **%99,5 pilot** |
| Yedek | Günlük; RPO 24s / RTO 4s |
| Log saklama | 90 gün (yapılandırılabilir) |
| API | Sürümlü, geriye uyumlu |
| Yükseltme | Kesintisiz hedef `[V2]` |

---

## 24. Test stratejisi

- Unit: iş kuralları, grant, metadata.
- Integration: API + DB + depolama.
- E2E: okuma, not, arama, yükleme, grant.
- **Kiracı izolasyonu (iki katman):** (a) DB/RLS — her tabloda `tenant_id` zorunlu, policy kapsam testi CI'da; (b) arama — A'nın özel başlığı B'nin arama sonuçlarında, faset sayımlarında, önerilerde ve sitemap'te görünmez. OpenSearch yolunda "default deny" tenant filtresi zorunlu ve aynı test koşar.
- **PDF POC:** üç dosya, 6.1 eşikleri.
- **Relevans:** 50 sorgu, precision@10 ≥ 0.70.
- **Türkçe kalite:** 20–30 gerçek akademik PDF'te OCR CER/WER; stemmer sorguları.
- Yük: 100 eşzamanlı, 10k başlık.
- Güvenlik: yetki yükseltme, IDOR, dosya yükleme, zip-bomb, CSV injection, webhook imzası.
- Erişilebilirlik: axe + manuel.
- Tarayıcı/cihaz matrisi.
- Migration/rollback; yedek/geri yükleme; yerelleştirme; duman testi.
- **hOCR hizalama:** taranmış PDF'te kelime seç → vurgu kutusu aynı kelimede mi (E2E).
- **DSpace senkron:** 1.000 kayıt harvest, artımlı güncelleme, silinen kayıt unpublish, kısıtlı bitstream açılmıyor `[V1]`.

---

## 25. Kabul kriterleri (MVP)

1. 8 kitap, 4 alan, TR/EN; hepsi açılır ve aranır.
2. 300 MB taranmış PDF yüklenir; OCR (hOCR) tamamlanır; metin aranır; vurgu hizalanır.
3. 500 MB PDF'te ilk sayfa < 2 sn, bellek < 500 MB.
4. Vurgu/not kaydedilir; oturum kapanıp açılınca korunur.
5. A kiracısı B'nin özel başlığını URL ile bile açamaz.
6. "implant" araması TR/EN sonuç döndürür; dil faseti çalışır.
7. 10.000 başlıkta arama p95 < 500 ms; relevans precision@10 ≥ 0.70.
8. Tek node'da 50 eşzamanlı okuyucu hatasız; 60 dk hareketsizlikte kontenjan düşmez.
9. Grant yoksa başlık kilitli; neden görünür.
10. 10 sayfalık kitapta önizleme 2 sayfa.
11. Embargo'lu başlık katalogda/aramada yok.
12. Zip-bomb reddedilir; CSV injection kaçırılır.
13. axe kritik 0; klavye ile tüm akışlar.
14. Docker Compose ile temiz sunucuda kurulum < 30 dk.
15. Yedekten geri yükleme < 1 saat.
16. MARC21 çıktısı doğrulanır `[V1]`.
17. AI modülü kapalıyken tüm MVP akışları eksiksiz çalışır; AI açıldığında her çıktı kaynak gösterir.
18. DSpace OAI-PMH'ten 1.000 kayıt harvest edilir; artımlı güncelleme ve silinen kayıt unpublish çalışır `[V1]`.
19. Handle korunur; kaynak rozeti görünür; kısıtlı bitstream platformda açılmaz `[V1]`.
20. Senkron sonrası yetim kayıt raporu üretilir `[V1]`.
21. Ana sayfadan herhangi bir kitabın okuyucusuna **≤ 3 tık** (ölçülür).
22. Kiracı "gizle" seçtiyse erişimi olmayan başlık aramada/listede görünmez; "kilitle" seçtiyse görünür ama açılmaz.
23. Taranmış PDF'te hOCR kelime kutusu, seçilen kelimenin üzerine hizalanır (E2E).

---

## 26. Sürüm planı

### 26.1 Tıklanabilir demo (3–4 hafta)

- 8 kitap, 4 alan, TR/EN
- PDF + temel EPUB okuyucu, not (PDF), arama, koleksiyon
- İki kiracı (A/B) ve basit grant; A, B'nin özel başlığını göremez (izolasyon demoda gösterilir)
- Amaç: yayıncı/kurum sunumu; üretim değil

**Kalibrasyon spike'ı (2 hafta, demo sonrası):** Tek kiracı, tek kitap, uçtan uca okuma + not + arama + grant. Spike 2 haftayı aşarsa MVP tahmini **30+ haftaya** çıkar; 24–28 hafta yalnızca spike başarılıysa geçerlidir.

**Spike girdileri (bloker):**
1. Üç POC PDF: 50 MB dijital, 300 MB taranmış, 500 MB görsel ağırlıklı.
2. En az **iki hedef kitap**: biri doğuştan dijital (metin katmanı), biri taranmış (hOCR + vurgu hizalaması için). Tek PDF iki yolu test etmez.
3. Kullanım izni: yayıncı onayı veya kamu malı.

**Scaffold sprint ≠ measurement sprint:** Repo, Docker Compose, upload, PDF.js görüntüleyici, `anchor` şeması ve Postgres FTS, kamu malı bir PDF ile bugün kurulabilir. **Ölçüm, üç POC dosyası gelmeden başlamaz.** Scaffold "çalışıyor" demek, spike "geçti" demek değildir.

### 26.2 MVP (24–28 hafta, 1 kişi tam zamanlı)

- Çok kiracılılık + RLS + görünürlük
- Platform + kiracı kataloğu
- PDF okuyucu (POC sonucu), temel EPUB (reflow/TOC/tema/konum)
- PDF not/vurgu; EPUB yer imi
- Postgres arama + faset + relevans seti
- Manuel koleksiyon
- Kullanıcı/rol/grup (temel), grant (manuel + CSV)
- Kiracı konsolu
- Ingestion + kalite kapısı (temel) + hOCR
- TR/EN, responsive, Docker, yedek, audit
- 4 metrik rapor + **olay sözlüğü** (event taxonomy)
- Threat model + SAST + zip-bomb/CSV injection
- **DLQ/retry**, **indeks yeniden kurma runbook'u**, **maintenance mode**, **404/500 sayfaları**
- **FieldOverride tasarım notu** (uygulama V1b'de DSpace/OAI ile)
- On-prem uyumluluk kancası

**MVP'den V1'e taşınanlar:** akıllı koleksiyonlar, EPUB vurgu/not, gelişmiş raporlar, platformdan kiracıya seçki, MARC/OPDS/SSO, grant API, on-prem kurulum paketi, toplu metadata araçları, **kalite raporu paneli**.

### 26.3 Pilot (MVP + 4–6 hafta; toplam 28–34 hafta)

MVP + V1a'dan SSO (tek IdP) ve MARC + gerçek kurum verisiyle sızma testi, yedek tatbikatı, destek runbook'u.

### 26.4 V1a, V1b ve V2

**V1a — altyapı (3–4 ay):** OCR kuyruğu, toplu import, EPUB doğrulama, SSO/MFA, MARC/KBART/OPDS 1.2/API/webhook, marka/alan adı, kota, zamanlanmış rapor, on-prem kurulum paketi, gözlemlenebilirlik. **Pilot V1a sonunda.**

**V1b — keşif ve AI (3–4 ay; V1a'dan sonra, toplam 6–8 ay):** OAI-PMH/DSpace bağlayıcısı; AI: metadata/konu önerisi, anlamsal arama, ilgili başlıklar, extractive özet, alt metin.

**V2 — olgunlaşma (9–12+ ay):** air-gap tam paket, DSpace 7 REST/Islandora, kurum SSO'su ile kısıtlı erişim, LTI, COUNTER/SUSHI, mobil/çevrimdışı, RTL/MathML, DRM değerlendirmesi; AI: RAG soru-cevap, çeviri, TTS, kişiselleştirme, on-prem yerel model.

---

## 27. Kararlar, açık sorular ve riskler

### 27.1 Verilen kararlar

1. **Kapasite:** 1 kişi + AI, tam zamanlı; MVP **24–28 hafta**; kapsam 26.2'deki gibi kırpıldı. Part-time ise süre iki katı.
2. **PDF:** istemci-first + POC; eşik geçilmezse sunucu tarafı sayfa görüntüsü/overlay yedeği; yedek plan +4–6 hafta.
3. **On-prem:** ilk günden uyumlu mimari; kurulum paketi V1a. Dış bağımlılık yasağı MVP'de.
4. **Arama:** tek motor Postgres FTS; OpenSearch eşiği 50k sentetik doğrulama ile.
5. **Çok kiracılılık:** paylaşımlı şema + RLS; dedicated büyük kurum için.
6. **OCR:** yerel Tesseract + hOCR.
7. **Herkese açık katalog:** platform kataloğu açık, kiracı özel kapalı.
8. **Bireysel okuma geçmişi:** yöneticiye kapalı.
9. **Bölge kısıtı:** MVP'de coğrafi engelleme yok; `territory[]` şemada. V1'de ilk müşteri şartına göre uygulanır.
10. **Veri yerelleştirme:** ilk müşteri kamu kurumu ise Türkiye'de barındırma MVP'ye girer; aksi halde V1a.
11. **Adli filigran:** V2/değerlendirme (satın alma veya Ar-Ge). V1: görünür filigran + indirme limiti + anomali tespiti.
12. **OPDS:** 1.2 V1a; 2.0 V2/değerlendirme.
13. **PDF POC dosyaları:** hafta 0'da ürün sahibi tarafından temin edilir; dosya yoksa POC başlamaz.
14. **Demo:** kiracı izolasyonu demoda da gösterilir (A, B'yi göremez); yanlış izlenim verilmez.
15. **Kalibrasyon:** demo sonrası 2 haftalık uçtan uca spike; 2 haftayı aşarsa MVP 30+ hafta.
16. **FieldOverride:** MVP'de yalnızca tasarım notu; şema V1b'de DSpace/OAI ile.

### 27.2 Açık kalanlar

- EPUB motoru: Readium mu epub.js mi? POC'ta ikisi de test edilir.
- İlk müşteri on-prem şartı koyarsa V1 takvimi öne çekilir mi?
- Platform kataloğu için SEO yatırımı ne zaman?

### 27.3 Riskler

- Büyük taranmış PDF performansı; POC ile azaltılır.
- PDF metin seçimi/vurgu hizalaması; hOCR koordinatları ile azaltılır.
- Türkçe stemmer kalitesi; 20–30 PDF ve sorgu setiyle ölçülür.
- PDF erişilebilirliği (yapısal etiket yok).
- OCR maliyeti/süresi.
- Kapsam kayması; 26.2 dışına çıkan her istek V1'e yazılır.
- Tek kişilik bakım yükü; otomasyon ve runbook.
- İçerik hakları ve kaldırma.
- **AI halüsinasyonu:** kaynaksız cevap; citation zorunluluğu ve değerlendirme setiyle azaltılır.
- **AI telif/veri:** yayıncı izni olmadan metnin modele gönderilmesi; opt-in ve no-training sözleşmesi.
- **AI maliyeti:** sorgu başına ücret; kiracı kotası ve önbellek olmadan sürdürülemez.
- **Arşiv metadata kalitesi:** OAI-PMH/DC alanları eksik veya tutarsız; AI + insan onayı ve kaynak override'ı gerekir.
- **Kısıtlı bitstream:** DSpace'te kapalı içerik platformda açılamaz; erişim modeli yanlış kurulursa telif ihlali.
- **Senkron çakışması:** kaynak sistemde silinen/değişen kayıt platformda yetim kalabilir; gece job'u + mutabakat raporu şart.
- **Kaynak hız limiti:** büyük arşivlerde harvest kısıtlanabilir; kademeli çekme ve önbellek gerekir.

---

## 28. Ekler

### 28.1 Durum makineleri

- **Title:** draft → in_review → published → embargoed → unpublished → archived
- **ImportJob:** queued → scanning → validating → extracting → ocr → review → completed | failed | **cancelled**
- **Grant:** pending → active → expired | revoked
- **Takedown:** received → reviewing → suspended → resolved | rejected

### 28.2 Veri modeli (özet)

```
Tenant 1─* User
Tenant 1─* Group 1─* Membership *─1 User
Publisher 1─* Work 1─* Edition 1─* Asset
Edition 1─* Chapter
Work *─* Subject
Tenant 0..1─* Collection 1─* CollectionItem *─1 Work
Grant *─1 (Tenant|Group|User)
Grant *─1 (Title|Collection|Subject|Publisher|All)
User 1─* Annotation *─1 Asset
User 1─* ReadingProgress *─1 Asset
ImportJob *─1 Tenant        (tenant_id nullable: platform import)
AuditEvent *─1 Tenant       (tenant_id nullable: platform olayı)
FieldOverride *─1 (Work|Edition|Asset)   (V1b; field_name bazlı, kaynak checksum'ı ile)
```

### 28.3 Yayın öncesi kontrol listesi

- [ ] Kiracı izolasyon testi (DB/RLS + arama/faset/öneri)
- [ ] Anotasyon çapası sürüm değişimi testi (yetim işaretleme)
- [ ] Grant cache TTL 60 sn + iptal testi
- [ ] Kota %90/%100 eşik testi
- [ ] Audit PII maskeleme testi (silme talebi)
- [ ] Grant/expiry/kontenjan testleri
- [ ] 60 dk hareketsizlik + heartbeat testi
- [ ] PDF POC eşikleri
- [ ] Relevans seti precision@10 ≥ 0.70
- [ ] OCR hOCR/vurgu hizalaması
- [ ] 4 alan × 2 dil demo içeriği
- [ ] Önizleme oranı (10 sayfa → 2)
- [ ] Embargo görünürlüğü
- [ ] Zip-bomb ve CSV injection testleri
- [ ] Webhook HMAC testi `[V1]`
- [ ] axe kritik 0
- [ ] Mobil Safari/Chrome
- [ ] Audit kapsamı
- [ ] KVKK metinleri/çerez
- [ ] Yedek/geri yükleme tatbikatı
- [ ] Runbook
- [ ] MARC/OPDS doğrulama `[V1]`
- [ ] AI kapalıyken çekirdek akışlar
- [ ] AI yayıncı izni/opt-in kaydı `[V1]`
- [ ] AI değerlendirme seti (V1: 50 soru; V2 RAG: 100 soru) `[V1]`
- [ ] AI maliyet tavanı/kotası `[V1]`
- [ ] Üç POC PDF + iki hedef kitap temin edildi
- [ ] Spike kabul kriterleri (28.8) ölçüldü ve ADR-001 yazıldı
- [ ] Performans ölçümleri

### 28.4 Mimari karar kayıtları (ADR)

| ADR | Karar | Durum |
|---|---|---|
| ADR-001 | PDF istemci-first + POC; yedekte sunucu render | Kabul |
| ADR-002 | Tek arama motoru: Postgres FTS; OpenSearch eşikli | Kabul |
| ADR-003 | On-prem-ready mimari; paket V1a | Kabul |
| ADR-004 | AI opsiyonel katman; MVP'de yok | Kabul |
| ADR-005 | DSpace = kaynak; platform okuma katmanı | Kabul |
| ADR-006 | V1 ikiye bölünür: V1a altyapı, V1b keşif/AI | Kabul |
| ADR-007 | Bölge kısıtı MVP'de yok; şema hazır | Kabul |
| ADR-008 | Adli filigran V2/değerlendirme | Kabul |
| ADR-009 | Anotasyon çapası: text_quote + range + CFI; yetim işaretleme | Kabul |
| ADR-010 | FieldOverride MVP'de değil, V1b'de DSpace/OAI ile | Kabul |

Her ADR: bağlam, karar, alternatifler, sonuç ve tarih içerir; `docs/adr/` altında saklanır.

### 28.5 CSV içe aktarma şeması

| Kolon | Zorunlu | Açıklama |
|---|---|---|
| `external_id` | — | Yayıncı/kurum kimliği |
| `title` | ✅ | |
| `subtitle` | — | |
| `language` | ✅ | `tr`, `en` |
| `authors` | ✅ | `;` ile ayrılır |
| `publisher` | ✅ | ad veya id |
| `year` | ✅ | |
| `edition` | — | |
| `content_type` | — | varsayılan `monograph` |
| `series` | — | |
| `volume` | — | |
| `isbn13` | — | |
| `doi` | — | |
| `handle` | — | DSpace/OAI kaydı ise |
| `license_uri` | — | CC/SPDX |
| `subjects` | ✅ | kanonik kodlar, `;` |
| `keywords` | — | `;` |
| `abstract` | ✅ | |
| `filename` | ✅ | ZIP içindeki yol |
| `cover_filename` | — | |
| `rights_note` | — | |
| `license_note` | — | |

Hata raporu: `row, field, code, message`; ilk 100 hata; CSV olarak indirilir.

### 28.6 MARC21 mapping profili

| MARC | Kaynak |
|---|---|
| 020 $a | ISBN-13 |
| 022 $a | ISSN (varsa) |
| 024 $a | DOI (varsa) |
| 041 $a | `language` |
| 100 $a $d | birinci yazar (kişi) |
| 110 $a | kurum yazarı (yetki kontrolü V1) |
| 245 $a $b | başlık / `$b` = remainder of title (alt başlık değil) |
| 250 $a | baskı |
| 264 $a $b $c (ind2=1) | yayıncı / yer / yıl |
| 300 $a | sayfa sayısı |
| 490 $a | seri |
| 520 $a | özet |
| 650 $a | konu başlıkları |
| 700 $a $d | diğer katkıda bulunanlar |
| 856 $u $3 | erişim URL'si / erişim notu |
| 546 $a | dil notu |

Kurum bazlı özelleştirme `[V1]`; çıktı doğrulaması MarcEdit ile. **Yetki kontrolü** (100 vs 110, kişi/kurum ayrımı) V1'de; standart dışı başlık alanları için `$6`/romanizasyon V2.

### 28.7 Kapsam dışı bilinçli kararlar

Ödeme, fatura, tedarik, telif mutabakatı, fiyatlandırma, pazarlama, DRM (V2), native uygulama (V2). Bunlar platformun teknik borcu değil, ayrı iş kollarıdır.

### 28.8 Spike kabul kriterleri (14 gün)

Ölçüm, üç POC PDF + iki hedef kitap geldikten sonra başlar. Eşikler spike başlamadan yazılıdır.

| Metrik | Eşik | Başarısızsa |
|---|---|---|
| 500 MB soğuk ilk sayfa | < 2 sn @ 20 Mbps | Sunucu tarafı sayfa görüntüsü/overlay yedeği |
| Tarayıcı RSS | < 500 MB | Aynı yedek |
| Taranmış sayfada vurgu hizalaması | %100 zoom'da ±3 px | hOCR kalitesi/render katmanı revizyonu |
| Annotation reload sonrası | %100 yerinde | Anchor şeması revizyonu |
| Sürüm değişimi re-anchor | ≥ %90 doğru; kalan "yetim" | C-01 algoritması yeniden açılır |
| Arama precision@10 (10 sorgu) | ≥ 0.70 | Türkçe stemmer yedek planı |
| 50 eşzamanlı okuyucu | Hata yok; p95 < 2 sn | Ölçek notu + kapasite planı |

**D14 çıktısı (ADR-001):** POC pass/fail, re-anchor sonucu, precision, 50 eşzamanlı sonuç, revize MVP tahmini (24–28 mi 30+ mı), açık riskler.

---

## 29. Kapsam boşlukları ve sürüm kararları (v1.3)

Bu bölüm, ilk şartnamede eksik kalan ve akademik platformlarda sonradan pahalıya patlayan alanları kapatır.

### 29.1 İçerik türleri ve hiyerarşi

`content_type`: `monograph`, `edited_volume`, `chapter`, `journal`, `journal_issue`, `article`, `conference_paper`, `thesis`, `report`, `standard`, `dataset`.

Hiyerarşi:
- Seri → Cilt → Bölüm
- Dergi → Sayı → Makale
- Bildiri kitabı → Bildiri

| Sürüm | Kapsam |
|---|---|
| MVP | `content_type` ve `parent_id` şemada; UI'da yalnızca monografi + bölüm |
| V1 | Makale/dergi sayısı, tez, rapor, bildiri |
| V2 | Veri seti, standart, çoklu medya |

**Neden şimdi:** "Akademik" içerik sadece kitap değil. Şema sonradan değişmez; `content_type` ve `parent_id` bugün eklenmezse makale/tez geldiğinde model kırılır.

### 29.2 Seri ve çok cilt

- `Series`, `series_id`, `volume_no`, `part_no`.
- Seri sayfası, "setin diğer ciltleri", cilt sırası.
- MVP şemada; V1 arayüzde.

### 29.3 Bölge kısıtı ve süresiz erişim

- `territory[]` (ISO 3166), `access_model` (`subscription` / `perpetual` / `trial`), `post_cancellation_access` (boolean).
- **Karar:** MVP'de coğrafi engelleme yok; alanlar şemada hazır. V1'de ilk müşteri şartına göre uygulanır (IP/geo + VPN yanlış pozitifleri + KVKK/GDPR etkisi belgelenir).
- "Abonelik bitince erişim ne olacak?" sorusu kurumların ilk sorusudur; `perpetual` ve `post_cancellation` alanları V1'de.

### 29.4 Konsorsiyum ve kiracı hiyerarşisi

- `tenant_type`: `consortium` / `institution` / `department`.
- `parent_id`; grant mirası; ortak koleksiyon; kullanım raporlarının yukarıya toplanması.
- V2; ancak `parent_id` şemada MVP'de.

### 29.5 Keşif ve birlikte çalışabilirlik

- OAI-PMH, Google Scholar meta etiketleri, OpenURL/link resolver, DOI/Crossref, Zotero/RIS, kalıcı bağlantı (permalink), sitemap.
- V1: permalink, RIS/BibTeX, Google Scholar meta, OAI-PMH.
- V2: OpenURL, Crossref deposit.

### 29.6 Koruma ve süreklilik

- Checksum, format göçü, dışa aktarma paketi, arşiv kopyası, "platform kapansa içerik ne olur?" politikası.
- V1: politika + checksum; V2: arşiv kopyası ve göç planı.

### 29.7 Errata, retraction, yeni baskı

- `relation_type`: `errata`, `retraction`, `new_edition`, `supplement`.
- Başlıkta uyarı şeridi; yeni baskı bildirimi; eski sürüme erişim.
- V2.

### 29.8 Kötüye kullanım ve adli filigran

- **V1:** görünür filigran, indirme hız limiti, anormal erişim tespiti, eşzamanlı oturum kontrolü.
- **V2/değerlendirme:** görünmez (adli) filigran. Dayanıklı adli filigran lisanslı teknoloji (Digimarc vb.) veya ciddi Ar-Ge gerektirir; "V1'de yaparız" gerçekçi değil. Satın al veya bırak.

### 29.9 Operasyon ve destek

- Durum sayfası, olay müdahale runbook'u, destek/geri bildirim widget'ı, kiracı onboarding sihirbazı, sandbox ortamı, sürüm notları.
- V1.

### 29.10 Görsel derin zoom

- Atlas/figür için tile tabanlı görüntüleyici; PDF zoom'dan bağımsız.
- V1/V2.

### 29.11 Kullanıcı profili ve verileri

- Tercihler (dil, tema, yazı boyutu), kişisel okuma istatistiği, veri dışa aktarma/silme, bildirim ayarları.
- V1.

### 29.12 Walk-in ve alumni erişimi

- Kampüs içi IP ile hesapsız erişim; mezun grant'i; misafir önizleme.
- V1.

### 29.13 Şimdi şemaya girmesi gerekenler

Bunlar bugün eklenmezse sonradan migration + veri kaybı riski taşır:

- `content_type`, `parent_id`
- `series_id`, `volume_no`
- `territory[]`, `access_model`, `post_cancellation_access`
- `tenant_type`, `tenant.parent_id` (nullable)
- `relation_type` (errata/retraction)

---

## 30. Kalan kenar durumlar (v1.5)

Büyük mimari boşluklar kapandı; bunlar üretim olgunluğu için son katman.

| Alan | Eksik | Sürüm |
|---|---|---|
| EPUB/PDF güvenliği | HTML sanitizasyonu, XXE, PDF içi JavaScript devre dışı, iframe sandbox | MVP |
| Kurumsal kimlik | SCIM provisioning, SSO single logout, IP aralığı yönetim ekranı | V1 |
| Akademik akış | Ders rezervi/okuma listesi (eğitmen), anotasyon paylaşımı, kişisel kütüphane | V1/V2 |
| Kimlik standartları | ORCID (yazar), ROR (kurum), Crossref DOI lookup | V1 |
| Lisans metadata'sı | CC/rights URI, atıf metni, makine-okunur lisans | V1 |
| Operasyon | DLQ/retry **MVP**, maintenance mode **MVP**, indeks yeniden kurma **MVP**, kill switch V1 | MVP/V1 |
| Analitik | Olay taksonomisi **MVP**, veri katmanı V1 | MVP/V1 |
| UX | 404/500/maintenance **MVP**; klavye kısayolları, yardım/tooltip, yazdırma stili V1 | MVP/V1 |
| Keşif yüzeyleri | Yazar, yayıncı, seri sayfaları; RSS | V1 |
| Uyum dosyaları | Kullanım koşulları, subprocessors listesi, ROPA/DPIA, audit tamper-evidence | V1 |
| E-posta | Bounce/complaint yönetimi | V1 |
| Silme yayılımı | Yedeklerden ve arama indeksinden silme | V1 |

**Şimdi eklenmesi gereken üç şey:**

1. **EPUB/PDF güvenliği (MVP):** kötü niyetli EPUB içinde XSS, XML external entity, PDF içi JavaScript ve gömülü iframe. Okuyucu sanal alanı ve HTML sanitizasyonu olmadan yükleme özelliği açılmamalı.
2. **Olay taksonomisi (V1):** sonradan COUNTER/SUSHI ve ürün analitiği bunun üstüne kurulur; olay adları şimdi tanımlanmazsa veri çöplüğü olur.
3. **Uyum dosyaları (V1):** kurumların güvenlik anketleri kullanım koşulları, subprocessors listesi ve ROPA/DPIA olmadan geçmez.

---

## 31. Genişletilebilirlik mimarisi (v1.6)

### 31.1 İlke: esnek çekirdek, sabit kenarlar

- Çekirdek domain modeli (Work/Edition/Asset, Grant, Tenant) sabit ve iyi test edilmiş olur.
- Esneklik **sınırlarda** sağlanır: adapter, konfigürasyon, feature flag, olay.
- **Rule of three:** aynı ihtiyaç üç kez gelmeden genelleştirme yapılmaz. Erken soyutlama, en pahalı teknik borçtur.

### 31.2 Modüler monolit

MVP'de mikroservis yok. Tek uygulama, net modüller:

`identity` · `tenant` · `catalog` · `ingestion` · `reader` · `annotations` · `search` · `collections` · `entitlement` · `notification` · `reporting` · `connector` · `ai` · `admin` · `audit`

- Her modülün kendi servis katmanı ve tablo öneki vardır; modüller birbirinin tablosuna doğrudan yazmaz.
- Modüller arası iletişim önce fonksiyon çağrısı, gerekirse domain event.
- Servise ayırma yalnızca üç koşulda: bağımsız ölçek, hata izolasyonu, ayrı ekip sahipliği.

### 31.3 Dikiş noktaları (port/adapter)

| Port | Uygulamalar | Sürüm |
|---|---|---|
| `ContentSource` | CSV, OAI-PMH, DSpace REST, EPrints | MVP/V1 |
| `Storage` | S3, MinIO, yerel disk | MVP |
| `IdentityProvider` | yerel, OIDC, SAML, LDAP | MVP/V1 |
| `SearchEngine` | Postgres FTS, OpenSearch | MVP/V1 |
| `MetadataExtractor` | PDF, EPUB, OCR | MVP |
| `AIProvider` | bulut, Azure, yerel model | V1 |
| `NotificationChannel` | e-posta, uygulama içi, webhook | MVP/V1 |
| `AccessPolicy` | grant değerlendirici | MVP |
| `ReportExporter` | CSV, XLSX, COUNTER | V1 |
| `ThemeProvider` | tasarım token'ları | MVP |

**Bütçe:** MVP'de en fazla 10 port. Her port için sözleşme testi + doküman + sahip.

### 31.4 Yapılandırılabilir metadata

- Çekirdek alanlar sabit; `metadata_schema` kiracı/koleksiyon bazlı (JSON Schema).
- `extra_metadata` JSONB; doğrulanır; fasetlenebilir alanlar generated column ile indekslenir.
- Arayüz şemadan dinamik üretilir; çeviri etiketleri şemada.
- Sınır: kiracı başına 50 özel alan; çekirdek alanlar ezilemez.
- Amaç: yeni alan için migration değil, konfigürasyon.

### 31.5 Sayfa ve tema esnekliği

- Blok tipleri: hero, koleksiyon grid'i, kitap karuseli, zengin metin, banner, konu kartları.
- Serbest HTML/JS yok; XSS yüzeyi açılmaz.
- Tasarım token'ları (logo, renk, tipografi), özel alan adı, e-posta şablonları.
- Kiracı ana sayfasını bloklarla kurar; kod değişmez.

### 31.6 Feature flag

- Kapsam: global, kiracı, kohort, yüzde.
- Kill switch ve maintenance mode.
- Her riskli özellik flag arkasında; flag ömrü en fazla 90 gün, sonra temizlik.
- Deploy ile release ayrılır.

### 31.7 Olaylar ve webhook

- Domain event'ler sürümlü şema ile; **outbox** deseni; en az bir kez teslim; tüketici idempotent.
- Olaylar: `title.published`, `grant.changed`, `import.completed`, `annotation.created`, `search.performed`.
- Webhook: HMAC, retry, DLQ.
- Fayda: analitik, entegrasyon ve AI indeksleme çekirdeği değiştirmeden eklenir.

### 31.8 API ve gömme

- REST v1 + OpenAPI; webhook; kurum sitesi için gömülebilir kitap/koleksiyon widget'ı.
- Sürümleme ve deprecated politikası; kiracı bazlı hız limiti.

### 31.9 Workflow esnekliği

- Durum makineleri kodda tanımlı (title, import, grant, takedown).
- MVP'de BPMN/generic workflow motoru yok.
- Özel onay akışı gerçekten gerekirse V2'de "approval policy" konfigürasyonu.

### 31.10 Yapmamalar

- Erken mikroservis.
- Genel amaçlı BPMN/workflow motoru.
- Üçüncü taraf kod çalıştırma / plugin marketi.
- Çekirdek alanlar için EAV.
- Müşteri başına fork.
- Serbest HTML sayfa yapıcı.
- Üç gerçek vaka olmadan soyutlama.

### 31.11 Esneklik testi

Her yeni istek için sırayla sorulur:

1. Konfigürasyonla çözülür mü?
2. Yeni bir adapter mı?
3. Yeni bir modül mü?
4. Çekirdek değişiklik mi? (son çare)

Cevap "çekirdek" ise, istek V1/V2'ye yazılır ve üç vaka birikmeden uygulanmaz.

### 31.12 Sürümleme ve göç

- API: geriye uyumlu, expand-contract.
- Veritabanı: ileri yönlü migration + geri alma planı.
- Adapter sözleşme testleri; flag'li kademeli çıkış.
- Şema değişikliklerinde önce yaz, sonra oku, en son eskisini kaldır.
