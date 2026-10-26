// Book-provided actions are untrusted; support navigation, never script/file actions.
export function safeBookUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  if (Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return null;
  const raw = value.trim();
  try {
    const url = new URL(raw.startsWith('//') ? `https:${raw}` : raw);
    if (!['https:', 'http:', 'mailto:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

export async function destinationPage(pdf, dest) {
  try {
    const explicit = typeof dest === 'string' ? await pdf.getDestination(dest) : dest;
    if (!Array.isArray(explicit) || explicit.length < 1) return null;
    const target = explicit[0];
    const index = Number.isInteger(target) ? target
      : target && typeof target === 'object' ? await pdf.getPageIndex(target) : -1;
    return Number.isInteger(index) && index >= 0 && index < pdf.numPages ? index + 1 : null;
  } catch { return null; }
}

export function annotationBox(rect, viewport) {
  if (!rect || rect.length !== 4 || !Array.from(rect).every(Number.isFinite)) return null;
  const points = viewport.convertToViewportRectangle(Array.from(rect));
  if (!points.every(Number.isFinite)) return null;
  const left = Math.max(0, Math.min(points[0], points[2]));
  const top = Math.max(0, Math.min(points[1], points[3]));
  const right = Math.min(viewport.width, Math.max(points[0], points[2]));
  const bottom = Math.min(viewport.height, Math.max(points[1], points[3]));
  return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : null;
}

export async function renderPdfLinks({ page, pdf, viewport, container, isCurrent, onNavigate,
  labels = { group: 'Sayfa bağlantıları', external: 'Bağlantıyı yeni sekmede aç', internal: 'Kitap içi bağlantıyı aç' } }) {
  const annotations = await page.getAnnotations({ intent: 'display' });
  if (!isCurrent()) return;
  const layer = container.ownerDocument.createElement('div');
  layer.className = 'pdf-link-layer';
  layer.setAttribute('role', 'group');
  layer.setAttribute('aria-label', labels.group);
  for (const annotation of annotations) {
    if (annotation.subtype !== 'Link') continue;
    const box = annotationBox(annotation.rect, viewport);
    if (!box) continue;
    const url = safeBookUrl(annotation.url);
    const hasDest = typeof annotation.dest === 'string' || Array.isArray(annotation.dest);
    if (!url && !hasDest) continue;
    const node = container.ownerDocument.createElement(url ? 'a' : 'button');
    node.className = 'pdf-link';
    Object.assign(node.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
    if (url) {
      node.href = url;
      node.target = '_blank';
      node.rel = 'noopener noreferrer';
      node.referrerPolicy = 'no-referrer';
      node.title = `${labels.external}: ${url}`;
    } else {
      node.type = 'button';
      node.title = labels.internal;
      node.addEventListener('click', async event => {
        event.preventDefault();
        if (!isCurrent()) return;
        const target = await destinationPage(pdf, annotation.dest);
        if (isCurrent() && target !== null) {
          try { await onNavigate(target); }
          catch (error) { console.warn('PDF link navigation failed:', error.message); }
        }
      });
    }
    node.setAttribute('aria-label', node.title);
    layer.appendChild(node);
  }
  if (!isCurrent()) return;
  container.querySelector('.pdf-link-layer')?.remove();
  if (layer.childElementCount) container.appendChild(layer);
}

// Keep relative chapter/fragment links with epub.js; open external links in the parent.
export function bindEpubLinks(doc, onExternal) {
  const handle = event => {
    if (event.type === 'auxclick' && event.button !== 1) return;
    const target = event.target?.nodeType === 3 ? event.target.parentElement : event.target;
    const anchor = target?.closest?.('a[href]');
    if (!anchor) return;
    const href = anchor.getAttribute('href')?.trim() || '';
    if (!href) return;
    const external = safeBookUrl(href);
    const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//');
    const hasControls = Array.from(href).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
    if (!external && !hasScheme && !hasControls) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (external) onExternal(external);
  };
  doc.addEventListener('click', handle, true);
  doc.addEventListener('auxclick', handle, true);
  return () => {
    doc.removeEventListener('click', handle, true);
    doc.removeEventListener('auxclick', handle, true);
  };
}
