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
  ocrCache: new Map(),
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

async function renderOcrLayer(viewport) {
  const assetId = state.book?.asset_id;
  if (!assetId) return false;
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

  pageLabel.textContent = `${state.page} / ${state.numPages}`;
  updateZoomLabel();
  renderHighlights();
  saveProgress();
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
    const item = document.createElement('div');
    item.className = 'note-item';
    const page = document.createElement('div');
    page.className = 'note-page';
    page.textContent = `Sayfa ${annotation.anchor?.page || '—'}`;
    item.appendChild(page);
    if (annotation.selected_text) {
      const text = document.createElement('p');
      text.className = 'note-text';
      text.textContent = annotation.selected_text.length > 120
        ? `${annotation.selected_text.slice(0, 120)}…`
        : annotation.selected_text;
      item.appendChild(text);
    }
    if (annotation.note) {
      const body = document.createElement('p');
      body.className = 'note-body';
      body.textContent = annotation.note;
      item.appendChild(body);
    }
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'note-delete';
    remove.title = 'Notu sil';
    remove.textContent = '×';
    remove.addEventListener('click', async (event) => {
      event.stopPropagation();
      await deleteAnnotation(annotation.id);
    });
    item.appendChild(remove);

    item.addEventListener('click', async () => {
      const target = Number(annotation.anchor?.page) || 1;
      if (target !== state.page) {
        state.page = target;
        await renderPage();
      }
      notesPanel.hidden = true;
    });
    notesList.appendChild(item);
  });
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
    const savedPage = Number(progress?.anchor?.page);
    state.page = Number.isFinite(savedPage) && savedPage > 0 ? Math.min(savedPage, state.numPages) : 1;
    renderNotes();
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

async function deleteAnnotation(id) {
  try {
    const response = await fetch(`/api/annotations/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!response.ok) throw new Error('delete failed');
    state.annotations = state.annotations.filter((annotation) => annotation.id !== id);
    renderNotes();
    renderHighlights();
    toast('Not silindi');
  } catch (error) {
    console.error(error);
    toast('Not silinemedi');
  }
}

function changePage(delta) {
  const next = state.page + delta;
  if (next < 1 || next > state.numPages) return;
  state.page = next;
  renderPage();
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
  if (event.key === '/' && document.activeElement !== search) {
    event.preventDefault();
    search.focus();
  }
  if (!editModal.hidden) {
    if (event.key === 'Escape') closeEdit();
    return;
  }
  if (reader.hidden) return;
  if (event.key === 'Escape') closeReader();
  if (event.key === 'ArrowLeft') changePage(-1);
  if (event.key === 'ArrowRight') changePage(1);
});

editForm.addEventListener('submit', saveEdit);
$('closeEdit').addEventListener('click', closeEdit);
$('cancelEdit').addEventListener('click', closeEdit);
editModal.addEventListener('click', (event) => {
  if (event.target === editModal) closeEdit();
});

$('closeReader').addEventListener('click', closeReader);
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
