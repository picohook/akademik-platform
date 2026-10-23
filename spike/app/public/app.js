import * as pdfjsLib from '/vendor/pdfjs/pdf.mjs';
import { formatCitation } from '/citations.mjs';
import { EpubEngine } from '/epub-engine.mjs';
import { initializeLanguage, toggleLanguage, t, translateDom, getLang } from '/i18n.mjs';
import {
  saveOfflineBook,
  listOfflineBooks,
  getOfflineBook,
  deleteOfflineBook,
  storageEstimate,
  listLocalAnnotations,
  saveLocalAnnotation,
  deleteLocalAnnotation,
  updateLocalAnnotation,
  queueAnnotationOp,
  listAnnotationOps,
  deleteAnnotationOp,
  removeQueuedCreate,
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
const toastEl = $('toast');
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

function toast(message) {
  toastEl.textContent = t(message);
  toastEl.hidden = false;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toastEl.hidden = true; }, 2600);
}

function hue(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) % 360;
  return hash;
}

async function openCardBook(book) {
  if (state.offlineMode || state.offlineLibrary) {
    const stored = await getOfflineBook(book.id);
    if (stored) {
      if (stored.book.format === 'epub') await openEpubBook(stored.book, { offlineBlob: stored.blob });
      else await openBook(stored.book, { offlineBlob: stored.blob });
      return;
    }
  }
  await openBook(book);
}

function makeCard(book) {
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
  visible.forEach((book) => grid.appendChild(makeCard(book)));
  count.textContent = `${visible.length} başlık`;
  empty.hidden = visible.length !== 0;
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
  setTimeout(() => focusElement?.focus(), 0);
}

function closeModal(modal) {
  modal.hidden = true;
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
  const focusable = [...reader.querySelectorAll(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], iframe, [tabindex]:not([tabindex="-1"])',
  )].filter((element) => element.offsetParent !== null);
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
  const url = `/api/books/${encodeURIComponent(book.id)}/file`;
  const probe = await fetch(url, { headers: { range: 'bytes=0-0' } });
  if (!probe.ok && probe.status !== 206) {
    const payload = await probe.json().catch(() => ({}));
    throw new Error(payload.error || `HTTP ${probe.status}`);
  }
  const range = probe.headers.get('content-range') || '';
  const total = Number(range.split('/')[1]) || Number(probe.headers.get('content-length')) || 0;
  probe.body?.cancel();
  if (total > 300 * 1024 * 1024) {
    toast(t('Dosya 300 MB sınırını aşıyor; çevrimdışı kaydedilemez'));
    return;
  }
  const response = await fetch(url);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  const blob = await response.blob();
  const estimate = await storageEstimate();
  if (estimate?.quota && estimate.usage + blob.size > estimate.quota * 0.95) {
    toast(t('Çevrimdışı alan yetersiz'));
    return;
  }
  await saveOfflineBook(book, blob);
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
  deleteBookBtn.hidden = book.source_system !== 'upload';
  openModal(editModal, editTitle);
}

function closeEdit() {
  closeModal(editModal);
}

function openCite() {
  if (!state.book) return;
  citeStyle.value = 'apa';
  citePage.value = '';
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

async function copyCitation() {
  const text = citeOutput.textContent || '';
  try {
    await navigator.clipboard.writeText(text);
    toast('Atıf kopyalandı');
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
    toast('Atıf kopyalandı');
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
}

function setUser(user) {
  state.user = user;
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
  state.books = entries.map((entry) => entry.book);
  renderFilters();
  renderBooks();
}

function showLogin(message = '') {
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
    const book = state.books.find((item) => item.id === bookId || item.asset_id === bookId);
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
  try {
    await fetch('/api/logout', { method: 'POST' });
  } catch {
    // Cookie is cleared server-side on the next successful request.
  }
  state.user = null;
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
  state.books = await response.json();
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
  fitToggle.setAttribute('aria-pressed', fitPage ? 'true' : 'false');
  fitToggle.classList.toggle('active', fitPage);
}

function applyTheme(theme) {
  const next = ['light', 'sepia', 'dark'].includes(theme) ? theme : 'light';
  state.theme = next;
  reader.dataset.theme = next;
  themeBtn.textContent = next === 'dark' ? '☾' : next === 'sepia' ? '◐' : '☀';
  themeBtn.title = t(next === 'dark' ? 'Koyu tema' : next === 'sepia' ? 'Sepia tema' : 'Açık tema');
  try {
    localStorage.setItem('readerTheme', next);
  } catch {
    // Private mode may block storage.
  }
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
    if (pageNumber === state.page) button.setAttribute('aria-current', 'location');
    button.textContent = `Sayfa ${pageNumber}`;
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
    button.setAttribute('aria-label', t(`Sayfa ${pageNumber}`));
    button.dataset.page = String(pageNumber);
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    canvas.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = `Sayfa ${pageNumber}`;
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
}

function setNotesOpen(open) {
  const next = Boolean(open);
  const hadFocus = notesPanel.contains(document.activeElement);
  notesPanel.hidden = !next;
  syncPanelA11y();
  if (next) {
    if (window.innerWidth < 820) tocPanel.hidden = true;
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

function updatePageUi() {
  if (state.epubMode) {
    pageInput.hidden = true;
    pageTotal.hidden = true;
    bookmarkBtn.hidden = true;
    pageLabel.textContent = `${state.epubProgress?.percent || 0}%`;
    return;
  }
  pageInput.hidden = false;
  pageTotal.hidden = false;
  bookmarkBtn.hidden = false;
  pageInput.max = String(state.numPages || 1);
  pageInput.value = String(state.page || 1);
  pageTotal.textContent = `/ ${state.numPages || 1}`;
  pageWrap.setAttribute('aria-label', t(`Sayfa ${state.page}`));
  pageWrap2.setAttribute('aria-label', t(`Sayfa ${state.secondPage || state.page + 1}`));
  pageLabel.textContent = t(state.twoPage && state.secondPage
    ? `${state.page}-${state.secondPage} / ${state.numPages}`
    : `${state.page} / ${state.numPages}`);
  updateBookmarkUi();
}

function updateUrl() {
  if (!state.book) return;
  const url = new URL(window.location.href);
  url.searchParams.set('book', state.book.id);
  if (state.epubMode) {
    url.searchParams.delete('page');
    if (state.epubEngine?.getCurrentCfi()) url.searchParams.set('cfi', state.epubEngine.getCurrentCfi());
  } else {
    url.searchParams.delete('cfi');
    url.searchParams.set('page', String(state.page));
  }
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
  if (state.scrollMode) {
    scrollToPage(target);
    return;
  }
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
  label.textContent = t(`Sayfa ${pageNumber}${matches > 1 ? ` · ${matches} eşleşme` : ''}`) + note;
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
      const response = await fetch(`/api/books/${encodeURIComponent(state.book.id)}/search?${params}`);
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
    const response = await fetch(`/api/books/${encodeURIComponent(state.book.id)}/search?${params}`);
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
  container.appendChild(fragment);
  return true;
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
  const page = await state.pdf.getPage(pageNumber);
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

  pane.textLayer.replaceChildren();
  const usedOcr = await renderOcrLayer(viewport, pageNumber, pane.textLayer);
  if (!usedOcr) {
    try {
      const textContent = await page.getTextContent();
      const textLayer = new pdfjsLib.TextLayer({
        textContentSource: textContent,
        container: pane.textLayer,
        viewport,
      });
      await textLayer.render();
    } catch (error) {
      console.warn('text layer failed', error);
    }
  }
  applySearchHighlight(pane.textLayer);
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
const COLOR_LABELS = { yellow: 'Sarı', green: 'Yeşil', blue: 'Mavi', pink: 'Pembe', bookmark: 'Yer imi' };

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

async function updateAnnotation(id, changes) {
  const response = await fetch(`/api/annotations/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(changes),
  });
  if (!response.ok) throw new Error('annotation update failed');
  const updated = await response.json();
  const index = state.annotations.findIndex((annotation) => annotation.id === id);
  if (index >= 0) state.annotations[index] = updated;
  renderNotes();
  renderHighlights();
  return updated;
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
    lines.push(`## Sayfa ${page}`, '');
    if (annotation.color === 'bookmark') {
      lines.push('*Yer imi*', '');
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
  const tagsInput = document.createElement('input');
  tagsInput.type = 'text';
  tagsInput.className = 'note-tags-input';
  tagsInput.placeholder = 'Etiketler (; ile ayırın)';
  tagsInput.maxLength = 200;
  tagsInput.value = (Array.isArray(annotation.tags) ? annotation.tags : []).join('; ');
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
    try {
      await updateAnnotation(annotation.id, {
        note: textarea.value.trim(),
        tags: tagsInput.value,
      });
      toast('Not güncellendi');
    } catch {
      toast('Not güncellenemedi');
    }
  });
  cancel.addEventListener('click', () => renderNotes());
  item.appendChild(editor);
  textarea.focus();
}

async function cycleAnnotationColor(annotation) {
  if (annotation.color === 'bookmark') return;
  const current = COLOR_ORDER.indexOf(annotation.color);
  const next = COLOR_ORDER[(current + 1) % COLOR_ORDER.length];
  try {
    await updateAnnotation(annotation.id, { color: next });
  } catch {
    toast('Renk değiştirilemedi');
  }
}

function renderNotes() {
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
    const color = document.createElement('button');
    color.type = 'button';
    color.className = `note-color ${annotation.color || 'yellow'}`;
    color.title = 'Rengi değiştir';
    color.setAttribute('aria-label', 'Rengi değiştir');
    color.addEventListener('click', async (event) => {
      event.stopPropagation();
      await cycleAnnotationColor(annotation);
    });
    item.appendChild(color);
    const page = document.createElement('div');
    page.className = 'note-page';
    const epubAnchor = annotation.anchor?.type === 'epub';
    page.textContent = epubAnchor
      ? 'EPUB'
      : `Sayfa ${annotation.anchor?.page || '—'}${isBookmark ? ' · Yer imi' : ''}`;
    item.appendChild(page);
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
    remove.textContent = '×';
    remove.addEventListener('click', async (event) => {
      event.stopPropagation();
      await deleteAnnotation(annotation.id);
    });
    item.appendChild(remove);
    if (!isBookmark) {
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'note-edit-btn';
      edit.title = 'Notu düzenle';
      edit.textContent = '✎';
      edit.addEventListener('click', (event) => {
        event.stopPropagation();
        startEditNote(annotation, item);
      });
      item.appendChild(edit);
    }

    item.addEventListener('click', async () => {
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
      if (anchor) localStorage.setItem(`offlineProgress:${state.book.id}`, JSON.stringify(anchor));
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
  const offlineBlob = options.offlineBlob || null;
  state.offlineMode = Boolean(offlineBlob) || !navigator.onLine;
  state.offlineBlob = offlineBlob;
  if (state.epubEngine) {
    state.epubEngine.destroy();
    state.epubEngine = null;
  }
  resetSearch();
  state.book = book;
  state.readerReturnFocus = document.activeElement;
  state.epubMode = true;
  state.scrollMode = false;
  state.twoPage = false;
  state.secondPage = null;
  state.secondViewport = null;
  state.epubProgress = null;
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
  bookmarkBtn.hidden = true;
  pageLabel.textContent = 'EPUB';

  try {
    await loadScript('/vendor/epubjs/jszip.min.js');
    await loadScript('/vendor/epubjs/epub.min.js');
    let progress = null;
    if (offlineBlob) {
      try {
        const saved = JSON.parse(localStorage.getItem(`offlineProgress:${book.id}`) || 'null');
        progress = saved ? { anchor: saved } : null;
      } catch { /* noop */ }
      state.annotations = await listLocalAnnotations(book.asset_id).catch(() => []);
    } else {
      const progressResponse = await fetch(`/api/progress?assetId=${encodeURIComponent(book.asset_id)}`);
      progress = progressResponse.ok ? await progressResponse.json() : null;
      state.annotations = await loadAnnotationsFor(book.asset_id, false);
    }
    const params = new URLSearchParams(window.location.search);
    const initialCfi = params.get('book') === book.id ? params.get('cfi') : progress?.anchor?.cfi;
    const engine = new EpubEngine(epubView, {
      onRelocated: (next) => {
        state.epubProgress = next;
        pageLabel.textContent = `${next.percent}%`;
        labelEpubFrames();
        updateUrl();
        saveProgress();
        if (state.searchQuery) {
          setTimeout(() => state.epubEngine?.highlightSearch(state.searchQuery, {
            fuzzy: ['fuzzy', 'stem'].includes(state.activeMatchType),
          }), 120);
        }
      },
      onSelected: handleEpubSelection,
      onSwipe: (delta) => changePage(delta),
    });
    state.epubEngine = engine;
    const source = offlineBlob ? await offlineBlob.arrayBuffer() : `/api/books/${encodeURIComponent(book.id)}/book.epub`;
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
    pageLabel.textContent = `${state.epubProgress.percent}%`;
    const metaPrefix = [book.publisher, book.publication_year].filter(Boolean).join(' · ');
    readerMeta.textContent = t(`${metaPrefix ? `${metaPrefix} · ` : ''}EPUB · ${engine.getSpineCount()} bölüm`);
    const savedTheme = (() => {
      try { return localStorage.getItem('readerTheme') || 'light'; } catch { return 'light'; }
    })();
    applyTheme(savedTheme);
    engine.setTheme(savedTheme);
    state.epubFontSize = 100;
    engine.setFontSize(state.epubFontSize);
    updateZoomLabel();
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
    $('closeReader').focus();
  } catch (error) {
    console.error(error);
    toast(`EPUB yüklenemedi: ${error.message}`);
    closeReader();
  }
}

async function openBook(book, options = {}) {
  if (book.format === 'epub') {
    await openEpubBook(book, options);
    return;
  }
  const offlineBlob = options.offlineBlob || null;
  state.offlineMode = Boolean(offlineBlob) || !navigator.onLine;
  state.offlineBlob = offlineBlob;
  state.book = book;
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
  textLayer2.replaceChildren();
  highlights2.replaceChildren();
  updateViewControls();
  let savedTheme = 'light';
  try { savedTheme = localStorage.getItem('readerTheme') || 'light'; } catch { /* noop */ }
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
        const saved = JSON.parse(localStorage.getItem(`offlineProgress:${book.id}`) || 'null');
        progress = saved ? { anchor: saved } : null;
      } catch { /* noop */ }
      state.annotations = await listLocalAnnotations(book.asset_id).catch(() => []);
    } else {
      const progressResponse = await fetch(`/api/progress?assetId=${encodeURIComponent(book.asset_id)}`);
      progress = progressResponse.ok ? await progressResponse.json() : null;
      state.annotations = await loadAnnotationsFor(book.asset_id, false);
    }

    const task = pdfjsLib.getDocument(offlineBlob ? {
      data: new Uint8Array(await offlineBlob.arrayBuffer()),
      cMapUrl: '/vendor/pdfjs/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/vendor/pdfjs/standard_fonts/',
      isEvalSupported: false,
    } : {
      url: `/api/books/${encodeURIComponent(book.id)}/file`,
      cMapUrl: '/vendor/pdfjs/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/vendor/pdfjs/standard_fonts/',
      isEvalSupported: false,
      disableAutoFetch: true,
    });
    state.pdf = await task.promise;
    state.perf.pdfLoadMs = performance.now() - state.perf.openedAt;
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
    $('closeReader').focus();
  } catch (error) {
    console.error(error);
    toast('PDF yüklenemedi. Sunucu ve dosya yolunu kontrol edin.');
    closeReader();
  }
}

async function closeReader() {
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
  resetSearch();
  state.epubMode = false;
  state.epubProgress = null;
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
  state.epubSelection = { cfiRange, text };
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
  updateSelectionBar(rect || { left: window.innerWidth / 2, top: 100, width: 0 });
  hlNote.value = '';
  hlBar.hidden = false;
}

function updateSelectionBar(rect) {
  const barWidth = 320;
  const left = Math.min(Math.max(12, rect.left + rect.width / 2 - barWidth / 2), window.innerWidth - barWidth - 12);
  const top = Math.max(12, rect.top - 58);
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
  updateSelectionBar(built.last);
  hlBar.hidden = false;
  hlNote.focus();
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
  state.epubSelection = null;
  hlBar.hidden = true;
  if (state.offlineMode) {
    const annotation = await saveLocalHighlight({
      assetId: state.book.asset_id,
      anchor: {
        asset_version_id: state.book.asset_id,
        type: 'epub',
        cfi: selection.cfiRange,
        text_quote: selection.text.slice(0, 500),
      },
      color: state.highlightColor,
      selectedText: selection.text,
    });
    state.epubEngine?.addAnnotation({
      id: annotation.id,
      cfiRange: selection.cfiRange,
      color: state.highlightColor,
    });
    try {
      epubView.querySelector('iframe')?.contentWindow?.getSelection()?.removeAllRanges();
    } catch { /* same-origin iframe */ }
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
          type: 'epub',
          cfi: selection.cfiRange,
          text_quote: selection.text.slice(0, 500),
        },
        color: state.highlightColor,
        note: hlNote.value.trim() || null,
        selectedText: selection.text,
      }),
    });
    if (!response.ok) throw new Error('annotation failed');
    const saved = await response.json();
    state.annotations.push({ ...saved, selected_text: saved.selected_text || selection.text });
    state.epubEngine?.addAnnotation({
      id: saved.id,
      cfiRange: selection.cfiRange,
      color: state.highlightColor,
    });
    renderNotes();
    toast('Vurgu kaydedildi');
    try {
      epubView.querySelector('iframe')?.contentWindow?.getSelection()?.removeAllRanges();
    } catch { /* same-origin iframe */ }
  } catch (error) {
    console.error(error);
    toast('Vurgu kaydedilemedi');
  }
}

async function syncOfflineAnnotations() {
  if (!navigator.onLine || state.annotationSyncing) return;
  state.annotationSyncing = true;
  try {
    const ops = await listAnnotationOps();
    for (const op of ops) {
      if (op.type === 'create') {
        const response = await fetch('/api/annotations', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(op.payload),
        });
        if (!response.ok) continue;
        const saved = await response.json();
        const local = (await listLocalAnnotations(op.assetId)).find((item) => item.id === op.localId);
        if (local) {
          await updateLocalAnnotation({
            ...local,
            server_id: saved.id,
            pending: false,
            updated_at: saved.updated_at || new Date().toISOString(),
          });
        }
        await deleteAnnotationOp(op.opId);
      } else if (op.type === 'delete') {
        if (op.serverId) {
          const response = await fetch(`/api/annotations/${encodeURIComponent(op.serverId)}`, { method: 'DELETE' });
          if (!response.ok) continue;
        }
        await deleteAnnotationOp(op.opId);
      }
    }
  } catch (error) {
    console.warn('offline annotation sync failed', error);
  } finally {
    state.annotationSyncing = false;
  }
}

async function loadAnnotationsFor(assetId, offline) {
  const local = await listLocalAnnotations(assetId).catch(() => []);
  if (offline) return local;
  await syncOfflineAnnotations();
  let server = [];
  try {
    const response = await fetch(`/api/annotations?assetId=${encodeURIComponent(assetId)}`);
    if (response.ok) server = await response.json();
  } catch { /* offline */ }
  const serverIds = new Set(server.map((item) => item.id));
  await Promise.all(server.map((item) => saveLocalAnnotation({
    ...item,
    server_id: item.id,
    pending: false,
  }).catch(() => {})));
  const localOnly = local.filter((item) => item.pending || (item.server_id && !serverIds.has(item.server_id)));
  return [...localOnly, ...server];
}

async function saveLocalHighlight({ assetId, anchor, color, selectedText }) {
  const id = `offline-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const annotation = {
    id,
    asset_id: assetId,
    anchor,
    color,
    note: hlNote.value.trim() || null,
    selected_text: selectedText,
    tags: [],
    status: 'active',
    created_at: now,
    updated_at: now,
    pending: true,
  };
  await saveLocalAnnotation(annotation);
  await queueAnnotationOp({
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
  renderNotes();
  toast(t('Vurgu çevrimdışı kaydedildi'));
  return annotation;
}

async function saveHighlight() {
  if (state.epubSelection) {
    await saveEpubHighlight();
    return;
  }
  if (!state.pending || !state.book) return;
  const pending = state.pending;
  state.pending = null;
  hlBar.hidden = true;
  if (state.offlineMode) {
    await saveLocalHighlight({
      assetId: state.book.asset_id,
      anchor: pending.anchor,
      color: state.highlightColor,
      selectedText: pending.text,
    });
    renderHighlights();
    window.getSelection()?.removeAllRanges();
    return;
  }
  try {
    const response = await fetch('/api/annotations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        assetId: state.book.asset_id,
        anchor: pending.anchor,
        color: state.highlightColor,
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
  if (state.offlineMode) {
    const annotation = state.annotations.find((item) => item.id === id);
    if (!annotation) return;
    if (annotation.server_id) {
      await queueAnnotationOp({
        opId: crypto.randomUUID(),
        type: 'delete',
        localId: annotation.id,
        serverId: annotation.server_id,
        createdAt: new Date().toISOString(),
      });
    } else {
      await removeQueuedCreate(annotation.id);
    }
    await deleteLocalAnnotation(annotation.id);
    state.annotations = state.annotations.filter((item) => item.id !== id);
    if (state.epubMode) state.epubEngine?.removeAnnotation(id);
    renderNotes();
    if (!state.epubMode) renderHighlights();
    if (!options.silent) toast('Not silindi (çevrimdışı)');
    return;
  }
  try {
    const response = await fetch(`/api/annotations/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!response.ok) throw new Error('delete failed');
    await deleteLocalAnnotation(id).catch(() => {});
    state.annotations = state.annotations.filter((annotation) => annotation.id !== id);
    if (state.epubMode) state.epubEngine?.removeAnnotation(id);
    renderNotes();
    if (!state.epubMode) renderHighlights();
    if (!options.silent) toast('Not silindi');
  } catch (error) {
    console.error(error);
    toast('Not silinemedi');
  }
}

function changePage(delta) {
  if (state.epubMode) {
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
    toast(error.message === 'only uploaded titles can be deleted'
      ? 'Yalnızca yüklenen kitaplar silinebilir'
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
  if (!state.book) return;
  const original = downloadBtn.textContent;
  downloadBtn.disabled = true;
  downloadBtn.textContent = t('İndiriliyor…');
  try {
    const response = await fetch(`/api/books/${encodeURIComponent(state.book.id)}/download`);
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || 'download failed');
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${state.book.title.replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 80) || 'kitap'}.pdf`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('PDF indirildi');
  } catch (error) {
    console.error(error);
    toast(error.message === 'download disabled for this title' ? 'Bu kitapta indirme kapalı' : 'PDF indirilemedi');
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
    state.epubFontSize = Math.min(200, state.epubFontSize + 10);
    state.epubEngine?.setFontSize(state.epubFontSize);
    updateZoomLabel();
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
    state.epubFontSize = Math.max(70, state.epubFontSize - 10);
    state.epubEngine?.setFontSize(state.epubFontSize);
    updateZoomLabel();
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
themeBtn.addEventListener('click', () => {
  const order = ['light', 'sepia', 'dark'];
  const next = order[(order.indexOf(state.theme) + 1) % order.length];
  applyTheme(next);
  if (state.epubMode) state.epubEngine?.setTheme(next);
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
hlColors.addEventListener('click', (event) => {
  const button = event.target.closest('.hl-color');
  if (button) setHighlightColor(button.dataset.color);
});
$('hlCancel').addEventListener('click', () => {
  state.pending = null;
  state.epubSelection = null;
  hlBar.hidden = true;
  clearPending(highlightsEl);
  clearPending(highlights2);
  window.getSelection()?.removeAllRanges();
  try { epubView.querySelector('iframe')?.contentWindow?.getSelection()?.removeAllRanges(); } catch { /* noop */ }
});
hlNote.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') saveHighlight();
  if (event.key === 'Escape') {
    state.pending = null;
    hlBar.hidden = true;
    clearPending(highlightsEl);
  clearPending(highlights2);
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

document.addEventListener('copy', (event) => {
  if (state.book && state.book.allow_copy === false) {
    event.preventDefault();
    toast('Bu kitapta kopyalama kapalı');
    return;
  }
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.anchorNode) return;
  const inPrimary = textLayerEl.contains(selection.anchorNode);
  const inSecondary = textLayer2.contains(selection.anchorNode);
  if (!inPrimary && !inSecondary) return;
  const pane = inSecondary ? secondaryPaneRef() : primaryPaneRef();
  const words = selectedOcrSpans(selection, pane.textLayer)
    .map((span) => span.textContent.trim())
    .filter(Boolean);
  if (!words.length || !event.clipboardData) return;
  event.clipboardData.setData('text/plain', words.join(' '));
  event.preventDefault();
});

document.addEventListener('cut', (event) => {
  if (state.book && state.book.allow_copy === false) {
    event.preventDefault();
    toast('Bu kitapta kopyalama kapalı');
  }
});

document.addEventListener('mousedown', (event) => {
  if (!hlBar.hidden && !hlBar.contains(event.target)) {
    hlBar.hidden = true;
    state.pending = null;
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

window.addEventListener('online', () => {
  if (state.user) {
    syncOfflineAnnotations().then(() => {
      if (state.book) loadAnnotationsFor(state.book.asset_id, false).then((items) => {
        state.annotations = items;
        renderNotes();
        if (!state.epubMode) renderHighlights();
      }).catch(() => {});
    }).catch(() => {});
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

window.__readerPerf = readerPerf;
window.__readerStress = stressPages;

(async function init() {
  try {
    const config = await fetch('/api/config').then((response) => (response.ok ? response.json() : null));
    if (config) {
      applyBrand(config.brandName, config.brandTagline);
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
    const me = await fetch('/api/me');
    if (!me.ok) {
      showLogin();
      return;
    }
    setUser(await me.json());
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
