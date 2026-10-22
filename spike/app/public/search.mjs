// Shared search rules for the server, the browser fallback and the tests.
// Everything is dependency-free so both sides fold Turkish text identically.

const FOLD = { 'ç': 'c', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u' };
const NON_WORD = /[^a-z0-9]+/g;
const WORD_CHAR = /[\p{L}\p{N}]/u;

export function normalizeSearch(value) {
  return String(value || '').toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim();
}

// Case folding that keeps the string length intact, so folded offsets can be
// used against the original text (Turkish lowercasing is one code point here).
export function foldChars(value) {
  return String(value || '')
    .toLocaleLowerCase('tr')
    .replace(/[çğıöşü]/g, (character) => FOLD[character]);
}

export function foldSearch(value) {
  return foldChars(normalizeSearch(value));
}

export function foldWords(value) {
  return foldChars(value).replace(NON_WORD, ' ').trim();
}

// Returns the first index where the query starts and ends on a word boundary.
export function findWholeWord(text, query, from = 0) {
  if (!query) return -1;
  let index = text.indexOf(query, from);
  while (index >= 0) {
    const before = index > 0 ? text[index - 1] : '';
    const after = index + query.length < text.length ? text[index + query.length] : '';
    if (!WORD_CHAR.test(before) && !WORD_CHAR.test(after)) return index;
    index = text.indexOf(query, index + 1);
  }
  return -1;
}

// Fuzzy result pages do not contain the exact query. Find a close word or a
// shared stem so the reader can still show where the fuzzy hit came from.
export function findFuzzyWord(text, query, from = 0) {
  const needle = foldChars(normalizeSearch(query)).split(' ')[0];
  if (!needle || needle.length < 3) return null;
  const maxDistance = needle.length >= 5 ? 2 : 1;
  const prefix = needle.slice(0, Math.min(5, needle.length));
  const words = /[\p{L}\p{N}]+/gu;
  words.lastIndex = Math.max(0, from);
  let match = words.exec(text);
  while (match) {
    const word = match[0].toLocaleLowerCase('tr');
    if (word.startsWith(prefix) || editDistance(word, needle) <= maxDistance) {
      return { index: match.index, length: word.length };
    }
    match = words.exec(text);
  }
  return null;
}

export function buildSnippet(text, index, length, radius = 45) {
  const value = String(text || '');
  const start = Math.max(0, index - radius);
  const end = Math.min(value.length, index + length + radius);
  return `${start > 0 ? '…' : ''}${value.slice(start, end)}${end < value.length ? '…' : ''}`;
}

// Exact/folded matches keep the query position; stemmed or fuzzy matches do not
// appear verbatim, so use the longest shared prefix of a query token instead.
export function findSnippetAnchor(text, query) {
  const foldedText = foldChars(String(text || ''));
  const foldedQuery = foldChars(normalizeSearch(query));
  if (!foldedQuery) return { index: 0, length: 0 };
  const direct = foldedText.indexOf(foldedQuery);
  if (direct >= 0) return { index: direct, length: foldedQuery.length };
  for (const token of foldedQuery.split(' ')) {
    const probe = token.slice(0, Math.min(4, token.length));
    if (probe.length < 3) continue;
    const found = foldedText.indexOf(probe);
    if (found >= 0) return { index: found, length: probe.length };
  }
  return { index: 0, length: 0 };
}

export function editDistance(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }
  return previous[right.length];
}

// Mirrors the catalog SQL: folded phrase match or every query token present,
// with one typo tolerated for tokens of five characters or more.
export function catalogMatches(fields, query) {
  const tokens = foldSearch(query).split(' ').filter(Boolean);
  if (!tokens.length) return false;
  const folded = foldSearch((Array.isArray(fields) ? fields : [fields]).join(' '));
  const words = folded.split(' ').filter(Boolean);
  return tokens.every((token) =>
    folded.includes(token)
    || (token.length >= 5 && words.some((word) => editDistance(word, token) <= 1)),
  );
}
