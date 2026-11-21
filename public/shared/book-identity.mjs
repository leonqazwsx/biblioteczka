const normalized = (v) =>
  typeof v === 'string'
    ? v.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pl')
    : '';
export function canonicalIsbn(isbn) {
  if (isbn == null || isbn === '') return null;
  if (typeof isbn !== 'string' || !/^(\d{13}|\d{9}[\dX])$/.test(isbn)) return null;
  const check = [...isbn].reduce(
    (sum, c, i) =>
      sum + (c === 'X' ? 10 : Number(c)) * (isbn.length === 13 ? (i % 2 ? 3 : 1) : 10 - i),
    0,
  );
  if (check % (isbn.length === 13 ? 10 : 11)) return null;
  if (isbn.length === 13) return isbn;
  const prefix = '978' + isbn.slice(0, 9),
    sum = [...prefix].reduce((n, c, i) => n + Number(c) * (i % 2 ? 3 : 1), 0);
  return prefix + ((10 - (sum % 10)) % 10);
}
export function createBookIdentityIndex(books = []) {
  const goodreads = new Map(),
    isbns = new Map(),
    titles = new Map();
  const key = (b) => JSON.stringify([normalized(b.title), normalized(b.authors?.[0])]);
  function add(b) {
    const isbn = canonicalIsbn(b.isbn),
      gr = b.goodreadsId || null;
    if (gr && !goodreads.has(gr)) goodreads.set(gr, b.id);
    if (isbn && !isbns.has(isbn)) isbns.set(isbn, b.id);
    const k = key(b);
    let bucket = titles.get(k);
    if (!bucket) {
      bucket = { first: b.id };
      titles.set(k, bucket);
    }
    if (!isbn && !Object.hasOwn(bucket, 'noIsbn')) bucket.noIsbn = b.id;
    if (!gr && !Object.hasOwn(bucket, 'noGoodreads')) bucket.noGoodreads = b.id;
    if (!isbn && !gr && !Object.hasOwn(bucket, 'neither')) bucket.neither = b.id;
  }
  function find(b) {
    const isbn = canonicalIsbn(b.isbn),
      gr = b.goodreadsId || null;
    if (gr && goodreads.has(gr)) return { id: goodreads.get(gr), reason: 'goodreads' };
    if (isbn && isbns.has(isbn)) return { id: isbns.get(isbn), reason: 'isbn' };
    const bucket = titles.get(key(b));
    if (!bucket) return null;
    const field = isbn && gr ? 'neither' : isbn ? 'noIsbn' : gr ? 'noGoodreads' : 'first';
    return Object.hasOwn(bucket, field) ? { id: bucket[field], reason: 'title-author' } : null;
  }
  for (const b of books) add(b);
  return { find, add };
}
