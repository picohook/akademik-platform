# ADR-012: EPUB motoru — epub.js (MVP/V1a), adapter arkasında

- Status: accepted (MVP/V1a); long-term default değil
- Date: 2026-10-21
- Deciders: ürün + mühendislik (tek kişi)

## Context

Şartname EPUB için temel reflow, TOC, tema, CFI konumu ve yer imi istiyor. PDF okuyucu hazır; EPUB ayrı bir renderer gerektiriyor. Ekip tek kişi, bütçe yok ve pilot için hız kritik.

İki aday:

- **epub.js** — MIT, küçük, hızlı entegre; bakımı durgun.
- **Readium Web Toolkit** — BSD-3, EPUB 3/erişilebilirlik/MathML/RTL/media overlays'te güçlü; entegrasyon ve bakım yükü yüksek.

LCP/DRM bu kararın dışında; LCP ayrı lisans ve sunucu işidir.

## Decision

1. **MVP/V1a için epub.js** kullanılır.
2. Motor, **`EpubEngine` adapter** arkasında tutulur. UI ve `anchor` modeli epub.js'e doğrudan bağlanmaz.
3. Sürüm **pinlenir**; bakım riski kabul edilir ve aşağıdaki sahiplik planı uygulanır.
4. Bu karar **uzun vadeli varsayılan değildir**. Aşağıdaki geçiş eşiklerinden biri tetiklenirse Readium/R2D2BC değerlendirilir.

### Adapter sözleşmesi (dondurulmuş)

```ts
interface EpubEngine {
  open(assetUrl: string, initialCfi?: string): Promise<void>;
  destroy(): void;
  getToc(): TocItem[];
  goToCfi(cfi: string): Promise<void>;
  getCurrentCfi(): string;
  getProgress(): { cfi: string; percent: number };
  search(query: string, options?: { limit?: number }): Promise<SearchHit[]>;
  addAnnotation(input: { id: string; cfiRange: string; color: string; note?: string }): void;
  updateAnnotation(input: { id: string; color?: string; note?: string }): void;
  removeAnnotation(id: string): void;
  setTheme(theme: 'light' | 'sepia' | 'dark'): void;
  setFontSize(size: number): void;
}
```

Kurallar:

- `search` kendi metin indeksimizi kullanır; epub.js iframe'ine ve koordinatlarına sızdırmaz.
- `addAnnotation` CFI aralığı alır; iframe DOM koordinatı UI'a taşınmaz.
- `anchor` modeli `{ type: 'epub', cfi, text_quote, text_position }` olarak kalır.
- EPUB'ta sayfa yoktur; ilerleme ve atıf CFI/yüzde üzerinden yürür.

### Bakım ve güvenlik sahipliği

- `package.json` + lockfile ile **tam sürüm pinlenir**; otomatik major upgrade yok.
- `npm audit`/advisory izlenir; güvenlik yaması gerekirse yerel yama veya doğrulanmış fork uygulanır.
- Aday fork/alternatifler (lisans, aktivite, API uyumu doğrulanmadan kabul edilmez):
  - `intity/epub-js` fork'u — uyumluluk testi gerekir.
  - **R2D2BC** — Readium tabanlı aktif alternatif; V1a sonunda yeniden değerlendirilir.
- En az bir yedek plan ADR'de kayıtlıdır; geçiş maliyeti adapter sayesinde sınırlı tutulur.

### Geçiş eşikleri (ölçülebilir)

Aşağıdakilerden **biri** gerçekleşirse motor değişikliği değerlendirilir:

1. Kurum sözleşmesinde **WCAG 2.2 AA + EPUB erişilebilirlik denetimi** şartı varsa.
2. Katalogdaki EPUB içeriğinde **MathML + RTL + fixed-layout oranı %10'u** aşarsa.
3. V1a kabul testlerinde **CFI doğruluğu** veya **vurgu/not hizalaması** eşiği sağlanmazsa (öneri: 50 örnekte ≥%95 doğru konum; kritik hata 0).

Bu eşiklerin dışında V2'ye kadar epub.js kalır.

## Alternatives considered

- **Readium Web Toolkit** — daha yetenekli ve aktif; ancak MVP kapsamı için gereğinden ağır. Erişilebilirlik/EPUB 3 şartı sertleşirse birinci alternatif.
- **R2D2BC** — Readium v2 tabanlı, fixed-layout/RTL destekli aktif aday; lisans/API uyumu doğrulanmadan seçilmedi.
- **Native EPUB SDK** — mobil uygulama kararı verilmeden erken.

## Consequences

Kolaylaşan:

- EPUB MVP hızlı çıkar; mevcut not/atıf/arama UI'ı adapte edilir.
- Motor değişimi UI'yı bozmaz; adapter sözleşmesi sabittir.

Zorlaşan / izlenmesi gereken:

- epub.js bakımı durgun; güvenlik yaması gelmeyebilir → pin + yerel yama planı.
- MathML MathJax hook'u, RTL ve erişilebilirlik **doğrulanmadı**; "yok" değil, V1a kabulünde test edilecek.
- EPUB arama için ayrı metin çıkarımı/indeks gerekir; PDF `asset_pages` indeksi doğrudan kullanılmaz.
- CFI/selection testleri iframe davranışı yüzünden PDF'ten farklıdır; ayrı test seti gerekir.
