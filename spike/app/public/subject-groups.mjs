// The catalogue shows a handful of broad subject groups, not every free-text subject a record carries. A record's own
// subjects stay in its details and in search; the group is only for the card label and the filter chips.
const GROUPS = [
  { key: 'openscience', tr: 'Açık bilim', en: 'Open science', test: /open (science|access|data)|acik (bilim|erisim|veri)|reproducib|tekrarlanabilir/ },
  { key: 'ai', tr: 'Yapay zekâ', en: 'Artificial intelligence', test: /artificial intelligence|yapay zeka|machine learning|makine ogren|deep learning|derin ogren|neural|sinir ag|natural language|dogal dil|data science|veri bilim|computer vision|(^|\W)(ai|nlp)(\W|$)/ },
  { key: 'statistics', tr: 'İstatistik', en: 'Statistics', test: /statist|probabil|olasilik|regress/ },
  { key: 'math', tr: 'Matematik', en: 'Mathematics', test: /mathemat|matematik|calculus|algebra|geometr|kalkulus/ },
  { key: 'logic', tr: 'Mantık', en: 'Logic', test: /(^|\W)logic|mantik|reasoning/ },
  { key: 'writing', tr: 'Akademik yazım', en: 'Academic writing', test: /writing|composition|yazim|yazma|rhetoric|retorik|citation|referencing|(^|\W)atif/ },
  { key: 'research', tr: 'Araştırma yöntemleri', en: 'Research methods', test: /research method|arastirma yontem|methodolog|metodoloji|qualitative|nitel|quantitative|nicel|literature review|systematic review/ },
  { key: 'health', tr: 'Sağlık bilimleri', en: 'Health sciences', test: /nurs|hemsire|medic|(^|\W)tip(\W|$)|saglik|health|dent|dis hek|pharm|eczac|clinic|klinik|anatom|physiolog|fizyolo|patholog|surg|cerrah|therap|terapi/ },
  { key: 'engineering', tr: 'Mühendislik ve teknoloji', en: 'Engineering and technology', test: /engineer|muhendis|technolog|teknoloji|computer|bilgisayar|software|yazilim|electr|mechanic|programming|programlama|database|veritabani/ },
  { key: 'science', tr: 'Fen bilimleri', en: 'Natural sciences', test: /physic|fizik|chemi|kimya|biolog|science|(^|\W)bilim|astronom|geolog|ecolog|ekoloji/ },
  { key: 'social', tr: 'Sosyal bilimler', en: 'Social sciences', test: /psycholog|psikoloji|sociolog|sosyoloji|econom|ekonomi|education|egitim|politic|siyaset|(^|\W)law(\W|$)|hukuk|management|isletme|business|communication|iletisim/ },
  { key: 'humanities', tr: 'Beşeri bilimler', en: 'Humanities', test: /histor|tarih|literatur|edebiyat|philosoph|felsefe|linguist|dilbilim|(^|\W)art(\W|$)|sanat|religion|language|(^|\W)dil(\W|$)/ },
];
const OTHER = { key: 'other', tr: 'Diğer', en: 'Other' };

// "Işık" and "Diş" fold to the same plain letters as "isik" and "dis", so one pattern serves both spellings.
function fold(text) {
  return String(text || '').toLocaleLowerCase('tr')
    .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c').replace(/â/g, 'a').replace(/î/g, 'i').replace(/û/g, 'u').replace(/\u0307/g, '');
}

export function subjectGroup(book) {
  const text = fold((book && book.subjects || []).join(' ; '));
  return (GROUPS.find((group) => group.test.test(text)) || OTHER).key;
}

export function subjectGroupLabel(key, lang) {
  const group = GROUPS.find((item) => item.key === key) || OTHER;
  return lang === 'en' ? group.en : group.tr;
}

// the groups the books belong to, in the catalogue's fixed order ("other" last)
export function subjectGroupKeys(books) {
  const present = new Set(books.map(subjectGroup));
  return [...GROUPS, OTHER].map((group) => group.key).filter((key) => present.has(key));
}
