// CSL-JSON is the intermediate model. Formatters below are deliberately manual:
// four styles + BibTeX, no CSL processor dependency. Swapping in a CSL engine
// later should only replace the formatter layer.

export const CITATION_STYLES = [
  { id: 'apa', label: 'APA 7' },
  { id: 'mla', label: 'MLA 9' },
  { id: 'chicago', label: 'Chicago 17' },
  { id: 'ieee', label: 'IEEE' },
  { id: 'bibtex', label: 'BibTeX' },
];

export function normalizeAuthors(value) {
  const list = Array.isArray(value) ? value : [];
  return list.map((author) => {
    if (author && typeof author === 'object') {
      return {
        family: String(author.family || author.last || '').trim(),
        given: String(author.given || author.first || '').trim(),
      };
    }
    const text = String(author || '').trim();
    if (!text) return null;
    if (text.includes(',')) {
      const [family, ...given] = text.split(',');
      return { family: family.trim(), given: given.join(',').trim() };
    }
    const parts = text.split(/\s+/);
    if (parts.length === 1) return { family: parts[0], given: '' };
    return { family: parts.pop(), given: parts.join(' ') };
  }).filter((author) => author && (author.family || author.given));
}

function firstYear(value) {
  return value?.['date-parts']?.[0]?.[0] || null;
}

export function toCslJson(book) {
  const metadata = book.metadata || {};
  const authors = normalizeAuthors(metadata.authors || book.authors || []);
  const editors = normalizeAuthors(metadata.editors || book.editors || []);
  const year = book.publication_year || metadata.year || null;
  const csl = {
    id: book.id || 'book',
    type: 'book',
    title: book.title || 'Adsız',
    author: authors,
    editor: editors,
    issued: year ? { 'date-parts': [[Number(year)]] } : undefined,
    publisher: book.publisher || undefined,
    'publisher-place': metadata.place || metadata.publisherPlace || undefined,
    edition: metadata.edition || undefined,
    ISBN: metadata.isbn || undefined,
    DOI: metadata.doi || undefined,
    URL: metadata.url || undefined,
    language: book.language || undefined,
  };
  return Object.fromEntries(Object.entries(csl).filter(([, value]) => {
    if (value === undefined || value === null || value === '') return false;
    if (Array.isArray(value) && value.length === 0) return false;
    return true;
  }));
}

function yearOf(csl) {
  return firstYear(csl.issued) || null;
}

function initials(given) {
  return String(given || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `${part[0].toLocaleUpperCase('tr')}.`)
    .join(' ');
}

function familyList(csl) {
  return (csl.author && csl.author.length ? csl.author : csl.editor || []);
}

function isEditorOnly(csl) {
  return (!csl.author || !csl.author.length) && csl.editor && csl.editor.length;
}

function apaAuthors(csl, turkish) {
  const list = familyList(csl);
  if (!list.length) return '';
  const suffix = isEditorOnly(csl) ? (turkish ? ' (Yay.).' : ' (Ed.).') : '';
  if (list.length === 1) return `${list[0].family}, ${initials(list[0].given)}${suffix}`;
  if (list.length === 2) {
    return `${list[0].family}, ${initials(list[0].given)}, ${turkish ? 've' : '&'} ${list[1].family}, ${initials(list[1].given)}${suffix}`;
  }
  return `${list[0].family}, ${initials(list[0].given)}, et al.${suffix}`;
}

function mlaAuthors(csl) {
  const list = familyList(csl);
  if (!list.length) return '';
  const suffix = isEditorOnly(csl) ? ', editor.' : '';
  if (list.length === 1) return `${list[0].family}, ${list[0].given}${suffix}`;
  if (list.length === 2) {
    return `${list[0].family}, ${list[0].given}, and ${list[1].given} ${list[1].family}${suffix}`;
  }
  return `${list[0].family}, ${list[0].given}, et al.${suffix}`;
}

function chicagoAuthors(csl) {
  const list = familyList(csl);
  if (!list.length) return '';
  const suffix = isEditorOnly(csl) ? ', ed.' : '';
  if (list.length === 1) return `${list[0].family}, ${list[0].given}${suffix}`;
  if (list.length === 2) {
    return `${list[0].family}, ${list[0].given}, and ${list[1].given} ${list[1].family}${suffix}`;
  }
  return `${list[0].family}, ${list[0].given}, et al.${suffix}`;
}

function ieeeAuthors(csl) {
  const list = familyList(csl);
  if (!list.length) return '';
  const suffix = isEditorOnly(csl) ? ', Ed.' : '';
  const names = list.map((author) => `${initials(author.given)} ${author.family}`.trim());
  if (names.length === 1) return `${names[0]}${suffix}`;
  if (names.length === 2) return `${names[0]} and ${names[1]}${suffix}`;
  return `${names[0]} et al.${suffix}`;
}

function pageLabel(page, turkish) {
  const value = String(page || '').trim();
  if (!value) return '';
  const range = value.includes('-') || value.includes('–');
  if (turkish) return `${range ? 'ss.' : 's.'} ${value.replace('-', '–')}`;
  return `${range ? 'pp.' : 'p.'} ${value.replace('-', '–')}`;
}

function editionLabel(edition, turkish) {
  if (!edition) return '';
  const value = String(edition).trim();
  if (turkish) return `${value}. baskı`;
  if (/^\d+$/.test(value)) {
    const number = Number(value);
    const suffix = number === 1 ? 'st' : number === 2 ? 'nd' : number === 3 ? 'rd' : 'th';
    return `${number}${suffix} ed.`;
  }
  return `${value} ed.`;
}

function yearLabel(csl) {
  return yearOf(csl) || 't.y.';
}

function apa(csl) {
  const turkish = csl.language === 'tr';
  const authors = apaAuthors(csl, turkish);
  const year = yearLabel(csl);
  const title = csl.title;
  const edition = editionLabel(csl.edition, turkish);
  const publisher = csl.publisher || '';
  let text = authors ? `${authors} (${year}). ${title}` : `${title}. (${year}).`;
  if (edition) text += ` (${edition})`;
  if (publisher) text += `. ${publisher}`;
  text += '.';
  if (csl.DOI) text += ` https://doi.org/${csl.DOI}`;
  return text;
}

function mla(csl) {
  const turkish = csl.language === 'tr';
  const authors = mlaAuthors(csl);
  const title = csl.title;
  const edition = editionLabel(csl.edition, turkish);
  let text = authors
    ? `${authors}${authors.endsWith('.') ? '' : '.'} ${title}.`
    : `${title}.`;
  if (edition) text += ` ${edition}`;
  if (csl.publisher) text += ` ${csl.publisher},`;
  text += ` ${yearLabel(csl)}`;
  if (!text.endsWith('.')) text += '.';
  if (csl.DOI) text += ` doi:${csl.DOI}.`;
  return text;
}

function chicago(csl) {
  const turkish = csl.language === 'tr';
  const authors = chicagoAuthors(csl);
  const title = csl.title;
  const edition = editionLabel(csl.edition, turkish);
  let text = authors
    ? `${authors}${authors.endsWith('.') ? '' : '.'} ${title}.`
    : `${title}.`;
  if (edition) text += ` ${edition}`;
  const place = csl['publisher-place'];
  if (place) text += ` ${place}:`;
  if (csl.publisher) text += ` ${csl.publisher},`;
  text += ` ${yearLabel(csl)}`;
  if (!text.endsWith('.')) text += '.';
  if (csl.DOI) text += ` https://doi.org/${csl.DOI}.`;
  return text;
}

function ieee(csl) {
  const turkish = csl.language === 'tr';
  const authors = ieeeAuthors(csl);
  const title = csl.title;
  const edition = editionLabel(csl.edition, turkish);
  let text = authors ? `${authors}, ${title}` : `${title}`;
  if (edition) text += `, ${edition.replace(/\.$/, '')}`;
  text += '.';
  const place = csl['publisher-place'];
  if (place) text += ` ${place}:`;
  if (csl.publisher) text += ` ${csl.publisher},`;
  text += ` ${yearLabel(csl)}`;
  if (!text.endsWith('.')) text += '.';
  if (csl.DOI) text += ` doi: ${csl.DOI}.`;
  return text;
}

function bibtexKey(csl) {
  const first = familyList(csl)[0];
  const base = `${first ? first.family : csl.title}`
    .replace(/[çÇ]/g, 'c').replace(/[ğĞ]/g, 'g').replace(/[ıİ]/g, 'i')
    .replace(/[öÖ]/g, 'o').replace(/[şŞ]/g, 's').replace(/[üÜ]/g, 'u')
    .replace(/[^A-Za-z0-9]/g, '');
  return `${base || 'book'}${yearOf(csl) || ''}`;
}

function bibtex(csl) {
  const fields = [];
  const authors = csl.author && csl.author.length
    ? csl.author.map((author) => `${author.family}, ${author.given}`).join(' and ')
    : '';
  const editors = csl.editor && csl.editor.length
    ? csl.editor.map((author) => `${author.family}, ${author.given}`).join(' and ')
    : '';
  if (authors) fields.push(`  author = {${authors}}`);
  if (editors) fields.push(`  editor = {${editors}}`);
  fields.push(`  title = {{${csl.title}}}`);
  if (csl.publisher) fields.push(`  publisher = {${csl.publisher}}`);
  if (yearOf(csl)) fields.push(`  year = {${yearOf(csl)}}`);
  if (csl.edition) fields.push(`  edition = {${csl.edition}}`);
  if (csl['publisher-place']) fields.push(`  address = {${csl['publisher-place']}}`);
  if (csl.ISBN) fields.push(`  isbn = {${csl.ISBN}}`);
  if (csl.DOI) fields.push(`  doi = {${csl.DOI}}`);
  if (csl.language) fields.push(`  language = {${csl.language}}`);
  return `@book{${bibtexKey(csl)},\n${fields.join(',\n')}\n}`;
}

export function formatCsl(csl, style = 'apa', page = '') {
  const warnings = [];
  if (!csl.author || !csl.author.length) {
    if (csl.editor && csl.editor.length) warnings.push('Yazar yok; editörle biçimlendirildi.');
    else warnings.push('Yazar bilgisi yok; başlıkla biçimlendirildi.');
  }
  if (!yearOf(csl)) warnings.push('Yayın yılı yok.');
  if (!csl.publisher) warnings.push('Yayıncı bilgisi yok.');

  let text;
  switch (style) {
    case 'mla': text = mla(csl); break;
    case 'chicago': text = chicago(csl); break;
    case 'ieee': text = ieee(csl); break;
    case 'bibtex': text = bibtex(csl); break;
    case 'apa':
    default: text = apa(csl); break;
  }

  if (style !== 'bibtex' && page) {
    const label = pageLabel(page, csl.language === 'tr');
    if (label) {
      if (style === 'mla') text = `${text} ${label}.`;
      else if (style === 'chicago') text = `${text} ${label}.`;
      else text = `${text.replace(/\.$/, '')}, ${label}.`;
    }
  }
  return { text, warnings };
}

export function formatCitation(book, style = 'apa', page = '') {
  return formatCsl(toCslJson(book), style, page);
}
