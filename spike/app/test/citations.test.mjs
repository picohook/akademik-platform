import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCitation, toCslJson } from '../public/citations.mjs';

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
