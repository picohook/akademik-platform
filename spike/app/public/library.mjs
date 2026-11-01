import { SORTS, sortBooks, filterBooks, authorName } from './library-model.mjs';

export function createLibrary({ state, renderBooks, makeCard, t, toast, libraryText }) {
  const $ = id => document.getElementById(id);
  let owner = '', generation = 0, favorites = new Set(), progress = new Map(), allBooks = [];
  let favoritesOnly = false;
  let historyOnly = false;
  let layout = 'grid';
  const pending = new Set();
  const facets = { language: '', publisher: '', from: '', to: '' };
  // The controls are built here but placed where the library design puts them: the sort select among the
  // catalogue tools, the filters panel in the chip row, the status line under it.
  const root = document.createElement('div');
  root.className = 'library-controls';
  root.innerHTML = `<label class="library-sort"><span></span><select id="librarySort"></select></label>
    <details id="libraryFilters"><summary></summary><div class="library-facets">
      <label><span></span><select id="libraryLanguage"></select></label>
      <label><span></span><select id="libraryPublisher"></select></label>
      <label><span></span><input id="libraryYearFrom" type="number" min="1" max="9999" inputmode="numeric"></label>
      <label><span></span><input id="libraryYearTo" type="number" min="1" max="9999" inputmode="numeric"></label>
    </div></details><p id="libraryStatus" role="status" aria-live="polite"></p>`;
  const toolbar = document.querySelector('#filters').closest('.toolbar');
  const sortLabel = root.querySelector('.library-sort');
  const filtersPanel = root.querySelector('#libraryFilters');
  const statusLine = root.querySelector('#libraryStatus');
  $('lrCatalogueTools').prepend(sortLabel);
  toolbar.insertBefore(filtersPanel, $('openUpload'));
  toolbar.after(statusLine);
  const labels = ['Katalog sıralaması', 'Katalog dili', 'Katalog yayıncısı', 'Başlangıç yayın yılı', 'Bitiş yayın yılı'];
  [sortLabel, ...filtersPanel.querySelectorAll('label')].forEach((label, index) => { label.querySelector('span').textContent = t(labels[index]); });
  filtersPanel.querySelector('summary').textContent = t('Katalog filtreleri');
  const sort = $('librarySort');
  // sort and view choices are remembered per reader
  const gridEl = $('grid');
  const sortLabels = ['İlgi / eklenme sırası', 'Kitap adı A–Z', 'Kitap adı Z–A', 'En yeni yayınlar', 'Yazar adı A–Z'];
  SORTS.forEach((value, index) => sort.add(new Option(t(sortLabels[index]), value)));
  sort.addEventListener('change', () => {
    try { if (owner) localStorage.setItem(`librarySort:${owner}`, sort.value); } catch { /* storage disabled */ }
    renderBooks();
  });
  const shelf = document.createElement('section');
  shelf.id = 'continueReading';
  shelf.hidden = true;
  shelf.setAttribute('aria-labelledby', 'continueReadingTitle');
  shelf.innerHTML = '<h2 id="continueReadingTitle"></h2><div class="library-shelf"></div>';
  shelf.querySelector('h2').textContent = t('Okumaya devam et');
  $('lrCatalogue').before(shelf);
  const layoutButtons = [...document.querySelectorAll('[data-layout]')];
  function setLayout(next, remember = true) {
    layout = next === 'list' ? 'list' : 'grid';
    gridEl.classList.toggle('list', layout === 'list');
    layoutButtons.forEach((button) => {
      const on = button.dataset.layout === layout;
      button.classList.toggle('active', on);
      button.setAttribute('aria-pressed', String(on));
    });
    if (remember) { try { if (owner) localStorage.setItem(`libraryLayout:${owner}`, layout); } catch { /* storage disabled */ } }
  }
  layoutButtons.forEach((button) => button.addEventListener('click', () => setLayout(button.dataset.layout)));
  $('count').setAttribute('role', 'status');
  $('count').setAttribute('aria-live', 'polite');
  $('count').setAttribute('aria-atomic', 'true');
  // The count is the live region; announcing every card duplicates it.
  $('grid').removeAttribute('aria-live');

  for (const [id, field] of [['libraryLanguage', 'language'], ['libraryPublisher', 'publisher'], ['libraryYearFrom', 'from'], ['libraryYearTo', 'to']]) {
    $(id).addEventListener('input', () => { facets[field] = $(id).value; renderBooks(); });
  }
  const refreshOnReturn = new MutationObserver(() => {
    if ($('reader').hidden && state.user?.id && !state.offlineLibrary) refresh();
  });
  refreshOnReturn.observe($('reader'), { attributes: true, attributeFilter: ['hidden'] });

  function setUser(user) {
    generation += 1;
    owner = user?.id ? `${user.tenantId || user.tenant_id || ''}:${user.id}` : '';
    favorites = new Set(); progress = new Map(); allBooks = []; favoritesOnly = false;
    shelf.hidden = true;
    shelf.querySelector('.library-shelf').replaceChildren();
    $('libraryStatus').textContent = '';
    Object.keys(facets).forEach(field => { facets[field] = ''; });
    root.querySelectorAll('input').forEach(input => { input.value = ''; });
    let saved = '';
    try { saved = localStorage.getItem(`librarySort:${owner}`) || ''; } catch { /* storage disabled */ }
    sort.value = SORTS.includes(saved) ? saved : '';
    let savedLayout = '';
    try { savedLayout = localStorage.getItem(`libraryLayout:${owner}`) || ''; } catch { /* storage disabled */ }
    setLayout(savedLayout, false);
    historyOnly = false;
    announce();
  }

  // The three ways to look at the library: everything, only favourites, only what was started.
  const getView = () => (favoritesOnly ? 'favorites' : (historyOnly ? 'history' : 'all'));
  function announce() {
    const chip = $('libraryFavorites');
    if (chip) { chip.classList.toggle('active', favoritesOnly); chip.setAttribute('aria-pressed', String(favoritesOnly)); }
    document.dispatchEvent(new CustomEvent('library-view', { detail: { view: getView(), favorites: favorites.size, history: progress.size, signedIn: Boolean(owner) } }));
  }
  function setView(next) {
    favoritesOnly = next === 'favorites';
    historyOnly = next === 'history';
    announce();
    renderBooks();
  }

  function setBooks(books, query) {
    if (!query) allBooks = books;
    for (const [id, field, label] of [['libraryLanguage', 'language', 'Tüm katalog dilleri'], ['libraryPublisher', 'publisher', 'Tüm katalog yayıncıları']]) {
      const select = $(id);
      const values = [...new Set([...allBooks, ...books].map(book => book[field]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'));
      // Keep active facets available even when a search has no matching titles.
      if (facets[field] && !values.includes(facets[field])) values.push(facets[field]);
      select.replaceChildren(new Option(t(label), ''), ...values.map(value => new Option(value, value)));
      select.value = facets[field];
    }
    renderShelf();
  }

  async function refresh() {
    const epoch = generation;
    if (!owner || state.offlineLibrary) return;
    try {
      const [f, p] = await Promise.all([fetch('/api/favorites'), fetch('/api/library/progress')]);
      if (!f.ok || !p.ok) throw new Error('library unavailable');
      const [favoriteRows, progressRows] = await Promise.all([f.json(), p.json()]);
      if (epoch !== generation) return;
      favorites = new Set(favoriteRows.map(row => row.work_id));
      progress = new Map(progressRows.map(row => [row.asset_id, row]));
      $('libraryStatus').textContent = '';
      renderBooks();
      renderShelf();
      announce();
    } catch {
      if (epoch === generation) $('libraryStatus').textContent = t('Kişisel kitaplık yüklenemedi. Yeniden denemek için sayfayı yenileyin.');
    }
  }

  function renderShelf() {
    const rows = [...progress.values()].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    const seen = new Set();
    const books = rows.map(row => allBooks.find(book => book.asset_id === row.asset_id)).filter(book => {
      if (!book || seen.has(book.id)) return false;
      seen.add(book.id); return true;
    }).slice(0, 4);
    const target = shelf.querySelector('.library-shelf');
    target.replaceChildren(...books.map(book => makeCard(book)));
    shelf.hidden = !books.length || state.offlineLibrary;
  }

  function addFavoriteFilter(container) {
    const button = document.createElement('button');
    button.id = 'libraryFavorites';
    button.type = 'button';
    button.className = `chip${favoritesOnly ? ' active' : ''}`;
    button.textContent = libraryText('favorites');
    button.setAttribute('aria-pressed', String(favoritesOnly));
    button.disabled = !owner || state.offlineLibrary;
    button.addEventListener('click', () => setView(favoritesOnly ? 'all' : 'favorites'));
    container.prepend(button);
  }

  function decorateCard(card, book) {
    card.dataset.workId = book.id;
    card.dataset.assetId = book.asset_id;
    const name = authorName(book);
    if (name) card.querySelector('.author').textContent = name;
    const button = document.createElement('button');
    button.className = 'library-star';
    button.type = 'button';
    button.disabled = !owner || state.offlineLibrary;
    const paint = () => {
      const selected = favorites.has(book.id);
      button.textContent = selected ? '★' : '☆';
      button.setAttribute('aria-pressed', String(selected));
      button.setAttribute('aria-label', `${t('Kitap favorisi')}: ${book.title}`);
    };
    paint();
    button.addEventListener('click', async event => {
      event.stopPropagation();
      if (pending.has(book.id)) return;
      const epoch = generation, selected = favorites.has(book.id);
      pending.add(book.id);
      button.setAttribute('aria-busy', 'true');
      try {
        const response = await fetch(`/api/favorites/${encodeURIComponent(book.id)}`, { method: selected ? 'DELETE' : 'PUT' });
        if (!response.ok) throw new Error('favorite failed');
        if (epoch !== generation) return;
        if (selected) favorites.delete(book.id); else favorites.add(book.id);
        // Keep both shelf and catalogue stars consistent without replacing the
        // focused button. Rebuild only when removing a card from Favoriler.
        document.querySelectorAll('.library-star').forEach(star => {
          if (star.closest('[data-work-id]')?.dataset.workId === book.id) {
            star.textContent = selected ? '☆' : '★';
            star.setAttribute('aria-pressed', String(!selected));
          }
        });
        announce();
        if (favoritesOnly) { renderBooks(); ($('libraryFavorites')?.offsetParent ? $('libraryFavorites') : document.querySelector('.lr-nav-item[data-view="favorites"]'))?.focus(); }
        toast(t(selected ? 'Kitap favorilerden çıkarıldı.' : 'Kitap favorilere eklendi.'));
      } catch {
        if (epoch === generation) toast(t('Kitap favorisi kaydedilemedi. Yeniden deneyin.'));
      } finally {
        pending.delete(book.id);
        button.removeAttribute('aria-busy');
        button.disabled = !owner || state.offlineLibrary;
        paint();
      }
    });
    card.querySelector('.card-meta').appendChild(button);
    const row = progress.get(book.asset_id);
    if (row) {
      const bar = document.createElement('progress');
      bar.className = 'library-progress';
      bar.max = 100;
      bar.value = Math.max(0, Math.min(100, Number(row.percent) || 0));
      bar.setAttribute('aria-label', `${t('Kitap okuma ilerlemesi')}: ${book.title}`);
      card.appendChild(bar);
      const percent = document.createElement('span');
      percent.className = 'library-percent';
      percent.setAttribute('aria-hidden', 'true');
      percent.textContent = `${Math.round(bar.value)}%`;
      card.appendChild(percent);
    }
  }

  return {
    setUser, setBooks, refresh, addFavoriteFilter, decorateCard, setView, getView, setLayout,
    counts: () => ({ favorites: favorites.size, history: progress.size }),
    visible: books => filterBooks(books, facets)
      .filter(book => !favoritesOnly || favorites.has(book.id))
      .filter(book => !historyOnly || progress.has(book.asset_id)),
    order: groups => {
      const byBook = new Map(groups.map(group => [group.book, group]));
      const ordered = sortBooks([...byBook.keys()], sort.value);
      // "Okuma geçmişi" with the default order: the most recently read first
      if (historyOnly && !sort.value) {
        const when = book => String(progress.get(book.asset_id)?.updated_at || '');
        ordered.sort((a, b) => when(b).localeCompare(when(a)));
      }
      return ordered.map(book => byBook.get(book));
    },
  };
}
