import { normalizeBookVariant, bookRequestId, offlineBookKey, groupBookVariants, variantLabel, locationMatchesBook, bookFromLocation, findOfflineVariant } from '/book-variants.mjs';
import { renderPdfLinks, destinationPage } from '/book-links.mjs';
import * as pdfjsLib from '/vendor/pdfjs/pdf.mjs';
import { buildPdfStructure } from '/pdf-structure.mjs';
import { renderHocrText } from '/ocr-layer.mjs';
import { formatCitation, normalizePdfPageLabels, pdfPageLabel, pdfPageDescription, pdfCitationPage, formatCopiedSelection } from '/citations.mjs';
import { EpubEngine } from '/epub-engine.mjs';
import { initializeLanguage, toggleLanguage, t, translateDom, getLang } from '/i18n.mjs?v=23';
import { fetchDownloadBlob, saveOfflineDownload } from '/downloads.mjs';
import {
  listOfflineBooks,
  getOfflineBook,
  deleteOfflineBook,
  storageEstimate,
  listLocalAnnotations,
  editLocalAnnotation,
  saveAnnotationWithOperation,
  removeLocalAnnotationWithOperation,
  cacheServerAnnotations,
  syncAnnotationOperations,
  resolveAnnotationConflict,
  subscribeAnnotationChanges,
} from '/offline.mjs';

initializeLanguage();
if ('serviceWorker' in navigator && (window.isSecureContext || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('/sw.js').catch((error) => console.warn('service worker:', error.message));
}
for (const button of document.querySelectorAll('[data-lang-toggle]')) {
  button.addEventListener('click', toggleLanguage);
}
import { findWholeWord, findFuzzyWord, foldChars, normalizeSearch } from '/search.mjs?v=1';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.mjs';

function readCookie(name) {
  const prefix = `${name}=`;
  const entry = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix));
  return entry ? decodeURIComponent(entry.slice(prefix.length)) : '';
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = [...document.scripts].find((script) => script.src.endsWith(src));
    if (existing) {
      if (existing.dataset.loaded === '1') resolve();
      else {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
      }
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.addEventListener('load', () => {
      script.dataset.loaded = '1';
      resolve();
    }, { once: true });
    script.addEventListener('error', reject, { once: true });
    document.head.appendChild(script);
  });
}

// Double-submit CSRF: the server sets a readable cookie; mutating requests echo it.
const nativeFetch = window.fetch.bind(window);
window.fetch = (input, init = {}) => {
  const method = String(init.method || 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const token = readCookie('akademik_csrf');
    if (token) {
      const headers = new Headers(init.headers || {});
      if (!headers.has('x-csrf-token')) headers.set('x-csrf-token', token);
      init = { ...init, headers };
    }
  }
  return nativeFetch(input, init);
};

const state = {
  books: [],
  filter: 'all',
  query: '',
  user: null,
  book: null,
  pdf: null,
  page: 1,
  numPages: 0,
  pdfPageLabels: null,
  scale: 1,
  fitMode: 'width',
  initialFit: true,
  rotation: 0,
  theme: 'light',
  twoPage: false,
  secondPage: null,
  secondViewport: null,
  scrollMode: false,
  scrollPanes: [],
  scrollObserver: null,
  scrollToken: 0,
  epubEngine: null,
  epubMode: false,
  epubProgress: null,
  epubFontSize: 100,
  epubSelection: null,
  activeBookmarkId: null,
  bookmarkJump: false,
  epubFrameObserver: null,
  offlineMode: false,
  offlineLibrary: false,
  offlineBlob: null,
  annotationSyncing: false,
  viewport: null,
  annotations: [],
  noteQuery: '',
  noteColor: 'all',
  outline: [],
  pageText: new Map(),
  searchRun: 0,
  activeQuery: '',
  activeMatchType: '',
  searchHits: [],
  searchIndex: -1,
  searchQuery: '',
  highlightColor: 'yellow',
  perf: null,
  ocrCache: new Map(),
  ocrManifest: new Map(),
  renderTask: null,
  secondRenderTask: null,
  pending: null,
  readerReturnFocus: null,
};

const $ = (id) => document.getElementById(id);
const grid = $('grid');
const empty = $('empty');
const filters = $('filters');
const count = $('count');
const search = $('search');
const mode = $('mode');
const brandName = $('brandName');
const brandTag = $('brandTag');
const loginBrand = $('loginBrand');
const footerBrand = $('footerBrand');
const footerYear = $('footerYear');
const footerVersion = $('footerVersion');
const footerEnvironment = $('footerEnvironment');
const footerBuildDate = $('footerBuildDate');
const footerSupport = $('footerSupport');
const loginScreen = $('loginScreen');
const loginForm = $('loginForm');
const loginEmail = $('loginEmail');
const loginPassword = $('loginPassword');
const loginError = $('loginError');
const userChip = $('userChip');
const logoutBtn = $('logoutBtn');
const passwordBtn = $('passwordBtn');
const passwordModal = $('passwordModal');
const passwordForm = $('passwordForm');
const passwordCurrent = $('passwordCurrent');
const passwordNew = $('passwordNew');
const passwordError = $('passwordError');

const reader = $('reader');
const pageArea = document.querySelector('.page-area');
const epubView = $('epubView');
const canvas = $('canvas');
const canvas2 = $('canvas2');
const pageLoading = $('pageLoading');
const pageWrap = $('pageWrap');
const pageWrap2 = $('pageWrap2');
const textLayerEl = $('textLayer');
const textLayer2 = $('textLayer2');
const highlightsEl = $('highlights');
const highlights2 = $('highlights2');
const scrollPages = $('scrollPages');
const pageLabel = $('pageLabel');
const readerTitle = $('readerTitle');
const readerMeta = $('readerMeta');
const readerVariants = $('readerVariants');
const variantSelections = new Map();
const zoomLabel = $('zoomLabel');
const noteCount = $('noteCount');
const notesList = $('notesList');
const notesEmpty = $('notesEmpty');
const notesPanel = $('notesPanel');
const noteFilter = $('noteFilter');
const noteColorFilter = $('noteColorFilter');
const exportMd = $('exportMd');
const exportJson = $('exportJson');
const tocPanel = $('tocPanel');
const tocList = $('tocList');
const tocEmpty = $('tocEmpty');
const tocFilter = $('tocFilter');
const pageInput = $('pageInput');
const pageTotal = $('pageTotal');
const fitToggle = $('fitToggle');
const themeBtn = $('themeBtn');
const spreadBtn = $('spreadBtn');
const scrollBtn = $('scrollBtn');
const bookmarkBtn = $('bookmarkBtn');
const downloadBtn = $('downloadBtn');
const tabToc = $('tabToc');
const tabSearch = $('tabSearch');
const tabPages = $('tabPages');
const tocView = $('tocView');
const searchView = $('searchView');
const pagesView = $('pagesView');
const thumbGrid = $('thumbGrid');
const bookSearch = $('bookSearch');
const searchStatus = $('searchStatus');
const searchResults = $('searchResults');
const searchEmpty = $('searchEmpty');
const searchPrev = $('searchPrev');
const searchNext = $('searchNext');
const searchPosition = $('searchPosition');
const searchWhole = $('searchWhole');
const searchFuzzy = $('searchFuzzy');
const hlBar = $('hlBar');
const hlColors = $('hlColors');
const hlNote = $('hlNote');
const hlCopy = $('hlCopy');
const hlCopyCite = $('hlCopyCite');
const toastEl = $('toast');
const readerStatus = $('readerStatus');
const messagesModal = $('messagesModal');
const messagesList = $('messagesList');
let messageHistory = [];
let messagesParent = null;
let readerStatusTimer;
let readerConflictSignature = '';
const perfPanel = $('perfPanel');
const perfBody = $('perfBody');

const editModal = $('editModal');
const editForm = $('editForm');
const editId = $('editId');
const editTitle = $('editTitle');
const editSubtitle = $('editSubtitle');
const editLanguage = $('editLanguage');
const editYear = $('editYear');
const editPublisher = $('editPublisher');
const editSubjects = $('editSubjects');
const editAuthors = $('editAuthors');
const editAllowCopy = $('editAllowCopy');
const editAllowDownload = $('editAllowDownload');
const editAllowPrint = $('editAllowPrint');
const editWatermark = $('editWatermark');
const deleteBookBtn = $('deleteBook');
const grantsModal = $('grantsModal');
const grantsList = $('grantsList');
const grantForm = $('grantForm');
const grantError = $('grantError');
const grantUsage = $('grantUsage');
const grantSubjectGroup = $('grantSubjectGroup');
const grantCollection = $('grantCollection');
const grantTitle = $('grantTitle');
const grantAuditEl = $('grantAudit');
const offlineModal = $('offlineModal');
const offlineList = $('offlineList');
const offlineStorage = $('offlineStorage');

const uploadModal = $('uploadModal');
const uploadForm = $('uploadForm');
const uploadFile = $('uploadFile');
const uploadTitle = $('uploadTitle');
const uploadSubtitle = $('uploadSubtitle');
const uploadLanguage = $('uploadLanguage');
const uploadYear = $('uploadYear');
const uploadPublisher = $('uploadPublisher');
const uploadSubjects = $('uploadSubjects');
const uploadAuthors = $('uploadAuthors');
const uploadSubmitButton = $('submitUpload');

const citeModal = $('citeModal');
const citeStyle = $('citeStyle');
const citePage = $('citePage');
const citeOutput = $('citeOutput');
const citeWarning = $('citeWarning');

function resetReaderStatus() {
  clearTimeout(readerStatusTimer);
  readerConflictSignature = '';
  if (readerStatus) readerStatus.textContent = '';
}

function announceReaderStatus(message) {
  if (!readerStatus || reader.hidden) return;
  clearTimeout(readerStatusTimer);
  readerStatus.textContent = '';
  const assetId = state.book?.asset_id;
  const ownerId = annotationOwnerId();
  readerStatusTimer = setTimeout(() => {
    if (!reader.hidden && state.book?.asset_id === assetId && annotationOwnerId() === ownerId) {
      readerStatus.textContent = t(message);
    }
  }, 120);
}

function announceReaderConflicts() {
  if (reader.hidden) return;
  const conflicts = state.annotations.filter(item => item.conflict);
  const signature = JSON.stringify(conflicts.map(item => [item.id, item.conflict.reason, item.conflict.current?.version || null]).sort());
  if (signature === readerConflictSignature) return;
  readerConflictSignature = signature;
  if (!conflicts.length) return;
  announceReaderStatus(conflicts.some(item => item.conflict.reason === 'operation_expired')
    ? 'Bu işlemin sunucu kaydı saklama süresi doldu; taslak korunuyor, yeni not olarak kaydedebilirsiniz'
    : 'Notta çakışma var; iki sürüm de korundu');
}

function toast(message) {
  // The visible toast is outside the modal and is hidden between messages.
  // Reader announcements use a persistent region inside the active dialog.
  const inReader = !reader.hidden && Boolean(readerStatus);
  toastEl.setAttribute('aria-hidden', inReader ? 'true' : 'false');
  toastEl.textContent = t(message);
  messageHistory.push({ text: toastEl.textContent, at: new Date().toISOString() });
  if (messageHistory.length > 200) messageHistory.shift();
  toastEl.hidden = false;
  if (inReader) announceReaderStatus(message);
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toastEl.hidden = true; }, 2600);
}

function renderMessageHistory() {
  messagesList.replaceChildren();
  for (const message of [...messageHistory].reverse()) {
    const item = document.createElement('li');
    const time = document.createElement('time');
    time.dateTime = message.at;
    time.textContent = new Date(message.at).toLocaleTimeString(getLang() === 'en' ? 'en-GB' : 'tr-TR', { hour: '2-digit', minute: '2-digit' });
    const text = document.createElement('p');
    text.textContent = message.text;
    item.append(time, text);
    messagesList.append(item);
  }
  $('messagesEmpty').hidden = Boolean(messageHistory.length);
  $('clearMessages').disabled = !messageHistory.length;
}

function openMessages() {
  if (!messagesModal.hidden) return;
  const parent = [...document.querySelectorAll('.modal')].find(modal => modal !== messagesModal && !modal.hidden);
  if (parent) {
    messagesParent = { modal: parent, returnFocus: modalReturnFocus, active: document.activeElement };
    parent.hidden = true;
  }
  renderMessageHistory();
  openModal(messagesModal, $('closeMessages'));
}

function closeMessages() {
  closeModal(messagesModal);
  if (messagesParent) {
    const parent = messagesParent;
    messagesParent = null;
    parent.modal.hidden = false;
    modalReturnFocus = parent.returnFocus;
    setAppInert(true);
    reader.inert = !reader.hidden;
    loginScreen.inert = !loginScreen.hidden;
    if (parent.active?.isConnected) parent.active.focus();
  }
}

function clearMessageHistory() {
  // An account/auth change must not restore an old account's suspended form.
  messagesParent = null;
  messageHistory = [];
  renderMessageHistory();
  if (!messagesModal.hidden) closeMessages();
}

function hue(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) % 360;
  return hash;
}

async function openCardBook(book) {
  if (state.offlineMode || state.offlineLibrary) {
    const stored = await findOfflineVariant(book, getOfflineBook);
    if (stored) {
      if (stored.book.format === 'epub') await openEpubBook(stored.book, { offlineBlob: stored.blob });
      else await openBook(stored.book, { offlineBlob: stored.blob });
      return;
    }
    toast(t('Bu sürüm çevrimdışı kaydedilmemiş'));
    return;
  }
  await openBook(book);
}

function makeVariantPicker(variants, selected, onChange, loading = false) {
  const label = document.createElement('label');
  label.className = 'variant-picker';
  const caption = document.createElement('span');
  caption.textContent = t('Dil / Biçim / Baskı');
  const select = document.createElement('select');
  select.className = 'variant-select';
  select.setAttribute('aria-label', t('Dil / Biçim / Baskı'));
  select.disabled = loading;
  for (const book of variants) {
    const option = document.createElement('option');
    option.value = bookRequestId(book);
    option.textContent = variantLabel(book, getLang());
    option.selected = option.value === bookRequestId(selected);
    select.appendChild(option);
  }
  label.append(caption, select);
  label.addEventListener('click', event => event.stopPropagation());
  select.addEventListener('change', async () => {
    const next = variants.find(book => bookRequestId(book) === select.value);
    if (!next || select.value === bookRequestId(selected)) return;
    select.disabled = true;
    try { await onChange(next); }
    catch (error) { console.error(error); toast(t('Sürüm açılamadı')); }
    finally { select.value = bookRequestId(selected); select.disabled = false; }
  });
  return label;
}

function renderReaderVariants(book, loading = false) {
  const variants = state.books.filter(item => item.id === book.id);
  if (!variants.some(item => bookRequestId(item) === bookRequestId(book))) variants.push(book);
  readerVariants.replaceChildren();
  readerVariants.hidden = variants.length < 2;
  if (variants.length < 2) return;
  readerVariants.appendChild(makeVariantPicker(variants, book, async next => {
    const offline = state.offlineMode;
    const stored = offline ? await findOfflineVariant(next, getOfflineBook) : null;
    if (offline && !stored) { toast(t('Bu sürüm çevrimdışı kaydedilmemiş')); return; }
    await saveProgress();
    await closeReader();
    variantSelections.set(next.id, bookRequestId(next));
    const url = new URL(window.location.href);
    url.searchParams.set('book', next.id);
    url.searchParams.set('asset', bookRequestId(next));
    url.searchParams.delete('page');
    url.searchParams.delete('cfi');
    history.replaceState(null, '', url);
    await openBook(next, stored ? { offlineBlob: stored.blob } : {});
    renderBooks();
  }, loading));
}

async function loadOfflineProgress(book) {
  let saved = localStorage.getItem(`offlineProgress:${offlineBookKey(book)}`);
  if (saved === null) {
    const legacy = await getOfflineBook(book.id);
    if (legacy?.book?.asset_id === book.asset_id) saved = localStorage.getItem(`offlineProgress:${book.id}`);
  }
  return JSON.parse(saved || 'null');
}

function makeCard(book, variants = [book]) {
  const card = document.createElement('div');
  card.className = 'card';
  card.addEventListener('click', () => { openCardBook(book).catch((error) => console.error(error)); });

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
  const formatBadge = document.createElement('span');
  formatBadge.className = 'badge format-badge';
  formatBadge.textContent = String(book.format || 'pdf').toUpperCase();
  badges.appendChild(formatBadge);
  (book.subjects || []).slice(0, 2).forEach((subject) => {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = subject;
    badges.appendChild(badge);
  });
  meta.appendChild(badges);

  if (variants.length > 1) {
    meta.appendChild(makeVariantPicker(variants, book, async (selected) => {
      variantSelections.set(book.id, bookRequestId(selected));
      const replacement = makeCard(selected, variants);
      card.replaceWith(replacement);
      replacement.querySelector('.variant-select')?.focus();
    }));
  }

  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'open-btn';
  open.textContent = t('Oku');
  open.setAttribute('aria-label', t(`${book.title} kitabını oku`));
  open.addEventListener('click', (event) => {
    event.stopPropagation();
    openCardBook(book).catch((error) => console.error(error));
  });
  meta.appendChild(open);

  if (book.allow_download !== false) {
    const offline = document.createElement('button');
    offline.type = 'button';
    offline.className = 'edit-btn offline-card-btn';
    offline.textContent = '↓';
    offline.title = t('Çevrimdışı indir');
    offline.setAttribute('aria-label', t('Çevrimdışı indir'));
    offline.addEventListener('click', (event) => {
      event.stopPropagation();
      handleOfflineDownload(book).catch((error) => {
        console.error(error);
        const detail = error.name === 'QuotaExceededError'
          ? t('Depolama alanı yetersiz')
          : error.message === 'Failed to fetch'
            ? t('İnternet bağlantısı yok')
            : error.message;
        toast(`${t('Çevrimdışı kaydedilemedi')}: ${detail}`);
      });
    });
    meta.appendChild(offline);
  }

  if (canEditBook(book)) {
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'edit-btn';
    edit.textContent = 'Düzenle';
    edit.addEventListener('click', (event) => {
      event.stopPropagation();
      openEdit(book);
    });
    meta.appendChild(edit);
  }

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
  const groups = groupBookVariants(visible, getLang(), variantSelections);
  groups.forEach(({ book, variants }) => grid.appendChild(makeCard(book, variants)));
  count.textContent = `${groups.length} başlık`;
  empty.hidden = groups.length !== 0;
  translateDom(grid);
  translateDom(count);
}

function authorsToText(authors) {
  return (authors || []).map((author) => {
    if (author && typeof author === 'object') {
      return author.family ? `${author.family}${author.given ? `, ${author.given}` : ''}` : '';
    }
    return String(author || '');
  }).filter(Boolean).join('; ');
}

let modalReturnFocus = null;

function openModal(modal, focusElement) {
  modalReturnFocus = document.activeElement;
  modal.hidden = false;
  setAppInert(true);
  reader.inert = !reader.hidden;
  loginScreen.inert = !loginScreen.hidden;
  setTimeout(() => focusElement?.focus(), 0);
}

function closeModal(modal) {
  modal.hidden = true;
  if (!messagesModal.hidden && messagesParent?.modal === modal) {
    // A background save may finish while its notification history is open.
    // Keep that history active, then return to the completed form's opener.
    modalReturnFocus = messagesParent.returnFocus;
    messagesParent = null;
    return;
  }
  reader.inert = false;
  loginScreen.inert = false;
  setAppInert(!loginScreen.hidden || !reader.hidden);
  const previous = modalReturnFocus;
  modalReturnFocus = null;
  if (previous && previous.isConnected) previous.focus();
}

function trapModalFocus(event) {
  if (event.key !== 'Tab') return false;
  const modal = [...document.querySelectorAll('.modal')].find((item) => !item.hidden);
  if (!modal) return false;
  const focusable = [...modal.querySelectorAll(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
  )].filter((element) => element.offsetParent !== null);
  if (!focusable.length) {
    event.preventDefault();
    return true;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
  return true;
}

function trapReaderFocus(event) {
  if (event.key !== 'Tab' || reader.hidden) return false;
  const focusable = [reader, ...(!hlBar.hidden && !reader.contains(hlBar) ? [hlBar] : [])].flatMap((root) => [...root.querySelectorAll(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], iframe, [tabindex]:not([tabindex="-1"])',
  )]).filter((element) => element.offsetParent !== null && !element.closest('[inert]'));
  if (!focusable.length) return false;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
    return true;
  }
  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
    return true;
  }
  return false;
}

async function handleOfflineDownload(book) {
  if (book.allow_download === false) {
    toast(t('Bu kitapta indirme kapalı'));
    return;
  }
  toast(t('Çevrimdışı kaydediliyor…'));
  try {
    await saveOfflineDownload(book);
  } catch (error) {
    if (error.status === 429) {
      toast(t(`Çok fazla indirme isteği; ${error.retryAfter} saniye sonra tekrar deneyin.`));
      return;
    }
    if (error.code === 'DOWNLOAD_TOO_LARGE') {
      toast(t('Dosya 300 MB sınırını aşıyor; çevrimdışı kaydedilemez'));
      return;
    }
    if (error.code === 'OFFLINE_QUOTA') {
      toast(t('Çevrimdışı alan yetersiz'));
      return;
    }
    // 409 means the server holds a file it will not stamp (e.g. malformed XHTML).
    // It is a permanent data defect, so retrying never helps: say so plainly.
    if (error.status === 409) {
      toast(t('Bu kitap şu an çevrimdışı indirilemiyor; kütüphaneye bildirildi'));
      return;
    }
    throw error;
  }
  toast(t('Çevrimdışı kaydedildi'));
  if (!offlineModal.hidden) await renderOfflineModal();
}

function offlineSize(bytes) {
  if (!bytes) return '—';
  return bytes > 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;
}

async function renderOfflineModal() {
  const entries = await listOfflineBooks();
  offlineList.replaceChildren();
  if (!entries.length) {
    offlineList.textContent = t('Çevrimdışı kitap yok.');
  }
  entries.forEach((entry) => {
    const row = document.createElement('div');
    row.className = 'grant-row';
    const label = document.createElement('span');
    label.textContent = `${entry.book.title} · ${String(entry.book.format || 'pdf').toUpperCase()} · ${offlineSize(entry.size)}`;
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'mini-btn';
    open.textContent = t('Aç');
    open.addEventListener('click', async () => {
      const stored = await getOfflineBook(entry.id);
      if (!stored) return;
      closeModal(offlineModal);
      state.offlineMode = true;
      if (stored.book.format === 'epub') await openEpubBook(stored.book, { offlineBlob: stored.blob });
      else await openBook(stored.book, { offlineBlob: stored.blob });
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'mini-btn';
    remove.textContent = 'Sil';
    remove.addEventListener('click', async () => {
      if (!window.confirm(t('Çevrimdışı kopya silinsin mi?'))) return;
      await deleteOfflineBook(entry.id);
      await renderOfflineModal();
    });
    row.append(label, open, remove);
    offlineList.appendChild(row);
  });
  const estimate = await storageEstimate();
  offlineStorage.textContent = estimate
    ? `${t('Kullanılan')}: ${offlineSize(estimate.usage)} / ${offlineSize(estimate.quota)}`
    : '';
}

async function openOfflineModal() {
  await renderOfflineModal();
  openModal(offlineModal, $('closeOffline'));
}

function closeOffline() {
  closeModal(offlineModal);
}

async function loadGrants() {
  grantsList.replaceChildren();
  try {
    const response = await fetch('/api/grants');
    if (!response.ok) throw new Error('grants failed');
    const grants = await response.json();
    try {
      const usage = await fetch('/api/grants/usage').then((item) => item.ok ? item.json() : null);
      if (usage) {
        grantUsage.textContent = `${t('Aktif oturum')}: ${usage.activeSessions}${usage.seatLimit ? ` / ${usage.seatLimit}` : ''}`;
      }
    } catch { /* usage optional */ }
    if (!grants.length) {
      grantsList.textContent = t('Aktif grant yok.');
      return;
    }
    grants.forEach((grant) => {
      const row = document.createElement('div');
      row.className = 'grant-row';
      const label = document.createElement('span');
      const subject = grant.subject_type === 'tenant'
        ? 'Kurum'
        : (grant.subject_email || grant.subject_id);
      const scope = grant.scope_type === 'all'
        ? 'Tümü'
        : `${grant.scope_type}: ${grant.scope_key || grant.scope_id || '—'}`;
      label.textContent = `${subject} · ${scope}${grant.seat_limit ? ` · ${grant.seat_limit} koltuk` : ''} · ${grant.status}`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'mini-btn';
      remove.textContent = 'Sil';
      remove.addEventListener('click', () => deleteGrant(grant.id));
      row.append(label, remove);
      grantsList.appendChild(row);
    });
  } catch (error) {
    console.error(error);
    grantsList.textContent = 'Grantlar yüklenemedi.';
  }
}

async function openGrants() {
  grantError.hidden = true;
  grantForm.reset();
  grantScopeTypeChanged();
  grantSubjectTypeChanged();
  await loadGrantOptions();
  loadGrants();
  renderGrantAudit();
  openModal(grantsModal, $('grantSubjectType'));
}

function closeGrants() {
  closeModal(grantsModal);
}

function grantSubjectTypeChanged() {
  const type = $('grantSubjectType').value;
  $('grantEmailLabel').hidden = type === 'group';
  $('grantGroupLabel').hidden = type !== 'group';
}

function grantScopeTypeChanged() {
  const scope = $('grantScopeType').value;
  const key = $('grantScopeKey');
  $('grantKeyLabel').hidden = ['collection', 'title', 'all'].includes(scope);
  $('grantCollectionLabel').hidden = scope !== 'collection';
  $('grantTitleLabel').hidden = scope !== 'title';
  key.disabled = ['collection', 'title', 'all'].includes(scope);
  key.placeholder = scope === 'publisher' ? 'Yayıncı adı' : scope === 'subject' ? 'Konu adı' : '';
}

async function loadGrantOptions(selectedGroupId = '') {
  const previousGroup = selectedGroupId || grantSubjectGroup.value;
  const [groups, collections] = await Promise.all([
    fetch('/api/groups').then((response) => response.ok ? response.json() : []).catch(() => []),
    fetch('/api/collections').then((response) => response.ok ? response.json() : []).catch(() => []),
  ]);
  grantSubjectGroup.replaceChildren();
  (groups || []).forEach((group) => {
    const option = document.createElement('option');
    option.value = group.id;
    option.textContent = `${group.name} (${group.member_count || 0})`;
    grantSubjectGroup.appendChild(option);
  });
  if (previousGroup && [...grantSubjectGroup.options].some((option) => option.value === previousGroup)) {
    grantSubjectGroup.value = previousGroup;
  }
  grantCollection.replaceChildren();
  (collections || []).forEach((collection) => {
    const option = document.createElement('option');
    option.value = collection.id;
    option.textContent = `${collection.title} (${collection.item_count || 0})`;
    grantCollection.appendChild(option);
  });
  grantTitle.replaceChildren();
  state.books.forEach((book) => {
    const option = document.createElement('option');
    option.value = book.id;
    option.textContent = book.title;
    grantTitle.appendChild(option);
  });
}

async function renderGrantAudit() {
  const response = await fetch('/api/grants/audit').catch(() => null);
  if (!response?.ok) return;
  const rows = await response.json();
  grantAuditEl.replaceChildren();
  (rows || []).slice(0, 6).forEach((row) => {
    const item = document.createElement('div');
    item.className = 'grant-row';
    item.textContent = `${row.action} · ${row.actor_email || row.actor_user_id || '—'} · ${new Date(row.created_at).toLocaleString(getLang() === 'en' ? 'en-GB' : 'tr-TR')}`;
    grantAuditEl.appendChild(item);
  });
}

async function removeGrantGroupMember() {
  const groupId = grantSubjectGroup.value;
  const email = $('grantGroupEmail').value.trim();
  if (!groupId || !email) return;
  try {
    const response = await fetch(`/api/groups/${encodeURIComponent(groupId)}/members?email=${encodeURIComponent(email)}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('remove member failed');
    $('grantGroupEmail').value = '';
    await loadGrantOptions();
    toast(t('Üye çıkarıldı'));
  } catch (error) {
    console.error(error);
    toast(t('Üye çıkarılamadı'));
  }
}

async function submitGrant(event) {
  event.preventDefault();
  grantError.hidden = true;
  const scopeType = $('grantScopeType').value;
  const subjectType = $('grantSubjectType').value;
  try {
    const response = await fetch('/api/grants', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        subjectType,
        subjectEmail: $('grantSubjectEmail').value.trim(),
        subjectGroup: grantSubjectGroup.value,
        scopeType,
        scopeKey: $('grantScopeKey').value.trim(),
        scopeId: scopeType === 'collection' ? grantCollection.value : scopeType === 'title' ? grantTitle.value : '',
        seatLimit: Number($('grantSeatLimit').value) || null,
        source: $('grantSource').value,
      }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || 'grant failed');
    }
    grantForm.reset();
    grantScopeTypeChanged();
    grantSubjectTypeChanged();
    await loadGrants();
    await renderGrantAudit();
    toast(t('Grant eklendi'));
  } catch (error) {
    console.error(error);
    grantError.textContent = error.message;
    grantError.hidden = false;
  }
}

async function createGrantGroup() {
  const name = $('grantGroupName').value.trim();
  if (!name) return;
  try {
    const response = await fetch('/api/groups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'group failed');
    $('grantGroupName').value = '';
    await loadGrantOptions(payload.id);
    toast(t('Grup oluşturuldu'));
  } catch (error) {
    console.error(error);
    toast(t('Grup oluşturulamadı'));
  }
}

async function addGrantGroupMember() {
  const groupId = grantSubjectGroup.value;
  const email = $('grantGroupEmail').value.trim();
  if (!groupId) {
    toast(t('Önce bir grup oluşturun/seçin'));
    return;
  }
  if (!email) {
    toast(t('Kullanıcı e-postası gerekli'));
    return;
  }
  try {
    const response = await fetch(`/api/groups/${encodeURIComponent(groupId)}/members`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'member failed');
    $('grantGroupEmail').value = '';
    await loadGrantOptions(groupId);
    toast(t('Üye eklendi'));
  } catch (error) {
    console.error(error);
    toast(error.message === 'user not found'
      ? t('Kullanıcı bulunamadı')
      : `${t('Üye eklenemedi')}: ${error.message}`);
  }
}

async function deleteGrant(id) {
  if (!window.confirm(t('Grant silinsin mi?'))) return;
  try {
    const response = await fetch(`/api/grants/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!response.ok) throw new Error('delete failed');
    await loadGrants();
    toast(t('Grant silindi'));
  } catch (error) {
    console.error(error);
    toast(t('Grant silinemedi'));
  }
}

function openEdit(book) {
  editId.value = book.id;
  editTitle.value = book.title || '';
  editSubtitle.value = book.subtitle || '';
  editLanguage.value = book.language === 'en' ? 'en' : 'tr';
  editYear.value = book.publication_year || '';
  editPublisher.value = book.publisher || '';
  editSubjects.value = (book.subjects || []).join('; ');
  editAuthors.value = authorsToText(book.metadata?.authors);
  editAllowCopy.checked = book.allow_copy !== false;
  editAllowDownload.checked = book.allow_download !== false;
  editAllowPrint.checked = book.allow_print !== false;
  editWatermark.checked = book.watermark !== false;
  deleteBookBtn.hidden = !['upload', 'ingest'].includes(book.source_system);
  openModal(editModal, editTitle);
}

function closeEdit() {
  closeModal(editModal);
}

function openCite() {
  if (!state.book) return;
  citeStyle.value = 'apa';
  citePage.value = state.epubMode ? '' : pdfCitationPage(state.pdfPageLabels, state.page, getLang());
  const hint = $('citePageHint');
  hint.hidden = state.epubMode;
  hint.textContent = state.epubMode ? '' : pdfPageText(state.page) + ' · ' + t(pdfPageLabel(state.pdfPageLabels, state.page)
    ? 'PDF sayfa etiketi kullanıldı; basılı nüshayla doğrulayın.'
    : 'Basılı sayfa eşlemesi yok; PDF sıra numarası kullanıldı.');
  renderCitation();
  openModal(citeModal, citeStyle);
}

function closeCite() {
  closeModal(citeModal);
}

function renderCitation() {
  if (!state.book) return;
  const { text, warnings } = formatCitation(state.book, citeStyle.value, citePage.value);
  citeOutput.textContent = text;
  citeWarning.hidden = warnings.length === 0;
  citeWarning.textContent = warnings.map((warning) => t(warning)).join(' ');
}

async function writeClipboard(text) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const active = document.activeElement;
    const area = document.createElement('textarea');
    area.value = text;
    area.readOnly = true;
    area.style.cssText = 'position:fixed;left:-10000px;top:0';
    document.body.appendChild(area);
    const copyExactText = (event) => {
      if (!event.clipboardData) return;
      event.clipboardData.setData('text/plain', text);
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    document.addEventListener('copy', copyExactText, true);
    try {
      area.focus();
      area.select();
      if (!document.execCommand('copy')) throw new Error('copy failed');
    } finally {
      document.removeEventListener('copy', copyExactText, true);
      area.remove();
      active?.focus({ preventScroll: true });
    }
  }
}

async function copyCitation() {
  try {
    await writeClipboard(citeOutput.textContent || '');
    toast('Atıf kopyalandı');
  } catch {
    toast('Kopyalanamadı; metni seçip kopyalayın.');
  }
}

function updateCopyControls() {
  const blocked = state.book?.allow_copy === false;
  for (const button of [hlCopy, hlCopyCite]) {
    button.disabled = blocked;
    button.title = blocked ? t('Bu kitapta kopyalama kapalı') : button.textContent;
  }
}

async function copySelectedText(withCitation = false) {
  if (!state.book || reader.hidden || hlBar.hidden) return;
  if (state.book.allow_copy === false) {
    toast('Bu kitapta kopyalama kapalı');
    return;
  }
  const selected = state.epubMode ? state.epubSelection : state.pending;
  if (!selected?.text) return;
  const locator = state.epubMode
    ? { type: 'epub', chapter: selected.chapter, language: getLang() }
    : { type: 'pdf', labels: state.pdfPageLabels, page: selected.anchor.page, language: getLang() };
  const text = withCitation ? formatCopiedSelection(state.book, selected.text, locator) : selected.text;
  try {
    await writeClipboard(text);
    toast(withCitation ? 'Metin ve atıf panoya kopyalandı. Ctrl+V ile yapıştırabilirsiniz.' : 'Metin panoya kopyalandı. Ctrl+V ile yapıştırabilirsiniz.');
  } catch {
    const dialog = document.createElement('dialog');
    dialog.className = 'manual-copy-dialog';
    const label = document.createElement('p');
    label.textContent = 'Otomatik kopyalanamadı. Aşağıdaki metni Ctrl+C ile kopyalayın.';
    const field = document.createElement('textarea');
    field.value = text; field.readOnly = true;
    field.setAttribute('aria-label', 'Kopyalanacak metin ve atıf');
    const close = document.createElement('button');
    close.type = 'button'; close.textContent = 'Kapat';
    close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => { dialog.remove(); hlCopyCite.focus(); });
    dialog.append(label, field, close); reader.appendChild(dialog);
    dialog.showModal(); field.focus(); field.select();
  }
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
    authors: editAuthors.value.trim(),
    allow_copy: editAllowCopy.checked,
    allow_download: editAllowDownload.checked,
    allow_print: editAllowPrint.checked,
    watermark: editWatermark.checked,
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
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || 'Kaydedilemedi');
    }
    const updated = await response.json();
    await loadBooks(state.query);
    if (state.book?.id === updated.id) {
      const selected = state.books.find(book => book.asset_id === state.book.asset_id);
      if (selected) state.book = selected;
      readerTitle.textContent = state.book.title;
      readerMeta.textContent = `${state.book.publisher || ''}${state.book.publication_year ? ` · ${state.book.publication_year}` : ''}`;
      renderReaderVariants(state.book);
    }
    renderFilters();
    renderBooks();
    closeEdit();
    toast('Künye güncellendi');
  } catch (error) {
    console.error(error);
    toast(error.message === 'yetkiniz yok' ? 'Bu işlem için yetkiniz yok' : 'Künye güncellenemedi');
  }
}

function renderFilters() {
  const subjects = new Set();
  state.books.forEach((book) => (book.subjects || []).forEach((s) => subjects.add(s)));
  filters.replaceChildren();
  const all = document.createElement('button');
  all.className = `chip${state.filter === 'all' ? ' active' : ''}`;
  all.textContent = t('Tümü');
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
  openModal(uploadModal, uploadFile);
}

function closeUpload() {
  closeModal(uploadModal);
}

async function submitUpload(event) {
  event.preventDefault();
  const file = uploadFile.files && uploadFile.files[0];
  if (!file) {
    toast('Önce bir PDF veya EPUB seçin');
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
  if (uploadAuthors.value.trim()) data.append('authors', uploadAuthors.value.trim());

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
    const message = error.message === 'already uploaded' ? 'Bu dosya zaten yüklü'
      : error.message === 'yetkiniz yok' ? 'Bu işlem için yetkiniz yok'
        : error.message === 'file too large' ? 'Dosya 300 MB sınırını aşıyor'
          // The server explains why an EPUB cannot be watermarked; show it instead of
          // a generic failure, or the admin re-uploads the same broken file.
          : /^EPUB indirilemiyor/.test(error.message) ? error.message
            : 'Kitap yüklenemedi';
    toast(message);
  } finally {
    uploadSubmitButton.disabled = false;
    uploadSubmitButton.textContent = 'Yükle';
  }
}

function applyBrand(name, tagline) {
  const title = String(name || 'Akademik Platform').trim();
  const tag = String(tagline || '').trim();
  brandName.textContent = title;
  brandTag.textContent = tag;
  brandTag.hidden = !tag;
  loginBrand.textContent = title;
  document.title = `${title} — Katalog`;
}

function applyFooter(config) {
  footerBrand.textContent = config.brandName || 'Akademik Platform';
  footerYear.textContent = String(new Date().getFullYear());
  footerVersion.textContent = config.version ? `v${String(config.version).replace(/^v/i, '')}` : '';
  const env = config.environment === 'production' ? 'Üretim' : 'Geliştirme';
  footerEnvironment.textContent = config.environment ? t(env) : '';
  footerBuildDate.textContent = config.buildDate ? ` · ${config.buildDate}` : '';
  if (config.supportEmail) {
    footerSupport.href = `mailto:${config.supportEmail}`;
    footerSupport.hidden = false;
  } else {
    footerSupport.hidden = true;
  }
}

function canManage() {
  return ['admin', 'librarian', 'publisher'].includes(state.user?.role);
}

function canManageAccess() {
  return ['admin', 'librarian'].includes(state.user?.role);
}

function canEditBook(book) {
  if (!state.user) return false;
  if (['admin', 'librarian'].includes(state.user.role)) return true;
  return state.user.role === 'publisher' && book?.metadata?.uploaded_by === state.user.id;
}

function applyRoleUi() {
  $('openUpload').hidden = !canManage();
  $('grantsBtn').hidden = !canManageAccess();
}

function setAppInert(inert) {
  const topbar = document.querySelector('.topbar');
  const main = document.getElementById('mainContent');
  const skip = document.querySelector('.skip-link');
  if (topbar) topbar.inert = inert;
  if (main) main.inert = inert;
  if (skip) skip.inert = inert;
  const footer = document.getElementById('siteFooter');
  if (footer) footer.inert = inert;
}

function setUser(user) {
  if (state.user?.id !== user?.id) {
    clearMessageHistory();
  }
  state.authEpoch = (state.authEpoch || 0) + 1;
  state.user = user;
  syncShortcutControls();
  try {
    if (user?.id) localStorage.setItem('offlineAnnotationUser', user.id);
    else if (!user) localStorage.removeItem('offlineAnnotationUser');
  } catch { /* storage may be disabled */ }
  state.offlineLibrary = false;
  setAppInert(!user);
  userChip.textContent = user ? `${user.displayName || user.email} · ${user.role || 'reader'}` : '';
  userChip.hidden = !user;
  logoutBtn.hidden = !user;
  passwordBtn.hidden = !user;
  applyRoleUi();
}

async function showOfflineLibrary(entries) {
  loginScreen.hidden = true;
  setAppInert(false);
  setUser({ displayName: 'Çevrimdışı', role: 'reader' });
  logoutBtn.hidden = true;
  passwordBtn.hidden = true;
  $('grantsBtn').hidden = true;
  $('openUpload').hidden = true;
  mode.textContent = t('Çevrimdışı');
  state.offlineMode = true;
  state.offlineLibrary = true;
  state.books = entries.map((entry) => normalizeBookVariant(entry.book));
  renderFilters();
  renderBooks();
}

function showLogin(message = '') {
  clearMessageHistory();
  setAppInert(true);
  loginScreen.hidden = false;
  loginError.hidden = !message;
  loginError.textContent = t(message);
  loginPassword.value = '';
  setTimeout(() => loginPassword.focus(), 0);
}

async function bootData() {
  await loadBooks();
  const bookId = new URLSearchParams(window.location.search).get('book');
  if (bookId) {
    const book = bookFromLocation(state.books, new URLSearchParams(window.location.search));
    if (book) await openBook(book);
  }
}

async function handleLogin(event) {
  event.preventDefault();
  loginError.hidden = true;
  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: loginEmail.value.trim(), password: loginPassword.value }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      showLogin(payload.error === 'session limit reached'
        ? `Aynı anda en fazla ${payload.limit || 3} oturum açılabilir. Önce bir cihazdan çıkış yapın.`
        : payload.error === 'tenant seat limit reached'
          ? `Kurumun eşzamanlı oturum limiti (${payload.limit || 3}) dolu. Önce bir cihazdan çıkış yapın.`
          : 'E-posta veya parola hatalı.');
      return;
    }
    loginScreen.hidden = true;
    setUser(payload);
    await bootData();
    syncOfflineAnnotations().then(() => {
      const assetId = state.book?.asset_id;
      if (assetId) return syncReaderAnnotations(assetId);
    }).catch(() => {});
    search.focus();
  } catch (error) {
    console.error(error);
    showLogin('Giriş yapılamadı.');
  }
}

function openPassword() {
  passwordForm.reset();
  passwordError.hidden = true;
  openModal(passwordModal, passwordCurrent);
}

function closePassword() {
  closeModal(passwordModal);
}

async function submitPassword(event) {
  event.preventDefault();
  passwordError.hidden = true;
  try {
    const response = await fetch('/api/password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        currentPassword: passwordCurrent.value,
        newPassword: passwordNew.value,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      passwordError.hidden = false;
      passwordError.textContent = payload.error === 'current password is incorrect'
        ? 'Mevcut parola hatalı.'
        : payload.error === 'password too short'
          ? 'Yeni parola en az 8 karakter olmalı.'
          : payload.error === 'password change requires database mode'
            ? 'Demo modunda parola değiştirilemez.'
            : 'Parola değiştirilemedi.';
      return;
    }
    closePassword();
    toast('Parola değiştirildi; yeniden giriş yapın.');
    await logout();
  } catch (error) {
    console.error(error);
    passwordError.hidden = false;
    passwordError.textContent = 'Parola değiştirilemedi.';
  }
}

async function logoutAll() {
  if (!window.confirm(t('Tüm cihazlardaki oturumlar kapatılsın mı?'))) return;
  try {
    await fetch('/api/logout-all', { method: 'POST' });
  } catch {
    // The local cookie is cleared regardless.
  }
  closePassword();
  await logout();
}

async function logout() {
  setUser(null);
  state.annotations = [];
  try {
    await fetch('/api/logout', { method: 'POST' });
  } catch {
    // Cookie is cleared server-side on the next successful request.
  }
  window.location.href = '/';
}

async function loadBooks(query = '') {
  const url = query ? `/api/search?q=${encodeURIComponent(query)}` : '/api/books';
  const response = await fetch(url);
  if (response.status === 401) {
    showLogin('Oturum gerekli.');
    throw new Error('Oturum gerekli');
  }
  if (!response.ok) throw new Error('Katalog yüklenemedi');
  state.books = (await response.json()).map(normalizeBookVariant);
  renderFilters();
  renderBooks();
}

function updateZoomLabel() {
  if (state.epubMode) {
    zoomLabel.textContent = `${state.epubFontSize}%`;
    return;
  }
  zoomLabel.textContent = `${Math.round(state.scale * 100)}%`;
}

function initialScaleCap() {
  // Very large books start slightly smaller so the first raster fits the 2 s
  // cold-open budget; explicit fit/zoom still uses the true fit scale.
  return state.numPages > 1000 ? 1.15 : 1.3;
}

function fitScale(baseViewport, columns = 1) {
  const area = document.querySelector('.page-area');
  const available = Math.max(320, (area.clientWidth - 120 - (columns - 1) * 10) / columns);
  return Math.min(2, Math.max(0.6, available / baseViewport.width));
}

function fitPageScale(baseViewport, columns = 1) {
  const area = document.querySelector('.page-area');
  const width = Math.max(240, (area.clientWidth - 120 - (columns - 1) * 10) / columns);
  const height = Math.max(240, area.clientHeight - 80);
  return Math.min(2, Math.max(0.5, Math.min(width / baseViewport.width, height / baseViewport.height)));
}

function updateViewControls() {
  const fitPage = state.fitMode === 'page';
  fitToggle.textContent = fitPage ? '⤢' : '↔';
  fitToggle.title = fitPage ? 'Sayfaya sığdır' : 'Genişliğe sığdır';
  fitToggle.setAttribute('aria-label', t(fitToggle.title));
  fitToggle.title = t(fitToggle.title);
  fitToggle.setAttribute('aria-pressed', fitPage ? 'true' : 'false');
  fitToggle.classList.toggle('active', fitPage);
}

function storageUserKey() {
  return state.user?.id || 'offline';
}

function themeStorageKey() {
  return `readerTheme:${storageUserKey()}`;
}

function epubFontStorageKey(bookId = state.book?.id) {
  return `readerEpubFontSize:${storageUserKey()}:${bookId || 'book'}`;
}

function storedTheme() {
  try {
    return localStorage.getItem(themeStorageKey()) || 'light';
  } catch {
    return 'light';
  }
}

function applyTheme(theme) {
  const preference = ['light', 'sepia', 'dark', 'system'].includes(theme) ? theme : 'light';
  const next = preference === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : preference;
  state.theme = next;
  reader.dataset.theme = next;
  try {
    const workspace = localStorage.getItem(`readerWorkspace:${storageUserKey()}`) || 'auto';
    reader.dataset.workspace = ['auto','gray','cream','slate'].includes(workspace) ? workspace : 'auto';
    document.getElementById('readerWorkspace').value = reader.dataset.workspace;
  } catch {}
  themeBtn.textContent = 'Görünüm';
  const picker = document.getElementById('readerTheme');
  if (picker) picker.value = preference;
  themeBtn.title = t(next === 'dark' ? 'Koyu tema' : next === 'sepia' ? 'Sepia tema' : 'Açık tema');
  themeBtn.setAttribute('aria-label', themeBtn.title);
  try {
    localStorage.setItem(themeStorageKey(), preference);
  } catch {
    // Private mode may block storage.
  }
}

async function resolveDest(dest, pdf) {
  return destinationPage(pdf, dest);
}

async function loadOutline(pdf = state.pdf) {
  if (!pdf || state.pdf !== pdf) return false;
  const entries = [];
  try {
    const outline = await pdf.getOutline();
    if (state.pdf !== pdf) return false;
    const walk = async (nodes, depth) => {
      for (const node of nodes) {
        if (state.pdf !== pdf) return;
        const page = await resolveDest(node.dest, pdf);
        if (state.pdf !== pdf) return;
        if (page) entries.push({ title: node.title || 'Başlıksız', page, depth });
        if (node.items && node.items.length) await walk(node.items, depth + 1);
      }
    };
    if (outline?.length) await walk(outline, 0);
  } catch (error) {
    console.warn('outline failed', error);
  }
  if (state.pdf !== pdf) return false;
  state.outline = entries;
  return true;
}

function scheduleOutline(pdf) {
  // Yield to the browser after the first page; never block opening on TOC destinations.
  setTimeout(() => {
    if (state.pdf !== pdf) return;
    void loadOutline(pdf).then((current) => {
      if (current && state.pdf === pdf) renderToc();
    }).catch((error) => console.warn('outline refresh failed', error));
  }, 0);
}

function renderEpubToc(query) {
  const items = state.epubEngine.getToc().filter(
    (item) => (item.label || item.href || '').toLocaleLowerCase('tr').includes(query),
  );
  if (!items.length) {
    tocEmpty.hidden = false;
    tocEmpty.textContent = state.epubEngine.getToc().length ? t('Eşleşen bölüm yok.') : t('Bu EPUB’ta içindekiler yok.');
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const item of items) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toc-item';
    button.style.paddingLeft = `${9 + item.level * 12}px`;
    button.textContent = item.label || item.href;
    button.addEventListener('click', () => state.epubEngine.goToHref(item.href));
    fragment.appendChild(button);
  }
  tocList.appendChild(fragment);
}

function renderToc() {
  const query = tocFilter.value.trim().toLocaleLowerCase('tr');
  tocList.replaceChildren();
  tocEmpty.hidden = true;
  if (state.epubMode && state.epubEngine) {
    renderEpubToc(query);
    return;
  }

  if (state.outline.length) {
    const items = state.outline.filter((item) => item.title.toLocaleLowerCase('tr').includes(query));
    if (!items.length) {
      tocEmpty.hidden = false;
      tocEmpty.textContent = t('Eşleşen bölüm yok.');
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const item of items) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `toc-item${item.page === state.page ? ' active' : ''}`;
      if (item.page === state.page) button.setAttribute('aria-current', 'location');
      button.style.paddingLeft = `${9 + item.depth * 12}px`;
      button.textContent = item.title;
      const page = document.createElement('span');
      page.className = 'toc-page';
      page.textContent = pdfPageText(item.page);
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
    if (pageNumber === state.page) button.setAttribute('aria-current', 'location');
    button.textContent = pdfPageText(pageNumber);
    button.addEventListener('click', () => goToPage(pageNumber));
    fragment.appendChild(button);
  }
  tocList.appendChild(fragment);
}

let thumbObserver = null;

function updateThumbActive() {
  thumbGrid.querySelectorAll('.thumb-item').forEach((item) => {
    const active = Number(item.dataset.page) === state.page;
    item.classList.toggle('active', active);
    if (active) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
}

async function renderThumb(button, pageNumber) {
  if (button.dataset.rendered || !state.pdf) return;
  button.dataset.rendered = '1';
  try {
    const page = await state.pdf.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 110 / base.width });
    const canvas = button.querySelector('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    page.cleanup();
  } catch (error) {
    console.warn('thumbnail failed', pageNumber, error.message);
  }
}

function renderThumbs() {
  if (!state.pdf) return;
  if (thumbGrid.dataset.book === state.book?.asset_id) {
    updateThumbActive();
    return;
  }
  if (thumbObserver) thumbObserver.disconnect();
  thumbGrid.replaceChildren();
  thumbGrid.dataset.book = state.book?.asset_id || '';
  thumbObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const button = entry.target;
      thumbObserver.unobserve(button);
      renderThumb(button, Number(button.dataset.page));
    });
  });
  const fragment = document.createDocumentFragment();
  for (let pageNumber = 1; pageNumber <= state.numPages; pageNumber += 1) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `thumb-item${pageNumber === state.page ? ' active' : ''}`;
    if (pageNumber === state.page) button.setAttribute('aria-current', 'page');
    button.setAttribute('aria-label', pdfPageText(pageNumber));
    button.dataset.page = String(pageNumber);
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    canvas.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = pdfPageText(pageNumber);
    button.append(canvas, label);
    button.addEventListener('click', () => goToPage(pageNumber));
    fragment.appendChild(button);
    thumbObserver.observe(button);
  }
  thumbGrid.appendChild(fragment);
}

function syncPanelA11y() {
  $('toggleToc').setAttribute('aria-expanded', tocPanel.hidden ? 'false' : 'true');
  $('toggleNotes').setAttribute('aria-expanded', notesPanel.hidden ? 'false' : 'true');
  // Narrow panels cover the document, so its controls must not take focus
  // behind them. The visible reader toolbar and panel close buttons remain.
  pageArea.inert = window.innerWidth <= 820 && (!tocPanel.hidden || !notesPanel.hidden);
}

function setNotesOpen(open) {
  const next = Boolean(open);
  const hadFocus = notesPanel.contains(document.activeElement);
  notesPanel.hidden = !next;
  if (next && window.innerWidth <= 820) tocPanel.hidden = true;
  syncPanelA11y();
  if (next) {
    setTimeout(() => $('noteFilter').focus(), 0);
  } else if (hadFocus) {
    $('toggleNotes').focus();
  }
}

function toggleToc(show) {
  const next = typeof show === 'boolean' ? show : tocPanel.hidden;
  tocPanel.hidden = !next;
  syncPanelA11y();
  if (next) {
    renderToc();
    if (window.innerWidth < 820) setNotesOpen(false);
  }
}

function pdfPageText(page) {
  return pdfPageDescription(state.pdfPageLabels, Number(page), getLang());
}

function updatePageUi() {
  if (state.epubMode) {
    pageInput.hidden = true;
    pageTotal.hidden = true;
    bookmarkBtn.hidden = false;
    updateEpubLocation(state.epubProgress, false);
    updateBookmarkUi();
    return;
  }
  pageLabel.setAttribute('aria-live', 'polite');
  pageInput.hidden = false;
  pageTotal.hidden = false;
  bookmarkBtn.hidden = false;
  pageInput.max = String(state.numPages || 1);
  pageInput.value = String(state.page || 1);
  pageInput.setAttribute('aria-label', t('PDF sayfa numarası'));
  pageInput.title = t('PDF dosyasındaki sıra numarası');
  pageTotal.textContent = `/ ${state.numPages || 1}`;
  pageWrap.setAttribute('aria-label', pdfPageText(state.page));
  pageWrap2.setAttribute('aria-label', pdfPageText(state.secondPage || state.page + 1));
  pageLabel.textContent = (state.twoPage && state.secondPage
    ? `${pdfPageText(state.page)} – ${pdfPageText(state.secondPage)}`
    : pdfPageText(state.page)) + ` / ${state.numPages}`;
  updateBookmarkUi();
}

function updateUrl() {
  if (!state.book) return;
  const url = new URL(window.location.href);
  url.searchParams.set('book', state.book.id);
  url.searchParams.set('asset', bookRequestId(state.book));
  if (state.epubMode) {
    url.searchParams.delete('page');
    if (state.epubEngine?.getCurrentCfi()) url.searchParams.set('cfi', state.epubEngine.getCurrentCfi());
  } else {
    url.searchParams.delete('cfi');
    url.searchParams.set('page', String(state.page));
  }
  history.replaceState(null, '', url);
}

function epubChapterLabel(href) {
  if (!href) return '';
  const base = String(href).split('#')[0];
  const toc = state.epubEngine?.getToc?.() || [];
  const item = toc.find((entry) => entry.href === href || String(entry.href || '').split('#')[0] === base);
  if (item?.label) return item.label;
  const raw = base.split('/').pop() || '';
  let name = raw;
  try {
    name = decodeURIComponent(raw);
  } catch { /* malformed href */ }
  return name.replace(/\.x?html?$/i, '') || '';
}

function epubBookmarkLabel(annotation, isBookmark) {
  if (annotation.anchor?.type !== 'epub') return '';
  const percent = Number(annotation.anchor.percent);
  const chapter = epubChapterLabel(annotation.anchor.href);
  const number = state.annotations
    .filter((item) => item.color === 'bookmark' && item.anchor?.type === 'epub')
    .findIndex((item) => item.id === annotation.id) + 1;
  return `EPUB${chapter ? ` · ${chapter}` : ''}${Number.isFinite(percent) ? ` · %${Math.round(percent)}` : ''}${isBookmark && number ? ` · ${t('Yer imi')} #${number}` : ''}`;
}

function cfiCompare(a, b) {
  const CFI = window.ePub?.EpubCFI || window.ePub?.CFI;
  if (!CFI || !a || !b) return null;
  try {
    return new CFI(a).compare(a, b);
  } catch {
    return null;
  }
}

function activeBookmarkVisible(annotation) {
  const anchor = annotation?.anchor;
  if (!anchor?.cfi) return false;
  const range = state.epubEngine?.getCurrentRange?.() || {};
  if (anchor.href && range.href && anchor.href !== range.href) return false;
  if (anchor.cfi === range.start || anchor.cfi === state.epubProgress?.cfi) return true;
  const start = cfiCompare(anchor.cfi, range.start);
  const end = cfiCompare(anchor.cfi, range.end);
  return start !== null && end !== null && start >= 0 && end <= 0;
}

function bookmarkForPage() {
  return state.annotations.find(
    (annotation) => annotation.color === 'bookmark' && Number(annotation.anchor?.page) === state.page,
  );
}

function currentEpubCfi() {
  return state.epubEngine?.getCurrentCfi() || state.epubProgress?.cfi || null;
}

function bookmarkForEpubCfi(cfi = currentEpubCfi()) {
  if (!cfi) return null;
  return state.annotations.find(
    (annotation) => annotation.color === 'bookmark'
      && annotation.anchor?.type === 'epub'
      && annotation.anchor?.cfi === cfi,
  ) || null;
}

function updateBookmarkUi() {
  let activeBookmark = state.epubMode && state.activeBookmarkId
    ? state.annotations.find((annotation) => annotation.id === state.activeBookmarkId)
    : null;
  if (activeBookmark && activeBookmark.anchor?.href && state.epubProgress?.href
      && activeBookmark.anchor.href !== state.epubProgress.href) {
    state.activeBookmarkId = null;
    activeBookmark = null;
  }
  const hasBookmark = Boolean(activeBookmark || (state.epubMode ? bookmarkForEpubCfi() : bookmarkForPage()));
  bookmarkBtn.textContent = hasBookmark ? '★' : '☆';
  bookmarkBtn.classList.toggle('active', hasBookmark);
  bookmarkBtn.setAttribute('aria-pressed', hasBookmark ? 'true' : 'false');
  bookmarkBtn.title = t(hasBookmark ? 'Yer imini kaldır' : 'Yer imi ekle');
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
  if (!state.scrollMode && target === state.page) {
    updatePageUi();
    return;
  }
  if (target !== state.page) {
    state.pending = null;
    hlBar.hidden = true;
    clearPending(highlightsEl);
    clearPending(highlights2);
  }
  if (state.scrollMode) {
    scrollToPage(target);
    return;
  }
  state.page = target;
  await renderPage();
}

function storedEpubFontSize(bookId = state.book?.id) {
  try {
    const keys = [
      epubFontStorageKey(bookId),
      `readerEpubFontSize:${storageUserKey()}`,
    ];
    for (const key of keys) {
      const value = Number(localStorage.getItem(key));
      if (Number.isFinite(value) && value >= 70 && value <= 200) return value;
    }
    return 100;
  } catch {
    return 100;
  }
}

function applyEpubFontSize(value, persist = true, bookId = state.book?.id) {
  state.epubFontSize = Math.min(200, Math.max(70, Math.round(Number(value) || 100)));
  state.epubEngine?.setFontSize(state.epubFontSize);
  updateZoomLabel();
  if (persist) {
    try {
      localStorage.setItem(epubFontStorageKey(bookId), String(state.epubFontSize));
      localStorage.setItem(`readerEpubFontSize:${storageUserKey()}`, String(state.epubFontSize));
    } catch { /* private mode */ }
  }
}

async function toggleBookmark() {
  if (!state.book || bookmarkBtn.disabled || (!state.epubMode && !state.pdf)) return;
  const ownerId = annotationOwnerId();
  if (!ownerId) { toast(t('Yer imi için giriş yapın')); return; }
  const cfi = state.epubMode ? currentEpubCfi() : null;
  if (state.epubMode && !cfi) return;
  const hadFocus = document.activeElement === bookmarkBtn;
  bookmarkBtn.disabled = true;
  try {
    const active = state.epubMode && state.activeBookmarkId
      ? state.annotations.find(item => item.id === state.activeBookmarkId
        && item.color === 'bookmark' && item.anchor?.type === 'epub') : null;
    const existing = active || (state.epubMode ? bookmarkForEpubCfi(cfi) : bookmarkForPage());
    if (existing) {
      const removed = await deleteAnnotation(existing.id, { silent: true });
      if (removed) toast(t('Yer imi kaldırıldı'));
      return;
    }
    const anchor = state.epubMode ? {
      asset_version_id: state.book.asset_id, type: 'epub', cfi,
      href: state.epubProgress?.href || null, percent: state.epubProgress?.percent || 0,
      text_quote: 'Yer imi',
    } : {
      asset_version_id: state.book.asset_id, type: 'pdf', page: state.page, rects: [],
      text_quote: { prefix: '', exact: '', suffix: '' }, text_position: { start: 0, end: 0 },
    };
    const saved = await saveLocalReaderAnnotation({
      assetId: state.book.asset_id, anchor, color: 'bookmark', note: 'Yer imi', selectedText: null,
    });
    if (navigator.onLine) syncReaderAnnotations(saved.asset_id, ownerId).catch(() => {});
  } catch (error) {
    console.error(error);
    toast(t('Yer imi eklenemedi'));
  } finally {
    bookmarkBtn.disabled = false;
    if (hadFocus && !reader.hidden && document.activeElement === document.body) bookmarkBtn.focus();
  }
}

function singleKeyShortcutsEnabled() {
  try { return localStorage.getItem(`singleKeyShortcuts:${annotationOwnerId() || storageUserKey()}`) !== 'off'; } catch { return true; }
}

function syncShortcutControls() {
  document.querySelectorAll('[data-single-key-shortcuts]').forEach(input => { input.checked = singleKeyShortcutsEnabled(); });
}

function showShortcuts() {
  const commands = t('j/k veya ←/→ sayfa · / kitapta ara · n notlar · b yer imi · ? yardım · Esc kapat · Alt+Shift+H seçim araçları');
  const selectionHelp = t('NVDA: NVDA+Shift+F10 ile yerel seçimi açın; Shift+ok ile metni seçin, Alt+Shift+H ile seçim araçlarını açın.');
  toast(`${commands}\n\n${selectionHelp}`);
  openMessages();
}

function showTocTab(tab) {
  const search = tab === 'search';
  const pages = tab === 'pages';
  if (pages && state.epubMode) return;
  tabToc.classList.toggle('active', !search && !pages);
  tabSearch.classList.toggle('active', search);
  tabPages.classList.toggle('active', pages);
  tabToc.setAttribute('aria-selected', !search && !pages ? 'true' : 'false');
  tabSearch.setAttribute('aria-selected', search ? 'true' : 'false');
  tabPages.setAttribute('aria-selected', pages ? 'true' : 'false');
  tabToc.tabIndex = !search && !pages ? 0 : -1;
  tabSearch.tabIndex = search ? 0 : -1;
  tabPages.tabIndex = pages ? 0 : -1;
  tocView.hidden = search || pages;
  searchView.hidden = !search;
  pagesView.hidden = !pages;
  if (search) setTimeout(() => bookSearch.focus(), 0);
  if (pages) renderThumbs();
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

function resetSearch() {
  clearTimeout(searchTimer);
  state.searchRun += 1;
  state.activeQuery = '';
  state.activeMatchType = '';
  state.searchQuery = '';
  state.searchHits = [];
  state.searchIndex = -1;
  bookSearch.value = '';
  searchResults.replaceChildren();
  searchStatus.textContent = '';
  searchEmpty.hidden = true;
  searchEmpty.textContent = '';
  updateSearchNav();
  refreshSearchHighlights();
  state.epubEngine?.clearSearchHighlights();
}

function updateSearchNav() {
  const total = state.searchHits.length;
  searchPosition.textContent = total
    ? `${state.searchIndex >= 0 ? state.searchIndex + 1 : 0} / ${total}`
    : '0 / 0';
  searchPrev.disabled = total === 0;
  searchNext.disabled = total === 0;
}

async function focusSearchResult(index) {
  if (!state.searchHits.length) return;
  const total = state.searchHits.length;
  const normalized = ((index % total) + total) % total;
  state.searchIndex = normalized;
  const hit = state.searchHits[normalized];
  state.activeQuery = hit.query || state.searchQuery;
  state.activeMatchType = hit.matchType || 'exact';
  if (state.epubMode) {
    const query = hit.query || state.searchQuery;
    const fuzzy = ['fuzzy', 'stem'].includes(hit.matchType);
    try {
      if (hit.href) await state.epubEngine?.goToHref(hit.href);
      else await state.epubEngine?.goToSpineIndex(hit.page);
    } catch {
      await state.epubEngine?.goToSpineIndex(hit.page);
    }
    await state.epubEngine?.goToMatch(query, { fuzzy });
    state.epubEngine?.highlightSearch(query, { fuzzy });
  } else {
    await goToPage(hit.page);
    refreshSearchHighlights();
  }
  searchResults.querySelectorAll('.search-item').forEach((item) => {
    item.classList.toggle('active', Number(item.dataset.index) === normalized);
  });
  const active = searchResults.querySelector(`.search-item[data-index="${normalized}"]`);
  active?.scrollIntoView({ block: 'nearest' });
  updateSearchNav();
  if (window.innerWidth < 820) toggleToc(false);
}

function addSearchResult(pageNumber, text, index, queryLength, query) {
  const start = Math.max(0, index - 45);
  const end = Math.min(text.length, index + queryLength + 45);
  const snippetText = `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
  addSearchResultSnippet(pageNumber, snippetText, query, 1, searchWhole.checked ? 'word' : 'exact');
}

function addSearchResultSnippet(pageNumber, snippetText, query, matches = 0, matchType = 'exact') {
  const hitIndex = state.searchHits.length;
  state.searchHits.push({ page: pageNumber, snippet: snippetText, query, matches, matchType });
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'toc-item search-item';
  button.dataset.index = String(hitIndex);
  const label = document.createElement('span');
  const note = matchType === 'stem' ? t(' · kök')
    : matchType === 'fuzzy' ? t(' · yakın')
      : matchType === 'word' ? t(' · tam kelime')
        : '';
  label.textContent = pdfPageText(pageNumber) + (matches > 1 ? ` · ${t(`${matches} eşleşme`)}` : '') + note;
  const snippet = document.createElement('span');
  snippet.className = 'search-snippet';
  snippet.textContent = snippetText;
  button.appendChild(label);
  button.appendChild(snippet);
  button.addEventListener('click', () => focusSearchResult(hitIndex));
  searchResults.appendChild(button);
  updateSearchNav();
}

function addEpubSearchResult(result, index) {
  state.searchHits.push({
    page: result.page,
    href: result.href || '',
    chapter: result.chapter || null,
    snippet: result.snippet,
    matches: result.matches || 1,
    matchType: result.matchType || 'exact',
    query: state.searchQuery,
  });
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'toc-item search-item';
  button.dataset.index = String(index);
  const label = document.createElement('span');
  const chapter = Number(result.chapter);
  const fallbackLabel = String(result.href || '').split('/').pop().replace(/\.[^.]+$/, '');
  label.textContent = t(chapter
    ? `Bölüm ${chapter}${result.matches > 1 ? ` · ${result.matches} eşleşme` : ''}`
    : `${fallbackLabel || 'Bölüm'}${result.matches > 1 ? ` · ${result.matches} eşleşme` : ''}`);
  const snippet = document.createElement('small');
  snippet.className = 'search-snippet';
  snippet.textContent = result.snippet;
  button.appendChild(label);
  button.appendChild(snippet);
  button.addEventListener('click', () => focusSearchResult(index));
  searchResults.appendChild(button);
}

let searchTimer = null;
async function runSearch(rawQuery) {
  const query = String(rawQuery || '').trim();
  const normalized = foldChars(normalizeSearch(query));
  const run = ++state.searchRun;
  state.activeQuery = query;
  state.searchHits = [];
  state.searchIndex = -1;
  state.searchQuery = query;
  updateSearchNav();
  refreshSearchHighlights();
  searchResults.replaceChildren();
  searchEmpty.hidden = true;

  if (!normalized) {
    state.epubEngine?.clearSearchHighlights();
    searchStatus.textContent = '';
    return;
  }

  if (state.epubMode) {
    state.epubEngine?.clearSearchHighlights();
    state.searchHits = [];
    state.searchIndex = -1;
    updateSearchNav();
    searchStatus.textContent = t('EPUB içinde aranıyor…');
    const params = new URLSearchParams({ q: query });
    if (searchWhole.checked) params.set('whole', '1');
    if (searchFuzzy.checked) params.set('fuzzy', '1');
    let results = [];
    try {
      const response = await fetch(`/api/books/${encodeURIComponent(bookRequestId(state.book))}/search?${params}`);
      const payload = response.ok ? await response.json() : {};
      if (state.searchRun !== run) return;
      if (payload.indexed) {
        results = payload.results || [];
        results.forEach((result, index) => addEpubSearchResult(result, index));
        searchStatus.textContent = t(results.length ? `${results.length} sonuç · dizin` : '0 sonuç');
        searchEmpty.hidden = results.length > 0;
        searchEmpty.textContent = t('Sonuç bulunamadı.');
        updateSearchNav();
        state.epubEngine?.highlightSearch(query, {
          fuzzy: results.some((result) => ['fuzzy', 'stem'].includes(result.matchType)),
        });
        return;
      }
    } catch (error) {
      console.warn('EPUB index search failed', error);
    }
    const fallback = await state.epubEngine?.search(query, { limit: 30 }) || [];
    if (state.searchRun !== run) return;
    fallback.forEach((result, index) => addEpubSearchResult({
      page: result.page || index + 1,
      href: result.href,
      snippet: result.snippet,
      matches: 1,
    }, index));
    searchStatus.textContent = t(fallback.length ? `${fallback.length} sonuç` : '0 sonuç');
    searchEmpty.hidden = fallback.length > 0;
    searchEmpty.textContent = t('Sonuç bulunamadı.');
    updateSearchNav();
    state.epubEngine?.highlightSearch(query);
    return;
  }
  searchStatus.textContent = t('Aranıyor…');
  try {
    const params = new URLSearchParams({ q: query });
    if (searchWhole.checked) params.set('whole', '1');
    if (searchFuzzy.checked) params.set('fuzzy', '1');
    const response = await fetch(`/api/books/${encodeURIComponent(bookRequestId(state.book))}/search?${params}`);
    if (state.searchRun !== run) return;
    if (response.ok) {
      const data = await response.json();
      if (data.indexed) {
        const results = Array.isArray(data.results) ? data.results : [];
        results.forEach((result) => addSearchResultSnippet(
          result.page, result.snippet, query, result.matches, result.matchType,
        ));
        searchStatus.textContent = t(results.length ? `${results.length}${results.length >= 100 ? '+' : ''} sonuç` : '0 sonuç');
        if (!results.length) {
          searchEmpty.hidden = false;
          searchEmpty.textContent = t('Sonuç bulunamadı.');
        }
        refreshSearchHighlights();
        return;
      }
    }
  } catch {
    // Fall back to the browser-side cache when the server index is unavailable.
  }

  searchStatus.textContent = t(`Aranıyor… 0 / ${state.numPages}`);
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
    const lower = foldChars(normalizeSearch(text));
    const whole = searchWhole.checked;
    let from = 0;
    let perPage = 0;
    while (perPage < 3 && count < 200) {
      const found = whole
        ? findWholeWord(lower, normalized, from)
        : lower.indexOf(normalized, from);
      if (found < 0) break;
      addSearchResult(pageNumber, text, found, normalized.length, query);
      count += 1;
      perPage += 1;
      from = found + normalized.length;
    }
    if (index % 10 === 0 || index === order.length - 1) {
      searchStatus.textContent = t(`Aranıyor… ${index + 1} / ${order.length}`);
    }
    if (index % 3 === 0) await nextFrame();
    if (count >= 200) break;
  }

  if (state.searchRun !== run) return;
  searchStatus.textContent = t(count ? `${count}${count >= 200 ? '+' : ''} sonuç` : '0 sonuç');
  if (!count) {
    searchEmpty.hidden = false;
    searchEmpty.textContent = t('Sonuç bulunamadı.');
  }
  refreshSearchHighlights();
}

function refreshSearchHighlights() {
  applySearchHighlight(textLayerEl);
  applySearchHighlight(textLayer2);
  state.scrollPanes.forEach((pane) => {
    if (pane.textLayer) applySearchHighlight(pane.textLayer);
  });
}

function clearSearchMarks(container) {
  container.querySelectorAll('mark.search-hit').forEach((mark) => {
    const parent = mark.parentNode;
    mark.replaceWith(...mark.childNodes);
    if (parent) parent.normalize();
  });
}

function applySearchHighlight(container = textLayerEl) {
  clearSearchMarks(container);
  const whole = searchWhole.checked;
  const fuzzyMode = state.activeMatchType === 'fuzzy' || state.activeMatchType === 'stem';
  const query = foldChars(state.activeQuery);
  if (!query) return;
  container.querySelectorAll('span').forEach((span) => {
    const text = span.textContent;
    if (!text || span.querySelector('span, mark')) return;
    const lower = foldChars(text);
    let cursor = 0;
    let match = fuzzyMode
      ? findFuzzyWord(lower, query, cursor)
      : (() => {
        const index = whole ? findWholeWord(lower, query, cursor) : lower.indexOf(query, cursor);
        return index >= 0 ? { index, length: query.length } : null;
      })();
    if (!match) return;
    const fragment = document.createDocumentFragment();
    while (match) {
      if (match.index > cursor) fragment.appendChild(document.createTextNode(text.slice(cursor, match.index)));
      const mark = document.createElement('mark');
      mark.className = 'search-hit';
      mark.textContent = text.slice(match.index, match.index + match.length);
      fragment.appendChild(mark);
      cursor = match.index + match.length;
      match = fuzzyMode
        ? findFuzzyWord(lower, query, cursor)
        : (() => {
          const index = whole ? findWholeWord(lower, query, cursor) : lower.indexOf(query, cursor);
          return index >= 0 ? { index, length: query.length } : null;
        })();
    }
    if (cursor < text.length) fragment.appendChild(document.createTextNode(text.slice(cursor)));
    span.replaceChildren(fragment);
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

async function renderOcrLayer(viewport, pageNumber = state.page, container = textLayerEl) {
  const assetId = state.book?.asset_id;
  if (!assetId) return false;

  const ocrPages = await getOcrPages(assetId);
  if (!ocrPages.has(pageNumber)) return false;

  const page = String(pageNumber).padStart(3, '0');
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

  return renderHocrText(hocr, viewport, container);
}

function readerFileTimings(bookId, openedAt) {
  if (!bookId || !Number.isFinite(openedAt) || !performance.getEntriesByType) return [];
  const fileUrl = new URL(`/api/books/${encodeURIComponent(bookId)}/file`, window.location.origin).href;
  return performance.getEntriesByType('resource')
    .filter((entry) => entry.name === fileUrl && entry.startTime >= openedAt)
    .slice(-20)
    .map((entry) => ({
      startMs: Math.round(entry.startTime - openedAt),
      totalMs: Math.round(entry.duration),
      ttfbMs: entry.requestStart > 0 && entry.responseStart > 0
        ? Math.round(entry.responseStart - entry.requestStart) : null,
      downloadMs: entry.responseStart > 0 && entry.responseEnd >= entry.responseStart
        ? Math.round(entry.responseEnd - entry.responseStart) : null,
      bytes: entry.encodedBodySize || 0,
      serverMs: Object.fromEntries((entry.serverTiming || [])
        .filter((metric) => ['app', 'storage'].includes(metric.name))
        .map((metric) => [metric.name, Math.round(metric.duration)])),
    }));
}

function readerPerf() {
  const renders = state.perf?.renders || [];
  const lastPhase = state.perf?.phases?.at(-1) || null;
  const average = renders.length
    ? renders.reduce((sum, value) => sum + value, 0) / renders.length
    : null;
  return {
    book: state.book?.title || null,
    pages: state.numPages,
    page: state.page,
    pdfLoadMs: state.perf?.pdfLoadMs ?? null,
    beforePdfMs: state.perf?.beforePdfMs ?? null,
    labelsMs: state.perf?.labelsMs ?? null,
    fileRequests: readerFileTimings(state.book ? bookRequestId(state.book) : null, state.perf?.openedAt),
    firstPageMs: state.perf?.firstPageMs ?? null,
    renders: renders.length,
    averageRenderMs: average === null ? null : Math.round(average),
    maxRenderMs: renders.length ? Math.round(Math.max(...renders)) : null,
    lastCanvasMs: lastPhase?.canvas ?? null,
    lastTextMs: lastPhase?.text ?? null,
    heapMB: performance.memory
      ? Math.round(performance.memory.usedJSHeapSize / 1048576)
      : null,
    scale: state.scale,
  };
}

function updatePerfPanel() {
  if (!perfPanel || perfPanel.hidden) return;
  const perf = readerPerf();
  const format = (value) => (value === null || value === undefined ? '—' : value);
  perfBody.textContent = [
    `Kitap: ${perf.book || '—'}`,
    `Sayfa: ${perf.page} / ${perf.pages || '—'}`,
    `PDF yükleme: ${format(perf.pdfLoadMs && Math.round(perf.pdfLoadMs))} ms`,
    `İlk sayfa: ${format(perf.firstPageMs && Math.round(perf.firstPageMs))} ms`,
    `Render: ${perf.renders} · ort. ${format(perf.averageRenderMs)} ms · max ${format(perf.maxRenderMs)} ms`,
    `Son: canvas ${format(perf.lastCanvasMs)} ms · text/OCR ${format(perf.lastTextMs)} ms`,
    `Heap: ${format(perf.heapMB)} MB`,
    `Zoom: ${Math.round((perf.scale || 0) * 100)}%`,
  ].join('\n');
}

function recordRender(milliseconds, phase = null) {
  if (!state.perf) return;
  state.perf.renders.push(milliseconds);
  if (phase) state.perf.phases.push(phase);
  if (state.perf.firstPageMs === null) {
    state.perf.firstPageMs = performance.now() - state.perf.openedAt;
  }
  updatePerfPanel();
}

async function stressPages(count = 20) {
  if (!state.pdf) return null;
  const start = state.page;
  for (let index = 0; index < count; index += 1) {
    const target = Math.min(state.numPages, start + index);
    if (target !== state.page) await goToPage(target);
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  const result = readerPerf();
  console.info('[reader perf]', result);
  updatePerfPanel();
  return result;
}

function createScrollPane(pageNumber, width, height) {
  const wrap = document.createElement('div');
  wrap.className = 'page-wrap scroll-page';
  wrap.style.width = `${Math.floor(width)}px`;
  wrap.style.height = `${Math.floor(height)}px`;
  const pane = {
    pageWrap: wrap,
    canvas: null,
    textLayer: null,
    highlights: null,
    pageNumber,
    viewport: null,
    rendered: false,
    rendering: false,
  };
  wrap.__pane = pane;
  return pane;
}

function ensureScrollPaneElements(pane) {
  if (pane.canvas) return;
  const canvas = document.createElement('canvas');
  const textLayer = document.createElement('div');
  textLayer.className = 'textLayer';
  const highlights = document.createElement('div');
  highlights.className = 'highlights';
  pane.pageWrap.append(canvas, textLayer, highlights);
  pane.canvas = canvas;
  pane.textLayer = textLayer;
  pane.highlights = highlights;
  textLayer.addEventListener('mouseup', () => setTimeout(() => onSelection(pane), 0));
}

async function renderScrollPane(pane) {
  if (!state.scrollMode || pane.rendered || pane.rendering) return;
  ensureScrollPaneElements(pane);
  pane.rendering = true;
  const token = state.scrollToken;
  try {
    const result = await renderPagePane(pane.pageNumber, pane, state.scale, state.rotation, false);
    if (!result || token !== state.scrollToken) return;
    pane.viewport = result.viewport;
    renderHighlightsFor(pane.pageNumber, result.viewport.scale, pane.highlights);
    pane.rendered = true;
    try { result.page.cleanup(); } catch { /* noop */ }
  } catch (error) {
    console.warn('scroll page failed', pane.pageNumber, error.message);
  } finally {
    pane.rendering = false;
  }
}

function scrollToPage(pageNumber) {
  const pane = state.scrollPanes[pageNumber - 1];
  if (!pane) return;
  state.page = pageNumber;
  updatePageUi();
  updateUrl();
  saveProgress();
  pane.pageWrap.scrollIntoView({ block: 'start' });
}

function buildScrollPanes(width, height) {
  if (state.scrollObserver) state.scrollObserver.disconnect();
  state.scrollToken += 1;
  scrollPages.replaceChildren();
  state.scrollPanes = [];
  const fragment = document.createDocumentFragment();
  for (let pageNumber = 1; pageNumber <= state.numPages; pageNumber += 1) {
    const pane = createScrollPane(pageNumber, width, height);
    state.scrollPanes.push(pane);
    fragment.appendChild(pane.pageWrap);
  }
  scrollPages.appendChild(fragment);
  state.scrollObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const pane = entry.target.__pane;
      if (pane) renderScrollPane(pane);
    });
  }, { root: pageArea, rootMargin: '700px 0px' });
  state.scrollPanes.forEach((pane) => state.scrollObserver.observe(pane.pageWrap));
}

async function startScrollMode(forcedScale = null) {
  if (!state.pdf || state.scrollMode) return;
  const current = await state.pdf.getPage(state.page);
  const base = current.getViewport({ scale: 1, rotation: state.rotation });
  try { current.cleanup(); } catch { /* noop */ }
  const scale = forcedScale || Math.min(initialScaleCap(), fitScale(base, 1));
  state.scale = scale;
  state.initialFit = false;
  state.twoPage = false;
  state.secondPage = null;
  state.secondViewport = null;
  state.scrollMode = true;
  buildScrollPanes(Math.floor(base.width * scale), Math.floor(base.height * scale));

  pageWrap.hidden = true;
  pageWrap2.hidden = true;
  scrollPages.hidden = false;
  pageLoading.hidden = true;
  reader.classList.add('scroll-mode');
  scrollBtn.classList.add('active');
  scrollBtn.setAttribute('aria-pressed', 'true');
  updatePageUi();
  updateZoomLabel();
  updateUrl();
  setTimeout(() => scrollToPage(state.page), 0);
}

async function rebuildScrollMode() {
  if (!state.scrollMode || !state.pdf) return;
  const current = await state.pdf.getPage(state.page);
  const base = current.getViewport({ scale: 1, rotation: state.rotation });
  try { current.cleanup(); } catch { /* noop */ }
  buildScrollPanes(Math.floor(base.width * state.scale), Math.floor(base.height * state.scale));
  updateZoomLabel();
  scrollToPage(state.page);
}

function stopScrollMode(renderAfter = true) {
  if (!state.scrollMode) return;
  state.scrollMode = false;
  state.scrollToken += 1;
  if (state.scrollObserver) state.scrollObserver.disconnect();
  state.scrollObserver = null;
  state.scrollPanes = [];
  scrollPages.replaceChildren();
  scrollPages.hidden = true;
  pageWrap.hidden = false;
  pageWrap2.hidden = !state.twoPage;
  reader.classList.remove('scroll-mode');
  scrollBtn.classList.remove('active');
  scrollBtn.setAttribute('aria-pressed', 'false');
  if (renderAfter) {
    state.scale = 0;
    state.initialFit = true;
    state.secondPage = state.twoPage && state.page < state.numPages ? state.page + 1 : null;
    renderPage();
  }
}

async function renderPagePane(pageNumber, pane, scale, rotationOffset, isPrimary) {
  const pdf = state.pdf;
  const renderToken = Symbol();
  pane.textLayer.pdfRenderToken = renderToken;
  const isCurrent = () => state.pdf === pdf && pane.textLayer.pdfRenderToken === renderToken;
  pane.pageWrap.querySelector('.pdf-link-layer')?.remove();
  const page = await pdf.getPage(pageNumber);
  if (!isCurrent()) return null;
  const viewport = page.getViewport({ scale, rotation: (page.rotate + rotationOffset) % 360 });
  // 2x DPR quadruples canvas pixels; 1.5x keeps text sharp while cutting
  // the first-page raster cost (~45%) on 2000-page / high-DPI screens.
  const outputScale = Math.min(window.devicePixelRatio || 1, 1.5);
  pane.canvas.width = Math.floor(viewport.width * outputScale);
  pane.canvas.height = Math.floor(viewport.height * outputScale);
  pane.canvas.style.width = `${Math.floor(viewport.width)}px`;
  pane.canvas.style.height = `${Math.floor(viewport.height)}px`;
  pane.pageWrap.style.width = `${Math.floor(viewport.width)}px`;
  pane.pageWrap.style.height = `${Math.floor(viewport.height)}px`;
  pane.textLayer.style.width = `${Math.floor(viewport.width)}px`;
  pane.textLayer.style.height = `${Math.floor(viewport.height)}px`;
  pane.textLayer.style.setProperty('--scale-factor', String(viewport.scale));
  pane.textLayer.style.setProperty('--total-scale-factor', String(viewport.scale));

  const context = pane.canvas.getContext('2d', { alpha: false });
  const task = page.render({
    canvasContext: context,
    viewport,
    transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null,
  });
  if (isPrimary) state.renderTask = task;
  else state.secondRenderTask = task;
  try {
    await task.promise;
  } catch (error) {
    if (error?.name === 'RenderingCancelledException') return null;
    throw error;
  }
  const canvasEnd = performance.now();
  if (!isCurrent()) return null;

  // Render off-DOM so an old text/structure request cannot overwrite a new
  // page or book after the canvas has finished.
  const textContainer = pane.textLayer.cloneNode(false);
  textContainer.removeAttribute('id');
  textContainer.removeAttribute('lang');
  let structure = null;
  let textLang = '';
  const usedOcr = await renderOcrLayer(viewport, pageNumber, textContainer);
  if (!isCurrent()) return null;
  if (usedOcr) textLang = textContainer.getAttribute('lang') || '';
  if (!usedOcr) {
    try {
      const [textContent, tree] = await Promise.all([
        page.getTextContent({ includeMarkedContent: true }),
        page.getStructTree().catch(error => {
          console.warn('PDF structure unavailable', error.message);
          return null;
        }),
      ]);
      if (!isCurrent()) return null;
      textLang = typeof textContent.lang === 'string' ? textContent.lang : '';
      const textLayer = new pdfjsLib.TextLayer({
        textContentSource: textContent,
        container: textContainer,
        viewport,
      });
      await textLayer.render();
      if (!isCurrent()) return null;
      structure = buildPdfStructure(tree, textContainer);
      if (structure && textLang && !structure.hasAttribute('lang')) structure.lang = textLang;
    } catch (error) {
      console.warn('text layer failed', error);
    }
  }
  if (!isCurrent()) return null;
  pane.pageWrap.querySelector('.pdf-structure')?.remove();
  const textFragment = document.createDocumentFragment();
  while (textContainer.firstChild) textFragment.append(textContainer.firstChild);
  pane.textLayer.replaceChildren(textFragment);
  if (textLang) pane.textLayer.lang = textLang;
  else pane.textLayer.removeAttribute('lang');
  if (structure) pane.pageWrap.insertBefore(structure, pane.textLayer);
  applySearchHighlight(pane.textLayer);
  // Links are optional metadata; they must not delay first-page display.
  void renderPdfLinks({ page, pdf, viewport, container: pane.pageWrap, isCurrent,
    onNavigate: goToPage,
    labels: { group: t('Sayfa bağlantıları'), external: t('Bağlantıyı yeni sekmede aç'), internal: t('Kitap içi bağlantıyı aç') },
  }).catch(error => console.warn('PDF links unavailable:', error.message));
  return { page, viewport, canvasEnd, textEnd: performance.now() };
}

async function renderPage() {
  if (!state.pdf || state.scrollMode) return;
  reader.setAttribute('aria-busy', 'true');
  const perfStart = performance.now();
  const firstRender = !state.perf || state.perf.firstPageMs === null;
  pageLoading.hidden = !firstRender;
  for (const task of [state.renderTask, state.secondRenderTask]) {
    if (task) {
      try { task.cancel(); } catch { /* noop */ }
    }
  }
  state.renderTask = null;
  state.secondRenderTask = null;

  const columns = state.twoPage && state.page < state.numPages ? 2 : 1;
  const firstPage = await state.pdf.getPage(state.page);
  const base = firstPage.getViewport({ scale: 1 });
  if (!state.scale || state.scale <= 0) {
    const fitted = state.fitMode === 'page' ? fitPageScale(base, columns) : fitScale(base, columns);
    state.scale = state.initialFit ? Math.min(initialScaleCap(), fitted) : fitted;
    state.initialFit = false;
  }
  const primaryPane = { pageWrap, canvas, textLayer: textLayerEl, highlights: highlightsEl };
  const secondaryPane = { pageWrap: pageWrap2, canvas: canvas2, textLayer: textLayer2, highlights: highlights2 };
  state.secondPage = state.twoPage && state.page < state.numPages ? state.page + 1 : null;
  pageWrap2.hidden = !state.secondPage;
  if (!state.secondPage) {
    pageWrap2.querySelector('.pdf-structure')?.remove();
    pageWrap2.querySelector('.pdf-link-layer')?.remove();
    textLayer2.replaceChildren();
    highlights2.replaceChildren();
  }

  const primary = await renderPagePane(state.page, primaryPane, state.scale, state.rotation, true);
  if (!primary) {
    pageLoading.hidden = true;
    reader.setAttribute('aria-busy', 'false');
    return;
  }
  state.viewport = primary.viewport;
  let secondary = null;
  if (state.secondPage) {
    secondary = await renderPagePane(state.secondPage, secondaryPane, state.scale, state.rotation, false);
    state.secondViewport = secondary?.viewport || null;
  } else {
    state.secondViewport = null;
  }

  updatePageUi();
  updateZoomLabel();
  renderHighlights();
  if (!tocPanel.hidden && !tocView.hidden) renderToc();
  if (!pagesView.hidden) updateThumbActive();
  saveProgress();
  updateUrl();
  pageLoading.hidden = true;
  recordRender(primary.textEnd - perfStart, {
    canvas: Math.round(primary.canvasEnd - perfStart),
    text: Math.round(primary.textEnd - primary.canvasEnd),
  });
  try { firstPage.cleanup(); } catch { /* noop */ }
  if (secondary) {
    try { secondary.page.cleanup(); } catch { /* noop */ }
  }
  applySearchHighlight(textLayerEl);
  applySearchHighlight(textLayer2);
  reader.setAttribute('aria-busy', 'false');
}

function renderHighlightsFor(pageNumber, scale, container) {
  container.replaceChildren();
  state.annotations
    .filter((annotation) => Number(annotation.anchor?.page) === pageNumber)
    .forEach((annotation) => {
      const rects = Array.isArray(annotation.anchor?.rects) ? annotation.anchor.rects : [];
      rects.forEach((rect) => {
        const box = document.createElement('div');
        box.className = `hl ${annotation.color || 'yellow'}`;
        box.style.left = `${rect[0] * scale}px`;
        box.style.top = `${rect[1] * scale}px`;
        box.style.width = `${rect[2] * scale}px`;
        box.style.height = `${rect[3] * scale}px`;
        container.appendChild(box);
      });
    });
}

function renderHighlights() {
  if (state.scrollMode) {
    state.scrollPanes.forEach((pane) => {
      if (pane.viewport) renderHighlightsFor(pane.pageNumber, pane.viewport.scale, pane.highlights);
    });
    return;
  }
  if (state.viewport) renderHighlightsFor(state.page, state.viewport.scale, highlightsEl);
  if (state.secondPage && state.secondViewport) {
    renderHighlightsFor(state.secondPage, state.secondViewport.scale, highlights2);
  }
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

function clearPending(container = highlightsEl) {
  container.querySelectorAll('.pending').forEach((element) => element.remove());
}

function setHighlightColor(color) {
  state.highlightColor = ['yellow', 'green', 'blue', 'pink'].includes(color) ? color : 'yellow';
  hlColors.querySelectorAll('.hl-color').forEach((button) => {
    button.classList.toggle('active', button.dataset.color === state.highlightColor);
  });
}

function renderPending(rects, container = highlightsEl, scale = state.viewport?.scale || 1) {
  clearPending(highlightsEl);
  clearPending(highlights2);
  state.scrollPanes.forEach((pane) => clearPending(pane.highlights));
  rects.forEach((rect) => {
    const box = document.createElement('div');
    box.className = `hl ${state.highlightColor} pending`;
    box.style.left = `${rect[0] * scale}px`;
    box.style.top = `${rect[1] * scale}px`;
    box.style.width = `${rect[2] * scale}px`;
    box.style.height = `${rect[3] * scale}px`;
    container.appendChild(box);
  });
}

const COLOR_ORDER = ['yellow', 'green', 'blue', 'pink'];
const COLOR_LABELS = { yellow: 'Sarı', green: 'Yeşil', blue: 'Mavi', pink: 'Pembe', bookmark: t('Yer imi') };

function annotationOwnerId() {
  if (state.user?.id) return state.user.id;
  try { return localStorage.getItem('offlineAnnotationUser'); } catch { return null; }
}

function formatNoteDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const age = Date.now() - date.getTime();
  if (age < 60 * 1000) return 'az önce';
  if (age < 60 * 60 * 1000) return `${Math.floor(age / 60000)} dk önce`;
  if (age < 24 * 60 * 60 * 1000) return `${Math.floor(age / 3600000)} sa önce`;
  if (age < 7 * 24 * 60 * 60 * 1000) return `${Math.floor(age / 86400000)} gün önce`;
  return new Intl.DateTimeFormat(getLang() === 'en' ? 'en-GB' : 'tr-TR', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

async function updateAnnotation(id, changes, expected = state.annotations.find(item => item.id === id)) {
  const ownerId = annotationOwnerId();
  const edited = await editLocalAnnotation(id, changes, ownerId, expected);
  state.annotations = await listLocalAnnotations(edited.asset_id, ownerId);
  renderNotes(); renderHighlights();
  if (navigator.onLine) syncReaderAnnotations(edited.asset_id, ownerId).catch(() => {});
  return edited;
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportAnnotations(format) {
  if (!state.book || !state.annotations.length) {
    toast('Dışa aktarılacak not yok');
    return;
  }
  const book = state.book;
  const annotations = [...state.annotations].sort(
    (a, b) => Number(a.anchor?.page || 0) - Number(b.anchor?.page || 0),
  );
  const slug = book.title
    .toLocaleLowerCase('tr')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'kitap';

  if (format === 'json') {
    const payload = {
      exported_at: new Date().toISOString(),
      book: {
        id: book.id,
        title: book.title,
        subtitle: book.subtitle || null,
        publisher: book.publisher || null,
        publication_year: book.publication_year || null,
        asset_id: book.asset_id,
      },
      annotations,
    };
    downloadFile(`${slug}-notlar.json`, JSON.stringify(payload, null, 2), 'application/json');
    toast('JSON indirildi');
    return;
  }

  const lines = [
    `# ${book.title}`,
    '',
    [book.publisher, book.publication_year].filter(Boolean).join(' · '),
    '',
    `Dışa aktarma: ${new Date().toLocaleString(getLang() === 'en' ? 'en-GB' : 'tr-TR')}`,
    '',
    '---',
    '',
  ];
  annotations.forEach((annotation) => {
    const page = annotation.anchor?.page || '—';
    lines.push(`## ${annotation.anchor?.type === 'epub' ? epubBookmarkLabel(annotation, annotation.color === 'bookmark') : pdfPageText(page)}`, '');
    if (annotation.color === 'bookmark') {
      lines.push(`*${t('Yer imi')}*`, '');
    } else {
      if (annotation.selected_text) lines.push(`> ${annotation.selected_text.replace(/\n/g, '\n> ')}`, '');
      if (annotation.note) lines.push(annotation.note, '');
      lines.push(`*Renk: ${COLOR_LABELS[annotation.color] || annotation.color || 'Sarı'}*`, '');
    }
    lines.push('---', '');
  });
  downloadFile(`${slug}-notlar.md`, lines.join('\n'), 'text/markdown;charset=utf-8');
  toast('Markdown indirildi');
}

function startEditNote(annotation, item) {
  if (item.querySelector('.note-edit')) return;
  item.classList.add('editing');
  const editor = document.createElement('div');
  editor.className = 'note-edit';
  const textarea = document.createElement('textarea');
  textarea.value = annotation.note || '';
  textarea.rows = 3;
  textarea.maxLength = 1000;
  textarea.setAttribute('aria-label', t('Not metni'));
  const tagsInput = document.createElement('input');
  tagsInput.type = 'text';
  tagsInput.className = 'note-tags-input';
  tagsInput.placeholder = 'Etiketler (; ile ayırın)';
  tagsInput.maxLength = 200;
  tagsInput.value = (Array.isArray(annotation.tags) ? annotation.tags : []).join('; ');
  tagsInput.setAttribute('aria-label', t('Etiketler'));
  const actions = document.createElement('div');
  actions.className = 'note-edit-actions';
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'primary';
  save.textContent = 'Kaydet';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'ghost-btn';
  cancel.textContent = 'Vazgeç';
  actions.append(save, cancel);
  editor.append(textarea, tagsInput, actions);
  editor.addEventListener('click', (event) => event.stopPropagation());
  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      const updated = await updateAnnotation(annotation.id, {
        note: textarea.value.trim(),
        tags: tagsInput.value,
      }, annotation);
      toast(t(updated.conflict ? 'Notta çakışma var; iki sürüm de korundu' : updated.pending ? 'Not cihazda kaydedildi; eşitleme bekliyor' : 'Not güncellendi'));
    } catch (error) {
      toast(t(error.code === 'ANNOTATION_CONFLICT_CHANGED' ? 'Çakışma başka sekmede değişti; metniniz düzenleyicide korunuyor' : error.code === 'ANNOTATION_OWNER_REQUIRED'
        ? 'Bu eski yerel notun hesabı doğrulanamıyor. Önce JSON olarak dışa aktarın.' : 'Not güncellenemedi'));
    } finally { save.disabled = false; }
  });
  cancel.addEventListener('click', () => renderNotes());
  item.appendChild(editor);
  translateDom(editor);
  textarea.focus();
}

async function cycleAnnotationColor(annotation) {
  if (annotation.color === 'bookmark') return;
  const current = COLOR_ORDER.indexOf(annotation.color);
  const next = COLOR_ORDER[(current + 1) % COLOR_ORDER.length];
  try {
    await updateAnnotation(annotation.id, { color: next }, annotation);
  } catch {
    toast('Renk değiştirilemedi');
  }
}

function appendAnnotationConflict(annotation, item) {
  const conflict = annotation.conflict;
  if (!conflict) return;
  const box = document.createElement('section'); box.className = 'note-conflict';
  box.setAttribute('aria-label', t('Not çakışması'));
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  status.textContent = t('Notta çakışma var; iki sürüm de korundu'); box.appendChild(status);
  for (const [label, value] of [[t('Bu cihazdaki taslak'), annotation], [t('Diğer sürüm'), conflict.current]]) {
    const heading = document.createElement('strong'); heading.textContent = label;
    const text = document.createElement('pre');
    text.textContent = value ? [value.note || '', (value.tags || []).join('; '), COLOR_LABELS[value.color] || value.color || ''].join('\n') : t(conflict.reason === 'legacy_unconfirmed_create'
      ? 'Eski isteğin teslimatı bilinmiyor; yeni kayıt oluşturmadan önce notlarınızı kontrol edin'
      : conflict.reason === 'operation_expired'
        ? 'Bu işlemin sunucu kaydı saklama süresi doldu; taslak korunuyor, yeni not olarak kaydedebilirsiniz'
        : 'Not diğer cihazda silinmiş veya bulunamıyor');
    box.append(heading, text);
  }
  const choices = [
    ['local', conflict.desiredType === 'delete' ? 'Silme işlemini uygula' : !conflict.current ? 'Yeni not olarak kaydet' : 'Bu taslağı kullan'],
    ['server', conflict.current ? 'Diğer sürümü kullan'
      : (conflict.reason === 'legacy_unconfirmed_create' || conflict.reason === 'operation_expired')
        ? 'Yerel taslağı kaldır' : 'Silinmeyi kabul et'],
  ];
  if (conflict.current && conflict.desiredType !== 'delete') choices.push(['copy', 'İkisini de sakla']);
  for (const [choice, label] of choices) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'ghost-btn';
    button.dataset.conflictChoice = choice; button.textContent = t(label);
    button.addEventListener('click', async event => {
      event.stopPropagation(); button.disabled = true;
      try {
        await resolveAnnotationConflict(annotation.id, choice, annotationOwnerId());
        state.annotations = await listLocalAnnotations(annotation.asset_id, annotationOwnerId());
        renderNotes(); noteFilter.focus(); if (!state.epubMode) renderHighlights();
        if (navigator.onLine) syncReaderAnnotations(annotation.asset_id).catch(() => {});
      } catch (error) { toast(t(error.code === 'SYNC_PENDING' ? 'Önce bekleyen isteğin sonucu doğrulanmalı; bağlantı gelince tekrar deneyin' : 'Çakışma çözülemedi')); }
      finally { button.disabled = false; }
    }); box.appendChild(button);
  }
  box.addEventListener('click', event => event.stopPropagation()); item.appendChild(box);
}

function renderNotes() {
  const previousFocus = notesList.contains(document.activeElement) ? document.activeElement : null;
  const focusedId = previousFocus?.closest('.note-item')?.dataset.annotationId;
  const focusClass = ['note-edit-btn', 'note-delete', 'note-color', 'note-tag', 'note-page'].find(name => previousFocus?.classList.contains(name));
  announceReaderConflicts();
  notesList.replaceChildren();
  const query = String(noteFilter.value || '').toLocaleLowerCase('tr').trim();
  const colorFilter = noteColorFilter.value;
  const visible = state.annotations.filter((annotation) => {
    const haystack = [
      annotation.note,
      annotation.selected_text,
      ...(Array.isArray(annotation.tags) ? annotation.tags : []),
    ].join(' ').toLocaleLowerCase('tr');
    return (!query || haystack.includes(query))
      && (colorFilter === 'all' || annotation.color === colorFilter);
  });
  noteCount.textContent = visible.length === state.annotations.length
    ? String(state.annotations.length)
    : `${visible.length}/${state.annotations.length}`;
  notesEmpty.hidden = visible.length !== 0;
  notesEmpty.textContent = t(state.annotations.length
    ? 'Filtreye uygun not yok.'
    : 'Metin seçip Vurgula ile başlayın.');
  visible.forEach((annotation) => {
    const isBookmark = annotation.color === 'bookmark';
    const item = document.createElement('div');
    item.className = 'note-item';
    item.dataset.annotationId = annotation.id;
    const color = document.createElement('button');
    color.type = 'button';
    color.className = `note-color ${annotation.color || 'yellow'}`;
    color.title = 'Rengi değiştir';
    color.setAttribute('aria-label', 'Rengi değiştir');
    if (isBookmark) { color.disabled = true; color.setAttribute('aria-hidden', 'true'); }
    color.addEventListener('click', async (event) => {
      event.stopPropagation();
      await cycleAnnotationColor(annotation);
    });
    item.appendChild(color);
    const page = document.createElement('button');
    page.type = 'button';
    page.className = 'note-page';
    const epubAnchor = annotation.anchor?.type === 'epub';
    page.textContent = epubAnchor
      ? epubBookmarkLabel(annotation, isBookmark)
      : `${pdfPageText(annotation.anchor?.page)}${isBookmark ? ` · ${t('Yer imi')}` : ''}`;
    item.appendChild(page);
    if (annotation.pending) {
      const status = document.createElement('div');
      status.className = 'note-date';
      status.textContent = t(annotation.conflict ? 'Not çakışması' : 'Eşitleme bekliyor');
      status.setAttribute('role', 'status');
      item.appendChild(status);
    }
    const createdAt = annotation.created_at ? new Date(annotation.created_at) : null;
    const updatedAt = annotation.updated_at ? new Date(annotation.updated_at) : null;
    if (createdAt && !Number.isNaN(createdAt.getTime())) {
      const edited = updatedAt && updatedAt.getTime() - createdAt.getTime() > 60000;
      const date = document.createElement('div');
      date.className = 'note-date';
      date.textContent = `${formatNoteDate(createdAt)}${edited ? ' · düzenlendi' : ''}`;
      date.title = edited
        ? `Oluşturuldu: ${createdAt.toLocaleString(getLang() === 'en' ? 'en-GB' : 'tr-TR')} · Düzenlendi: ${updatedAt.toLocaleString(getLang() === 'en' ? 'en-GB' : 'tr-TR')}`
        : `Oluşturuldu: ${createdAt.toLocaleString(getLang() === 'en' ? 'en-GB' : 'tr-TR')}`;
      item.appendChild(date);
    }
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
    if (Array.isArray(annotation.tags) && annotation.tags.length) {
      const tags = document.createElement('div');
      tags.className = 'note-tags';
      annotation.tags.forEach((tag) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'note-tag';
        chip.textContent = tag;
        chip.addEventListener('click', (event) => {
          event.stopPropagation();
          noteFilter.value = tag;
          renderNotes();
        });
        tags.appendChild(chip);
      });
      item.appendChild(tags);
    }
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'note-delete';
    remove.title = 'Sil';
    remove.setAttribute('aria-label', t('Sil'));
    remove.textContent = '×';
    remove.addEventListener('click', async (event) => {
      event.stopPropagation();
      if (!isBookmark && !window.confirm(t('Bu not ve vurgusu silinsin mi?'))) return;
      await deleteAnnotation(annotation.id);
    });
    item.appendChild(remove);
    appendAnnotationConflict(annotation, item);
    if (!isBookmark) {
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'note-edit-btn';
      edit.title = 'Notu düzenle';
      edit.setAttribute('aria-label', t('Notu düzenle'));
      edit.textContent = '✎';
      edit.addEventListener('click', (event) => {
        event.stopPropagation();
        startEditNote(annotation, item);
      });
      item.appendChild(edit);
    }

    item.addEventListener('click', async () => {
      if (isBookmark) {
        state.activeBookmarkId = annotation.id;
        state.bookmarkJump = true;
      } else {
        state.activeBookmarkId = null;
      }
      if (annotation.anchor?.type === 'epub' && annotation.anchor?.cfi) {
        await state.epubEngine?.goToCfi(annotation.anchor.cfi);
      } else {
        const target = Number(annotation.anchor?.page) || 1;
        await goToPage(target);
      }
      if (window.innerWidth < 820) setNotesOpen(false);
    });
    notesList.appendChild(item);
  });
  translateDom(notesList);
  if (previousFocus && !previousFocus.isConnected && !notesPanel.hidden) {
    const replacement = [...notesList.querySelectorAll('.note-item')].find(item => item.dataset.annotationId === focusedId);
    (replacement?.querySelector(`.${focusClass || 'note-edit-btn'}`) || noteFilter).focus();
  }
  updateBookmarkUi();
}

async function saveProgress() {
  if (!state.book) return;
  if (state.offlineMode) {
    try {
      const anchor = state.epubMode
        ? (() => {
          const progress = state.epubEngine?.getProgress();
          return progress?.cfi ? { type: 'epub', cfi: progress.cfi, href: progress.href, percent: progress.percent } : null;
        })()
        : { type: 'pdf', page: state.page };
      if (anchor) localStorage.setItem(`offlineProgress:${offlineBookKey(state.book)}`, JSON.stringify(anchor));
    } catch { /* quota/private mode */ }
    return;
  }
  if (state.epubMode) {
    const progress = state.epubEngine?.getProgress();
    if (!progress?.cfi) return;
    try {
      await fetch('/api/progress', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          assetId: state.book.asset_id,
          anchor: {
            asset_version_id: state.book.asset_id,
            type: 'epub',
            cfi: progress.cfi,
            href: progress.href,
          },
          percent: progress.percent,
        }),
      });
    } catch (error) {
      console.warn('EPUB progress save failed', error);
    }
    return;
  }
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

let announcedEpubChapter = null;
function updateEpubLocation(progress, announce = true) {
  const href = (progress?.href || '').split('#')[0];
  const chapter = epubChapterLabel(href);
  pageLabel.textContent = `${chapter ? `${chapter} · ` : ''}${progress?.percent || 0}%`;
  if (announce && announcedEpubChapter !== null && href && href !== announcedEpubChapter && chapter) {
    announceReaderStatus(`${t('Bölüm')}: ${chapter}`);
  }
  if (href) announcedEpubChapter = href;
}

function labelEpubFrames() {
  for (const frame of epubView.querySelectorAll('iframe')) {
    const lang = state.book?.language === 'en' ? 'en' : 'tr';
    frame.setAttribute('title', t('EPUB içeriği'));
    frame.setAttribute('aria-label', t('EPUB içeriği'));
    frame.setAttribute('lang', lang);
    if (!frame.dataset.a11yBound) {
      frame.dataset.a11yBound = '1';
      frame.addEventListener('load', labelEpubFrames);
    }
    try {
      frame.contentDocument.documentElement.lang = lang;
      frame.contentDocument.documentElement.setAttribute('lang', lang);
      frame.contentDocument.documentElement.setAttribute('xml:lang', lang);
    } catch { /* sandboxed frame */ }
  }
}

async function openEpubBook(book, options = {}) {
  book = normalizeBookVariant(book);
  const offlineBlob = options.offlineBlob || null;
  renderReaderVariants(book, true);
  state.offlineMode = Boolean(offlineBlob) || !navigator.onLine;
  state.offlineBlob = offlineBlob;
  if (state.epubEngine) {
    state.epubEngine.destroy();
    state.epubEngine = null;
  }
  resetSearch();
  resetReaderStatus();
  state.book = book;
  state.pending = null;
  state.epubSelection = null;
  hlBar.hidden = true;
  state.activeBookmarkId = null;
  state.bookmarkJump = false;
  state.readerReturnFocus = document.activeElement;
  state.epubMode = true;
  state.scrollMode = false;
  state.twoPage = false;
  state.secondPage = null;
  state.secondViewport = null;
  state.epubProgress = null;
  announcedEpubChapter = null;
  state.annotations = [];
  reader.hidden = false;
  setAppInert(true);
  tocPanel.hidden = true;
  notesPanel.hidden = true;
  syncPanelA11y();
  document.body.style.overflow = 'hidden';
  readerTitle.textContent = book.title;
  readerMeta.textContent = `${book.publisher || ''}${book.publication_year ? ` · ${book.publication_year}` : ''}`;
  downloadBtn.hidden = book.allow_download === false;
  document.body.classList.toggle('print-blocked', book.allow_print === false);
  reader.classList.add('epub-mode');
  reader.classList.remove('scroll-mode');
  pageWrap.hidden = true;
  pageWrap2.hidden = true;
  scrollPages.hidden = true;
  epubView.hidden = false;
  epubView.replaceChildren();
  tabPages.hidden = true;
  showTocTab('toc');
  pageInput.hidden = true;
  pageTotal.hidden = true;
  bookmarkBtn.hidden = false;
  pageLabel.setAttribute('aria-live', 'off');
  pageLabel.textContent = 'EPUB';

  try {
    await loadScript('/vendor/epubjs/jszip.min.js');
    await loadScript('/vendor/epubjs/epub.min.js');
    let progress = null;
    if (offlineBlob) {
      try {
        const saved = await loadOfflineProgress(book);
        progress = saved ? { anchor: saved } : null;
      } catch { /* noop */ }
      state.annotations = await listLocalAnnotations(book.asset_id, annotationOwnerId()).catch(() => []);
    } else {
      const progressResponse = await fetch(`/api/progress?assetId=${encodeURIComponent(book.asset_id)}`);
      progress = progressResponse.ok ? await progressResponse.json() : null;
      state.annotations = await loadAnnotationsFor(book.asset_id, false);
    }
    const params = new URLSearchParams(window.location.search);
    const initialCfi = (locationMatchesBook(params, book) ? params.get('cfi') : null) || progress?.anchor?.cfi;
    const engine = new EpubEngine(epubView, {
      canCopy: () => state.book?.allow_copy !== false,
      onCopyBlocked: () => toast('Bu kitapta kopyalama kapalı'),
      onRelocated: (next) => {
        state.epubProgress = next;
        updateEpubLocation(next);
        labelEpubFrames();
        if (state.bookmarkJump) {
          state.bookmarkJump = false;
        } else if (state.activeBookmarkId) {
          const active = state.annotations.find((annotation) => annotation.id === state.activeBookmarkId);
          if (!active || !activeBookmarkVisible(active)) {
            state.activeBookmarkId = null;
          }
        }
        updateBookmarkUi();
        updateUrl();
        saveProgress();
        if (state.searchQuery) {
          setTimeout(() => state.epubEngine?.highlightSearch(state.searchQuery, {
            fuzzy: ['fuzzy', 'stem'].includes(state.activeMatchType),
          }), 120);
        }
      },
      onSelected: handleEpubSelection,
      onSelectionTools: openSelectionTools,
      onDeselected: () => {
        state.epubSelection = null;
        hlBar.hidden = true;
      },
      onSwipe: (delta) => changePage(delta),
    });
    state.epubEngine = engine;
    const source = offlineBlob ? await offlineBlob.arrayBuffer() : `/api/books/${encodeURIComponent(bookRequestId(book))}/book.epub`;
    await engine.open(source, initialCfi || undefined);
    const frame = epubView.querySelector('iframe');
    const frameRect = frame?.getBoundingClientRect();
    if (!frame || !frameRect || frameRect.height < 20) {
      throw new Error('EPUB görünümü oluşmadı (iframe boyutu 0)');
    }
    frame.setAttribute('title', t('EPUB içeriği'));
    frame.setAttribute('aria-label', t('EPUB içeriği'));
    labelEpubFrames();
    state.epubFrameObserver?.disconnect();
    state.epubFrameObserver = new MutationObserver(labelEpubFrames);
    state.epubFrameObserver.observe(epubView, { childList: true, subtree: true });
    let frameBody = null;
    try { frameBody = frame.contentDocument?.body || null; } catch { /* cross-origin */ }
    if (frameBody && !frameBody.textContent.trim() && !frameBody.querySelector('img, svg, canvas')) {
      throw new Error('EPUB içeriği boş');
    }
    state.epubProgress = engine.getProgress();
    updateEpubLocation(state.epubProgress, false);
    const metaPrefix = [book.publisher, book.publication_year].filter(Boolean).join(' · ');
    readerMeta.textContent = t(`${metaPrefix ? `${metaPrefix} · ` : ''}EPUB · ${engine.getSpineCount()} bölüm`);
    const savedTheme = storedTheme();
    applyTheme(savedTheme);
    engine.setTheme(state.theme);
    applyEpubFontSize(storedEpubFontSize(book.id), false, book.id);
    state.annotations
      .filter((annotation) => annotation.anchor?.type === 'epub' && annotation.anchor?.cfi)
      .forEach((annotation) => engine.addAnnotation({
        id: annotation.id,
        cfiRange: annotation.anchor.cfi,
        color: annotation.color,
      }));
    renderToc();
    renderNotes();
    updateUrl();
    renderReaderVariants(book);
    $('closeReader').focus();
  } catch (error) {
    console.error(error);
    toast(`EPUB yüklenemedi: ${error.message}`);
    closeReader();
  }
}

async function openBook(book, options = {}) {
  book = normalizeBookVariant(book);
  if (book.format === 'epub') {
    await openEpubBook(book, options);
    return;
  }
  const offlineBlob = options.offlineBlob || null;
  renderReaderVariants(book, true);
  state.offlineMode = Boolean(offlineBlob) || !navigator.onLine;
  state.offlineBlob = offlineBlob;
  resetReaderStatus();
  state.book = book;
  state.pending = null;
  state.epubSelection = null;
  hlBar.hidden = true;
  state.activeBookmarkId = null;
  state.bookmarkJump = false;
  state.readerReturnFocus = document.activeElement;
  if (state.epubEngine) {
    state.epubEngine.destroy();
    state.epubEngine = null;
  }
  resetSearch();
  state.epubMode = false;
  reader.classList.remove('epub-mode');
  epubView.hidden = true;
  epubView.replaceChildren();
  tabPages.hidden = false;
  pageInput.hidden = false;
  pageTotal.hidden = false;
  bookmarkBtn.hidden = false;
  state.page = 1;
  state.pdfPageLabels = null;
  state.scale = 0;
  state.fitMode = 'width';
  state.initialFit = true;
  state.rotation = 0;
  state.twoPage = false;
  state.secondPage = null;
  state.secondViewport = null;
  if (state.scrollMode) stopScrollMode(false);
  state.scrollMode = false;
  scrollPages.hidden = true;
  scrollPages.replaceChildren();
  pageWrap.hidden = false;
  pageWrap2.hidden = true;
  reader.classList.remove('scroll-mode');
  scrollBtn.classList.remove('active');
  scrollBtn.setAttribute('aria-pressed', 'false');
  spreadBtn.setAttribute('aria-pressed', 'false');
  spreadBtn.classList.remove('active');
  pageWrap.querySelector('.pdf-structure')?.remove();
  pageWrap.querySelector('.pdf-link-layer')?.remove();
  pageWrap2.querySelector('.pdf-structure')?.remove();
  pageWrap2.querySelector('.pdf-link-layer')?.remove();
  textLayerEl.replaceChildren();
  textLayer2.replaceChildren();
  highlights2.replaceChildren();
  updateViewControls();
  let savedTheme = storedTheme();
  applyTheme(savedTheme);
  state.annotations = [];
  state.outline = [];
  state.pageText = new Map();
  state.searchRun += 1;
  state.activeQuery = '';
  state.perf = { openedAt: performance.now(), pdfLoadMs: null, firstPageMs: null, renders: [], phases: [] };
  noteFilter.value = '';
  noteColorFilter.value = 'all';
  if (thumbObserver) thumbObserver.disconnect();
  thumbGrid.replaceChildren();
  thumbGrid.dataset.book = '';
  setHighlightColor('yellow');
  bookSearch.value = '';
  searchResults.replaceChildren();
  searchStatus.textContent = '';
  searchEmpty.hidden = true;
  showTocTab('toc');
  tocFilter.value = '';
  tocPanel.hidden = true;
  reader.hidden = false;
  setAppInert(true);
  document.body.style.overflow = 'hidden';
  readerTitle.textContent = book.title;
  readerMeta.textContent = `${book.publisher || ''}${book.publication_year ? ` · ${book.publication_year}` : ''}`;
  downloadBtn.hidden = book.allow_download === false;
  document.body.classList.toggle('print-blocked', book.allow_print === false);
  notesPanel.hidden = window.innerWidth < 820;
  syncPanelA11y();
  pageLabel.textContent = '…';

  try {
    let progress = null;
    if (offlineBlob) {
      try {
        const saved = await loadOfflineProgress(book);
        progress = saved ? { anchor: saved } : null;
      } catch { /* noop */ }
      state.annotations = await listLocalAnnotations(book.asset_id, annotationOwnerId()).catch(() => []);
    } else {
      const progressResponse = await fetch(`/api/progress?assetId=${encodeURIComponent(book.asset_id)}`);
      progress = progressResponse.ok ? await progressResponse.json() : null;
      state.annotations = await loadAnnotationsFor(book.asset_id, false);
    }

    state.perf.beforePdfMs = Math.round(performance.now() - state.perf.openedAt);
    const task = pdfjsLib.getDocument(offlineBlob ? {
      data: new Uint8Array(await offlineBlob.arrayBuffer()),
      cMapUrl: '/vendor/pdfjs/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/vendor/pdfjs/standard_fonts/',
      isEvalSupported: false,
    } : {
      url: `/api/books/${encodeURIComponent(bookRequestId(book))}/file`,
      cMapUrl: '/vendor/pdfjs/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/vendor/pdfjs/standard_fonts/',
      isEvalSupported: false,
      // Both options are required to stop the full-file stream competing with ranges.
      disableStream: true,
      disableAutoFetch: true,
      rangeChunkSize: 256 * 1024,
    });
    state.pdf = await task.promise;
    state.perf.pdfLoadMs = performance.now() - state.perf.openedAt;
    state.numPages = state.pdf.numPages;
    const loadedPdf = state.pdf;
    const labelsStarted = performance.now();
    let labels = null;
    try {
      labels = normalizePdfPageLabels(await loadedPdf.getPageLabels());
    } catch (error) {
      console.warn('PDF page labels unavailable:', error.message);
    }
    if (state.pdf !== loadedPdf) return;
    state.perf.labelsMs = Math.round(performance.now() - labelsStarted);
    state.pdfPageLabels = labels;

    const params = new URLSearchParams(window.location.search);
    const rawPage = locationMatchesBook(params, book) ? params.get('page') : null;
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

    renderNotes();
    updatePageUi();
    await renderPage();
    if (state.pdf !== loadedPdf) return;
    renderReaderVariants(book);
    $('closeReader').focus();
    scheduleOutline(loadedPdf);
  } catch (error) {
    console.error(error);
    toast('PDF yüklenemedi. Sunucu ve dosya yolunu kontrol edin.');
    closeReader();
  }
}

async function closeReader() {
  readerVariants.hidden = true;
  readerVariants.replaceChildren();
  resetReaderStatus();
  if (state.epubFrameObserver) {
    state.epubFrameObserver.disconnect();
    state.epubFrameObserver = null;
  }
  if (state.epubEngine) {
    state.epubEngine.destroy();
    state.epubEngine = null;
  }
  state.offlineMode = false;
  state.offlineBlob = null;
  state.activeBookmarkId = null;
  state.bookmarkJump = false;
  resetSearch();
  state.epubMode = false;
  state.epubProgress = null;
  state.pending = null;
  state.epubSelection = null;
  reader.classList.remove('epub-mode');
  tabPages.hidden = false;
  epubView.hidden = true;
  epubView.replaceChildren();
  pageInput.hidden = false;
  pageTotal.hidden = false;
  bookmarkBtn.hidden = false;
  if (state.scrollMode) stopScrollMode(false);
  if (state.renderTask) {
    try { state.renderTask.cancel(); } catch { /* noop */ }
  }
  if (state.secondRenderTask) {
    try { state.secondRenderTask.cancel(); } catch { /* noop */ }
  }
  const pdf = state.pdf;
  state.renderTask = null;
  state.secondRenderTask = null;
  state.pdf = null;
  state.pdfPageLabels = null;
  state.book = null;
  state.secondPage = null;
  state.secondViewport = null;
  reader.hidden = true;
  reader.setAttribute('aria-busy', 'false');
  document.body.style.overflow = '';
  document.body.classList.remove('print-blocked');
  downloadBtn.hidden = true;
  hlBar.hidden = true;
  pageLoading.hidden = true;
  tocPanel.hidden = true;
  state.outline = [];
  state.searchRun += 1;
  state.activeQuery = '';
  state.pageText.clear();
  state.ocrCache.clear();
  state.ocrManifest.clear();
  state.annotations = [];
  state.viewport = null;
  if (thumbObserver) thumbObserver.disconnect();
  thumbGrid.replaceChildren();
  thumbGrid.dataset.book = '';
  canvas.width = 0;
  canvas.height = 0;
  canvas2.width = 0;
  canvas2.height = 0;
  pageWrap2.hidden = true;
  clearPending(highlightsEl);
  clearPending(highlights2);
  textLayerEl.replaceChildren();
  textLayer2.replaceChildren();
  pageWrap.querySelector('.pdf-structure')?.remove();
  pageWrap.querySelector('.pdf-link-layer')?.remove();
  pageWrap2.querySelector('.pdf-structure')?.remove();
  pageWrap2.querySelector('.pdf-link-layer')?.remove();
  highlightsEl.replaceChildren();
  highlights2.replaceChildren();
  if (pdf) {
    try { await pdf.destroy(); } catch { /* noop */ }
  }
  const returnFocus = state.readerReturnFocus;
  state.readerReturnFocus = null;
  if (loginScreen.hidden) setAppInert(false);
  if (returnFocus && returnFocus.isConnected) returnFocus.focus();
}

function handleEpubSelection({ cfiRange, text, contents }) {
  if (!cfiRange || !text) return;
  const href = state.epubEngine?.getCurrentRange?.().href || state.epubProgress?.href || '';
  state.epubSelection = { cfiRange, text, chapter: epubChapterLabel(href) };
  let rect = null;
  try {
    const selection = contents.window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const frameRect = contents.window.frameElement?.getBoundingClientRect();
    const localRect = range?.getBoundingClientRect();
    if (frameRect && localRect && localRect.width) {
      rect = {
        left: frameRect.left + localRect.left,
        top: frameRect.top + localRect.top,
        width: localRect.width,
      };
    }
  } catch {
    /* selection geometry is best-effort */
  }
  hlNote.value = '';
  hlBar.hidden = false;
  updateCopyControls();
  updateSelectionBar(rect || { left: window.innerWidth / 2, top: 100, width: 0 });
}

function updateSelectionBar(rect) {
  const barWidth = hlBar.getBoundingClientRect().width || 320;
  const barHeight = hlBar.getBoundingClientRect().height || 48;
  const left = Math.max(12, Math.min(rect.left + rect.width / 2 - barWidth / 2, window.innerWidth - barWidth - 12));
  const preferredTop = rect.top - barHeight - 8;
  const top = Math.max(12, Math.min(preferredTop < 12 ? rect.top + 24 : preferredTop, window.innerHeight - barHeight - 12));
  hlBar.style.left = `${left}px`;
  hlBar.style.top = `${top}px`;
}

function selectedOcrSpans(selection, container = textLayerEl) {
  const range = selection.rangeCount ? selection.getRangeAt(0) : null;
  return [...container.querySelectorAll('.ocr-word')]
    .filter((span) => (range ? range.intersectsNode(span) : selection.containsNode(span, true)));
}

function ocrSelectionText(selection, container = textLayerEl) {
  const words = selectedOcrSpans(selection, container)
    .map((span) => span.textContent.trim())
    .filter(Boolean);
  return words.length ? words.join(' ') : selection.toString().trim();
}

function buildSelection(selection, pane = {}) {
  if (!state.book || !selection || selection.isCollapsed || !selection.rangeCount) return null;
  const textLayer = pane.textLayer || textLayerEl;
  const pageWrapEl = pane.pageWrap || pageWrap;
  const range = selection.getRangeAt(0);
  if (!textLayer.contains(range.commonAncestorContainer)) return null;

  const ocrSpans = selectedOcrSpans(selection, textLayer);
  const text = ocrSelectionText(selection, textLayer);
  if (!text) return null;

  const pageRect = pageWrapEl.getBoundingClientRect();
  const scale = pane.viewport?.scale || state.viewport?.scale || 1;
  const toPageRect = (rect) => [
    Math.max(0, (rect.left - pageRect.left) / scale),
    Math.max(0, (rect.top - pageRect.top) / scale),
    rect.width / scale,
    rect.height / scale,
  ];

  let rects;
  if (ocrSpans.length) {
    rects = ocrSpans
      .map((span) => toPageRect(span.getBoundingClientRect()))
      .filter((rect) => rect[2] > 1 && rect[3] > 1);
  } else {
    rects = mergeRects([...range.getClientRects()].map(toPageRect));
  }
  if (!rects.length) return null;

  const last = ocrSpans.length
    ? ocrSpans[ocrSpans.length - 1].getBoundingClientRect()
    : (range.getClientRects()[range.getClientRects().length - 1] || pageRect);

  return { text, ocrSpans, range, rects, last, pane };
}

function openSelectionTools() {
  if (reader.hidden) return;
  if (state.epubMode) {
    const selected = state.epubEngine?.getSelection();
    if (selected) handleEpubSelection(selected);
  } else {
    const selection = window.getSelection();
    if (selection?.anchorNode) onSelection(paneForNode(selection.anchorNode));
  }
  if (!hlBar.hidden) hlNote.focus();
  else toast('Önce metin seçin');
}

function onSelection(pane = {}) {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return;
  const built = buildSelection(selection, pane);
  if (!built) return;

  renderPending(built.rects, pane.highlights || highlightsEl, pane.viewport?.scale || state.viewport?.scale || 1);
  state.pending = {
    text: built.text,
    anchor: {
      asset_version_id: state.book.asset_id,
      type: 'pdf',
      page: pane.pageNumber || state.page,
      rects: built.rects,
      text_quote: { prefix: '', exact: built.text, suffix: '' },
      text_position: { start: 0, end: built.text.length },
    },
  };
  hlNote.value = '';
  hlBar.hidden = false;
  updateCopyControls();
  updateSelectionBar(built.last);
}

function primaryPaneRef() {
  return {
    pageWrap,
    canvas,
    textLayer: textLayerEl,
    highlights: highlightsEl,
    pageNumber: state.page,
    viewport: state.viewport,
  };
}

function secondaryPaneRef() {
  return {
    pageWrap: pageWrap2,
    canvas: canvas2,
    textLayer: textLayer2,
    highlights: highlights2,
    pageNumber: state.secondPage,
    viewport: state.secondViewport,
  };
}

function paneForNode(node) {
  if (!node) return primaryPaneRef();
  const scrollWrap = node.parentElement?.closest('.scroll-page');
  if (scrollWrap?.__pane) return scrollWrap.__pane;
  if (textLayer2.contains(node)) return secondaryPaneRef();
  return primaryPaneRef();
}

async function saveEpubHighlight() {
  const selection = state.epubSelection;
  if (!selection || !state.book) return;
  const toolbarFocused = hlBar.contains(document.activeElement);
  state.epubSelection = null; hlBar.hidden = true;
  if (toolbarFocused) $('selectionTools').focus();
  try {
    const annotation = await saveLocalReaderAnnotation({ assetId: state.book.asset_id,
      anchor: { asset_version_id: state.book.asset_id, type: 'epub', cfi: selection.cfiRange,
        text_quote: selection.text.slice(0, 500) }, color: state.highlightColor, selectedText: selection.text });
    state.epubEngine?.addAnnotation({ id: annotation.id, cfiRange: selection.cfiRange, color: annotation.color });
    try { epubView.querySelector('iframe')?.contentWindow?.getSelection()?.removeAllRanges(); } catch { /* same origin */ }
  } catch (error) { console.error(error); toast(t('Vurgu kaydedilemedi')); }
}

async function syncOfflineAnnotations() {
  if (!navigator.onLine) return;
  if (state.annotationSyncing) return state.annotationSyncing;
  const authEpoch = state.authEpoch;
  state.annotationSyncing = (async () => {
    const response = await fetch('/api/me');
    if (!response.ok) return;
    const user = await response.json();
    if (state.authEpoch !== authEpoch || !user.id) return;
    if (state.user?.id !== user.id) setUser(user);
    const result = await syncAnnotationOperations(user.id);
    if (result?.sent === 100 && result.pending) setTimeout(() => syncOfflineAnnotations().catch(() => {}), 0);
    return result;
  })().catch(error => { console.warn('offline annotation sync failed', error); })
    .finally(() => { state.annotationSyncing = false; });
  return state.annotationSyncing;
}

async function syncReaderAnnotations(assetId, ownerId = annotationOwnerId()) {
  await syncOfflineAnnotations();
  const items = await listLocalAnnotations(assetId, ownerId);
  if (state.book?.asset_id !== assetId || annotationOwnerId() !== ownerId) return;
  state.annotations = items;
  if (!notesList.querySelector('.note-edit')) renderNotes();
  if (!state.epubMode) renderHighlights();
}

async function loadAnnotationsFor(assetId, offline) {
  if (offline) return listLocalAnnotations(assetId, annotationOwnerId()).catch(() => []);
  await syncOfflineAnnotations();
  const ownerId = annotationOwnerId();
  try {
    const response = await fetch('/api/annotations/v1?assetId=' + encodeURIComponent(assetId) + '&ownerId=' + encodeURIComponent(ownerId || ''));
    if (response.ok && annotationOwnerId() === ownerId) await cacheServerAnnotations(assetId, await response.json(), ownerId);
  } catch { /* retain local data */ }
  return listLocalAnnotations(assetId, annotationOwnerId()).catch(() => []);
}

async function saveLocalReaderAnnotation({ assetId, anchor, color, selectedText, note = hlNote.value.trim() || null }) {
  if (!annotationOwnerId()) throw new Error('annotation owner required');
  const id = `offline-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  let annotation = {
    id,
    asset_id: assetId,
    anchor,
    color,
    note,
    selected_text: selectedText,
    tags: [],
    status: 'active',
    created_at: now,
    updated_at: now,
    pending: true,
    ownerId: annotationOwnerId(),
  };
  annotation = await saveAnnotationWithOperation(annotation, {
    opId: crypto.randomUUID(),
    type: 'create',
    localId: id,
    assetId,
    payload: {
      assetId,
      anchor,
      color,
      note: annotation.note,
      selectedText,
    },
    createdAt: now,
  });
  state.annotations.push(annotation);
  if (color === 'bookmark' && state.epubMode) state.activeBookmarkId = annotation.id;
  renderNotes();
  toast(t(color === 'bookmark' ? 'Yer imi cihazda kaydedildi; eşitleme bekliyor' : 'Vurgu çevrimdışı kaydedildi'));
  if (navigator.onLine) syncReaderAnnotations(assetId, annotation.ownerId).catch(() => {});
  return annotation;
}

async function saveHighlight() {
  if (state.epubSelection) return saveEpubHighlight();
  if (!state.pending || !state.book) return;
  const toolbarFocused = hlBar.contains(document.activeElement);
  const pending = state.pending; state.pending = null; hlBar.hidden = true;
  if (toolbarFocused) $('selectionTools').focus();
  try {
    await saveLocalReaderAnnotation({ assetId: state.book.asset_id, anchor: pending.anchor,
      color: state.highlightColor, selectedText: pending.text });
    renderHighlights(); window.getSelection()?.removeAllRanges();
  } catch (error) { console.error(error); toast(t('Vurgu kaydedilemedi')); }
}

async function deleteAnnotation(id, options = {}) {
  const annotation = state.annotations.find(item => item.id === id);
  if (!annotation) return false;
  try {
    const ownerId = annotationOwnerId();
    const result = await removeLocalAnnotationWithOperation(annotation, ownerId);
    if (state.activeBookmarkId === id) state.activeBookmarkId = null;
    state.annotations = await listLocalAnnotations(annotation.asset_id, ownerId);
    if (state.epubMode) state.epubEngine?.removeAnnotation(id);
    renderNotes(); if (!state.epubMode) renderHighlights();
    if (navigator.onLine) syncReaderAnnotations(annotation.asset_id, ownerId).catch(() => {});
    if (result?.conflict) { toast(t('Notta çakışma var; iki sürüm de korundu')); return false; }
    if (!options.silent) toast(t(annotation.color === 'bookmark' ? 'Yer imi bu cihazdan kaldırıldı' : 'Not bu cihazdan kaldırıldı'));
    return true;
  } catch (error) { console.error(error); toast(t('Not silinemedi')); return false; }
}

function changePage(delta) {
  if (state.epubMode) {
    state.epubSelection = null;
    hlBar.hidden = true;
    state.activeBookmarkId = null;
    state.bookmarkJump = false;
    if (delta > 0) state.epubEngine?.next();
    else state.epubEngine?.prev();
    return;
  }
  goToPage(state.page + delta * (state.scrollMode ? 1 : state.twoPage ? 2 : 1));
}

let readerSwipe = null;
pageArea.addEventListener('touchstart', (event) => {
  if (reader.hidden || event.touches.length !== 1 || event.target.closest('button, input, select, a, textarea')) {
    readerSwipe = null;
    return;
  }
  readerSwipe = { x: event.touches[0].clientX, y: event.touches[0].clientY };
}, { passive: true });
pageArea.addEventListener('touchend', (event) => {
  if (!readerSwipe || !event.changedTouches.length) {
    readerSwipe = null;
    return;
  }
  const dx = event.changedTouches[0].clientX - readerSwipe.x;
  const dy = event.changedTouches[0].clientY - readerSwipe.y;
  readerSwipe = null;
  if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.4) changePage(dx < 0 ? 1 : -1);
}, { passive: true });

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

  if (trapModalFocus(event)) return;
  if (trapReaderFocus(event)) return;

  if (!passwordModal.hidden) {
    if (event.key === 'Escape') closePassword();
    return;
  }
  if (!citeModal.hidden) {
    if (event.key === 'Escape') closeCite();
    return;
  }
  if (!uploadModal.hidden) {
    if (event.key === 'Escape') closeUpload();
    return;
  }
  if (!editModal.hidden) {
    if (event.key === 'Escape') closeEdit();
    return;
  }
  if (!grantsModal.hidden) {
    if (event.key === 'Escape') closeGrants();
    return;
  }
  if (!offlineModal.hidden) {
    if (event.key === 'Escape') closeOffline();
    return;
  }
  if (!messagesModal.hidden) {
    if (event.key === 'Escape') closeMessages();
    return;
  }
  if (event.key === 'Escape' && !hlBar.hidden) {
    event.preventDefault();
    cancelSelection();
    return;
  }
  if (event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey
      && (event.code === 'KeyH' || event.key?.toLowerCase() === 'h') && !reader.hidden) {
    event.preventDefault();
    openSelectionTools();
    return;
  }
  if (event.ctrlKey || event.altKey || event.metaKey) return;
  if (!loginScreen.hidden) return;
  if (event.key === '?' && !typing && singleKeyShortcutsEnabled()) {
    event.preventDefault();
    showShortcuts();
    return;
  }
  if (event.key === '/' && !typing && singleKeyShortcutsEnabled()) {
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
      if (!notesPanel.hidden && notesPanel.contains(event.target)) {
        event.preventDefault();
        setNotesOpen(false);
      } else {
        event.target.blur();
        if (!tocPanel.hidden) toggleToc(false);
      }
    }
    return;
  }
  if (reader.hidden) return;

  if (event.shiftKey || (event.key.length === 1 && !singleKeyShortcutsEnabled())) return;

  switch (event.key) {
    case 'Escape':
      if (!tocPanel.hidden) toggleToc(false);
      else if (!notesPanel.hidden) setNotesOpen(false);
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
      setNotesOpen(notesPanel.hidden);
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

$('selectionTools').addEventListener('click', openSelectionTools);
$('footerShortcuts').addEventListener('click', showShortcuts);
document.querySelectorAll('[data-open-messages]').forEach(button => button.addEventListener('click', openMessages));
$('closeMessages').addEventListener('click', closeMessages);
$('clearMessages').addEventListener('click', () => {
  messageHistory = [];
  renderMessageHistory();
  $('closeMessages').focus();
});
messagesModal.addEventListener('click', event => { if (event.target === messagesModal) closeMessages(); });
document.querySelectorAll('[data-single-key-shortcuts]').forEach(input => input.addEventListener('change', () => {
  try { localStorage.setItem(`singleKeyShortcuts:${annotationOwnerId() || storageUserKey()}`, input.checked ? 'on' : 'off'); } catch { /* private storage */ }
  document.querySelectorAll('[data-single-key-shortcuts]').forEach(other => { other.checked = input.checked; });
}));
$('openUpload').addEventListener('click', openUpload);
$('offlineBtn').addEventListener('click', openOfflineModal);
$('closeOffline').addEventListener('click', closeOffline);
offlineModal.addEventListener('click', (event) => {
  if (event.target === offlineModal) closeOffline();
});
$('grantsBtn').addEventListener('click', openGrants);
$('closeGrants').addEventListener('click', closeGrants);
$('cancelGrant').addEventListener('click', closeGrants);
$('grantScopeType').addEventListener('change', grantScopeTypeChanged);
$('grantSubjectType').addEventListener('change', grantSubjectTypeChanged);
$('createGroupBtn').addEventListener('click', createGrantGroup);
$('addGroupMemberBtn').addEventListener('click', addGrantGroupMember);
$('removeGroupMemberBtn').addEventListener('click', removeGrantGroupMember);
grantForm.addEventListener('submit', submitGrant);
grantsModal.addEventListener('click', (event) => {
  if (event.target === grantsModal) closeGrants();
});
loginForm.addEventListener('submit', handleLogin);
logoutBtn.addEventListener('click', logout);
passwordBtn.addEventListener('click', openPassword);
passwordForm.addEventListener('submit', submitPassword);
$('closePassword').addEventListener('click', closePassword);
$('cancelPassword').addEventListener('click', closePassword);
$('logoutAllBtn').addEventListener('click', logoutAll);
passwordModal.addEventListener('click', (event) => {
  if (event.target === passwordModal) closePassword();
});
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
deleteBookBtn.addEventListener('click', async () => {
  const id = editId.value;
  if (!id) return;
  const title = editTitle.value.trim() || 'Bu kitap';
  if (!window.confirm(t(`“${title}” kalıcı olarak silinsin mi? Notlar ve ilerleme de silinir.`))) return;
  deleteBookBtn.disabled = true;
  try {
    const response = await fetch(`/api/books/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'x-csrf-token': readCookie('akademik_csrf') },
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || 'delete failed');
    }
    closeEdit();
    toast('Kitap silindi');
    await loadBooks();
  } catch (error) {
    console.error(error);
    toast(error.message === 'only platform-managed titles can be deleted'
      ? 'Yalnızca platforma yüklenen kitaplar silinebilir'
      : 'Kitap silinemedi');
  } finally {
    deleteBookBtn.disabled = false;
  }
});
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
tabPages.addEventListener('click', () => showTocTab('pages'));
[[tabToc, 'toc'], [tabSearch, 'search'], [tabPages, 'pages']].forEach(([tab, name], index, list) => {
  tab.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const nextIndex = (index + (event.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length;
    const [nextTab, nextName] = list[nextIndex];
    showTocTab(nextName);
    nextTab.focus();
  });
});
bookSearch.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => runSearch(bookSearch.value), 300);
});
searchWhole.addEventListener('change', () => {
  if (searchWhole.checked) searchFuzzy.checked = false;
});
searchFuzzy.addEventListener('change', () => {
  if (searchFuzzy.checked) searchWhole.checked = false;
});
for (const toggle of [searchWhole, searchFuzzy]) {
  toggle.addEventListener('change', () => {
    if (bookSearch.value.trim()) runSearch(bookSearch.value);
    bookSearch.focus();
  });
}
bookSearch.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    clearTimeout(searchTimer);
    const query = bookSearch.value.trim();
    if (state.searchHits.length && state.searchQuery === query) {
      focusSearchResult(state.searchIndex + (event.shiftKey ? -1 : 1));
    } else {
      runSearch(query);
    }
  }
});
searchPrev.addEventListener('click', () => focusSearchResult(state.searchIndex - 1));
searchNext.addEventListener('click', () => focusSearchResult(state.searchIndex + 1));
pageInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    goToPage(pageInput.value);
    pageInput.blur();
  }
});
pageInput.addEventListener('change', () => goToPage(pageInput.value));
bookmarkBtn.addEventListener('click', toggleBookmark);
$('citeBook').addEventListener('click', openCite);
downloadBtn.addEventListener('click', async () => {
  const book = state.book;
  if (!book) return;
  const original = downloadBtn.textContent;
  downloadBtn.disabled = true;
  downloadBtn.textContent = t('İndiriliyor…');
  try {
    const blob = await fetchDownloadBlob(book);
    const url = URL.createObjectURL(blob);
    const extension = book.format === 'epub' ? 'epub' : 'pdf';
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${book.title.replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 80) || 'kitap'}.${extension}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(t(extension === 'epub' ? 'EPUB indirildi' : 'PDF indirildi'));
  } catch (error) {
    console.error(error);
    toast(error.status === 429
      ? t(`Çok fazla indirme isteği; ${error.retryAfter} saniye sonra tekrar deneyin.`)
      : error.code === 'DOWNLOAD_DISABLED'
        ? t('Bu kitapta indirme kapalı')
        // 409 is a stored-file defect, not a transient failure: name it and point
        // the reader at the library instead of implying a retry would work.
        : error.status === 409
          ? t('Bu kitap şu an indirilemiyor; kütüphaneye bildirildi')
          : t(book.format === 'epub' ? 'EPUB indirilemedi' : 'PDF indirilemedi'));
  } finally {
    downloadBtn.disabled = false;
    downloadBtn.textContent = original;
  }
});
$('closeCite').addEventListener('click', closeCite);
$('closeCite2').addEventListener('click', closeCite);
$('copyCite').addEventListener('click', copyCitation);
citeStyle.addEventListener('change', renderCitation);
citePage.addEventListener('input', renderCitation);
citeModal.addEventListener('click', (event) => {
  if (event.target === citeModal) closeCite();
});
exportMd.addEventListener('click', () => exportAnnotations('md'));
exportJson.addEventListener('click', () => exportAnnotations('json'));
noteFilter.addEventListener('input', renderNotes);
noteColorFilter.addEventListener('change', renderNotes);
$('perfClose').addEventListener('click', () => { perfPanel.hidden = true; });
$('perfStress').addEventListener('click', () => {
  stressPages(20).catch((error) => {
    console.error(error);
    toast('Performans testi tamamlanamadı');
  });
});
$('prevPage').addEventListener('click', () => changePage(-1));
$('nextPage').addEventListener('click', () => changePage(1));
$('zoomIn').addEventListener('click', () => {
  state.initialFit = false;
  if (state.epubMode) {
    applyEpubFontSize(state.epubFontSize + 10);
    return;
  }
  state.scale = Math.min(3, state.scale + 0.2);
  updateZoomLabel();
  if (state.scrollMode) rebuildScrollMode();
  else renderPage();
});
$('zoomOut').addEventListener('click', () => {
  state.initialFit = false;
  if (state.epubMode) {
    applyEpubFontSize(state.epubFontSize - 10);
    return;
  }
  state.scale = Math.max(0.5, state.scale - 0.2);
  updateZoomLabel();
  if (state.scrollMode) rebuildScrollMode();
  else renderPage();
});
fitToggle.addEventListener('click', async () => {
  state.fitMode = state.fitMode === 'width' ? 'page' : 'width';
  state.initialFit = false;
  updateViewControls();
  if (state.scrollMode && state.pdf) {
    const page = await state.pdf.getPage(state.page);
    const base = page.getViewport({ scale: 1, rotation: state.rotation });
    state.scale = state.fitMode === 'page' ? fitPageScale(base, 1) : fitScale(base, 1);
    try { page.cleanup(); } catch { /* noop */ }
    updateZoomLabel();
    rebuildScrollMode();
    return;
  }
  state.scale = 0;
  renderPage();
});
$('rotateBtn').addEventListener('click', async () => {
  state.rotation = (state.rotation + 90) % 360;
  state.initialFit = false;
  if (state.scrollMode && state.pdf) {
    const page = await state.pdf.getPage(state.page);
    const base = page.getViewport({ scale: 1, rotation: state.rotation });
    state.scale = state.fitMode === 'page' ? fitPageScale(base, 1) : fitScale(base, 1);
    try { page.cleanup(); } catch { /* noop */ }
    updateZoomLabel();
    rebuildScrollMode();
    return;
  }
  state.scale = 0;
  renderPage();
});
$('fullscreenBtn').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await reader.requestFullscreen();
  } catch {
    toast('Tam ekran başlatılamadı');
  }
});
document.getElementById('readerTheme').addEventListener('change', (event) => {
  applyTheme(event.target.value);
  if (state.epubMode) state.epubEngine?.setTheme(state.theme);
});
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (storedTheme() === 'system') {
    applyTheme('system');
    if (state.epubMode) state.epubEngine?.setTheme(state.theme);
  }
});
const workspacePicker = document.getElementById('readerWorkspace');
workspacePicker.addEventListener('change', () => {
  reader.dataset.workspace = workspacePicker.value;
  try { localStorage.setItem(`readerWorkspace:${storageUserKey()}`, workspacePicker.value); } catch {}
});
document.getElementById('readerFocus').addEventListener('change', (event) => {
  reader.classList.toggle('reading-focus', event.target.checked);
});
document.getElementById('leaveFocus').addEventListener('click', () => {
  reader.classList.remove('reading-focus');
  document.getElementById('readerFocus').checked = false;
});
document.querySelectorAll('.reader-menu').forEach(menu => {
  menu.addEventListener('toggle', () => {
    if (menu.open) document.querySelectorAll('.reader-menu').forEach(other => { if (other !== menu) other.open = false; });
  });
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    document.querySelectorAll('.reader-menu').forEach(menu => { menu.open = false; });
    reader.classList.remove('reading-focus');
    document.getElementById('readerFocus').checked = false;
  }
});
spreadBtn.addEventListener('click', () => {
  if (state.scrollMode) stopScrollMode(false);
  state.twoPage = !state.twoPage;
  state.initialFit = false;
  state.scale = 0;
  spreadBtn.setAttribute('aria-pressed', state.twoPage ? 'true' : 'false');
  spreadBtn.classList.toggle('active', state.twoPage);
  renderPage();
});
scrollBtn.addEventListener('click', () => {
  if (state.scrollMode) stopScrollMode();
  else startScrollMode().catch((error) => {
    console.error(error);
    toast('Sürekli kaydırma açılamadı');
  });
});
$('toggleNotes').addEventListener('click', () => {
  setNotesOpen(notesPanel.hidden);
});
$('closeNotes').addEventListener('click', () => {
  setNotesOpen(false);
});
$('hlSave').addEventListener('click', saveHighlight);
hlCopy.addEventListener('click', () => copySelectedText(false));
hlCopyCite.addEventListener('click', () => copySelectedText(true));
hlColors.addEventListener('click', (event) => {
  const button = event.target.closest('.hl-color');
  if (button) setHighlightColor(button.dataset.color);
});
function cancelSelection() {
  const hadFocus = hlBar.contains(document.activeElement);
  state.pending = null;
  state.epubSelection = null;
  hlBar.hidden = true;
  clearPending(highlightsEl);
  clearPending(highlights2);
  window.getSelection()?.removeAllRanges();
  try { epubView.querySelector('iframe')?.contentWindow?.getSelection()?.removeAllRanges(); } catch { /* noop */ }
  if (hadFocus && !reader.hidden) $('selectionTools').focus();
}
$('hlCancel').addEventListener('click', cancelSelection);
hlNote.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') saveHighlight();
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    cancelSelection();
  }
});

textLayerEl.addEventListener('mouseup', () => setTimeout(() => onSelection(primaryPaneRef()), 0));
textLayer2.addEventListener('mouseup', () => setTimeout(() => onSelection(secondaryPaneRef()), 0));

let selectionFrame = null;
function updateLiveSelection() {
  selectionFrame = null;
  if (reader.hidden) return;
  if (state.pending && !hlBar.hidden) return;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.anchorNode) {
    clearPending(highlightsEl);
    clearPending(highlights2);
    return;
  }
  const pane = paneForNode(selection.anchorNode);
  const built = buildSelection(selection, pane);
  if (!built) {
    clearPending(highlightsEl);
    clearPending(highlights2);
    return;
  }
  renderPending(built.rects, pane.highlights, pane.viewport?.scale || 1);
}

document.addEventListener('selectionchange', () => {
  if (selectionFrame) return;
  selectionFrame = requestAnimationFrame(updateLiveSelection);
});

function selectedPdfContent(event) {
  const target = event.target;
  if (target?.closest?.('input, textarea, select') || target?.isContentEditable) return null;
  if (!state.book || reader.hidden || state.epubMode) return null;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const inText = (node) => {
    const element = node?.nodeType === 1 ? node : node?.parentElement;
    return Boolean(element?.closest?.('.textLayer'));
  };
  if (!inText(selection.anchorNode) && !inText(selection.focusNode)) return null;
  return { selection, pane: paneForNode(selection.anchorNode) };
}

document.addEventListener('copy', (event) => {
  const selected = selectedPdfContent(event);
  if (!selected) return;
  if (state.book.allow_copy === false) {
    event.preventDefault();
    toast('Bu kitapta kopyalama kapalı');
    return;
  }
  const { selection, pane } = selected;
  const words = selectedOcrSpans(selection, pane.textLayer)
    .map((span) => span.textContent.trim())
    .filter(Boolean);
  if (!words.length || !event.clipboardData) return;
  event.clipboardData.setData('text/plain', words.join(' '));
  event.preventDefault();
});

document.addEventListener('cut', (event) => {
  if (selectedPdfContent(event) && state.book.allow_copy === false) {
    event.preventDefault();
    toast('Bu kitapta kopyalama kapalı');
  }
});

document.addEventListener('mousedown', (event) => {
  if (!hlBar.hidden && !hlBar.contains(event.target)) {
    hlBar.hidden = true;
    state.pending = null;
    state.epubSelection = null;
    clearPending(highlightsEl);
    clearPending(highlights2);
  }
});

let scrollTick = null;
function updateScrollPageFromViewport() {
  if (!state.scrollMode) return;
  const area = pageArea.getBoundingClientRect();
  const center = area.top + area.height / 2;
  let best = null;
  let bestDistance = Infinity;
  state.scrollPanes.forEach((pane) => {
    const rect = pane.pageWrap.getBoundingClientRect();
    if (rect.bottom < area.top || rect.top > area.bottom) return;
    const distance = Math.abs((rect.top + rect.bottom) / 2 - center);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = pane.pageNumber;
    }
  });
  if (best && best !== state.page) {
    state.page = best;
    updatePageUi();
    updateUrl();
    saveProgress();
  }
}

pageArea.addEventListener('scroll', () => {
  if (!state.scrollMode || scrollTick) return;
  scrollTick = requestAnimationFrame(() => {
    scrollTick = null;
    updateScrollPageFromViewport();
  });
});

window.addEventListener('storage', event => {
  if (event.key !== 'offlineAnnotationUser') return;
  state.authEpoch = (state.authEpoch || 0) + 1;
  if (!state.user?.id || event.newValue === state.user.id) return;
  // Another tab changed accounts. Do not clear the new account's shared key.
  state.user = null;
  clearMessageHistory();
  state.annotations = [];
  userChip.textContent = ''; userChip.hidden = true; logoutBtn.hidden = true; passwordBtn.hidden = true;
  applyRoleUi();
  if (!reader.hidden) closeReader();
  notesList.replaceChildren();
  showLogin(t('Hesap başka sekmede değişti; yeniden giriş yapın'));
});

subscribeAnnotationChanges(() => {
  const assetId = state.book?.asset_id, ownerId = annotationOwnerId();
  if (!assetId || !ownerId) return;
  listLocalAnnotations(assetId, ownerId).then(items => {
    if (state.book?.asset_id !== assetId || annotationOwnerId() !== ownerId) return;
    state.annotations = items;
    if (!notesList.querySelector('.note-edit')) renderNotes();
    if (!state.epubMode) renderHighlights();
  }).catch(() => {});
});
window.addEventListener('focus', () => {
  if (navigator.onLine && state.book && state.user?.id) {
    const assetId = state.book.asset_id, ownerId = state.user.id;
    loadAnnotationsFor(assetId, false).then(items => {
      if (state.book?.asset_id !== assetId || annotationOwnerId() !== ownerId) return;
      state.annotations = items;
      if (!notesList.querySelector('.note-edit')) renderNotes();
      if (!state.epubMode) renderHighlights();
    }).catch(() => {});
  }
});

window.addEventListener('online', () => {
  if (state.user) {
    syncOfflineAnnotations().then(() => {
      const assetId = state.book?.asset_id;
      if (assetId) loadAnnotationsFor(assetId, false).then((items) => {
        if (state.book?.asset_id !== assetId) return;
        state.annotations = items;
        if (!notesList.querySelector('.note-edit')) renderNotes();
        if (!state.epubMode) renderHighlights();
      }).catch(() => {});
    }).catch(() => {});
  }
});
window.addEventListener('resize', () => {
  syncPanelA11y();
  if (reader.hidden || !state.pdf) return;
  clearTimeout(window._resizeTimer);
  window._resizeTimer = setTimeout(() => {
    state.scale = 0;
    renderPage();
  }, 220);
});

window.__readerPerf = readerPerf;
window.__readerStress = stressPages;

(async function init() {
  try {
    const config = await fetch('/api/config').then((response) => (response.ok ? response.json() : null));
    if (config) {
      applyBrand(config.brandName, config.brandTagline);
      applyFooter(config);
      mode.textContent = t(config.mode === 'db' ? 'DB modu' : 'Demo modu');
      mode.classList.toggle('db', config.mode === 'db');
    } else {
      const health = await fetch('/api/health').then((response) => response.json());
      mode.textContent = t(health.mode === 'db' ? 'DB modu' : 'Demo modu');
      mode.classList.toggle('db', health.mode === 'db');
    }
  } catch {
    mode.textContent = t('bağlantı yok');
  }
  if (new URLSearchParams(window.location.search).get('perf') === '1') {
    perfPanel.hidden = false;
    updatePerfPanel();
  }
  try {
    const authEpoch = state.authEpoch;
    const me = await fetch('/api/me');
    if (state.authEpoch !== authEpoch) { showLogin(t('Hesap başka sekmede değişti; yeniden giriş yapın')); return; }
    if (!me.ok) {
      showLogin();
      return;
    }
    const initialUser = await me.json();
    if (state.authEpoch !== authEpoch) { showLogin(); return; }
    setUser(initialUser);
    await bootData();
    syncOfflineAnnotations().catch(() => {});
  } catch (error) {
    console.error(error);
    const offlineEntries = await listOfflineBooks().catch(() => []);
    if (offlineEntries.length) {
      await showOfflineLibrary(offlineEntries);
      return;
    }
    showLogin('Sunucuya ulaşılamadı.');
  }
})();
