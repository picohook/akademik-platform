import { EpubEngine } from '/epub-engine.mjs';

const viewer = document.getElementById('viewer');
const tocEl = document.getElementById('toc');
const resultsEl = document.getElementById('results');
const searchEl = document.getElementById('search');
const statusEl = document.getElementById('status');

let fontSize = 100;
const engine = new EpubEngine(viewer, {
  onRelocated(progress) {
    statusEl.textContent = progress.cfi
      ? `${progress.percent}% · ${progress.cfi.slice(0, 42)}…`
      : 'konum alınıyor…';
  },
});

window.epubEngine = engine;

document.getElementById('prev').addEventListener('click', () => engine.prev());
document.getElementById('next').addEventListener('click', () => engine.next());
document.getElementById('fontSmall').addEventListener('click', () => {
  fontSize = Math.max(70, fontSize - 10);
  engine.setFontSize(fontSize);
});
document.getElementById('fontBig').addEventListener('click', () => {
  fontSize = Math.min(200, fontSize + 10);
  engine.setFontSize(fontSize);
});

document.querySelectorAll('[data-theme]').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('[data-theme]').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    engine.setTheme(button.dataset.theme);
  });
});

searchEl.addEventListener('keydown', async (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  resultsEl.replaceChildren();
  const query = searchEl.value.trim();
  if (!query) return;
  const results = await engine.search(query, { limit: 20 });
  if (!results.length) {
    resultsEl.textContent = 'Sonuç yok.';
    return;
  }
  results.forEach((result) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'result';
    button.textContent = result.snippet;
    const href = document.createElement('small');
    href.textContent = result.href;
    button.appendChild(href);
    button.addEventListener('click', () => engine.goToHref(result.href));
    resultsEl.appendChild(button);
  });
});

try {
  await engine.open('/seed/sample.epub');
  engine.setTheme('light');
  engine.setFontSize(fontSize);
  engine.getToc().forEach((item) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toc-item';
    button.style.paddingLeft = `${8 + item.level * 12}px`;
    button.textContent = item.label || item.href;
    button.addEventListener('click', () => engine.goToHref(item.href));
    tocEl.appendChild(button);
  });
  statusEl.textContent = 'hazır';
} catch (error) {
  console.error(error);
  statusEl.textContent = `yüklenemedi: ${error.message}`;
}
