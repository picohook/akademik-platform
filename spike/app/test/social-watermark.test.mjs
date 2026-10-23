import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { watermarkDownload } from '../social-watermark.mjs';

const auth = {
  userId: '12345678-1234-4234-8234-123456789abc',
  tenantId: '87654321-4321-4321-8321-cba987654321',
  email: 'reader@example.org',
};

async function samplePdf(dimensions = [[595, 842], [320, 420]]) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  dimensions.forEach((size, index) => {
    const page = pdf.addPage(size);
    page.drawText(`Original page ${index + 1}`, { x: 20, y: size[1] - 30, size: 10, font });
  });
  return pdf.save({ addDefaultPage: false });
}

async function epub(documents = { 'OEBPS/chapter.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Book</title></head><body><p>Original chapter</p></body></html>' }, options = {}) {
  const zip = new JSZip();
  const resources = Object.keys(documents).filter(name => !name.startsWith('META-INF/'));
  const mediaType = name => options.mediaTypes?.[name]
    || (/\.(?:xhtml|html|htm)$/.test(name) ? 'application/xhtml+xml' : name.endsWith('.svg') ? 'image/svg+xml' : 'text/css');
  const html = resources.filter(name => mediaType(name) === 'application/xhtml+xml' || mediaType(name) === 'text/html');
  for (const [name, content] of Object.entries(documents)) {
    // Test XHTML resources have the namespace required by their declared type.
    const data = mediaType(name) === 'application/xhtml+xml'
      ? content.replace(/<html(?=[\s>])([^>]*)>/, (tag, attrs) => /\bxmlns\s*=/.test(attrs) ? tag : `<html xmlns="http://www.w3.org/1999/xhtml"${attrs}>`)
      : content;
    zip.file(name, data);
  }
  const spine = options.spine ?? (html.length ? html : resources);
  const manifest = resources.map((name, index) => `<item id="item${index}" href="${name}" media-type="${mediaType(name)}" />`).join('');
  const references = spine.map(name => `<itemref idref="item${resources.indexOf(name)}" />`).join('');
  const packageXml = `<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><manifest>${manifest}</manifest><spine>${references}</spine></package>`;
  zip.file('package.opf', options.transformOpf ? options.transformOpf(packageXml) : packageXml);
  zip.file('META-INF/container.xml', options.container ?? '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="package.opf" media-type="application/oebps-package+xml" /></rootfiles></container>');
  // Intentionally wrong order/compression in the source: output must fix both.
  zip.file('mimetype', 'application/epub+zip');
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function pdfText(buffer, inspect) {
  const document = await getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise;
  try {
    for (let index = 1; index <= document.numPages; index++) {
      const page = await document.getPage(index);
      const text = await page.getTextContent();
      await inspect(text.items, page, index);
    }
    return document.numPages;
  } finally {
    await document.destroy();
  }
}

test('actual PDF text on every page contains platform, full identities and UTC date', async () => {
  const result = await watermarkDownload(await samplePdf(), 'pdf', auth);
  assert.ok(Buffer.isBuffer(result));
  assert.equal(await pdfText(result, (items, page, index) => {
    const text = items.map(item => item.str).join(' ');
    assert.ok(text.includes(`Original page ${index}`));
    for (const value of ['Akademik Platform', auth.userId, auth.tenantId, auth.email, new Date().toISOString().slice(0, 10)]) {
      assert.ok(text.includes(value), `missing ${value} on page ${index}`);
    }
    assert.match(text, /UTC: \d{4}-\d{2}-\d{2}T[\d:.]+Z/);
  }), 2);
});

test('long and Unicode PDF emails are retained safely and wrapped within each page', async () => {
  const identity = { ...auth, email: `ğ😀${'long'.repeat(45)}@example.org` };
  const result = await watermarkDownload(await samplePdf([[240, 300]]), 'pdf', identity);
  await pdfText(result, (items, page) => {
    const compact = items.map(item => item.str).join('').replace(/\s/g, '');
    assert.ok(compact.includes(auth.userId));
    assert.ok(compact.includes(auth.tenantId));
    assert.ok(compact.includes('\\u{11F}\\u{1F600}'));
    assert.ok(compact.includes(`${'long'.repeat(45)}@example.org`));
    for (const item of items) {
      assert.ok(item.transform[4] >= page.view[0]);
      assert.ok(item.transform[4] + item.width <= page.view[2] + 0.01);
      assert.ok(item.transform[5] >= page.view[1] && item.transform[5] <= page.view[3]);
    }
  });
});

test('PDF stamping respects a nonzero crop box', async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage([300, 400]).setCropBox(20, 30, 240, 330);
  const result = await watermarkDownload(await pdf.save(), 'pdf', auth);
  await pdfText(result, (items, page) => {
    assert.ok(items.some(item => item.str.includes(auth.userId)));
    for (const item of items) {
      assert.ok(item.transform[4] >= 20);
      assert.ok(item.transform[4] + item.width <= 260.01);
      assert.ok(item.transform[5] >= 30 && item.transform[5] <= 360);
    }
  });
});

test('PDF watermark adds translucent text without painting over dense original footer content', async () => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([595, 842]);
  // Existing vector art and dense footer text must retain their paint operators.
  page.drawRectangle({ x: 350, y: 12, width: 140, height: 80, color: rgb(0.7, 0.7, 0.7) });
  const originals = Array.from({ length: 9 }, (_, index) => `Original dense bottom line ${index + 1}`);
  originals.forEach((line, index) => page.drawText(line, { x: 18, y: 12 + index * 10, font, size: 8 }));
  const source = await pdf.save();
  const paintingOps = new Set([
    OPS.constructPath, OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke,
    OPS.shadingFill, OPS.paintImageXObject, OPS.paintInlineImageXObject,
    OPS.paintImageMaskXObject, OPS.paintSolidColorImageMask,
  ].filter(Number.isInteger));
  const before = [];
  await pdfText(source, async (_, originalPage) => {
    const operators = await originalPage.getOperatorList();
    before.push(...operators.fnArray.filter(op => paintingOps.has(op)));
  });
  assert.ok(before.includes(OPS.constructPath), 'fixture must contain original vector art');
  const result = await watermarkDownload(source, 'pdf', auth);
  await pdfText(result, async (items, stampedPage) => {
    const text = items.map(item => item.str).join(' ');
    for (const original of originals) assert.ok(text.includes(original));
    assert.ok(text.includes('Akademik Platform'));
    const operators = await stampedPage.getOperatorList();
    assert.deepEqual(operators.fnArray.filter(op => paintingOps.has(op)), before,
      'watermark must not introduce rectangle/fill/image paint over original content');
    let currentAlpha = 1;
    let translucentTextRuns = 0;
    const savedAlpha = [];
    operators.fnArray.forEach((op, index) => {
      if (op === OPS.save) savedAlpha.push(currentAlpha);
      if (op === OPS.restore) currentAlpha = savedAlpha.pop() ?? 1;
      if (op === OPS.setGState) {
        for (const [key, value] of operators.argsArray[index][0]) if (key === 'ca') currentAlpha = value;
      }
      if (op === OPS.showText && currentAlpha > 0 && currentAlpha <= 0.3) translucentTextRuns++;
    });
    assert.ok(translucentTextRuns >= 4, 'every watermark identity line must use translucent text');
  });
});

test('malformed, encrypted, zero-page and unreadably tiny PDFs fail closed', async () => {
  await assert.rejects(watermarkDownload(Buffer.from('not a PDF'), 'pdf', auth));
  const empty = await PDFDocument.create();
  await assert.rejects(watermarkDownload(await empty.save({ addDefaultPage: false }), 'pdf', auth), /cannot be watermarked/);
  const encrypted = await PDFDocument.create();
  encrypted.addPage();
  encrypted.context.trailerInfo.Encrypt = encrypted.context.register(encrypted.context.obj({ Filter: 'Standard', V: 1, R: 2 }));
  await assert.rejects(watermarkDownload(await encrypted.save(), 'pdf', auth), /encrypt/i);
  const tiny = await PDFDocument.create();
  tiny.addPage([5, 5]);
  await assert.rejects(watermarkDownload(await tiny.save(), 'pdf', auth), /narrow|small/);
});

test('every EPUB body contains escaped Unicode identity; mimetype is first and stored', async () => {
  const identity = { ...auth, email: `ali<&"'>ğ@example.org` };
  const documents = {
    'OEBPS/chapter.xhtml': '<html><head><script><![CDATA[const example = "<body>fake</body>";]]></script></head><!-- <body>fake</body> --><body class="a > b"><p>Original chapter</p></body></html>',
    'OEBPS/next.html': '<html><body><p>Second chapter</p></body></html>',
    'OEBPS/third.htm': '<html><body><p>Third chapter</p></body></html>',
    'OEBPS/style.css': 'p { color: red; }',
  };
  const result = await watermarkDownload(await epub(documents), 'epub', identity);
  assert.ok(Buffer.isBuffer(result));
  assert.equal(result.readUInt32LE(0), 0x04034b50);
  assert.equal(result.readUInt16LE(8), 0);
  assert.equal(result.subarray(30, 30 + result.readUInt16LE(26)).toString(), 'mimetype');
  const zip = await JSZip.loadAsync(result);
  assert.equal(await zip.file('mimetype').async('string'), 'application/epub+zip');
  assert.equal(await zip.file('OEBPS/style.css').async('string'), documents['OEBPS/style.css']);
  for (const name of Object.keys(documents).filter(name => !name.endsWith('.css'))) {
    const content = await zip.file(name).async('string');
    assert.equal((content.match(/data-social-watermark="true"/g) || []).length, 1);
    for (const value of ['Akademik Platform', auth.userId, auth.tenantId, 'ali&lt;&amp;&quot;&#39;&gt;ğ@example.org', new Date().toISOString().slice(0, 10)]) assert.ok(content.includes(value), `${name}: ${value}`);
    assert.ok(!content.includes(identity.email));
    assert.ok(content.indexOf('data-social-watermark=') > content.indexOf(name.endsWith('.xhtml') ? '<body class=' : '<body>'));
  }
});

test('EPUB without visible bodies, malformed documents and encrypted packages fail closed', async () => {
  await assert.rejects(watermarkDownload(Buffer.from('not a ZIP'), 'epub', auth));
  for (const content of ['<html><head></head></html>', '<html><!-- <body>fake</body> --></html>', '<html><!-- <body>fake</body>', '<html><body>unclosed', '<html><body /><body>two</body></html>']) {
    await assert.rejects(watermarkDownload(await epub({ 'book.xhtml': content }), 'epub', auth), /body|Malformed|Invalid EPUB package/);
  }
  await assert.rejects(watermarkDownload(await epub({ 'images/page.svg': '<svg />' }), 'epub', auth), /unsupported spine media type/);
  const encrypted = await epub({ 'META-INF/encryption.xml': '<encryption />', 'book.xhtml': '<html><body>Book</body></html>' });
  await assert.rejects(watermarkDownload(encrypted, 'epub', auth), /Encrypted EPUB/);
  const mixed = await epub({ 'valid.xhtml': '<html><body>Good</body></html>', 'invalid.xhtml': '<html><head>No body</head></html>' });
  await assert.rejects(watermarkDownload(mixed, 'epub', auth), /HTML body/);
});

test('OPF-declared XHTML spine is stamped even when its filename ends in xml', async () => {
  const documents = {
    'chapter.xml': '<html><body><p>Real chapter</p></body></html>',
    'nav.xhtml': '<html><body><nav>Navigation</nav></body></html>',
  };
  const result = await watermarkDownload(await epub(documents, {
    mediaTypes: { 'chapter.xml': 'application/xhtml+xml' }, spine: ['chapter.xml'],
  }), 'epub', auth);
  const zip = await JSZip.loadAsync(result);
  for (const name of Object.keys(documents)) {
    const content = await zip.file(name).async('string');
    assert.ok(content.includes(auth.userId), `${name} was not stamped`);
    assert.ok(content.includes(auth.tenantId));
  }
});

test('SVG/fixed-layout spine cannot bypass stamping through an ordinary XHTML nav', async () => {
  const documents = {
    'page.svg': '<svg xmlns="http://www.w3.org/2000/svg"><text>Real book</text></svg>',
    'nav.xhtml': '<html><body>Navigation only</body></html>',
  };
  await assert.rejects(watermarkDownload(await epub(documents, { spine: ['page.svg'] }), 'epub', auth), /unsupported spine media type/);
  for (const transformOpf of [
    xml => xml.replace('<manifest>', '<metadata><meta property="rendition:layout">pre-paginated</meta></metadata><manifest>'),
    xml => xml.replace('<manifest>', '<metadata><meta name="fixed-layout" content="true" /></metadata><manifest>'),
    xml => xml.replace('<itemref ', '<itemref properties="rendition:layout-pre-paginated" '),
  ]) await assert.rejects(watermarkDownload(await epub(undefined, { transformOpf }), 'epub', auth), /fixed-layout/);
  await assert.rejects(watermarkDownload(await epub({ 'nav.xhtml': documents['nav.xhtml'] }, { spine: [] }), 'epub', auth), /empty spine/);
});

test('declared XHTML must have a real HTML root and same-namespace direct body', async () => {
  for (const content of [
    '<svg xmlns="http://www.w3.org/2000/svg"><body></body><text>Undamaged book text</text></svg>',
    '<html xmlns="http://www.w3.org/2000/svg"><body>Foreign namespace</body></html>',
    '<html xmlns="http://www.w3.org/1999/xhtml"><body xmlns="http://www.w3.org/2000/svg">Foreign body</body></html>',
    '<html xmlns="http://www.w3.org/1999/xhtml"><template><body>Inert body</body></template></html>',
    '<body xmlns="http://www.w3.org/1999/xhtml">Fragment</body>',
    '<html xmlns="http://www.w3.org/1999/xhtml"><body>First</body><body>Second</body></html>',
  ]) {
    const source = await epub({
      'chapter.xml': content,
      'nav.xhtml': '<html><body>Navigation only</body></html>',
    }, { mediaTypes: { 'chapter.xml': 'application/xhtml+xml' }, spine: ['chapter.xml'] });
    await assert.rejects(watermarkDownload(source, 'epub', auth), /not HTML\/XHTML|HTML body/);
  }
});

test('namespaced XHTML and declared HTML with void tags remain stampable', async () => {
  const source = await epub({
    'chapter.xml': '<!DOCTYPE html><x:html xmlns:x="http://www.w3.org/1999/xhtml"><x:head /><x:body><x:p>Original</x:p></x:body></x:html>',
    'chapter.data': '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><p>Plain HTML</p><br><img src="cover.png"></body></html>',
  }, { mediaTypes: { 'chapter.xml': 'application/xhtml+xml', 'chapter.data': 'text/html' } });
  const zip = await JSZip.loadAsync(await watermarkDownload(source, 'epub', auth));
  for (const name of ['chapter.xml', 'chapter.data']) assert.ok((await zip.file(name).async('string')).includes(auth.userId));
});

test('OPF parent-relative chapter paths resolve inside the archive and cannot escape it', async () => {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file('META-INF/container.xml', '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml" /></rootfiles></container>');
  const opf = '<package xmlns="http://www.idpf.org/2007/opf"><manifest><item id="chapter" href="../Text/chapter.xml" media-type="application/xhtml+xml" /></manifest><spine><itemref idref="chapter" /></spine></package>';
  zip.file('OEBPS/package.opf', opf);
  zip.file('Text/chapter.xml', '<html xmlns="http://www.w3.org/1999/xhtml"><body>Book text</body></html>');
  const result = await watermarkDownload(await zip.generateAsync({ type: 'nodebuffer' }), 'epub', auth);
  assert.ok((await (await JSZip.loadAsync(result)).file('Text/chapter.xml').async('string')).includes(auth.userId));
  zip.file('OEBPS/package.opf', opf.replace('../Text/chapter.xml', '../../Text/chapter.xml'));
  await assert.rejects(watermarkDownload(await zip.generateAsync({ type: 'nodebuffer' }), 'epub', auth), /outside archive/);
});

test('missing, malformed, ambiguous or unsafe EPUB package metadata fails closed', async () => {
  const onlyNav = new JSZip();
  onlyNav.file('mimetype', 'application/epub+zip');
  onlyNav.file('nav.xhtml', '<html><body>Navigation</body></html>');
  await assert.rejects(watermarkDownload(await onlyNav.generateAsync({ type: 'nodebuffer' }), 'epub', auth), /missing container/);
  for (const transformOpf of [
    xml => xml.replace('</manifest>', '<item id="item0" href="different.xhtml" media-type="application/xhtml+xml" /></manifest>'),
    xml => xml.replace('</manifest>', '<item id="duplicatePath" href="OEBPS/chapter.xhtml" media-type="application/xhtml+xml" /></manifest>'),
    xml => xml.replace('idref="item0"', 'idref="missing"'),
    xml => xml.replace('OEBPS/chapter.xhtml', 'https://example.org/chapter.xhtml'),
    xml => xml.replace('OEBPS/chapter.xhtml', '../chapter.xhtml'),
    xml => xml.replace('OEBPS/chapter.xhtml', 'OEBPS/%2e%2e/chapter.xhtml'),
    xml => xml.replace('OEBPS/chapter.xhtml', 'OEBPS/%252e%252e/chapter.xhtml'),
    xml => xml.replace('OEBPS/chapter.xhtml', 'OEBPS%2fchapter.xhtml'),
    xml => xml.replace('OEBPS/chapter.xhtml', 'OEBPS/chapter.xhtml#fragment'),
    xml => xml.replace('OEBPS/chapter.xhtml', 'missing.xhtml'),
    xml => xml.replace('<spine>', '<spine><itemref idref="item0" />'),
    xml => xml.replace('<manifest>', '<manifest xml:base="other/">'),
    xml => `<!DOCTYPE package [<!ENTITY external SYSTEM "file:///secret">]>${xml}`,
    xml => xml.replace('version="3.0"', 'version="3.0" version="2.0"'),
    xml => xml.replace('</package>', '</wrong>'),
    xml => xml.replace('idref="item0"', 'idref="&unknown;"'),
  ]) await assert.rejects(watermarkDownload(await epub(undefined, { transformOpf }), 'epub', auth), /Invalid EPUB package/);
  for (const container of [
    '<container><rootfiles /></container>',
    '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="../package.opf" media-type="application/oebps-package+xml" /></rootfiles></container>',
    '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="package.opf" media-type="application/oebps-package+xml" /><rootfile full-path="other.opf" media-type="application/oebps-package+xml" /></rootfiles></container>',
    '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles></container>',
  ]) await assert.rejects(watermarkDownload(await epub(undefined, { container }), 'epub', auth), /Invalid EPUB package/);
});

test('unsupported format or missing/malformed identity fails instead of returning original', async () => {
  const source = await samplePdf();
  await assert.rejects(watermarkDownload(source, 'txt', auth), /Unsupported/);
  for (const key of ['userId', 'tenantId', 'email']) {
    await assert.rejects(watermarkDownload(source, 'pdf', { ...auth, [key]: '' }), new RegExp(key));
    await assert.rejects(watermarkDownload(source, 'pdf', { ...auth, [key]: 'bad\u0000identity' }), new RegExp(key));
  }
});
