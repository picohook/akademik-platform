// The library's three designs and the sidebar around the catalogue.
//
//   classic  Klasik Yeşil      dark green navigation, written wordmark
//   light    LibRead Açık      the original logo, white and blue (the default)
//   salon    Okuma Salonu      warm paper, burgundy, serif headings, a wider shelf
//
// A design only changes how the catalogue looks (library-designs.css is written for the catalogue's own
// containers). The reader, its light/sepia/dark setting and the dialogs are not touched, and nothing here
// holds catalogue state: search, filters, sort, favourites and reading positions live in library.mjs and app.js,
// so switching design cannot reset them.
//
// The choice is remembered per reader (`libreadDesign:<tenant>:<user>`) and also device-wide (`libreadDesign`,
// read by design-init.js before first paint). A browser that cannot store anything simply starts in the default
// design every time.

import { getLang, t } from '/i18n.mjs?v=23';

const DESIGNS = ['classic', 'light', 'salon'];
const DEFAULT_DESIGN = 'light';
const THEME_COLOR = { classic: '#163c32', light: '#283d78', salon: '#703b43' };

// Local copy, as for the read-aloud player: short generic words stay out of the global dictionary.
const TEXT = {
  design: ['Tasarım', 'Design'],
  workspace: ['ÇALIŞMA ALANIM', 'MY WORKSPACE'],
  library: ['Kütüphane', 'Library'],
  favorites: ['Favoriler', 'Favourites'],
  history: ['Okuma geçmişi', 'Reading history'],
  note: ['Bir sayfa daha.<br>Bir fikir daha.', 'Another page.<br>Another idea.'],
  help: ['Yardım ve kısayollar', 'Help and shortcuts'],
  knowledge: ['bilgi ekosistemi', 'knowledge ecosystem'],
  openAccessLibrary: ['Açık erişim kütüphanesi', 'An open-access library'],
  end: ['Kütüphanedeki tüm kaynakları gördünüz.', 'You have seen everything in the library.'],
  layoutGroup: ['Görünüm', 'View'],
  gridView: ['Izgara görünümü', 'Grid view'],
  listView: ['Liste görünümü', 'List view'],
  openNav: ['Menüyü aç', 'Open menu'],
  closeNav: ['Menüyü kapat', 'Close menu'],
  eyebrow: ['KİŞİSEL AKADEMİK KÜTÜPHANENİZ', 'YOUR PERSONAL ACADEMIC LIBRARY'],
  titleAll: ['Kütüphanem', 'My library'],
  titleFavorites: ['Favorilerim', 'My favourites'],
  titleHistory: ['Okuma geçmişim', 'My reading history'],
  ledeAll: ['Okumaya devam edin veya yeni bir kaynak keşfedin.', 'Pick up where you left off, or discover something new.'],
  ledeFavorites: ['Yıldızladığınız kitaplar burada toplanır.', 'The books you have starred are kept here.'],
  ledeHistory: ['Okumaya başladığınız kitaplar, en son okuduğunuz en üstte.', 'The books you have started, the most recent first.'],
  catalogueAll: ['Kataloğu keşfet', 'Explore the catalogue'],
  catalogueFavorites: ['Favori kitaplarınız', 'Your favourite books'],
  catalogueHistory: ['Okuma geçmişiniz', 'Your reading history'],
  emptyFavorites: ['Henüz favori kitabınız yok. Bir kitabın yıldızına dokunarak ekleyin.', 'You have no favourites yet. Tap the star on a book to add one.'],
  emptyHistory: ['Henüz okumaya başladığınız bir kitap yok.', 'You have not started a book yet.'],
  designTitle: ['Kütüphanenizin havasını seçin.', 'Make the library your own.'],
  designDescription: ['Üç tasarım, aynı kütüphane. Seçiminiz hesabınız için bu tarayıcıda hatırlanır.', 'Three designs, one library. Your choice is remembered for your account in this browser.'],
  designDone: ['Kütüphaneye dön', 'Back to the library'],
  close: ['Kapat', 'Close'],
  choose: ['Tasarım seçin. Şu an:', 'Choose a design. Current:'],
  selected: ['seçildi.', 'selected.'],
};
const NAMES = { classic: ['Klasik Yeşil', 'Classic Green'], light: ['LibRead Açık', 'LibRead Light'], salon: ['Okuma Salonu', 'Reading Room'] };
const DESCRIPTIONS = {
  classic: ['İlk tasarım. Yazılı marka, koyu yeşil gezinme.', 'The original. A wordmark and deep green navigation.'],
  light: ['Orijinal logo, beyaz ve mavi tonlar.', 'The original logo with crisp white and blue tones.'],
  salon: ['Sıcak kâğıt tonları, bordo ve geniş kitap rafı.', 'Warm paper, burgundy accents and a spacious bookshelf.'],
};

export function createDesigns({ library, openShortcuts, isOffline = () => false }) {
  const $ = (id) => document.getElementById(id);
  const root = document.documentElement;
  const dialog = $('designDialog');
  const trigger = $('lrDesignBtn');
  const sidebar = $('lrSidebar');
  const backdrop = $('lrNavBackdrop');
  const openNavButton = $('lrOpenNav');
  const phone = window.matchMedia('(max-width: 760px)');
  const say = (key) => TEXT[key][getLang() === 'en' ? 1 : 0];
  let owner = '';
  let changed = false;
  let drawerOpen = false;

  const current = () => (DESIGNS.includes(root.dataset.design) ? root.dataset.design : DEFAULT_DESIGN);

  function remember(id) {
    try {
      localStorage.setItem('libreadDesign', id);
      if (owner) localStorage.setItem(`libreadDesign:${owner}`, id);
    } catch { /* storage may be blocked: the choice still applies for this visit */ }
  }

  function apply(id) {
    const design = DESIGNS.includes(id) ? id : DEFAULT_DESIGN;
    root.dataset.design = design;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[design]);
    paint();
  }

  function choose(id) {
    if (!DESIGNS.includes(id)) return;
    apply(id);
    remember(id);
    changed = true;
    paint();
  }

  // ---- text in the current language ----
  function paint() {
    const index = getLang() === 'en' ? 1 : 0;
    document.querySelectorAll('[data-lr]').forEach((el) => {
      const text = TEXT[el.dataset.lr]?.[index];
      if (text === undefined) return;
      if (text.includes('<br>')) el.replaceChildren(...text.split('<br>').flatMap((part, i) => (i ? [document.createElement('br'), part] : [part])));
      else el.textContent = text;
    });
    document.querySelectorAll('[data-lr-label]').forEach((el) => { el.setAttribute('aria-label', say(el.dataset.lrLabel)); });
    $('designTitle').textContent = say('designTitle');
    $('designDescription').textContent = say('designDescription');
    $('designDone').textContent = say('designDone');
    $('designClose').setAttribute('aria-label', say('close'));
    const id = current();
    document.querySelectorAll('[data-design-name]').forEach((el) => { el.textContent = NAMES[el.dataset.designName][index]; });
    document.querySelectorAll('[data-design-description]').forEach((el) => { el.textContent = DESCRIPTIONS[el.dataset.designDescription][index]; });
    document.querySelectorAll('[data-design-option]').forEach((el) => { el.setAttribute('aria-pressed', String(el.dataset.designOption === id)); });
    trigger.setAttribute('aria-label', `${say('choose')} ${NAMES[id][index]}`);
    trigger.title = NAMES[id][index];
    $('designStatus').textContent = changed ? `${NAMES[id][index]} ${say('selected')}` : '';
    $('lrOpenNav').setAttribute('aria-label', say('openNav'));
    $('lrCloseNav').setAttribute('aria-label', say('closeNav'));
    backdrop.setAttribute('aria-label', say('closeNav'));
    heading(library.getView());
  }

  // ---- the page heading follows the view ----
  function heading(view) {
    const key = view === 'favorites' ? 'Favorites' : (view === 'history' ? 'History' : 'All');
    $('lrEyebrow').textContent = say('eyebrow');
    const title = $('lrTitle');
    const dot = document.createElement('span');
    dot.textContent = '.';
    title.replaceChildren(say(`title${key}`), dot);
    $('lrLede').textContent = say(`lede${key}`);
    $('lrCatalogueTitle').textContent = say(`catalogue${key}`);
    const empty = $('empty');
    if (empty) empty.textContent = view === 'all' ? t('Sonuç yok. Arama terimini değiştirin.') : say(`empty${key}`);
    document.title = `LibRead — ${say(`title${key}`)}`;
  }

  function sync(detail = null) {
    const view = detail?.view || library.getView();
    const counts = library.counts();
    const signedIn = detail ? detail.signedIn : Boolean(owner);
    document.querySelectorAll('.lr-nav-item').forEach((button) => {
      const active = button.dataset.view === view;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
      // Favourites and history live on the server: not available signed out or in the offline library
      button.disabled = button.dataset.view !== 'all' && (!signedIn || isOffline());
    });
    const badge = $('lrFavoriteCount');
    badge.textContent = String(counts.favorites);
    badge.hidden = !counts.favorites;
    heading(view);
  }

  document.addEventListener('library-view', (event) => sync(event.detail));
  document.querySelectorAll('.lr-nav-item').forEach((button) => {
    button.addEventListener('click', () => {
      library.setView(button.dataset.view);
      closeDrawer(false);
      window.scrollTo({ top: 0 });
    });
  });
  $('lrHelp').addEventListener('click', () => { closeDrawer(false); openShortcuts(); });

  // ---- the design dialog ----
  trigger.addEventListener('click', () => {
    changed = false;
    paint();
    dialog.showModal();
    dialog.querySelector('[aria-pressed="true"]')?.focus();
  });
  dialog.addEventListener('click', (event) => {
    const option = event.target.closest('[data-design-option]');
    if (option) choose(option.dataset.designOption);
  });
  $('designClose').addEventListener('click', () => dialog.close());
  $('designDone').addEventListener('click', () => dialog.close());
  // Escape closes a native modal dialog by itself; the focus goes back to the button that opened it
  dialog.addEventListener('close', () => trigger.focus({ preventScroll: true }));

  // ---- the sidebar as a drawer on a phone ----
  function setDrawer(open) {
    drawerOpen = open;
    sidebar.classList.toggle('open', open);
    backdrop.hidden = !open;
    document.body.classList.toggle('lr-nav-open', open && phone.matches);
    openNavButton.setAttribute('aria-expanded', String(open));
    // closed on a phone, the sidebar is off screen: keep it out of the keyboard and screen-reader order
    sidebar.inert = phone.matches && !open;
  }
  function closeDrawer(returnFocus = true) {
    if (!drawerOpen) return;
    setDrawer(false);
    if (returnFocus) openNavButton.focus({ preventScroll: true });
  }
  openNavButton.addEventListener('click', () => { setDrawer(true); sidebar.querySelector('.lr-nav-item:not(:disabled)')?.focus(); });
  $('lrCloseNav').addEventListener('click', () => closeDrawer());
  backdrop.addEventListener('click', () => closeDrawer());
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && drawerOpen) { event.preventDefault(); closeDrawer(); } });
  phone.addEventListener('change', () => setDrawer(false));

  // ---- who is signed in decides which saved choice applies ----
  function setUser(user) {
    owner = user?.id ? `${user.tenantId || user.tenant_id || ''}:${user.id}` : '';
    if (owner) {
      let saved = '';
      try { saved = localStorage.getItem(`libreadDesign:${owner}`) || ''; } catch { /* storage blocked */ }
      if (DESIGNS.includes(saved)) apply(saved);
      else apply(current()); // first visit of this reader on this device: keep what is showing
    }
    sync();
  }

  apply(current());
  setDrawer(false);
  sync();
  return { setUser, sync, current, choose, paint };
}
