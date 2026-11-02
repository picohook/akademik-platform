// LibRead public demo: the guide.
//
// A visitor should not have to find the features alone. On the first visit a short dialog says what the reader can do and offers
// three steps that perform the real thing in the real reader (open a book, select a sentence and keep it, change how the page
// looks); each step is ticked when the visitor actually does it. A small "Guide" button stays on screen, and the same dialog
// lists the other tools with a button that opens each one. Everything here only clicks the reader's own buttons.
(() => {
  'use strict';
  const demo = window.LibReadDemo;
  if (!demo) return;
  const KEY = demo.prefix + 'guide';
  const $ = (id) => document.getElementById(id);
  const english = (() => { try { return localStorage.getItem('uiLang') === 'en'; } catch { return false; } })();
  const T = english ? {
    guide: 'Guide', note: 'Demo · your notes stay in this browser', reset: 'Reset demo', confirm: 'Delete the notes, favourites and progress of this demo?', account: 'Open an account',
    title: 'Try LibRead in three steps', intro: 'This is the real reader, with two NASA books. Your notes stay in this browser; no account is needed.',
    steps: [
      ['Open a book', 'Earth at Night opens on a real NASA photograph; Earth as Art opens as a PDF.', 'Open Earth at Night'],
      ['Keep a sentence', 'Select text: the bar that appears lets you highlight, copy, cite or write a note.', 'Show me'],
      ['Make it comfortable', 'Theme, typeface, size, line spacing and text width are in one menu.', 'Open the Appearance menu'],
    ],
    toolsTitle: 'And while you read',
    tools: [
      ['Contents and search', 'Chapters, and a search through the whole book.', 'Search'],
      ['Bookmarks', 'Mark a place and come back to it.', 'Bookmarks'],
      ['Notes and export', 'Your notes in one list; export them as Markdown or JSON.', 'Notes'],
      ['Read aloud', 'The book read to you, sentence by sentence (needs a voice on this device).', 'Try it'],
      ['Cite and book details', 'Copy a citation, see the record of the book.', 'More menu'],
    ],
    close: 'Close', done: 'Done', left: 'steps done', hint: 'Choose Highlight or Note in the bar to keep this sentence.',
    stepDone: (n) => `Step done · ${n}/3`, allDone: 'All three steps done. Open an account to read your own books.', opening: 'Opening the book…',
  } : {
    guide: 'Rehber', note: 'Demo · notlarınız yalnız bu tarayıcıda', reset: 'Demoyu sıfırla', confirm: 'Bu demodaki notlar, favoriler ve ilerleme silinsin mi?', account: 'Hesap aç',
    title: 'LibRead\'i üç adımda deneyin', intro: 'Gerçek okuyucunun kendisindesiniz, iki NASA kitabıyla. Notlarınız yalnız bu tarayıcıda kalır; hesap gerekmez.',
    steps: [
      ['Bir kitap açın', 'Earth at Night gerçek bir NASA fotoğrafıyla açılır; Earth as Art PDF olarak.', 'Earth at Night\'ı aç'],
      ['Bir cümleyi kendinize ayırın', 'Metni seçin: çıkan çubukla vurgulayabilir, kopyalayabilir, atıf yapabilir ya da not yazabilirsiniz.', 'Bana göster'],
      ['Okuma rahatınızı bulun', 'Tema, yazı tipi, boyut, satır aralığı ve metin genişliği tek menüde.', 'Görünüm menüsünü aç'],
    ],
    toolsTitle: 'Okurken ayrıca',
    tools: [
      ['İçindekiler ve arama', 'Bölümler ve kitabın tamamında arama.', 'Ara'],
      ['Yer imleri', 'Bir yeri işaretleyin, sonra dönün.', 'Yer imleri'],
      ['Notlar ve dışa aktarma', 'Notlarınız tek listede; Markdown veya JSON olarak dışa aktarın.', 'Notlar'],
      ['Sesli okuma', 'Kitap size cümle cümle okunur (bu cihazda bir ses gerekir).', 'Dene'],
      ['Atıf ve kitap bilgisi', 'Atıf kopyalayın, kitabın künyesine bakın.', 'Diğer menüsü'],
    ],
    close: 'Kapat', done: 'Tamam', left: 'adım tamam', hint: 'Bu cümleyi saklamak için çubuktan Vurgula ya da Not\'u seçin.',
    stepDone: (n) => `Adım tamam · ${n}/3`, allDone: 'Üç adım da tamam. Kendi kitaplarınız için hesap açabilirsiniz.', opening: 'Kitap açılıyor…',
  };
  const STEPS = ['open', 'note', 'look'];

  // ---- progress, kept in this browser ------------------------------------------------------------------------------------
  let progress = { welcomed: false, open: false, note: false, look: false };
  try { Object.assign(progress, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* storage closed: this visit only */ }
  const store = () => { try { localStorage.setItem(KEY, JSON.stringify(progress)); } catch { /* ignore */ } };
  const count = () => STEPS.filter((step) => progress[step]).length;

  // ---- the page ---------------------------------------------------------------------------------------------------------
  const style = document.createElement('style');
  style.textContent = `
    .demo-pill { position: fixed; right: 12px; bottom: 12px; z-index: 55; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; max-width: calc(100vw - 24px);
      padding: 6px 12px; border: 1px solid #c9d3e6; border-radius: 999px; background: #fff; color: #2e4484; font: 12px/1.4 system-ui, sans-serif; box-shadow: 0 4px 18px rgba(20, 30, 60, .12); }
    .demo-pill button, .demo-pill a { all: unset; cursor: pointer; color: #2e4484; text-decoration: underline; text-underline-offset: 2px; font: inherit; }
    .demo-pill .demo-guide-open { padding: 3px 10px; border-radius: 999px; background: #2e4484; color: #fff; text-decoration: none; font-weight: 600; }
    .demo-pill button:focus-visible, .demo-pill a:focus-visible { outline: 2px solid #3b6fc4; outline-offset: 2px; }
    body:has(#reader:not([hidden])) .demo-pill { bottom: 66px; padding: 4px; border-radius: 999px; }
    body:has(#reader:not([hidden])) .demo-pill > :not(.demo-guide-open) { display: none; }
    body:has(dialog[open]) .demo-pill { display: none; }
    .demo-toast { position: fixed; left: 50%; bottom: 72px; transform: translateX(-50%); z-index: 70; max-width: min(92vw, 460px); padding: 9px 16px; border-radius: 10px;
      background: #20304f; color: #fff; font: 13px/1.45 system-ui, sans-serif; box-shadow: 0 6px 24px rgba(10, 20, 40, .3); }
    .demo-toast[hidden] { display: none; }
    dialog.demo-guide { width: min(560px, calc(100vw - 24px)); max-height: calc(100vh - 24px); padding: 0; border: 0; border-radius: 12px; background: #fff; color: #1d2433;
      box-shadow: 0 20px 70px rgba(10, 20, 40, .35); font: 14px/1.5 system-ui, sans-serif; overflow: auto; }
    dialog.demo-guide::backdrop { background: rgba(20, 30, 50, .45); }
    .demo-guide-body { padding: 22px 24px 20px; }
    .demo-guide h2 { margin: 0 0 6px; font: 600 22px/1.25 Georgia, 'Times New Roman', serif; }
    .demo-guide p { margin: 0; color: #4a5470; }
    .demo-guide ol, .demo-guide ul { list-style: none; margin: 16px 0 0; padding: 0; display: grid; gap: 10px; }
    .demo-guide li { display: grid; grid-template-columns: 30px 1fr auto; gap: 4px 12px; align-items: center; padding: 10px 12px; border: 1px solid #e1e6f0; border-radius: 10px; }
    .demo-guide .mark { grid-row: span 2; display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: #edf1fb; color: #2e4484; font-weight: 700; }
    .demo-guide li.done .mark { background: #dff3e6; color: #1f6b3d; }
    .demo-guide li.done { border-color: #bfe3cb; }
    .demo-guide strong { display: block; font-weight: 600; }
    .demo-guide li span.text { grid-column: 2; color: #4a5470; font-size: 13px; }
    .demo-guide li button { grid-column: 3; grid-row: 1 / span 2; font: inherit; font-size: 13px; padding: 7px 12px; border: 1px solid #2e4484; border-radius: 8px; background: #fff; color: #2e4484; cursor: pointer; }
    .demo-guide ol li button { background: #2e4484; color: #fff; }
    .demo-guide li.done button { background: #fff; color: #2e4484; }
    .demo-guide button:focus-visible { outline: 2px solid #3b6fc4; outline-offset: 2px; }
    .demo-guide h3 { margin: 20px 0 0; font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: #5c6880; }
    .demo-guide .foot { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 18px; }
    .demo-guide .foot button { font: inherit; padding: 8px 16px; border: 0; border-radius: 8px; background: #2e4484; color: #fff; cursor: pointer; }
    .demo-guide .foot span { color: #5c6880; font-size: 13px; }
    @media (max-width: 560px) { body:has(#reader:not([hidden])) .demo-pill { bottom: 126px; } body:has(#reader:not([hidden])) .demo-toast { bottom: 170px; } }
    @media (max-width: 480px) { .demo-guide li { grid-template-columns: 28px 1fr; } .demo-guide li button { grid-column: 2; grid-row: auto; justify-self: start; } }
  `;
  document.head.appendChild(style);

  // the notice
  const pill = document.createElement('div');
  pill.className = 'demo-pill';
  pill.setAttribute('role', 'note');
  const guideButton = document.createElement('button');
  guideButton.type = 'button';
  guideButton.className = 'demo-guide-open';
  const label = document.createElement('span');
  label.textContent = T.note;
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.textContent = T.reset;
  reset.addEventListener('click', () => { if (window.confirm(T.confirm)) demo.reset(); });
  const account = document.createElement('a');
  account.href = '/auth/libedge/start?ctx=individual';
  account.textContent = T.account;
  pill.append(guideButton, label, reset, account);
  document.body.appendChild(pill);

  const toast = document.createElement('div');
  toast.className = 'demo-toast';
  toast.setAttribute('role', 'status');
  toast.hidden = true;
  document.body.appendChild(toast);
  let toastTimer;
  const say = (text, ms = 6000) => { toast.textContent = text; toast.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, ms); };

  // ---- the dialog -------------------------------------------------------------------------------------------------------
  const dialog = document.createElement('dialog');
  dialog.className = 'demo-guide';
  dialog.setAttribute('aria-labelledby', 'demoGuideTitle');
  const body = document.createElement('div');
  body.className = 'demo-guide-body';
  dialog.appendChild(body);
  document.body.appendChild(dialog);

  const readerOpen = () => { const reader = $('reader'); return Boolean(reader) && !reader.hidden; };
  const waitFor = (test, ms = 15000) => new Promise((resolve) => {
    const started = Date.now();
    const tick = () => { let ok = false; try { ok = test(); } catch { ok = false; } if (ok) resolve(true); else if (Date.now() - started > ms) resolve(false); else setTimeout(tick, 150); };
    tick();
  });
  const frameDoc = () => { try { return document.querySelector('#epubView iframe')?.contentDocument || null; } catch { return null; } };
  const bookReady = () => readerOpen() && ($('reader').classList.contains('epub-mode')
    ? Boolean(frameDoc()?.body?.textContent?.trim().length)
    : Boolean(document.querySelector('#textLayer span')));

  // run `action` with a book open: opens Earth at Night when none is
  async function withBook(action) {
    if (!readerOpen()) {
      const card = [...document.querySelectorAll('#grid .card')].find((item) => item.textContent.includes('Earth at Night'));
      const open = card?.querySelector('.open-btn');
      if (!open) return;
      say(T.opening, 4000);
      open.click();
      if (!await waitFor(bookReady)) return;
    } else if (!await waitFor(bookReady)) return;
    action();
  }

  function selectSentence() {
    const reader = $('reader');
    if (reader.classList.contains('epub-mode')) {
      const doc = frameDoc();
      if (!doc) return;
      const view = $('epubView').getBoundingClientRect().width;
      const paragraph = [...doc.querySelectorAll('p')].find((item) => item.textContent.trim().length > 80 && item.getBoundingClientRect().left >= 0 && item.getBoundingClientRect().left < view - 80);
      const walker = paragraph && doc.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
      const node = walker?.nextNode();
      if (!node) return;
      const value = node.nodeValue;
      const start = value.search(/\S/);
      const stop = value.slice(start).search(/[.!?](\s|$)/);
      const range = doc.createRange();
      range.setStart(node, Math.max(0, start));
      range.setEnd(node, stop > 0 ? Math.min(value.length, start + stop + 1) : Math.min(value.length, start + 120));
      const selection = doc.defaultView.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      paragraph.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    } else {
      const span = [...document.querySelectorAll('#textLayer span')].find((item) => item.textContent.trim().length > 24 && item.getBoundingClientRect().width > 0);
      if (!span) return;
      const range = document.createRange();
      range.selectNodeContents(span);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
      span.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    }
    say(T.hint, 9000);
  }

  const openMenu = (summaryId) => { const details = $(summaryId)?.closest('details'); if (details) details.open = true; };
  const click = (id) => () => { $(id)?.click(); };

  const actions = {
    open: () => { const card = [...document.querySelectorAll('#grid .card')].find((item) => item.textContent.includes('Earth at Night')); if (!readerOpen()) card?.querySelector('.open-btn')?.click(); },
    note: () => withBook(selectSentence),
    look: () => withBook(() => openMenu('themeBtn')),
  };
  const toolActions = [
    () => withBook(click('railSearch')),
    () => withBook(click('railBookmarks')),
    () => withBook(click('toggleNotes')),
    () => withBook(click('raBtn')),
    () => withBook(() => openMenu('moreMenuBtn')),
  ];

  function render() {
    body.replaceChildren();
    const title = document.createElement('h2');
    title.id = 'demoGuideTitle';
    title.textContent = T.title;
    const intro = document.createElement('p');
    intro.textContent = T.intro;
    body.append(title, intro);

    const steps = document.createElement('ol');
    T.steps.forEach(([name, text, button], index) => {
      const key = STEPS[index];
      const item = document.createElement('li');
      item.className = progress[key] ? 'done' : '';
      const mark = document.createElement('span');
      mark.className = 'mark';
      mark.textContent = progress[key] ? '✓' : String(index + 1);
      mark.setAttribute('aria-hidden', 'true');
      const strong = document.createElement('strong');
      strong.textContent = name;
      const detail = document.createElement('span');
      detail.className = 'text';
      detail.textContent = text;
      const go = document.createElement('button');
      go.type = 'button';
      go.textContent = button;
      go.dataset.step = key;
      go.addEventListener('click', () => { dialog.close(); actions[key](); });
      item.append(mark, strong, go, detail);
      steps.appendChild(item);
    });
    body.appendChild(steps);

    const heading = document.createElement('h3');
    heading.textContent = T.toolsTitle;
    const tools = document.createElement('ul');
    T.tools.forEach(([name, text, button], index) => {
      if (index === 3 && $('raBtn')?.hidden) return; // no speech on this device
      const item = document.createElement('li');
      const mark = document.createElement('span');
      mark.className = 'mark';
      mark.textContent = '•';
      mark.setAttribute('aria-hidden', 'true');
      const strong = document.createElement('strong');
      strong.textContent = name;
      const detail = document.createElement('span');
      detail.className = 'text';
      detail.textContent = text;
      const go = document.createElement('button');
      go.type = 'button';
      go.textContent = button;
      go.addEventListener('click', () => { dialog.close(); toolActions[index](); });
      item.append(mark, strong, go, detail);
      tools.appendChild(item);
    });
    body.append(heading, tools);

    const foot = document.createElement('div');
    foot.className = 'foot';
    const left = document.createElement('span');
    left.textContent = `${count()} / 3 ${T.left}`;
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = count() === 3 ? T.done : T.close;
    close.addEventListener('click', () => dialog.close());
    foot.append(left, close);
    body.appendChild(foot);
  }

  function showGuide() {
    if (dialog.open) return;
    render();
    dialog.showModal();
    progress.welcomed = true;
    store();
  }
  guideButton.addEventListener('click', showGuide);
  const paintButton = () => { guideButton.textContent = `${T.guide} ${count()}/3`; guideButton.setAttribute('aria-label', `${T.guide}: ${count()} / 3 ${T.left}`); };
  paintButton();

  // ---- the steps tick when the visitor really does them -----------------------------------------------------------------
  function mark(step) {
    if (progress[step]) return;
    progress[step] = true;
    store();
    paintButton();
    say(count() === 3 ? T.allDone : T.stepDone(count()), count() === 3 ? 9000 : 4000);
  }
  const reader = $('reader');
  if (reader) {
    if (!reader.hidden) mark('open');
    new MutationObserver(() => { if (!reader.hidden) mark('open'); }).observe(reader, { attributes: true, attributeFilter: ['hidden'] });
  }
  window.addEventListener('libread-demo:annotation', () => mark('note'));
  const inAppearance = (target) => Boolean(target?.closest?.('.reader-menu-panel') && target.closest('details')?.querySelector('#themeBtn'));
  document.addEventListener('change', (event) => { if (inAppearance(event.target)) mark('look'); });
  document.addEventListener('input', (event) => { if (inAppearance(event.target)) mark('look'); });
  document.addEventListener('click', (event) => { if (event.target.closest?.('#epubTypeReset')) mark('look'); });

  // first visit: say what this is, once the library is on screen (not when the reader was restored from the address)
  if (!progress.welcomed && !readerOpen()) setTimeout(() => { if (!readerOpen()) showGuide(); }, 700);
})();
