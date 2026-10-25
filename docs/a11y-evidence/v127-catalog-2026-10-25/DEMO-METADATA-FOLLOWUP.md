# Demo metadata follow-up

Tarih: 2026-10-25 (Europe/Istanbul)

Canlı seed/demo kaydı, katalog incelemesinde bulunan veri bütünlüğü hatasını gidermek için düzeltilmiştir. Bu düzeltme gerçek PDF dosyasını değiştirmedi ve yeni deploy veya migration gerektirmedi.

## Önce

- Başlık: `Diş Hekimliğinde İmplant Komplikasyonları`
- Dil: `tr`
- Metadata sayfa sayısı: `6`
- Kaynak dosya: 1 sayfalık İngilizce `Dummy PDF file`
- Koleksiyon: `Diş Hekimliği` / `dis-hekimligi`

## Sonra

- Başlık: `Demo PDF — Dummy PDF file`
- Alt başlık: `One-page English test document`
- Dil: `en`
- Abstract ve konular artık yalnızca platform test fikstürünü tarif ediyor.
- Metadata ve sayfa indeksi: `1` sayfa; indekslenen fiziksel sayfa: `[1]`.
- Koleksiyon: `Demo` / `demo`.
- Sahte ISBN/lisans iddiası kaldırıldı; kayıt test fikstürü olarak işaretlendi.

## Kanıt

- Kaynak PDF SHA-256: `3df79d34abbca99308e79cb94461c1893582604d68329a41fd4bec1885e6adb4` (önce/sonra aynı).
- Kaynak metin: `Dummy PDF file`; gerçek PDF sayfa sayısı: `1`.
- Canlı API: katalog `2` kayıt; demo `en/1`; MARC başlığı düzeltildi.
- Arama: `Dummy PDF` demo kaydını buluyor; eski `İmplantoloji` sorgusu demo kaydını döndürmüyor.
- Gerçek makale asset’i ve SHA-256 değişmedi: `6ef24df5cc72de3c2bf4ea7d78b9f4c4d907ff9834216d64808f2790ad19babc`.
- Audit olayı: `book.metadata.corrected`, id `133`.
- Yedek: `backups/demo-metadata-20251025-170615.dump`.

Seed ve bellekteki fallback de aynı gerçek metadata ile güncellendi; mevcut production container v127 olduğu için bu kaynak değişiklikleri bir sonraki planlı uygulama imajına alınacaktır. Canlı veritabanı düzeltmesi zaten tamamlandı.

Bu işlem ACR’yi kapatmaz: gerçek makaledeki yayıncı kaynaklı alternatif/tablo/başlık eksikleri ve VoiceOver/Safari kapsamı ayrı açıklar olarak kalır.
