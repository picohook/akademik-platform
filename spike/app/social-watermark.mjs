import JSZip from 'jszip';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

function stampLines(auth) {
  const identity = (key) => {
    const value = typeof auth?.[key] === 'string' ? auth[key].trim() : '';
    if (!value || value.length > 2048 || /[\u0000-\u001f\u007f]/u.test(value)) {
      throw new Error(`Cannot watermark download: invalid ${key}`);
    }
    return value;
  };
  return [
    `Akademik Platform | UTC: ${new Date().toISOString()}`,
    `User: ${identity('userId')}`,
    `Tenant: ${identity('tenantId')}`,
    `Email: ${identity('email')}`,
  ];
}

// Helvetica/WinAnsi cannot encode arbitrary Unicode. Keep every identity byte
// identifiable through ASCII Unicode escapes instead of replacing it with '?'.
function pdfSafeText(value) {
  return Array.from(value, (char) => {
    const code = char.codePointAt(0);
    return code >= 32 && code <= 126 ? char : `\\u{${code.toString(16).toUpperCase()}}`;
  }).join('');
}

function wrapLine(value, font, size, width) {
  const lines = [];
  let line = '';
  for (const char of value) {
    if (font.widthOfTextAtSize(line + char, size) > width) {
      if (!line) throw new Error('PDF page is too narrow for a readable watermark');
      lines.push(line);
      line = char;
    } else {
      line += char;
    }
  }
  if (line) lines.push(line);
  return lines;
}

async function watermarkPdf(buffer, lines) {
  // Never ignore encryption: downloading an original on stamping failure would
  // bypass the social-DRM policy.
  const pdf = await PDFDocument.load(buffer, { updateMetadata: false });
  if (pdf.isEncrypted || pdf.getPageCount() === 0) throw new Error('PDF cannot be watermarked');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const textLines = lines.map(pdfSafeText);
  for (const page of pdf.getPages()) {
    const { x, y, width, height } = page.getCropBox();
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
      throw new Error('Invalid PDF page dimensions');
    }
    const margin = Math.min(18, width * 0.04, height * 0.04);
    const availableWidth = width - 2 * margin;
    let layout = null;
    for (let size = 8; size >= 5; size -= 0.5) {
      const wrapped = textLines.flatMap(line => wrapLine(line, font, size, availableWidth));
      const lineHeight = size * 1.25;
      if ((wrapped.length + 1) * lineHeight <= height - 2 * margin) {
        layout = { wrapped, size, lineHeight };
        break;
      }
    }
    if (!layout) throw new Error('PDF page is too small for a readable watermark');
    const { wrapped, size, lineHeight } = layout;
    wrapped.forEach((line, index) => page.drawText(line, {
      x: x + margin,
      y: y + margin + (wrapped.length - index - 1) * lineHeight,
      size, font, color: rgb(0.2, 0.2, 0.2), opacity: 0.28,
    }));
  }
  return Buffer.from(await pdf.save({ addDefaultPage: false }));
}

function escapeMarkup(value) {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

const CONTAINER_NS = 'urn:oasis:names:tc:opendocument:xmlns:container';
const OPF_NS = 'http://www.idpf.org/2007/opf';
const XHTML_NS = 'http://www.w3.org/1999/xhtml';
const XHTML_MEDIA = new Set(['application/xhtml+xml', 'text/html']);
const XML_NAME = '(?:[A-Za-z_][A-Za-z0-9_.-]*:)?[A-Za-z_][A-Za-z0-9_.-]*';

function invalidPackage(reason) {
  throw new Error(`Invalid EPUB package: ${reason}`);
}

function xmlValue(value) {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(value)) invalidPackage('invalid XML character');
  return value.replace(/&([^;]*);|&/g, (entity, name) => {
    const predefined = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (Object.hasOwn(predefined, name)) return predefined[name];
    if (/^#(?:[0-9]+|x[0-9A-Fa-f]+)$/.test(name || '')) {
      const code = name[1] === 'x' ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
      if (code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) && code !== 0xfffe && code !== 0xffff)) return String.fromCodePoint(code);
    }
    return invalidPackage('unsupported XML entity');
  });
}

// A deliberately restricted metadata XML parser: no DTDs, entity declarations,
// recovery, external resources, or ambiguous attributes. Unknown namespaces are
// retained so foreign elements cannot masquerade as OPF/container elements.
function packageXml(source, { document = false, html = false } = {}) {
  if (!document && source.length > 2 * 1024 * 1024) invalidPackage('metadata too large');
  const text = source.replace(/^\ufeff/, '');
  const stack = [];
  let root = null;
  let offset = 0;
  const appendText = (value, cdata = false) => {
    const decoded = cdata ? value : xmlValue(value);
    if (!stack.length) {
      if (decoded.trim()) invalidPackage('text outside XML root');
    } else stack.at(-1).text += decoded;
  };
  while (offset < text.length) {
    const start = text.indexOf('<', offset);
    if (start < 0) { appendText(text.slice(offset)); break; }
    appendText(text.slice(offset, start));
    if (text.startsWith('<!--', start)) {
      const end = text.indexOf('-->', start + 4);
      if (end < 0 || text.slice(start + 4, end).includes('--')) invalidPackage('malformed XML comment');
      offset = end + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', start)) {
      const end = text.indexOf(']]>', start + 9);
      if (end < 0 || !stack.length) invalidPackage('malformed XML CDATA');
      appendText(text.slice(start + 9, end), true);
      offset = end + 3;
      continue;
    }
    if (text.startsWith('<?', start)) {
      const end = text.indexOf('?>', start + 2);
      if (end < 0) invalidPackage('malformed XML processing instruction');
      offset = end + 2;
      continue;
    }
    if (document && /^<!DOCTYPE\s/i.test(text.slice(start))) {
      // Recognize a simple external/public HTML doctype without fetching it.
      // Internal subsets/entity declarations remain unsupported and fail closed.
      const declaration = text.slice(start).match(/^<!DOCTYPE\s+html(?:\s+(?:PUBLIC\s+(?:"[^"]*"|'[^']*')\s+(?:"[^"]*"|'[^']*')|SYSTEM\s+(?:"[^"]*"|'[^']*')))?\s*>/i);
      if (!declaration || root || stack.length) invalidPackage('unsupported document doctype');
      offset = start + declaration[0].length;
      continue;
    }
    if (text.startsWith('<!', start)) invalidPackage('XML declarations/DTDs are unsupported');
    let end = start + 1;
    let quote = '';
    for (; end < text.length; end++) {
      const char = text[end];
      if (quote) { if (char === quote) quote = ''; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === '>') break;
      else if (char === '<') invalidPackage('malformed XML tag');
    }
    if (end >= text.length || quote) invalidPackage('unterminated XML tag');
    const token = text.slice(start, end + 1);
    offset = end + 1;
    if (token.startsWith('</')) {
      const closing = token.match(new RegExp(`^</(${XML_NAME})\\s*>$`));
      if (!closing || stack.pop()?.name !== closing[1]) invalidPackage('mismatched XML closing tag');
      continue;
    }
    const opening = token.match(new RegExp(`^<(${XML_NAME})([\\s\\S]*?)(/?)>$`));
    if (!opening) invalidPackage('malformed XML opening tag');
    const [, name, attrSource, selfClosing] = opening;
    const attrs = new Map();
    const attribute = new RegExp(`\\s+(${XML_NAME})\\s*=\\s*(?:"([^"<]*)"|'([^'<]*)')`, 'y');
    let attrOffset = 0;
    while (attrOffset < attrSource.length) {
      if (!attrSource.slice(attrOffset).trim()) break;
      attribute.lastIndex = attrOffset;
      const match = attribute.exec(attrSource);
      if (!match || attrs.has(match[1])) invalidPackage('malformed or duplicate XML attribute');
      attrs.set(match[1], xmlValue(match[2] ?? match[3]));
      attrOffset = attribute.lastIndex;
    }
    const namespaces = new Map(stack.at(-1)?.namespaces || [['xml', 'http://www.w3.org/XML/1998/namespace']]);
    for (const [key, value] of attrs) {
      if (key === 'xmlns') namespaces.set('', value);
      else if (key.startsWith('xmlns:')) namespaces.set(key.slice(6), value);
      if (key === 'xml:base') invalidPackage('xml:base is unsupported');
    }
    const parts = name.split(':');
    const prefix = parts.length > 1 ? parts[0] : '';
    if (prefix && !namespaces.has(prefix)) invalidPackage('undeclared XML namespace');
    const expandedAttrs = new Set();
    for (const key of attrs.keys()) {
      if (key === 'xmlns' || key.startsWith('xmlns:')) continue;
      const split = key.split(':');
      if (split.length > 1 && !namespaces.has(split[0])) invalidPackage('undeclared attribute namespace');
      const expanded = `${split.length > 1 ? namespaces.get(split[0]) : ''}|${split.at(-1)}`;
      if (expanded === 'http://www.w3.org/XML/1998/namespace|base') invalidPackage('xml:base is unsupported');
      if (expandedAttrs.has(expanded)) invalidPackage('ambiguous XML attribute');
      expandedAttrs.add(expanded);
    }
    const node = { name, localName: parts.at(-1), namespace: namespaces.get(prefix) || '', attrs, namespaces, children: [], text: '', openingEnd: offset };
    if (stack.length) stack.at(-1).children.push(node);
    else if (root) invalidPackage('multiple XML roots');
    else root = node;
    const htmlVoid = html && ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'].includes(node.localName.toLowerCase());
    if (!selfClosing && !htmlVoid) stack.push(node);
  }
  if (!root || stack.length) invalidPackage('incomplete XML document');
  return root;
}

function bodyOpeningEnd(content, mediaType) {
  const html = mediaType === 'text/html';
  const root = packageXml(content, { document: true, html });
  const nameIs = (node, local) => html ? node.localName.toLowerCase() === local : node.localName === local;
  if (!nameIs(root, 'html') || (root.namespace !== XHTML_NS && !(html && root.namespace === ''))) invalidPackage('document is not HTML/XHTML');
  const bodies = root.children.filter(node => nameIs(node, 'body'));
  if (bodies.length !== 1 || bodies[0].namespace !== root.namespace) invalidPackage('document has no unambiguous HTML body');
  return bodies[0].openingEnd;
}

function resourcePath(href, base = '') {
  if (typeof href !== 'string' || !href || href !== href.trim() || /[\\?#\u0000-\u0020]/u.test(href) || /%2f|%5c/i.test(href)) invalidPackage('unsafe resource href');
  let decoded;
  try { decoded = decodeURIComponent(href); } catch { invalidPackage('malformed resource encoding'); }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:|^[\/\\]|[\\?#\u0000-\u001f]|%[0-9a-f]{2}/i.test(decoded)) invalidPackage('external or ambiguous resource href');
  const segments = decoded.split('/');
  if (segments.some(segment => segment === '')) invalidPackage('ambiguous resource path');
  const resolved = base.split('/').filter(Boolean);
  for (const segment of segments) {
    if (segment === '.') continue;
    if (segment === '..') {
      if (!resolved.length) invalidPackage('resource traversal outside archive');
      resolved.pop();
    } else resolved.push(segment);
  }
  if (!resolved.length) invalidPackage('empty resource path');
  return resolved.join('/');
}

async function spineDocuments(zip) {
  const containerEntry = zip.file('META-INF/container.xml');
  if (!containerEntry) invalidPackage('missing container.xml');
  const container = packageXml(await containerEntry.async('string'));
  if (container.localName !== 'container' || container.namespace !== CONTAINER_NS) invalidPackage('invalid container root');
  const roots = container.children.filter(node => node.localName === 'rootfiles' && node.namespace === CONTAINER_NS);
  const packages = roots.flatMap(node => node.children.filter(child => child.localName === 'rootfile' && child.namespace === CONTAINER_NS));
  if (roots.length !== 1 || packages.length !== 1 || packages[0].attrs.get('media-type') !== 'application/oebps-package+xml') invalidPackage('one unambiguous OPF package is required');
  const opfPath = resourcePath(packages[0].attrs.get('full-path'));
  const opfEntry = zip.file(opfPath);
  if (!opfEntry) invalidPackage('missing OPF package');
  const opf = packageXml(await opfEntry.async('string'));
  if (opf.localName !== 'package' || opf.namespace !== OPF_NS) invalidPackage('invalid OPF root');
  const children = localName => opf.children.filter(node => node.localName === localName && node.namespace === OPF_NS);
  const manifests = children('manifest');
  const spines = children('spine');
  if (manifests.length !== 1 || spines.length !== 1) invalidPackage('one manifest and spine are required');
  for (const metadata of children('metadata')) {
    if (metadata.children.some(node => node.namespace === OPF_NS && node.localName === 'meta'
      && ((node.attrs.get('property') === 'rendition:layout' && node.text.trim() === 'pre-paginated')
        || (node.attrs.get('name') === 'fixed-layout' && node.attrs.get('content') === 'true')))) invalidPackage('fixed-layout spine is unsupported');
  }
  const base = opfPath.slice(0, opfPath.lastIndexOf('/') + 1);
  const items = new Map();
  const paths = new Set();
  for (const node of manifests[0].children) {
    if (node.localName !== 'item' || node.namespace !== OPF_NS) invalidPackage('invalid manifest item');
    const id = node.attrs.get('id');
    const mediaType = node.attrs.get('media-type');
    if (!id || /\s/.test(id) || items.has(id) || !mediaType) invalidPackage('ambiguous manifest item');
    const path = resourcePath(node.attrs.get('href'), base);
    if (paths.has(path) || !zip.file(path)) invalidPackage('duplicate or missing manifest resource');
    paths.add(path);
    items.set(id, { path, mediaType });
  }
  const spinePaths = new Set();
  const documents = new Map();
  for (const node of spines[0].children) {
    if (node.localName !== 'itemref' || node.namespace !== OPF_NS) invalidPackage('invalid spine reference');
    const item = items.get(node.attrs.get('idref'));
    if (!item || spinePaths.has(item.path)) invalidPackage('missing or ambiguous spine resource');
    if (!XHTML_MEDIA.has(item.mediaType)) invalidPackage(`unsupported spine media type: ${item.mediaType}`);
    if ((node.attrs.get('properties') || '').split(/\s+/).includes('rendition:layout-pre-paginated')) invalidPackage('fixed-layout spine is unsupported');
    spinePaths.add(item.path);
  }
  if (!spinePaths.size) invalidPackage('empty spine');
  // Cover nav/other XHTML resources too, regardless of filename extension.
  for (const item of items.values()) if (XHTML_MEDIA.has(item.mediaType)) documents.set(item.path, item.mediaType);
  return { spinePaths, documents };
}

async function watermarkEpub(buffer, lines, { inspectOnly = false } = {}) {
  const source = await JSZip.loadAsync(buffer, { checkCRC32: true });
  if (Object.keys(source.files).some(name => /^META-INF\/encryption\.xml$/i.test(name))) {
    throw new Error('Encrypted EPUB cannot be watermarked');
  }
  if (await source.file('mimetype')?.async('string') !== 'application/epub+zip') {
    throw new Error('Invalid EPUB mimetype');
  }
  const { spinePaths, documents } = await spineDocuments(source);
  const candidates = Object.keys(source.files).filter(name =>
    name !== 'mimetype' && !source.files[name].dir && (documents.has(name) || /\.(?:xhtml|html|htm)$/i.test(name)));
  // Dry run: parse every document exactly as the real stamp would, to surface the
  // first malformed file by name, then stop without rewriting the archive.
  if (inspectOnly) {
    const checked = [];
    for (const name of candidates) {
      try {
        bodyOpeningEnd(await source.file(name).async('string'), documents.get(name) || 'text/html');
      } catch (error) {
        // Name the offending entry: the operator needs the file, not just the offset.
        throw new Error(`${name}: ${error.message}`);
      }
      checked.push(name);
    }
    if (!spinePaths.size) throw new Error('EPUB has no complete stampable spine');
    return { format: 'epub', documents: checked };
  }
  const result = new JSZip();
  // EPUB requires the mimetype entry first and uncompressed, regardless of the
  // ordering/compression used by the uploaded ZIP.
  result.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  result.comment = source.comment;
  const markup = `<div xmlns="http://www.w3.org/1999/xhtml" data-social-watermark="true" style="margin:8px 0;padding:6px;border:1px solid #aaa;background:#fff;color:#333;font:11px/1.4 sans-serif;overflow-wrap:anywhere;direction:ltr;unicode-bidi:isolate">${lines.map(escapeMarkup).join('<br />')}</div>`;
  let stamped = 0;
  for (const [name, entry] of Object.entries(source.files)) {
    if (name === 'mimetype') continue;
    let data = await entry.async('nodebuffer');
    if (!entry.dir && candidates.includes(name)) {
      const content = data.toString('utf8');
      const insertAt = bodyOpeningEnd(content, documents.get(name) || 'text/html');
      data = Buffer.from(content.slice(0, insertAt) + markup + content.slice(insertAt), 'utf8');
      stamped++;
      spinePaths.delete(name);
    }
    result.file(name, data, {
      dir: entry.dir, date: entry.date, comment: entry.comment,
      unixPermissions: entry.unixPermissions, dosPermissions: entry.dosPermissions,
      compression: 'DEFLATE',
    });
  }
  if (!stamped || spinePaths.size) throw new Error('EPUB has no complete stampable spine');
  return result.generateAsync({ type: 'nodebuffer', mimeType: 'application/epub+zip', compression: 'DEFLATE' });
}

export async function watermarkDownload(buffer, format, auth) {
  const lines = stampLines(auth);
  if (format === 'pdf') return watermarkPdf(buffer, lines);
  if (format === 'epub') return watermarkEpub(buffer, lines);
  throw new Error('Unsupported download format');
}

// Dry run for ingest: prove the file can be stamped *before* it is published,
// using the same parse/validate path as a real download. A file that only fails
// here (an XHTML subset that is not well-formed XML, for example) can be read
// online but is undownloadable forever once stored, and the only signal today is
// a 409 at download time. No identity is needed and nothing is written.
export async function inspectWatermarkable(buffer, format) {
  if (format !== 'epub' && format !== 'pdf') throw new Error('Unsupported download format');
  const lines = stampLines({ userId: 'dry-run', tenantId: 'dry-run', email: 'dry-run@invalid' });
  if (format === 'pdf') {
    await watermarkPdf(buffer, lines);
    return { format, documents: null };
  }
  return watermarkEpub(buffer, lines, { inspectOnly: true });
}
