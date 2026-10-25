function language(value) {
  const clean = String(value || '').trim();
  const normalized = ({ eng: 'en', tur: 'tr', ara: 'ar', deu: 'de', fra: 'fr' })[clean.toLowerCase()] || clean;
  return /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(normalized) ? normalized : '';
}
function sourceLanguage(element) {
  for (let current = element; current; current = current.parentElement) {
    const lang = language(current.getAttribute('lang') || current.getAttribute('xml:lang'));
    if (lang) return lang;
  }
  return '';
}
function box(element) {
  const match = /\bbbox\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)/.exec(element?.getAttribute('title') || '');
  const rect = match ? match.slice(1).map(Number) : null;
  return rect?.every(Number.isFinite) ? rect : null;
}

// Preserve only the supplied hOCR word/paragraph order and language. This does
// not infer headings, column order, image descriptions or OCR correctness.
export function renderHocrText(hocr, viewport, container) {
  if (typeof hocr !== 'string' || hocr.length > 20 * 1024 * 1024) return false;
  const doc = new DOMParser().parseFromString(hocr, 'text/html');
  const page = doc.querySelector('.ocr_page'), bounds = box(page);
  if (!bounds || bounds[2] <= bounds[0] || bounds[3] <= bounds[1]) return false;
  const scale = viewport.width / (bounds[2] - bounds[0]);
  if (!Number.isFinite(scale) || scale <= 0) return false;
  const words = [...page.querySelectorAll('.ocrx_word')];
  if (!words.length || words.length > 100000) return false;
  const fragment = container.ownerDocument.createDocumentFragment(), paragraphs = new Map();
  for (const word of words) {
    const rect = box(word), text = (word.textContent || '').trim();
    if (!rect || !text || rect[2] <= rect[0] || rect[3] <= rect[1]) continue;
    const height = (rect[3] - rect[1]) * scale;
    const span = container.ownerDocument.createElement('span');
    span.className = 'ocr-word';
    span.textContent = `${text} `;
    const lang = sourceLanguage(word);
    if (lang) span.lang = lang;
    Object.assign(span.style, {
      position: 'absolute', left: `${(rect[0] - bounds[0]) * scale}px`, top: `${(rect[1] - bounds[1]) * scale}px`,
      width: `${(rect[2] - rect[0]) * scale}px`, height: `${height}px`, fontSize: `${height}px`,
      lineHeight: '1', whiteSpace: 'pre', overflow: 'hidden', color: 'transparent', transformOrigin: '0 0',
    });
    const paragraph = word.closest('.ocr_par');
    let target = fragment;
    if (paragraph) {
      if (!paragraphs.has(paragraph)) {
        const group = container.ownerDocument.createElement('div');
        group.className = 'ocr-paragraph';
        group.setAttribute('role', 'paragraph');
        const lang = sourceLanguage(paragraph);
        if (lang) group.lang = lang;
        paragraphs.set(paragraph, group);
        fragment.append(group);
      }
      target = paragraphs.get(paragraph);
    }
    target.append(span, container.ownerDocument.createTextNode(' '));
  }
  if (!fragment.childNodes.length) return false;
  const lang = sourceLanguage(page);
  if (lang) container.lang = lang;
  container.append(fragment);
  return true;
}
