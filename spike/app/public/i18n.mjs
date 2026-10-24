// Minimal UI i18n: Turkish is the source text, English is a lookup table.
// Static DOM is translated on load; dynamic renderers call translateDom()/t().

const DICT = {
  'İçeriğe atla': 'Skip to content',
  'Okuyucu': 'Reader',
  'EPUB içeriği': 'EPUB content',
  'Katalogda ara': 'Search catalog',
  'Bölüm başlığında ara': 'Search chapters',
  'Kitabın içinde ara': 'Search in book',
  'Notlarda ara': 'Search notes',
  'Vurgu notu': 'Highlight note',
  'Okuyucu:': 'Reader:',
  'Kütüphaneci:': 'Librarian:',
  '· Kütüphaneci:': '· Librarian:',
  'Parola:': 'Password:',
  'E-posta': 'Email',
  'Parola': 'Password',
  'Giriş yap': 'Sign in',
  'Başlık, konu veya tam metin ara…': 'Search title, subject or full text…',
  'bağlanıyor…': 'connecting…',
  'DB modu': 'DB mode',
  'Demo modu': 'Demo mode',
  'bağlantı yok': 'offline',
  'Çıkış': 'Sign out',
  'Okuma katmanı · 14 günlük spike': 'Reading layer · 14-day spike',
  'Katalog, okuyucu, not ve arama.': 'Catalog, reader, notes and search.',
  'Tek çalışan dilim.': 'One working slice.',
  '+ Kitap ekle': '+ Add book',
  'Sonuç yok. Arama terimini değiştirin.': 'No results. Try another term.',
  'Kitabı düzenle': 'Edit book',
  'Kapat': 'Close',
  'Kısayollar': 'Shortcuts',
  'Üretim': 'Production',
  'Geliştirme': 'Development',
  'Destek': 'Support',
  'Başlık': 'Title',
  'Alt başlık': 'Subtitle',
  'Yazarlar (; ile ayırın; "Soyad, Ad")': 'Authors (separate with ; "Last, First")',
  'Kopyalama': 'Copy',
  'İndirme': 'Download',
  'Yazdırma': 'Print',
  'Filigran': 'Watermark',
  'Dil': 'Language',
  'Türkçe': 'Turkish',
  'Yıl': 'Year',
  'Yayıncı': 'Publisher',
  'Konular (; ile ayırın)': 'Subjects (separate with ;)',
  'Sil': 'Delete',
  'Vazgeç': 'Cancel',
  'Kaydet': 'Save',
  'Kitap ekle': 'Add book',
  'PDF veya EPUB dosyası': 'PDF or EPUB file',
  'PDF veya EPUB dosyası (max. 300 MB)': 'PDF or EPUB file (max. 300 MB)',
  'Dosya 300 MB sınırını aşıyor': 'File exceeds the 300 MB limit',
  'Başlık (boşsa dosya adı)': 'Title (filename if empty)',
  'Yükle': 'Upload',
  'Atıf': 'Citation',
  'PDF sayfa numarası': 'PDF page number',
  'PDF dosyasındaki sıra numarası': 'Position in the PDF file',
  'Sayfa (opsiyonel, örn. iv, 42 veya 42-45)': 'Page (optional, e.g. iv, 42 or 42-45)',
  'PDF sayfa etiketi kullanıldı; basılı nüshayla doğrulayın.': 'PDF page label used; verify against the printed copy.',
  'Basılı sayfa eşlemesi yok; PDF sıra numarası kullanıldı.': 'No printed-page mapping; the PDF page position is used.',
  'BibTeX kitap künyesidir; sayfa konumu eklenmez.': 'BibTeX describes the book; the page locator is not included.',
  'Stil': 'Style',
  'Sayfa (opsiyonel, örn. 42 veya 42-45)': 'Page (optional, e.g. 42 or 42-45)',
  'Kopyala': 'Copy',
  'Atıfla kopyala': 'Copy with citation',
  'Atıfla kopyalandı': 'Copied with citation',
  'Metin kopyalandı': 'Text copied',
  'Bu kitapta kopyalama kapalı': 'Copying is disabled for this title',
  'Kopyalanamadı; metni seçip kopyalayın.': 'Could not copy; select the text and copy it manually.',
  'Parola değiştir': 'Change password',
  'Mevcut parola': 'Current password',
  'Yeni parola (en az 8 karakter)': 'New password (min. 8 characters)',
  'Tüm cihazlardan çıkış': 'Sign out everywhere',
  'İçindekiler': 'Contents',
  'Genişliğe sığdır': 'Fit width',
  'Döndür': 'Rotate',
  'Tam ekran': 'Fullscreen',
  'Tema': 'Theme',
  'Çift sayfa': 'Two-page',
  'Sürekli kaydırma': 'Continuous scroll',
  'Yakınlaştır': 'Zoom in',
  'Uzaklaştır': 'Zoom out',
  "Eski isteğin teslimatı bilinmiyor; yeni kayıt oluşturmadan önce notlarınızı kontrol edin": "Delivery of this old request is unknown; check your notes before creating another record",
  "Yerel taslağı kaldır": "Remove local draft",
  "Hesap başka sekmede değişti; yeniden giriş yapın": "The account changed in another tab; sign in again",
  "Çakışma başka sekmede değişti; metniniz düzenleyicide korunuyor": "The conflict changed in another tab; your text remains in the editor",
  "Not çakışması": "Note conflict",
  "Notta çakışma var; iki sürüm de korundu": "This note has a conflict; both versions were kept",
  "Bu cihazdaki taslak": "Draft on this device",
  "Diğer sürüm": "Other version",
  "Not diğer cihazda silinmiş veya bulunamıyor": "The note was deleted on another device or is unavailable",
  "Silme işlemini uygula": "Apply deletion",
  "Yeni not olarak kaydet": "Save as a new note",
  "Bu taslağı kullan": "Use this draft",
  "Diğer sürümü kullan": "Use the other version",
  "Silinmeyi kabul et": "Accept deletion",
  "İkisini de sakla": "Keep both",
  "Önce bekleyen isteğin sonucu doğrulanmalı; bağlantı gelince tekrar deneyin": "The pending request must be confirmed first; retry when connected",
  "Çakışma çözülemedi": "Conflict could not be resolved",
  'Yer imi': 'Bookmark',
  'Yer imi eklendi': 'Bookmark added',
  'Yer imi cihazda kaydedildi; eşitleme bekliyor': 'Bookmark saved on this device; sync pending',
  'Yer imi için giriş yapın': 'Sign in to add a bookmark',
  'Yer imi eklenemedi': 'Bookmark could not be saved',
  'Yer imi çevrimdışı eklenemiyor': 'Bookmark cannot be added offline',
  'Yer imi ekle': 'Add bookmark',
  'PDF indir': 'Download PDF',
  'İndir': 'Download',
  'Notlar': 'Notes',
  'Gezinme paneli': 'Navigation panel',
  'Gezinme': 'Navigation',
  'Okuyucu panelleri': 'Reader panels',
  'Ara': 'Search',
  'Sayfalar': 'Pages',
  'Bölüm başlığında ara…': 'Search chapter titles…',
  'Kitabın içinde ara…': 'Search inside the book…',
  'Tam kelime': 'Whole word',
  'Bulanık': 'Fuzzy',
  'Sayfa hazırlanıyor…': 'Loading page…',
  'Notlar ve vurgular': 'Notes & highlights',
  'Notlarda ara…': 'Search notes…',
  'Tüm renkler': 'All colors',
  'Tümü': 'All',
  'Sarı': 'Yellow',
  'Yeşil': 'Green',
  'Mavi': 'Blue',
  'Pembe': 'Pink',
  'Metin seçip': 'Select text and',
  'ile başlayın.': 'start with',
  'Metin seçip Vurgula ile başlayın.': 'Select text and use Highlight to start.',
  'Filtreye uygun not yok.': 'No notes match the filter.',
  'Sayfa': 'Page',
  'Erişim': 'Access',
  'Erişim grantleri': 'Access grants',
  'Kime': 'Subject',
  'Tüm kurum': 'Whole institution',
  'Tek kullanıcı': 'Single user',
  'Kullanıcı e-postası': 'User email',
  'Kapsam': 'Scope',
  'Grup': 'Group',
  'Yeni grup': 'New group',
  'Grup oluştur': 'Create group',
  'Gruba e-posta': 'Group member email',
  'Üye ekle': 'Add member',
  'Üye çıkar': 'Remove member',
  'Üye çıkarıldı': 'Member removed',
  'Üye çıkarılamadı': 'Could not remove member',
  'Önce bir grup oluşturun/seçin': 'Create or select a group first',
  'Kullanıcı e-postası gerekli': 'User email is required',
  'Kullanıcı bulunamadı': 'User not found',
  'Grup oluşturuldu': 'Group created',
  'Grup oluşturulamadı': 'Could not create group',
  'Üye eklendi': 'Member added',
  'Üye eklenemedi': 'Could not add member',
  'Grant geçmişi': 'Grant history',
  'Son grant işlemleri': 'Recent grant activity',
  'Yayıncı': 'Publisher',
  'Konu': 'Subject',
  'Koleksiyon UUID': 'Collection UUID',
  'Koleksiyon': 'Collection',
  'Başlık UUID': 'Title UUID',
  'Değer': 'Value',
  'Koltuk limiti': 'Seat limit',
  'Aktif oturum': 'Active sessions',
  'Kaynak': 'Source',
  'Manuel': 'Manual',
  'Abonelik': 'Subscription',
  'Deneme': 'Trial',
  'Satın alma': 'Purchase',
  'Grant ekle': 'Add grant',
  'Grant eklendi': 'Grant added',
  'Grant silindi': 'Grant deleted',
  'Grant silinemedi': 'Could not delete grant',
  'Grant silinsin mi?': 'Delete this grant?',
  'Aktif grant yok.': 'No active grants.',
  'Grantlar yüklenemedi.': 'Could not load grants.',
  'Eşleşme': 'Matches',
  'Kurum': 'Institution',
  'Oku': 'Read',
  'Aç': 'Open',
  'Çevrimdışı': 'Offline',
  'Çevrimdışı kitaplar': 'Offline books',
  'Çevrimdışı kitap listesi': 'Offline book list',
  'Çevrimdışı indir': 'Save offline',
  'Çevrimdışı kaydediliyor…': 'Saving offline…',
  'Çevrimdışı kaydedildi': 'Saved offline',
  'Çevrimdışı kaydedilemedi': 'Could not save offline',
  'Çevrimdışı alan yetersiz': 'Not enough offline storage',
  'Depolama alanı yetersiz': 'Not enough storage space',
  'İnternet bağlantısı yok': 'No internet connection',
  'Dosya 300 MB sınırını aşıyor; çevrimdışı kaydedilemez': 'File exceeds the 300 MB limit; cannot save offline',
  'Çevrimdışı kitap yok.': 'No offline books.',
  'Çevrimdışı kopya silinsin mi?': 'Delete the offline copy?',
  'Kullanılan': 'Used',
  'Not rengi': 'Note color',
  'Sayfa alanı': 'Page area',
  'Bölüm listesi': 'Chapter list',
  'Arama sonuçları': 'Search results',
  'Not listesi': 'Note list',
  'Grant listesi': 'Grant list',
  'Yazar yok; editörle biçimlendirildi.': 'No author; formatted with editor.',
  'Yazar bilgisi yok; başlıkla biçimlendirildi.': 'No author; formatted by title.',
  'Yayın yılı yok.': 'No publication year.',
  'Yayıncı bilgisi yok.': 'No publisher.',
  ' · kök': ' · stem',
  ' · yakın': ' · fuzzy',
  ' · tam kelime': ' · whole word',
  'Vurgula': 'Highlight',
  'Vurgu rengi': 'Highlight color',
  'Not (opsiyonel)': 'Note (optional)',
  'İptal': 'Cancel',
  'Önceki sayfa': 'Previous page',
  'Sonraki sayfa': 'Next page',
  'Önceki sonuç': 'Previous result',
  'Sonraki sonuç': 'Next result',
  'Sayfa numarası': 'Page number',
  '20 sayfa test': '20-page test',
  'Markdown olarak indir': 'Download as Markdown',
  'JSON olarak indir': 'Download as JSON',
  'Yükleniyor…': 'Loading…',
  'Aranıyor…': 'Searching…',
  'EPUB içinde aranıyor…': 'Searching in EPUB…',
  'Sonuç bulunamadı.': 'No results found.',
  'Eşleşen bölüm yok.': 'No matching chapters.',
  'Bu EPUB’ta içindekiler yok.': 'This EPUB has no table of contents.',
  'Vurgu kaydedildi': 'Highlight saved',
  'Vurgu çevrimdışı kaydedildi': 'Highlight saved offline',
  'Not silindi (çevrimdışı)': 'Note deleted (offline)',
  'Vurgu kaydedilemedi': 'Could not save highlight',
  'Kitap silindi': 'Book deleted',
  'Kitap silinemedi': 'Could not delete book',
  'Bu kitapta kopyalama kapalı': 'Copying is disabled for this title',
  'Bu kitapta indirme kapalı': 'Downloading is disabled for this title',
  'PDF indirildi': 'PDF downloaded',
  'EPUB indirildi': 'EPUB downloaded',
  'PDF indirilemedi': 'Could not download PDF',
  'EPUB indirilemedi': 'Could not download EPUB',
  'E-posta veya parola hatalı.': 'Incorrect email or password.',
  'Giriş yapılamadı.': 'Could not sign in.',
  'Bu dosya zaten yüklü': 'This file is already uploaded',
  'Kitap eklendi': 'Book added',
  'Düzenle': 'Edit',
  'Açık tema': 'Light theme',
  'Koyu tema': 'Dark theme',
  'Sepia tema': 'Sepia theme',
  'Notu düzenle': 'Edit note',
  'Etiketler (; ile ayırın)': 'Tags (separate with ;)',
  'Rengi değiştir': 'Change color',
  'Atıf kopyalandı': 'Citation copied',
  'Katalog yüklenemedi': 'Could not load catalog',
  'Kitap yüklenemedi': 'Could not load book',
  'Sunucuya ulaşılamadı.': 'Could not reach the server.',
  'Künye güncellendi': 'Metadata updated',
  'Künye güncellenemedi': 'Could not update metadata',
  'Not güncellendi': 'Note updated',
  'Not güncellenemedi': 'Could not update note',
  'Not metni': 'Note text',
  'Etiketler': 'Tags',
  'Not cihazda kaydedildi; eşitleme bekliyor': 'Note saved on this device; sync pending',
  'Eşitleme bekliyor': 'Sync pending',
  'Bu eski yerel notun hesabı doğrulanamıyor. Önce JSON olarak dışa aktarın.': 'The account for this legacy local note cannot be verified. Export it as JSON first.',
  'Yer imi kaldırıldı': 'Bookmark removed',
  'Yer imi bu cihazdan kaldırıldı': 'Bookmark removed from this device',
  'Not bu cihazdan kaldırıldı': 'Note removed from this device',
  'Yer imini kaldır': 'Remove bookmark',
  'Yalnızca yüklenen kitaplar silinebilir': 'Only uploaded titles can be deleted',
  'Yalnızca platforma yüklenen kitaplar silinebilir': 'Only platform-managed titles can be deleted',
  'Tüm cihazlardaki oturumlar kapatılsın mı?': 'Sign out of all devices?',
  'Yeni parola en az 8 karakter olmalı.': 'New password must be at least 8 characters.',
  'Mevcut parola hatalı.': 'Current password is incorrect.',
  'Parola değiştirildi; yeniden giriş yapın.': 'Password changed; sign in again.',
  'Parola değiştirilemedi.': 'Could not change password.',
  'Demo modunda parola değiştirilemez.': 'Password cannot be changed in demo mode.',
  'Başlık boş olamaz': 'Title cannot be empty',
  'Başlıksız': 'Untitled',
  'Bu PDF’te içindekiler bulunamadı.': 'No table of contents found in this PDF.',
  'Bu PDF’te içindekiler bulunamadı. Sayfa numarası girerek veya aşağıdaki listeden gidebilirsiniz.': 'No table of contents found in this PDF. Enter a page number or use the list below.',
  'Geçersiz sayfa numarası': 'Invalid page number',
  'Sayfa aralığı dışında': 'Page out of range',
  'Sürekli kaydırma açılamadı': 'Could not open continuous scroll',
  'Tam ekran başlatılamadı': 'Could not start fullscreen',
  'Performans testi tamamlanamadı': 'Performance test could not complete',
  'İndiriliyor…': 'Downloading…',
  'Önce bir PDF veya EPUB seçin': 'Choose a PDF or EPUB first',
  'az önce': 'just now',
  'j/k veya ←/→ sayfa · / kitapta ara · n notlar · b yer imi · ? yardım · Esc kapat': 'j/k or ←/→ page · / search in book · n notes · b bookmark · ? help · Esc close',
  'Geçersiz sayfa numarası': 'Invalid page number',
  'EPUB yüklenemedi': 'Could not load EPUB',
};

const PATTERNS = [
  [/^Çok fazla indirme isteği; (\d+) saniye sonra tekrar deneyin\.$/, 'Too many download requests; try again in $1 seconds.'],
  [/^Sayfa (\d+) \/ (\d+)$/, 'Page $1 / $2'],
  [/^Sayfa (\d+)$/, 'Page $1'],
  [/^Sayfa (\d+) · Yer imi$/, 'Page $1 · Bookmark'],
  [/^Sayfa (\d+) · (\d+) eşleşme$/, 'Page $1 · $2 matches'],
  [/^Sayfa (.+)$/, 'Page $1'],
  [/^Sayfa (\d+)-(\d+) \/ (\d+)$/, 'Pages $1-$2 / $3'],
  [/^Bölüm (\d+)$/, 'Chapter $1'],
  [/^Bölüm (\d+) · (\d+) eşleşme$/, 'Chapter $1 · $2 matches'],
  [/^(\d+) sonuç$/, '$1 results'],
  [/^(\d+)\+ sonuç$/, '$1+ results'],
  [/^(\d+) sonuç · dizin$/, '$1 results · index'],
  [/^(\d+) eşleşme$/, '$1 matches'],
  [/^(.+) · EPUB · (\d+) bölüm$/, '$1 · EPUB · $2 chapters'],
  [/^· EPUB · (\d+) bölüm$/, '· EPUB · $1 chapters'],
  [/^EPUB · (\d+) bölüm$/, 'EPUB · $1 chapters'],
  [/^(\d+) \/ (\d+)$/, '$1 / $2'],
  [/^(\d+) başlık$/, '$1 titles'],
  [/^(\d+) kitap$/, '$1 books'],
  [/^(\d+) gün önce$/, '$1 days ago'],
  [/^(\d+) sa önce$/, '$1 hr ago'],
  [/^(\d+) dk önce$/, '$1 min ago'],
  [/^Aranıyor… (\d+) \/ (\d+)$/, 'Searching… $1 / $2'],
  [/^Aynı anda en fazla (\d+) oturum açılabilir\. Önce bir cihazdan çıkış yapın\.$/, 'At most $1 sessions can be open. Sign out on one device first.'],
  [/^Kurumun eşzamanlı oturum limiti \((\d+)\) dolu\. Önce bir cihazdan çıkış yapın\.$/, 'The institution seat limit ($1) is full. Sign out on one device first.'],
  [/^EPUB yüklenemedi: (.+)$/, 'Could not load EPUB: $1'],
  [/^Dışa aktarma: (.+)$/, 'Export: $1'],
  [/^Oluşturuldu: (.+) · Düzenlendi: (.+)$/, 'Created: $1 · Edited: $2'],
  [/^Oluşturuldu: (.+)$/, 'Created: $1'],
  [/^(.+) kitabını oku$/, 'Read $1'],
  [/^“(.+)” kalıcı olarak silinsin mi\? Notlar ve ilerleme de silinir\.$/, 'Delete “$1” permanently? Notes and progress will also be deleted.'],
];

const SKIP = 'script, style, code, .book-title, .book-meta, .note-text, .cite-output, [data-no-i18n]';

const HTML_STRINGS = {
  heroLede: {
    tr: 'Bu ekran ürün değil; PDF.js, <code>anchor</code> modeli ve Postgres aramasını ölçmek için kurulmuş bir iskelet. Örnek içerik kamu malı test PDF’idir.',
    en: 'This screen is not a product; it is a skeleton for measuring PDF.js, the <code>anchor</code> model and Postgres search. Sample content is a public-domain test PDF.',
  },
};

let lang = 'tr';

export function getLang() {
  return lang;
}

export function initializeLanguage() {
  let saved = 'tr';
  try { saved = localStorage.getItem('uiLang') || 'tr'; } catch { /* private mode */ }
  lang = saved === 'en' ? 'en' : 'tr';
  document.documentElement.lang = lang;
  translateDom(document.body);
  document.title = lang === 'en' ? 'Academic Platform — Spike' : 'Akademik Platform — Spike';
  for (const button of document.querySelectorAll('[data-lang-toggle]')) {
    button.textContent = lang === 'en' ? 'TR' : 'EN';
    button.setAttribute('aria-label', lang === 'en' ? 'Türkçeye geç' : 'Switch to English');
  }
}

export function toggleLanguage() {
  try { localStorage.setItem('uiLang', lang === 'en' ? 'tr' : 'en'); } catch { /* noop */ }
  window.location.reload();
}

export function translateString(value, language = lang) {
  if (language !== 'en') return value;
  const text = String(value ?? '');
  if (DICT[text]) return DICT[text];
  for (const [pattern, replacement] of PATTERNS) {
    if (pattern.test(text)) return text.replace(pattern, replacement);
  }
  return text;
}

export function t(value) {
  return translateString(value);
}

export function translateDom(root = document.body) {
  if (!root) return;
  for (const element of root.querySelectorAll('[data-i18n]')) {
    const entry = HTML_STRINGS[element.dataset.i18n];
    if (entry && lang === 'en') element.innerHTML = entry.en;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let node = walker.nextNode();
  while (node) {
    nodes.push(node);
    node = walker.nextNode();
  }
  for (const textNode of nodes) {
    const parent = textNode.parentElement;
    if (!parent || parent.closest(SKIP)) continue;
    const original = textNode.nodeValue;
    const trimmed = original.trim();
    const translated = translateString(trimmed);
    if (translated !== trimmed) {
      const start = original.indexOf(trimmed);
      textNode.nodeValue = original.slice(0, start) + translated + original.slice(start + trimmed.length);
    }
  }
  for (const element of root.querySelectorAll('[placeholder], [title], [aria-label]')) {
    if (element.closest(SKIP)) continue;
    for (const attr of ['placeholder', 'title', 'aria-label']) {
      const value = element.getAttribute(attr);
      if (!value) continue;
      const translated = translateString(value);
      if (translated !== value) element.setAttribute(attr, translated);
    }
  }
}
