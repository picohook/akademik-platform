import { SORTS, sortBooks, filterBooks, authorName } from './library-model.mjs';

export function createLibrary({ state, renderBooks, makeCard, t, toast, libraryText }) {
  const $ = id => document.getElementById(id);
  let owner = '', generation = 0, favorites = new Set(), progress = new Map(), allBooks = [];
  let favoritesOnly = false;
  const pending = new Set();
  const facets = { language: '', publisher: '', from: '', to: '' };
  const root = document.createElement('section');
  root.className = 'library-controls';
  root.innerHTML = `<label class="library-sort"><span></span><select id="librarySort"></select></label>
    <details id="libraryFilters"><summary></summary><div class="library-facets">
      <label><span></span><select id="libraryLanguage"></select></label>
      <label><span></span><select id="libraryPublisher"></select></label>
      <label><span></span><input id="libraryYearFrom" type="number" min="1" max="9999" inputmode="numeric"></label>
      <label><span></span><input id="libraryYearTo" type="number" min="1" max="9999" inputmode="numeric"></label>
    </div></details><p id="libraryStatus" role="status" aria-live="polite"></p>`;
  const toolbar = document.querySelector('#filters').closest('.toolbar');
  toolbar.before(root);
  const labels = ['Katalog sıralaması', 'Katalog dili', 'Katalog yayıncısı', 'Başlangıç yayın yılı', 'Bitiş yayın yılı'];
  root.querySelectorAll('label > span').forEach((span, index) => { span.textContent = t(labels[index]); });
  root.querySelector('summary').textContent = t('Katalog filtreleri');
  const sort = $('librarySort');
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
  root.before(shelf);
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
    button.addEventListener('click', () => {
      favoritesOnly = !favoritesOnly;
      button.classList.toggle('active', favoritesOnly);
      button.setAttribute('aria-pressed', String(favoritesOnly));
      renderBooks();
    });
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
        if (favoritesOnly) { renderBooks(); $('libraryFavorites').focus(); }
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
    }
  }

  return {
    setUser, setBooks, refresh, addFavoriteFilter, decorateCard,
    visible: books => filterBooks(books, facets).filter(book => !favoritesOnly || favorites.has(book.id)),
    order: groups => {
      const byBook = new Map(groups.map(group => [group.book, group]));
      return sortBooks([...byBook.keys()], sort.value).map(book => byBook.get(book));
    },
  };
}
