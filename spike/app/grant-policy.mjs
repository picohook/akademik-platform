// No active grants must never reopen a tenant that has configured access.
export function grantAllows(book, grants) {
  if (!grants.length) return grants.accessRequired === false;
  const publisher = String(book.publisher || '').toLocaleLowerCase('tr');
  const subjects = (book.subjects || []).map(value => String(value).toLocaleLowerCase('tr'));
  return grants.some(grant => {
    if (grant.scope_type === 'all') return true;
    if (grant.scope_type === 'title') return String(grant.scope_id || '') === String(book.id);
    if (grant.scope_type === 'publisher') return String(grant.scope_key || '').toLocaleLowerCase('tr') === publisher;
    if (grant.scope_type === 'subject') return subjects.includes(String(grant.scope_key || '').toLocaleLowerCase('tr'));
    if (grant.scope_type === 'collection') return (book.collection_ids || []).map(String).includes(String(grant.scope_id || ''));
    return false;
  });
}
