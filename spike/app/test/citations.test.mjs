import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCitation, toCslJson, normalizePdfPageLabels, pdfPageLabel, pdfPageDescription, pdfCitationPage, formatCopiedSelection } from '../public/citations.mjs';

const examples = {
  'tr-single': {
    book: {
      id: '1',
      title: 'Diş Hekimliğinde İmplant Komplikasyonları',
      language: 'tr',
      publisher: 'Akademik Yayıncılık',
      publication_year: 2026,
      metadata: { authors: [{ family: 'Yılmaz', given: 'Ayşe' }] },
    },
    expected: {
      apa: 'Yılmaz, A. (2026). Diş Hekimliğinde İmplant Komplikasyonları. Akademik Yayıncılık.',
      mla: 'Yılmaz, Ayşe. Diş Hekimliğinde İmplant Komplikasyonları. Akademik Yayıncılık, 2026.',
      chicago: 'Yılmaz, Ayşe. Diş Hekimliğinde İmplant Komplikasyonları. Akademik Yayıncılık, 2026.',
      ieee: 'A. Yılmaz, Diş Hekimliğinde İmplant Komplikasyonları. Akademik Yayıncılık, 2026.',
      bibtex: `@book{Yilmaz2026,
  author = {Yılmaz, Ayşe},
  title = {{Diş Hekimliğinde İmplant Komplikasyonları}},
  publisher = {Akademik Yayıncılık},
  year = {2026},
  language = {tr}
}`,
    },
  },
  'en-two': {
    page: '42',
    book: {
      id: '2',
      title: 'Oral Radiology',
      language: 'en',
      publisher: 'Mosby',
      publication_year: 2020,
      metadata: {
        authors: [
          { family: 'Smith', given: 'John A.' },
          { family: 'Doe', given: 'Jane' },
        ],
      },
    },
    expected: {
      apa: 'Smith, J. A., & Doe, J. (2020). Oral Radiology. Mosby, p. 42.',
      mla: 'Smith, John A., and Jane Doe. Oral Radiology. Mosby, 2020. p. 42.',
      chicago: 'Smith, John A., and Jane Doe. Oral Radiology. Mosby, 2020. p. 42.',
      ieee: 'J. A. Smith and J. Doe, Oral Radiology. Mosby, 2020, p. 42.',
      bibtex: `@book{Smith2020,
  author = {Smith, John A. and Doe, Jane},
  title = {{Oral Radiology}},
  publisher = {Mosby},
  year = {2020},
  language = {en}
}`,
    },
  },
  'en-three-doi': {
    book: {
      id: '3',
      title: 'Nursing Research',
      language: 'en',
      publisher: 'Wolters Kluwer',
      publication_year: 2022,
      metadata: {
        authors: [
          { family: 'Polit', given: 'Denise F.' },
          { family: 'Beck', given: 'Cheryl T.' },
          { family: 'Hungler', given: 'Bernadette P.' },
        ],
        edition: '11',
        doi: '10.1234/nursing',
      },
    },
    expected: {
      apa: 'Polit, D. F., et al. (2022). Nursing Research (11th ed.). Wolters Kluwer. https://doi.org/10.1234/nursing',
      mla: 'Polit, Denise F., et al. Nursing Research. 11th ed. Wolters Kluwer, 2022. doi:10.1234/nursing.',
      chicago: 'Polit, Denise F., et al. Nursing Research. 11th ed. Wolters Kluwer, 2022. https://doi.org/10.1234/nursing.',
      ieee: 'D. F. Polit et al., Nursing Research, 11th ed. Wolters Kluwer, 2022. doi: 10.1234/nursing.',
      bibtex: `@book{Polit2022,
  author = {Polit, Denise F. and Beck, Cheryl T. and Hungler, Bernadette P.},
  title = {{Nursing Research}},
  publisher = {Wolters Kluwer},
  year = {2022},
  edition = {11},
  doi = {10.1234/nursing},
  language = {en}
}`,
    },
  },
  'editor': {
    book: {
      id: '4',
      title: 'Handbook of Imaging',
      language: 'en',
      publisher: 'Springer',
      publication_year: 2019,
      metadata: { editors: [{ family: 'Brown', given: 'Alice' }] },
    },
    expected: {
      apa: 'Brown, A. (Ed.). (2019). Handbook of Imaging. Springer.',
      mla: 'Brown, Alice, editor. Handbook of Imaging. Springer, 2019.',
      chicago: 'Brown, Alice, ed. Handbook of Imaging. Springer, 2019.',
      ieee: 'A. Brown, Ed., Handbook of Imaging. Springer, 2019.',
      bibtex: `@book{Brown2019,
  editor = {Brown, Alice},
  title = {{Handbook of Imaging}},
  publisher = {Springer},
  year = {2019},
  language = {en}
}`,
    },
  },
  'place-isbn': {
    book: {
      id: '5',
      title: 'Sağlık Yönetimi',
      language: 'tr',
      publisher: 'Nobel',
      publication_year: 2021,
      metadata: {
        authors: [{ family: 'Kaya', given: 'Mehmet' }],
        place: 'Ankara',
        isbn: '978-605-1234-56-7',
      },
    },
    expected: {
      apa: 'Kaya, M. (2021). Sağlık Yönetimi. Nobel.',
      mla: 'Kaya, Mehmet. Sağlık Yönetimi. Nobel, 2021.',
      chicago: 'Kaya, Mehmet. Sağlık Yönetimi. Ankara: Nobel, 2021.',
      ieee: 'M. Kaya, Sağlık Yönetimi. Ankara: Nobel, 2021.',
      bibtex: `@book{Kaya2021,
  author = {Kaya, Mehmet},
  title = {{Sağlık Yönetimi}},
  publisher = {Nobel},
  year = {2021},
  address = {Ankara},
  isbn = {978-605-1234-56-7},
  language = {tr}
}`,
    },
  },
  'missing': {
    book: {
      id: '6',
      title: 'Untitled Manuscript',
      language: 'en',
      metadata: { authors: [{ family: 'Taylor', given: 'Sam' }] },
    },
    expected: {
      apa: 'Taylor, S. (t.y.). Untitled Manuscript.',
      mla: 'Taylor, Sam. Untitled Manuscript. t.y.',
      chicago: 'Taylor, Sam. Untitled Manuscript. t.y.',
      ieee: 'S. Taylor, Untitled Manuscript. t.y.',
      bibtex: `@book{Taylor,
  author = {Taylor, Sam},
  title = {{Untitled Manuscript}},
  language = {en}
}`,
    },
  },
};

for (const [name, example] of Object.entries(examples)) {
  test(`citation ${name}`, () => {
    for (const [style, expected] of Object.entries(example.expected)) {
      const result = formatCitation(example.book, style, example.page || '');
      assert.equal(result.text, expected, `${name} / ${style}`);
    }
  });
}

test('CSL-JSON keeps structured authors', () => {
  const csl = toCslJson(examples['tr-single'].book);
  assert.equal(csl.type, 'book');
  assert.deepEqual(csl.author, [{ family: 'Yılmaz', given: 'Ayşe' }]);
  assert.deepEqual(csl.issued, { 'date-parts': [[2026]] });
});

test('missing metadata produces warnings', () => {
  const result = formatCitation(examples.missing.book, 'apa');
  assert.deepEqual(result.warnings, ['Yayın yılı yok.', 'Yayıncı bilgisi yok.']);
});

test('PDF PageLabels preserve roman, decimal and prefixed labels without offsets', () => {
  const labels = normalizePdfPageLabels(['iii', 'iv', '125', '126', 'A-1', '']);
  assert.deepEqual(labels, ['iii', 'iv', '125', '126', 'A-1', '']);
  assert.equal(pdfPageLabel(labels, 2), 'iv');
  assert.equal(pdfPageDescription(labels, 3), 'Sayfa 125 (PDF 3)');
  assert.equal(pdfPageDescription(labels, 5, 'en'), 'Page A-1 (PDF 5)');
  assert.equal(pdfCitationPage(labels, 2), 'iv');
  assert.equal(pdfCitationPage(labels, 3), '125');
});

test('absent label maps never imply printed pages', () => {
  for (const labels of [null, undefined, {}, 'i, ii']) {
    assert.equal(normalizePdfPageLabels(labels), null);
  }
  assert.equal(pdfPageDescription(null, 4), 'PDF sayfası 4');
  assert.equal(pdfCitationPage(null, 4, 'en'), 'PDF page 4');
  assert.equal(pdfCitationPage(['', ' '], 2), 'PDF sayfası 2');
  assert.equal(pdfPageLabel(['i'], 0), null);
  assert.equal(pdfPageLabel(['i'], 1.5), null);
  assert.equal(pdfPageLabel(['i'], 2), null);
});

test('duplicate and custom labels are preserved rather than renumbered', () => {
  assert.deepEqual(normalizePdfPageLabels(['cover', 'cover']), ['cover', 'cover']);
  assert.equal(pdfPageDescription(['cover', 'cover'], 2), 'Sayfa cover (PDF 2)');
});

test('all text citation styles use roman page labels and explicit PDF fallback', () => {
  for (const style of ['apa', 'mla', 'chicago', 'ieee']) {
    const book = examples['en-two'].book;
    assert.match(formatCitation(book, style, pdfCitationPage(['iii', 'iv'], 2)).text, /p\. iv\./);
    const fallback = formatCitation(book, style, pdfCitationPage(null, 3, 'en')).text;
    assert.match(fallback, /PDF page 3\./);
    assert.doesNotMatch(fallback, /p\. PDF/);
    const turkish = formatCitation(examples['tr-single'].book, style, pdfCitationPage(null, 3)).text;
    assert.match(turkish, /PDF sayfası 3\./);
    assert.doesNotMatch(turkish, /s\. PDF/);
  }
});

test('roman ranges remain editable; BibTeX explicitly warns about omitted locators', () => {
  assert.match(formatCitation(examples['en-two'].book, 'apa', 'iv–v').text, /pp\. iv–v\./);
  assert.ok(formatCitation(examples['en-two'].book, 'bibtex', 'iv').warnings.includes('BibTeX kitap künyesidir; sayfa konumu eklenmez.'));
});

test('hyphens in custom PDF labels are not converted to page ranges', () => {
  for (const style of ['apa', 'mla', 'chicago', 'ieee']) {
    assert.match(formatCitation(examples['en-two'].book, style, 'A-1').text, /p\. A-1\./);
  }
});


test('partial labels retain valid pages and fall back only at missing entries', () => {
  const input = [' i ', null, ' 125 ', undefined, 42, '  ', 'A-1'];
  const labels = normalizePdfPageLabels(input);
  assert.deepEqual(labels, ['i', '', '125', '', '', '', 'A-1']);
  assert.equal(input[0], ' i ', 'Normalization must not mutate the PDF.js array');
  assert.equal(pdfPageDescription(labels, 1), 'Sayfa i (PDF 1)');
  assert.equal(pdfCitationPage(labels, 3), '125');
  assert.equal(pdfCitationPage(labels, 7), 'A-1');
  for (const page of [2, 4, 5, 6, 8]) {
    assert.equal(pdfPageDescription(labels, page), 'PDF sayfası ' + page);
    assert.equal(pdfCitationPage(labels, page, 'en'), 'PDF page ' + page);
  }
  const short = normalizePdfPageLabels(['ii']);
  assert.equal(pdfCitationPage(short, 1), 'ii');
  assert.equal(pdfCitationPage(short, 2), 'PDF sayfası 2');
});


test('copied PDF quotations cite the selection page, including mapped and fallback locators', () => {
  const book = examples['en-two'].book;
  assert.match(formatCopiedSelection(book, 'Selected text', {page: 3, labels: ['i','ii','125']}), /Selected text\n\n.*p\. 125\./);
  assert.match(formatCopiedSelection(book, 'Selected text', {page: 3, language: 'en'}), /PDF page 3\./);
  assert.match(formatCopiedSelection(book, 'Selected text', {page: 3}), /PDF sayfası 3\./);
});

test('EPUB quotations use chapter locators without inventing PDF or printed pages', () => {
  const result = formatCopiedSelection(examples['en-two'].book, 'EPUB quote', {type:'epub',chapter:'Methods',language:'en'});
  assert.match(result, /EPUB quote\n\n/);
  assert.match(result, /Chapter: Methods$/);
  assert.doesNotMatch(result, /PDF page|p\. Methods|epubcfi/);
  assert.match(formatCopiedSelection(examples['en-two'].book,'Text',{type:'epub'}), / · EPUB$/);
  assert.equal(formatCopiedSelection(examples['en-two'].book,'  ',{}),'');
});
