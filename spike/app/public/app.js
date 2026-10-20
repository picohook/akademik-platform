import * as pdfjsLib from '/vendor/pdfjs/pdf.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.mjs';

const state = {
  books: [],
  filter: 'all',
  query: '',
  book: null,
  pdf: null,
  page: 1,
  numPages: 0,
  scale: 1,
  viewport: null,
  annotations: [],
  outline: [],
  pageText: new Map(),
  searchRun: 0,
  activeQuery: '',
  ocrCache: new Map(),
  ocrManifest: new Map(),
  renderTask: null,
  pending: null,
};

const $ = (id) => document.getElementById(id);
const grid = $('grid');
const empty = $('empty');
const filters = $('filters');
const count = $('count');
const search = $('search');
const mode = $('mode');

const reader = $('reader');
const canvas = $('canvas');
const pageWrap = $('pageWrap');
const textLayerEl = $('textLayer');
const highlightsEl = $('highlights');
const pageLabel = $('pageLabel');
const readerTitle = $('readerTitle');
const readerMeta = $('readerMeta');
const zoomLabel = $('zoomLabel');
const noteCount = $('noteCount');
const notesList = $('notesList');
const notesEmpty = $('notesEmpty');
const notesPanel = $('notesPanel');
const tocPanel = $('tocPanel');
const tocList = $('tocList');
const tocEmpty = $('tocEmpty');
const tocFilter = $('tocFilter');
const pageInput = $('pageInput');
const pageTotal = $('pageTotal');
const bookmarkBtn = $('bookmarkBtn');
const tabToc = $('tabToc');
const tabSearch = $('tabSearch');
const tocView = $('tocView');
const searchView = $('searchView');
const bookSearch = $('bookSearch');
const searchStatus = $('searchStatus');
const searchResults = $('searchResults');
const searchEmpty = $('searchEmpty');
const hlBar = $('hlBar');
const hlNote = $('hlNote');
const toastEl = $('toast');

const editModal = $('editModal');
const editForm = $('editForm');
const editId = $('editId');
const editTitle = $('editTitle');
const editSubtitle = $('editSubtitle');
const editLanguage = $('editLanguage');
const editYear = $('editYear');
const editPublisher = $('editPublisher');
const editSubjects = $('editSubjects');

const uploadModal = $('uploadModal');
const uploadForm = $('uploadForm');
const uploadFile = $('uploadFile');
const uploadTitle = $('uploadTitle');
const uploadSubtitle = $('uploadSubtitle');
const uploadLanguage = $('uploadLanguage');
const uploadYear = $('uploadYear');
const uploadPublisher = $('uploadPublisher');
const uploadSubjects = $('uploadSubjects');
const uploadSubmitButton = $('submitUpload');

function toast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toastEl.hidden = true; }, 2600);
}

function hue(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) % 360;
  return hash;
}

function makeCard(book) {
  const card = document.createElement('div');
  card.className = 'card';
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.addEventListener('click', () => openBook(book));
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openBook(book);
    }
  });

  const cover = document.createElement('div');
  cover.className = 'cover';
  const h = hue(book.title || 'x');
  cover.style.background = `linear-gradient(145deg, hsl(${h} 36% 26%), hsl(${(h + 38) % 360} 42% 16%))`;

  const kicker = document.createElement('span');
  kicker.className = 'kicker';
  kicker.lang = book.language === 'en' ? 'en' : 'tr';
  const subject = (book.subjects && book.subjects[0]) || 'Akademik';
  // Locale-aware uppercase: English "Nursing" -> NURSING (I), Turkish "Diş" -> DİŞ (İ).
  kicker.textContent = String(subject).toLocaleUpperCase(kicker.lang);
  cover.appendChild(kicker);

  const initial = document.createElement('span');
  initial.className = 'initial';
  initial.textContent = (book.title || 'A').trim().charAt(0).toLocaleUpperCase('tr');
  cover.appendChild(initial);

  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = book.title;
  cover.appendChild(title);

  const author = document.createElement('div');
  author.className = 'author';
  author.textContent = book.publisher || '';
  cover.appendChild(author);

  const meta = document.createElement('div');
  meta.className = 'card-meta';
  const cardTitle = document.createElement('p');
  cardTitle.className = 'card-title';
  cardTitle.textContent = book.subtitle || book.title;
  meta.appendChild(cardTitle);

  const sub = document.createElement('p');
  sub.className = 'card-sub';
  sub.textContent = `${book.language ? book.language.toUpperCase() : '—'} · ${book.publication_year || '—'}`;
  meta.appendChild(sub);

  const badges = document.createElement('div');
  badges.className = 'badges';
  (book.subjects || []).slice(0, 2).forEach((subject) => {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = subject;
    badges.appendChild(badge);
  });
  meta.appendChild(badges);

  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'edit-btn';
  edit.textContent = 'Düzenle';
  edit.addEventListener('click', (event) => {
    event.stopPropagation();
    openEdit(book);
  });
  meta.appendChild(edit);

  card.appendChild(cover);
  card.appendChild(meta);
  return card;
}

function renderBooks() {
  grid.replaceChildren();
  const visible = state.books.filter((book) => {
    if (state.filter === 'all') return true;
    return (book.subjects || []).includes(state.filter);
  });
  visible.forEach((book) => grid.appendChild(makeCard(book)));
  count.textContent = `${visible.length} başlık`;
  empty.hidden = visible.length !== 0;
}

function openEdit(book) {
  editId.value = book.id;
  editTitle.value = book.title || '';
  editSubtitle.value = book.subtitle || '';
  editLanguage.value = book.language === 'en' ? 'en' : 'tr';
  editYear.value = book.publication_year || '';
  editPublisher.value = book.publisher || '';
  editSubjects.value = (book.subjects || []).join('; ');
  editModal.hidden = false;
  setTimeout(() => editTitle.focus(), 0);
}

function closeEdit() {
  editModal.hidden = true;
}

async function saveEdit(event) {
  event.preventDefault();
  const id = editId.value;
  const payload = {
    title: editTitle.value.trim(),
    subtitle: editSubtitle.value.trim(),
    language: editLanguage.value,
    publisher: editPublisher.value.trim(),
    year: editYear.value ? Number(editYear.value) : null,
    subjects: editSubjects.value.split(/[;,]/).map((item) => item.trim()).filter(Boolean),
  };
  if (!payload.title) {
    toast('Başlık boş olamaz');
    return;
  }
  try {
    const response = await fetch(`/api/books/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error('Kaydedilemedi');
    const updated = await response.json();
    state.books = state.books.map((book) => (book.id === updated.id ? updated : book));
    if (state.book?.id === updated.id) {
      readerTitle.textContent = updated.title;
      readerMeta.textContent = `${updated.publisher || ''}${updated.publication_year ? ` · ${updated.publication_year}` : ''}`;
    }
    renderFilters();
    renderBooks();
    closeEdit();
    toast('Künye güncellendi');
  } catch (error) {
    console.error(error);
    toast('Künye güncellenemedi');
  }
}

function renderFilters() {
  const subjects = new Set();
  state.books.forEach((book) => (book.subjects || []).forEach((s) => subjects.add(s)));
  filters.replaceChildren();
  const all = document.createElement('button');
  all.className = `chip${state.filter === 'all' ? ' active' : ''}`;
  all.textContent = 'Tümü';
  all.addEventListener('click', () => { state.filter = 'all'; renderFilters(); renderBooks(); });
  filters.appendChild(all);
  [...subjects].sort((a, b) => a.localeCompare(b, 'tr')).forEach((subject) => {
    const chip = document.createElement('button');
    chip.className = `chip${state.filter === subject ? ' active' : ''}`;
    chip.textContent = subject;
    chip.addEventListener('click', () => { state.filter = subject; renderFilters(); renderBooks(); });
    filters.appendChild(chip);
  });
}

function openUpload() {
  uploadForm.reset();
  uploadModal.hidden = false;
  setTimeout(() => uploadFile.focus(), 0);
}

function closeUpload() {
  uploadModal.hidden = true;
}

async function submitUpload(event) {
  event.preventDefault();
  const file = uploadFile.files && uploadFile.files[0];
  if (!file) {
    toast('Önce bir PDF seçin');
    return;
  }

  const data = new FormData();
  data.append('file', file, file.name);
  if (uploadTitle.value.trim()) data.append('title', uploadTitle.value.trim());
  if (uploadSubtitle.value.trim()) data.append('subtitle', uploadSubtitle.value.trim());
  data.append('language', uploadLanguage.value);
  if (uploadYear.value) data.append('year', uploadYear.value);
  if (uploadPublisher.value.trim()) data.append('publisher', uploadPublisher.value.trim());
  if (uploadSubjects.value.trim()) data.append('subjects', uploadSubjects.value.trim());

  uploadSubmitButton.disabled = true;
  uploadSubmitButton.textContent = 'Yükleniyor…';
  try {
    const response = await fetch('/api/upload', { method: 'POST', body: data });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Yüklenemedi');
    state.books.unshift(payload);
    renderFilters();
    renderBooks();
    closeUpload();
    toast('Kitap eklendi');
  } catch (error) {
    console.error(error);
    toast(error.message === 'already uploaded' ? 'Bu PDF zaten yüklü' : 'Kitap yüklenemedi');
  } finally {
    uploadSubmitButton.disabled = false;
    uploadSubmitButton.textContent = 'Yükle';
  }
}

async function loadBooks(query = '') {
  const url = query ? `/api/search?q=${encodeURIComponent(query)}` : '/api/books';
  const response = await fetch(url);
  if (!response.ok) throw new Error('Katalog yüklenemedi');
  state.books = await response.json();
  renderFilters();
  renderBooks();
}

function updateZoomLabel() {
  zoomLabel.textContent = `${Math.round(state.scale * 100)}%`;
}

function fitScale(baseViewport) {
  const area = document.querySelector('.page-area');
  const available = Math.max(320, area.clientWidth - 120);
  return Math.min(2, Math.max(0.6, available / baseViewport.width));
}

async function resolveDest(dest) {
  try {
    const explicit = typeof dest === 'string' ? await state.pdf.getDestination(dest) : dest;
    if (!explicit || !explicit[0]) return null;
    const index = await state.pdf.getPageIndex(explicit[0]);
    return index + 1;
  } catch {
    return null;
  }
}

async function loadOutline() {
  state.outline = [];
  if (!state.pdf) return;
  try {
    const outline = await state.pdf.getOutline();
    if (!outline || !outline.length) return;
    const walk = async (nodes, depth) => {
      for (const node of nodes) {
        const page = await resolveDest(node.dest);
        if (page) state.outline.push({ title: node.title || 'Başlıksız', page, depth });
        if (node.items && node.items.length) await walk(node.items, depth + 1);
      }
    };
    await walk(outline, 0);
  } catch (error) {
    console.warn('outline failed', error);
  }
}

function renderToc() {
  const query = tocFilter.value.trim().toLocaleLowerCase('tr');
  tocList.replaceChildren();
  tocEmpty.hidden = true;

  if (state.outline.length) {
    const items = state.outline.filter((item) => item.title.toLocaleLowerCase('tr').includes(query));
    if (!items.length) {
      tocEmpty.hidden = false;
      tocEmpty.textContent = 'Eşleşen bölüm yok.';
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const item of items) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `toc-item${item.page === state.page ? ' active' : ''}`;
      button.style.paddingLeft = `${9 + item.depth * 12}px`;
      button.textContent = item.title;
      const page = document.createElement('span');
      page.className = 'toc-page';
      page.textContent = String(item.page);
      button.appendChild(page);
      button.addEventListener('click', () => goToPage(item.page));
      fragment.appendChild(button);
    }
    tocList.appendChild(fragment);
    return;
  }

  tocEmpty.hidden = false;
  tocEmpty.textContent = 'Bu PDF\'te içindekiler bulunamadı. Sayfa numarası girerek veya aşağıdaki listeden gidebilirsiniz.';
  if (query) {
    tocEmpty.textContent = 'Bu PDF\'te içindekiler bulunamadı.';
    return;
  }
  const fragment = document.createDocumentFragment();
  for (let pageNumber = 1; pageNumber <= state.numPages; pageNumber += 1) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `toc-item${pageNumber === state.page ? ' active' : ''}`;
    button.textContent = `Sayfa ${pageNumber}`;
    button.addEventListener('click', () => goToPage(pageNumber));
    fragment.appendChild(button);
  }
  tocList.appendChild(fragment);
}

function toggleToc(show) {
  const next = typeof show === 'boolean' ? show : tocPanel.hidden;
  tocPanel.hidden = !next;
  if (next) {
    renderToc();
    if (window.innerWidth < 820) notesPanel.hidden = true;
  }
}

function updatePageUi() {
  pageInput.max = String(state.numPages || 1);
  pageInput.value = String(state.page || 1);
  pageTotal.textContent = `/ ${state.numPages || 1}`;
  pageLabel.textContent = `${state.page} / ${state.numPages}`;
  updateBookmarkUi();
}

function updateUrl() {
  if (!state.book) return;
  const url = new URL(window.location.href);
  url.searchParams.set('book', state.book.id);
  url.searchParams.set('page', String(state.page));
  history.replaceState(null, '', url);
}

function bookmarkForPage() {
  return state.annotations.find(
    (annotation) => annotation.color === 'bookmark' && Number(annotation.anchor?.page) === state.page,
  );
}

function updateBookmarkUi() {
  const hasBookmark = Boolean(bookmarkForPage());
  bookmarkBtn.textContent = hasBookmark ? '★' : '☆';
  bookmarkBtn.classList.toggle('active', hasBookmark);
  bookmarkBtn.title = hasBookmark ? 'Yer imini kaldır' : 'Yer imi ekle';
}

async function goToPage(value) {
  if (!state.pdf) return;
  const requested = Number(value);
  if (!Number.isFinite(requested) || requested < 1) {
    toast('Geçersiz sayfa numarası');
    updatePageUi();
    return;
  }
  const target = Math.min(state.numPages, Math.max(1, Math.trunc(requested)));
  if (target !== requested) toast('Sayfa aralığı dışında');
  state.page = target;
  await renderPage();
}

async function toggleBookmark() {
  if (!state.book || !state.pdf) return;
  const existing = bookmarkForPage();
  if (existing) {
    await deleteAnnotation(existing.id, { silent: true });
    toast('Yer imi kaldırıldı');
    return;
  }
  try {
    const response = await fetch('/api/annotations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        assetId: state.book.asset_id,
        anchor: {
          asset_version_id: state.book.asset_id,
          type: 'pdf',
          page: state.page,
          rects: [],
          text_quote: { prefix: '', exact: '', suffix: '' },
          text_position: { start: 0, end: 0 },
        },
        color: 'bookmark',
        note: 'Yer imi',
        selectedText: null,
      }),
    });
    if (!response.ok) throw new Error('bookmark failed');
    const saved = await response.json();
    state.annotations.push(saved);
    renderNotes();
    updateBookmarkUi();
    toast('Yer imi eklendi');
  } catch (error) {
    console.error(error);
    toast('Yer imi eklenemedi');
  }
}

function showShortcuts() {
  toast('j/k veya ←/→ sayfa · / kitapta ara · n notlar · b yer imi · ? yardım · Esc kapat');
}

function showTocTab(tab) {
  const search = tab === 'search';
  tabToc.classList.toggle('active', !search);
  tabSearch.classList.toggle('active', search);
  tocView.hidden = search;
  searchView.hidden = !search;
  if (search) setTimeout(() => bookSearch.focus(), 0);
}

function normalizeSearch(value) {
  return String(value || '').toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim();
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function getPageText(pageNumber) {
  const key = `${state.book.asset_id}:${pageNumber}`;
  if (state.pageText.has(key)) return state.pageText.get(key);

  let text = '';
  const ocrPages = await getOcrPages(state.book.asset_id);
  if (ocrPages.has(pageNumber)) {
    try {
      const response = await fetch(`/ocr/${encodeURIComponent(state.book.asset_id)}/page-${String(pageNumber).padStart(3, '0')}.hocr?v=2`);
      if (response.ok) {
        const hocr = await response.text();
        const doc = new DOMParser().parseFromString(hocr, 'text/html');
        text = [...doc.querySelectorAll('.ocrx_word')].map((word) => word.textContent).join(' ');
      }
    } catch {
      text = '';
    }
  } else {
    try {
      const page = await state.pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      text = content.items.map((item) => item.str).join(' ');
    } catch {
      text = '';
    }
  }

  text = text.replace(/\s+/g, ' ').trim();
  state.pageText.set(key, text);
  return text;
}

function addSearchResult(pageNumber, text, index, queryLength, query) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'toc-item search-item';
  const label = document.createElement('span');
  label.textContent = `Sayfa ${pageNumber}`;
  const snippet = document.createElement('span');
  snippet.className = 'search-snippet';
  const start = Math.max(0, index - 45);
  const end = Math.min(text.length, index + queryLength + 45);
  snippet.textContent = `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
  button.appendChild(label);
  button.appendChild(snippet);
  button.addEventListener('click', async () => {
    state.activeQuery = query;
    await goToPage(pageNumber);
    if (window.innerWidth < 820) toggleToc(false);
  });
  searchResults.appendChild(button);
}

function addSearchResultSnippet(pageNumber, snippetText, query) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'toc-item search-item';
  const label = document.createElement('span');
  label.textContent = `Sayfa ${pageNumber}`;
  const snippet = document.createElement('span');
  snippet.className = 'search-snippet';
  snippet.textContent = snippetText;
  button.appendChild(label);
  button.appendChild(snippet);
  button.addEventListener('click', async () => {
    state.activeQuery = query;
    await goToPage(pageNumber);
    if (window.innerWidth < 820) toggleToc(false);
  });
  searchResults.appendChild(button);
}

let searchTimer = null;
async function runSearch(rawQuery) {
  const query = String(rawQuery || '').trim();
  const normalized = normalizeSearch(query);
  const run = ++state.searchRun;
  state.activeQuery = query;
  applySearchHighlight();
  searchResults.replaceChildren();
  searchEmpty.hidden = true;

  if (!normalized) {
    searchStatus.textContent = '';
    return;
  }

  searchStatus.textContent = 'Aranıyor…';
  try {
    const response = await fetch(`/api/books/${encodeURIComponent(state.book.id)}/search?q=${encodeURIComponent(query)}`);
    if (state.searchRun !== run) return;
    if (response.ok) {
      const data = await response.json();
      if (data.indexed) {
        const results = Array.isArray(data.results) ? data.results : [];
        results.forEach((result) => addSearchResultSnippet(result.page, result.snippet, query));
        searchStatus.textContent = results.length ? `${results.length}${results.length >= 100 ? '+' : ''} sonuç` : '0 sonuç';
        if (!results.length) {
          searchEmpty.hidden = false;
          searchEmpty.textContent = 'Sonuç bulunamadı.';
        }
        return;
      }
    }
  } catch {
    // Fall back to the browser-side cache when the server index is unavailable.
  }

  searchStatus.textContent = `Aranıyor… 0 / ${state.numPages}`;
  let count = 0;

  // Start from the current page, then scan forward and wrap around. Academic
  // searches usually target the chapter the reader is in.
  const order = [];
  for (let pageNumber = state.page; pageNumber <= state.numPages; pageNumber += 1) order.push(pageNumber);
  for (let pageNumber = 1; pageNumber < state.page; pageNumber += 1) order.push(pageNumber);

  for (let index = 0; index < order.length; index += 1) {
    if (state.searchRun !== run) return;
    const pageNumber = order[index];
    const text = await getPageText(pageNumber);
    if (state.searchRun !== run) return;
    const lower = normalizeSearch(text);
    let from = 0;
    let perPage = 0;
    while (perPage < 3 && count < 200) {
      const found = lower.indexOf(normalized, from);
      if (found < 0) break;
      addSearchResult(pageNumber, text, found, normalized.length, query);
      count += 1;
      perPage += 1;
      from = found + normalized.length;
    }
    if (index % 10 === 0 || index === order.length - 1) {
      searchStatus.textContent = `Aranıyor… ${index + 1} / ${order.length}`;
    }
    if (index % 3 === 0) await nextFrame();
    if (count >= 200) break;
  }

  if (state.searchRun !== run) return;
  searchStatus.textContent = count ? `${count}${count >= 200 ? '+' : ''} sonuç` : '0 sonuç';
  if (!count) {
    searchEmpty.hidden = false;
    searchEmpty.textContent = 'Sonuç bulunamadı.';
  }
}

function applySearchHighlight() {
  textLayerEl.querySelectorAll('.search-hit').forEach((span) => span.classList.remove('search-hit'));
  const query = normalizeSearch(state.activeQuery);
  if (!query) return;
  textLayerEl.querySelectorAll('span').forEach((span) => {
    if (normalizeSearch(span.textContent).includes(query)) span.classList.add('search-hit');
  });
}

async function getOcrPages(assetId) {
  if (state.ocrManifest.has(assetId)) return state.ocrManifest.get(assetId);
  let pages = new Set();
  try {
    const response = await fetch(`/api/ocr/${encodeURIComponent(assetId)}`);
    if (response.ok) {
      const data = await response.json();
      pages = new Set((data.pages || []).map(Number));
    }
  } catch {
    // No OCR manifest: fall back to the PDF text layer.
  }
  state.ocrManifest.set(assetId, pages);
  return pages;
}

async function renderOcrLayer(viewport) {
  const assetId = state.book?.asset_id;
  if (!assetId) return false;

  const ocrPages = await getOcrPages(assetId);
  if (!ocrPages.has(state.page)) return false;

  const page = String(state.page).padStart(3, '0');
  const key = `${assetId}:${page}`;
  let hocr = state.ocrCache.get(key);
  if (hocr === undefined) {
    try {
      const response = await fetch(`/ocr/${encodeURIComponent(assetId)}/page-${page}.hocr?v=2`);
      hocr = response.ok ? await response.text() : null;
    } catch {
      hocr = null;
    }
    state.ocrCache.set(key, hocr);
  }
  if (!hocr) return false;

  const doc = new DOMParser().parseFromString(hocr, 'text/html');
  const pageEl = doc.querySelector('.ocr_page');
  const pageBox = /bbox\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/.exec(pageEl?.getAttribute('title') || '');
  if (!pageBox) return false;
  const pageWidth = Number(pageBox[3]) - Number(pageBox[1]);
  if (!pageWidth) return false;
  const scale = viewport.width / pageWidth;
  const words = [...doc.querySelectorAll('.ocrx_word')];
  if (!words.length) return false;

  const fragment = document.createDocumentFragment();
  for (const word of words) {
    const box = /bbox\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/.exec(word.getAttribute('title') || '');
    const text = (word.textContent || '').trim();
    if (!box || !text) continue;
    const x0 = Number(box[1]);
    const y0 = Number(box[2]);
    const x1 = Number(box[3]);
    const y1 = Number(box[4]);
    const width = (x1 - x0) * scale;
    const height = (y1 - y0) * scale;
    if (width <= 0 || height <= 0) continue;
    const span = document.createElement('span');
    span.className = 'ocr-word';
    // hOCR words are separate spans; without a trailing space the browser
    // concatenates the selection ("DişHekimliğinde"). The space stays in the
    // DOM text even when overflow clips it visually.
    span.textContent = `${text} `;
    span.style.position = 'absolute';
    span.style.left = `${x0 * scale}px`;
    span.style.top = `${y0 * scale}px`;
    span.style.width = `${width}px`;
    span.style.height = `${height}px`;
    span.style.fontSize = `${height}px`;
    span.style.lineHeight = '1';
    span.style.whiteSpace = 'pre';
    span.style.overflow = 'hidden';
    span.style.color = 'transparent';
    span.style.transformOrigin = '0 0';
    fragment.appendChild(span);
    // A real whitespace text node between absolutely positioned word spans is
    // what makes the browser's native selection include spaces.
    fragment.appendChild(document.createTextNode(' '));
  }
  if (!fragment.childNodes.length) return false;
  textLayerEl.appendChild(fragment);
  return true;
}

async function renderPage() {
  if (!state.pdf) return;
  if (state.renderTask) {
    try { state.renderTask.cancel(); } catch { /* noop */ }
    state.renderTask = null;
  }
  const page = await state.pdf.getPage(state.page);
  const base = page.getViewport({ scale: 1 });
  if (!state.scale || state.scale <= 0) state.scale = fitScale(base);
  const viewport = page.getViewport({ scale: state.scale });
  state.viewport = viewport;

  const outputScale = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(viewport.width * outputScale);
  canvas.height = Math.floor(viewport.height * outputScale);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  pageWrap.style.width = `${Math.floor(viewport.width)}px`;
  pageWrap.style.height = `${Math.floor(viewport.height)}px`;
  textLayerEl.style.width = `${Math.floor(viewport.width)}px`;
  textLayerEl.style.height = `${Math.floor(viewport.height)}px`;
  textLayerEl.style.setProperty('--scale-factor', String(viewport.scale));
  textLayerEl.style.setProperty('--total-scale-factor', String(viewport.scale));

  const context = canvas.getContext('2d', { alpha: false });
  const task = page.render({
    canvasContext: context,
    viewport,
    transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null,
  });
  state.renderTask = task;
  try {
    await task.promise;
  } catch (error) {
    if (error?.name === 'RenderingCancelledException') return;
    throw error;
  }

  textLayerEl.replaceChildren();
  const usedOcr = await renderOcrLayer(viewport);
  if (!usedOcr) {
    try {
      const textContent = await page.getTextContent();
      const textLayer = new pdfjsLib.TextLayer({
        textContentSource: textContent,
        container: textLayerEl,
        viewport,
      });
      await textLayer.render();
    } catch (error) {
      console.warn('text layer failed', error);
    }
  }
  applySearchHighlight();

  updatePageUi();
  updateZoomLabel();
  renderHighlights();
  if (!tocPanel.hidden) renderToc();
  saveProgress();
  updateUrl();
}

function renderHighlights() {
  highlightsEl.replaceChildren();
  if (!state.viewport) return;
  const scale = state.viewport.scale;
  state.annotations
    .filter((annotation) => Number(annotation.anchor?.page) === state.page)
    .forEach((annotation) => {
      const rects = Array.isArray(annotation.anchor?.rects) ? annotation.anchor.rects : [];
      rects.forEach((rect) => {
        const box = document.createElement('div');
        box.className = `hl ${annotation.color || 'yellow'}`;
        box.style.left = `${rect[0] * scale}px`;
        box.style.top = `${rect[1] * scale}px`;
        box.style.width = `${rect[2] * scale}px`;
        box.style.height = `${rect[3] * scale}px`;
        highlightsEl.appendChild(box);
      });
    });
}

function mergeRects(raw) {
  const items = raw
    .filter((rect) => rect[2] >= 3 && rect[3] >= 3 && rect.every(Number.isFinite))
    .map(([x, y, w, h]) => ({ x, y, w, h }))
    .sort((a, b) => a.y - b.y || a.x - b.x);

  const lines = [];
  for (const rect of items) {
    const line = lines.find((candidate) =>
      Math.abs(candidate.y - rect.y) <= Math.max(2, rect.h * 0.4)
      && rect.x <= candidate.x + candidate.w + 14);
    if (line) {
      const right = Math.max(line.x + line.w, rect.x + rect.w);
      line.x = Math.min(line.x, rect.x);
      line.w = right - line.x;
      line.h = Math.max(line.h, rect.h);
      line.y = Math.min(line.y, rect.y);
    } else {
      lines.push({ ...rect });
    }
  }
  return lines.map((line) => [line.x, line.y, line.w, line.h]);
}

function clearPending() {
  highlightsEl.querySelectorAll('.pending').forEach((element) => element.remove());
}

function renderPending(rects) {
  clearPending();
  if (!state.viewport) return;
  const scale = state.viewport.scale;
  rects.forEach((rect) => {
    const box = document.createElement('div');
    box.className = 'hl pending';
    box.style.left = `${rect[0] * scale}px`;
    box.style.top = `${rect[1] * scale}px`;
    box.style.width = `${rect[2] * scale}px`;
    box.style.height = `${rect[3] * scale}px`;
    highlightsEl.appendChild(box);
  });
}

function renderNotes() {
  notesList.replaceChildren();
  noteCount.textContent = String(state.annotations.length);
  notesEmpty.hidden = state.annotations.length !== 0;
  state.annotations.forEach((annotation) => {
    const isBookmark = annotation.color === 'bookmark';
    const item = document.createElement('div');
    item.className = 'note-item';
    const page = document.createElement('div');
    page.className = 'note-page';
    page.textContent = `Sayfa ${annotation.anchor?.page || '—'}${isBookmark ? ' · Yer imi' : ''}`;
    item.appendChild(page);
    if (!isBookmark && annotation.selected_text) {
      const text = document.createElement('p');
      text.className = 'note-text';
      text.textContent = annotation.selected_text.length > 120
        ? `${annotation.selected_text.slice(0, 120)}…`
        : annotation.selected_text;
      item.appendChild(text);
    }
    if (!isBookmark && annotation.note) {
      const body = document.createElement('p');
      body.className = 'note-body';
      body.textContent = annotation.note;
      item.appendChild(body);
    }
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'note-delete';
    remove.title = 'Sil';
    remove.textContent = '×';
    remove.addEventListener('click', async (event) => {
      event.stopPropagation();
      await deleteAnnotation(annotation.id);
    });
    item.appendChild(remove);

    item.addEventListener('click', async () => {
      const target = Number(annotation.anchor?.page) || 1;
      await goToPage(target);
      notesPanel.hidden = true;
    });
    notesList.appendChild(item);
  });
  updateBookmarkUi();
}

async function saveProgress() {
  if (!state.book) return;
  try {
    await fetch('/api/progress', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        assetId: state.book.asset_id,
        anchor: { asset_version_id: state.book.asset_id, type: 'pdf', page: state.page, rects: [] },
        percent: state.numPages ? Math.round((state.page / state.numPages) * 100) : 0,
      }),
    });
  } catch (error) {
    console.warn('progress save failed', error);
  }
}

async function openBook(book) {
  state.book = book;
  state.page = 1;
  state.scale = 0;
  state.annotations = [];
  state.outline = [];
  state.pageText = new Map();
  state.searchRun += 1;
  state.activeQuery = '';
  bookSearch.value = '';
  searchResults.replaceChildren();
  searchStatus.textContent = '';
  searchEmpty.hidden = true;
  showTocTab('toc');
  tocFilter.value = '';
  tocPanel.hidden = true;
  reader.hidden = false;
  document.body.style.overflow = 'hidden';
  readerTitle.textContent = book.title;
  readerMeta.textContent = `${book.publisher || ''}${book.publication_year ? ` · ${book.publication_year}` : ''}`;
  notesPanel.hidden = window.innerWidth < 820;
  pageLabel.textContent = '…';

  try {
    const [progressResponse, annotationsResponse] = await Promise.all([
      fetch(`/api/progress?assetId=${encodeURIComponent(book.asset_id)}`),
      fetch(`/api/annotations?assetId=${encodeURIComponent(book.asset_id)}`),
    ]);
    const progress = progressResponse.ok ? await progressResponse.json() : null;
    state.annotations = annotationsResponse.ok ? await annotationsResponse.json() : [];

    const task = pdfjsLib.getDocument({
      url: `/api/books/${encodeURIComponent(book.id)}/file`,
      cMapUrl: '/vendor/pdfjs/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/vendor/pdfjs/standard_fonts/',
    });
    state.pdf = await task.promise;
    state.numPages = state.pdf.numPages;

    const params = new URLSearchParams(window.location.search);
    const rawPage = params.get('book') === book.id ? params.get('page') : null;
    if (rawPage !== null) {
      const requested = Number(rawPage);
      if (!Number.isInteger(requested) || requested < 1) {
        toast('Geçersiz sayfa numarası');
        state.page = 1;
      } else if (requested > state.numPages) {
        toast('Sayfa aralığı dışında');
        state.page = state.numPages;
      } else {
        state.page = requested;
      }
    } else {
      const savedPage = Number(progress?.anchor?.page);
      state.page = Number.isFinite(savedPage) && savedPage > 0
        ? Math.min(savedPage, state.numPages)
        : 1;
    }

    await loadOutline();
    renderToc();
    renderNotes();
    updatePageUi();
    await renderPage();
  } catch (error) {
    console.error(error);
    toast('PDF yüklenemedi. Sunucu ve dosya yolunu kontrol edin.');
    closeReader();
  }
}

async function closeReader() {
  if (state.renderTask) {
    try { state.renderTask.cancel(); } catch { /* noop */ }
  }
  state.renderTask = null;
  state.pdf = null;
  state.book = null;
  reader.hidden = true;
  document.body.style.overflow = '';
  hlBar.hidden = true;
  tocPanel.hidden = true;
  state.outline = [];
  state.searchRun += 1;
  state.activeQuery = '';
  clearPending();
  textLayerEl.replaceChildren();
  highlightsEl.replaceChildren();
}

function updateSelectionBar(rect) {
  const barWidth = 320;
  const left = Math.min(Math.max(12, rect.left + rect.width / 2 - barWidth / 2), window.innerWidth - barWidth - 12);
  const top = Math.max(12, rect.top - 58);
  hlBar.style.left = `${left}px`;
  hlBar.style.top = `${top}px`;
}

function selectedOcrSpans(selection) {
  const range = selection.rangeCount ? selection.getRangeAt(0) : null;
  return [...textLayerEl.querySelectorAll('.ocr-word')]
    .filter((span) => (range ? range.intersectsNode(span) : selection.containsNode(span, true)));
}

function ocrSelectionText(selection) {
  const words = selectedOcrSpans(selection)
    .map((span) => span.textContent.trim())
    .filter(Boolean);
  return words.length ? words.join(' ') : selection.toString().trim();
}

function buildSelection(selection) {
  if (!state.book || !selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!textLayerEl.contains(range.commonAncestorContainer)) return null;

  const ocrSpans = selectedOcrSpans(selection);
  const text = ocrSelectionText(selection);
  if (!text) return null;

  const pageRect = pageWrap.getBoundingClientRect();
  const scale = state.viewport?.scale || 1;
  const toPageRect = (rect) => [
    Math.max(0, (rect.left - pageRect.left) / scale),
    Math.max(0, (rect.top - pageRect.top) / scale),
    rect.width / scale,
    rect.height / scale,
  ];

  let rects;
  if (ocrSpans.length) {
    // Highlight the full OCR word boxes, not the partial browser range, so the
    // saved text and the yellow boxes always cover the same words.
    rects = ocrSpans
      .map((span) => toPageRect(span.getBoundingClientRect()))
      .filter((rect) => rect[2] > 1 && rect[3] > 1);
  } else {
    // PDF.js returns a rectangle per glyph/fragment; merge them per line.
    rects = mergeRects([...range.getClientRects()].map(toPageRect));
  }

  if (!rects.length) return null;

  const last = ocrSpans.length
    ? ocrSpans[ocrSpans.length - 1].getBoundingClientRect()
    : (range.getClientRects()[range.getClientRects().length - 1] || pageRect);

  return { text, ocrSpans, range, rects, last };
}

function onSelection() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return;
  const built = buildSelection(selection);
  if (!built) return;

  renderPending(built.rects);
  state.pending = {
    text: built.text,
    anchor: {
      asset_version_id: state.book.asset_id,
      type: 'pdf',
      page: state.page,
      rects: built.rects,
      text_quote: { prefix: '', exact: built.text, suffix: '' },
      text_position: { start: 0, end: built.text.length },
    },
  };
  hlNote.value = '';
  updateSelectionBar(built.last);
  hlBar.hidden = false;
  hlNote.focus();
}

async function saveHighlight() {
  if (!state.pending || !state.book) return;
  const pending = state.pending;
  state.pending = null;
  hlBar.hidden = true;
  try {
    const response = await fetch('/api/annotations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        assetId: state.book.asset_id,
        anchor: pending.anchor,
        color: 'yellow',
        note: hlNote.value.trim() || null,
        selectedText: pending.text,
      }),
    });
    if (!response.ok) throw new Error('annotation failed');
    const saved = await response.json();
    state.annotations.push({ ...saved, selected_text: saved.selected_text || pending.text });
    renderNotes();
    renderHighlights();
    toast('Vurgu kaydedildi');
    window.getSelection()?.removeAllRanges();
  } catch (error) {
    console.error(error);
    toast('Vurgu kaydedilemedi');
  }
}

async function deleteAnnotation(id, options = {}) {
  try {
    const response = await fetch(`/api/annotations/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!response.ok) throw new Error('delete failed');
    state.annotations = state.annotations.filter((annotation) => annotation.id !== id);
    renderNotes();
    renderHighlights();
    if (!options.silent) toast('Not silindi');
  } catch (error) {
    console.error(error);
    toast('Not silinemedi');
  }
}

function changePage(delta) {
  goToPage(state.page + delta);
}

search.addEventListener('input', () => {
  const query = search.value.trim();
  clearTimeout(search._timer);
  search._timer = setTimeout(() => {
    state.query = query;
    loadBooks(query).catch((error) => toast(error.message));
  }, 220);
});

document.addEventListener('keydown', (event) => {
  const target = event.target;
  const typing = target
    && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable);

  if (!uploadModal.hidden) {
    if (event.key === 'Escape') closeUpload();
    return;
  }
  if (!editModal.hidden) {
    if (event.key === 'Escape') closeEdit();
    return;
  }
  if (event.key === '?' && !typing) {
    event.preventDefault();
    showShortcuts();
    return;
  }
  if (event.key === '/' && !typing) {
    event.preventDefault();
    if (reader.hidden) {
      search.focus();
    } else {
      toggleToc(true);
      showTocTab('search');
      bookSearch.focus();
    }
    return;
  }
  if (typing) {
    if (event.key === 'Escape') {
      event.target.blur();
      if (!tocPanel.hidden) toggleToc(false);
    }
    return;
  }
  if (reader.hidden) return;

  switch (event.key) {
    case 'Escape':
      if (!tocPanel.hidden) toggleToc(false);
      else if (!notesPanel.hidden) notesPanel.hidden = true;
      else closeReader();
      break;
    case 'ArrowLeft':
    case 'k':
      changePage(-1);
      break;
    case 'ArrowRight':
    case 'j':
      changePage(1);
      break;
    case 'n':
      notesPanel.hidden = !notesPanel.hidden;
      if (!notesPanel.hidden && window.innerWidth < 820) tocPanel.hidden = true;
      break;
    case 'b':
      toggleBookmark();
      break;
    case 't':
      toggleToc(true);
      showTocTab('toc');
      break;
    default:
      break;
  }
});

$('openUpload').addEventListener('click', openUpload);
uploadForm.addEventListener('submit', submitUpload);
$('closeUpload').addEventListener('click', closeUpload);
$('cancelUpload').addEventListener('click', closeUpload);
uploadModal.addEventListener('click', (event) => {
  if (event.target === uploadModal) closeUpload();
});
uploadFile.addEventListener('change', () => {
  const file = uploadFile.files && uploadFile.files[0];
  if (file && !uploadTitle.value.trim()) {
    uploadTitle.value = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  }
});

editForm.addEventListener('submit', saveEdit);
$('closeEdit').addEventListener('click', closeEdit);
$('cancelEdit').addEventListener('click', closeEdit);
editModal.addEventListener('click', (event) => {
  if (event.target === editModal) closeEdit();
});

$('closeReader').addEventListener('click', closeReader);
$('toggleToc').addEventListener('click', () => toggleToc());
$('closeToc').addEventListener('click', () => toggleToc(false));
tocFilter.addEventListener('input', renderToc);
tabToc.addEventListener('click', () => showTocTab('toc'));
tabSearch.addEventListener('click', () => showTocTab('search'));
bookSearch.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => runSearch(bookSearch.value), 300);
});
bookSearch.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    clearTimeout(searchTimer);
    runSearch(bookSearch.value);
  }
});
pageInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    goToPage(pageInput.value);
    pageInput.blur();
  }
});
pageInput.addEventListener('change', () => goToPage(pageInput.value));
bookmarkBtn.addEventListener('click', toggleBookmark);
$('prevPage').addEventListener('click', () => changePage(-1));
$('nextPage').addEventListener('click', () => changePage(1));
$('zoomIn').addEventListener('click', () => {
  state.scale = Math.min(3, state.scale + 0.2);
  renderPage();
});
$('zoomOut').addEventListener('click', () => {
  state.scale = Math.max(0.5, state.scale - 0.2);
  renderPage();
});
$('toggleNotes').addEventListener('click', () => {
  notesPanel.hidden = !notesPanel.hidden;
  if (!notesPanel.hidden && window.innerWidth < 820) tocPanel.hidden = true;
});
$('hlSave').addEventListener('click', saveHighlight);
$('hlCancel').addEventListener('click', () => {
  state.pending = null;
  hlBar.hidden = true;
  clearPending();
  window.getSelection()?.removeAllRanges();
});
hlNote.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') saveHighlight();
  if (event.key === 'Escape') {
    state.pending = null;
    hlBar.hidden = true;
    clearPending();
  }
});

textLayerEl.addEventListener('mouseup', () => setTimeout(onSelection, 0));

let selectionFrame = null;
function updateLiveSelection() {
  selectionFrame = null;
  if (reader.hidden) return;
  if (state.pending && !hlBar.hidden) return;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) {
    clearPending();
    return;
  }
  const built = buildSelection(selection);
  if (!built) {
    clearPending();
    return;
  }
  renderPending(built.rects);
}

document.addEventListener('selectionchange', () => {
  if (selectionFrame) return;
  selectionFrame = requestAnimationFrame(updateLiveSelection);
});

document.addEventListener('copy', (event) => {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return;
  if (!selection.anchorNode || !textLayerEl.contains(selection.anchorNode)) return;
  const words = selectedOcrSpans(selection)
    .map((span) => span.textContent.trim())
    .filter(Boolean);
  if (!words.length || !event.clipboardData) return;
  event.clipboardData.setData('text/plain', words.join(' '));
  event.preventDefault();
});

document.addEventListener('mousedown', (event) => {
  if (!hlBar.hidden && !hlBar.contains(event.target)) {
    hlBar.hidden = true;
    state.pending = null;
    clearPending();
  }
});

window.addEventListener('resize', () => {
  if (reader.hidden || !state.pdf) return;
  clearTimeout(window._resizeTimer);
  window._resizeTimer = setTimeout(() => {
    state.scale = 0;
    renderPage();
  }, 220);
});

(async function init() {
  try {
    const health = await fetch('/api/health').then((response) => response.json());
    mode.textContent = health.mode === 'db' ? 'DB modu' : 'Demo modu';
    mode.classList.toggle('db', health.mode === 'db');
  } catch {
    mode.textContent = 'bağlantı yok';
  }
  try {
    await loadBooks();
    const bookId = new URLSearchParams(window.location.search).get('book');
    if (bookId) {
      const book = state.books.find((item) => item.id === bookId || item.asset_id === bookId);
      if (book) await openBook(book);
    }
  } catch (error) {
    toast(error.message);
  }
})();
