// Connect the source PDF structure tree to PDF.js's actual selectable text.
// aria-owns follows the PDF.js viewer's structure-layer approach. Never copy
// text into a second hidden document or infer structure from font/coordinates.
let layerSerial = 0;
const roles = new Map(Object.entries({
  Part: 'group', Sect: 'group', Div: 'group', Aside: 'note',
  P: 'paragraph', FENote: 'note', Sub: 'group', Annot: 'note',
  L: 'list', LI: 'listitem', Table: 'table', TR: 'row',
  TH: 'columnheader', TD: 'cell', THead: 'rowgroup', TBody: 'rowgroup',
  TFoot: 'rowgroup', Figure: 'figure',
}));

export function buildPdfStructure(tree, textLayer) {
  if (!tree || !Array.isArray(tree.children)) return null;
  const doc = textLayer.ownerDocument;
  const prefix = `pdf-mc-${++layerSerial}-`;
  const content = new Map();
  for (const [index, span] of [...textLayer.querySelectorAll('.markedContent[id]')].entries()) {
    const original = span.id;
    span.id = `${prefix}${index}`;
    // Ambiguous source IDs must not steal unrelated text in another page.
    content.set(original, content.has(original) ? null : span.id);
  }
  const claimed = new Set();
  let remaining = 10000;
  function walk(node, depth = 0) {
    if (!node || depth > 100 || --remaining < 0) return null;
    if (node.type === 'content') {
      const id = content.get(node.id);
      if (!id || claimed.has(id)) return null;
      claimed.add(id);
      const element = doc.createElement('span');
      element.setAttribute('aria-owns', id);
      return element;
    }
    if (!Array.isArray(node.children)) return null;
    const element = doc.createElement('span');
    const heading = /^H([1-9]\d*)$/.exec(node.role || '');
    const role = heading ? 'heading' : roles.get(node.role);
    if (role) element.setAttribute('role', role);
    if (heading) element.setAttribute('aria-level', heading[1]);
    const alt = typeof node.alt === 'string' ? node.alt.replaceAll('\0', '').trim() : '';
    const lang = typeof node.lang === 'string' ? node.lang.replaceAll('\0', '').trim() : '';
    if (alt) element.setAttribute('aria-label', alt);
    // PDF Formula supplies a textual alternative, not MathML. role=math would
    // make NVDA/MathCAT try to parse non-existent markup ("Invalid math"). An
    // atomic alternative conveys the source description without inventing a
    // navigable mathematical expression. Unlabelled formulas keep real text.
    if (node.role === 'Formula') {
      element.dataset.pdfRole = 'Formula';
      element.setAttribute('role', alt ? 'img' : 'group');
    }
    if (lang) element.setAttribute('lang', lang);
    for (const child of node.children) {
      const rendered = walk(child, depth + 1);
      if (rendered) element.append(rendered);
    }
    // Keep meaningful source alternatives even if a figure has no text spans.
    // Missing content/annotation references never become broken aria-owns.
    if (!element.childNodes.length && !alt) return null;
    return element;
  }
  const root = walk(tree);
  if (!root) return null;
  root.classList.add('pdf-structure');
  return root;
}
