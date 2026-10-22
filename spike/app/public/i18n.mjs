// Minimal UI i18n: Turkish is the source text, English is a lookup table.
// Static DOM is translated on load; dynamic renderers call translateDom()/t().

const DICT = {
  'İçeriğe atla': 'Skip to content',
  'Okuyucu:': 'Reader:',
  'Kütüphaneci:': 'Librarian:',
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
  'Başlık (boşsa dosya adı)': 'Title (filename if empty)',
  'Yükle': 'Upload',
  'Atıf': 'Citation',
  'Stil': 'Style',
  'Sayfa (opsiyonel, örn. 42 veya 42-45)': 'Page (optional, e.g. 42 or 42-45)',
  'Kopyala': 'Copy',
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
  'Yer imi': 'Bookmark',
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
  'Vurgu kaydedilemedi': 'Could not save highlight',
  'Kitap silindi': 'Book deleted',
  'Kitap silinemedi': 'Could not delete book',
  'Bu kitapta kopyalama kapalı': 'Copying is disabled for this title',
  'Bu kitapta indirme kapalı': 'Downloading is disabled for this title',
  'PDF indirildi': 'PDF downloaded',
  'PDF indirilemedi': 'Could not download PDF',
  'E-posta veya parola hatalı.': 'Incorrect email or password.',
  'Giriş yapılamadı.': 'Could not sign in.',
  'Bu dosya zaten yüklü': 'This file is already uploaded',
  'Kitap eklendi': 'Book added',
  'Geçersiz sayfa numarası': 'Invalid page number',
  'EPUB yüklenemedi': 'Could not load EPUB',
};

const PATTERNS = [
  [/^Sayfa (\d+) \/ (\d+)$/, 'Page $1 / $2'],
  [/^Sayfa (\d+)-(\d+) \/ (\d+)$/, 'Pages $1-$2 / $3'],
  [/^Bölüm (\d+)$/, 'Chapter $1'],
  [/^Bölüm (\d+) · (\d+) eşleşme$/, 'Chapter $1 · $2 matches'],
  [/^(\d+) sonuç$/, '$1 results'],
  [/^(\d+)\+ sonuç$/, '$1+ results'],
  [/^(\d+) sonuç · dizin$/, '$1 results · index'],
  [/^(\d+) eşleşme$/, '$1 matches'],
  [/^(.+) · EPUB · (\d+) bölüm$/, '$1 · EPUB · $2 chapters'],
  [/^EPUB · (\d+) bölüm$/, 'EPUB · $1 chapters'],
  [/^(\d+) \/ (\d+)$/, '$1 / $2'],
  [/^(\d+) başlık$/, '$1 titles'],
  [/^(\d+) kitap$/, '$1 books'],
  [/^(\d+) gün önce$/, '$1 days ago'],
];

const SKIP = 'script, style, code, .book-title, .book-meta, .note-text, .cite-output, [data-no-i18n]';

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

export function translateString(value) {
  if (lang !== 'en') return value;
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
