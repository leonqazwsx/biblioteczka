import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeIsbn,
  createOpenLibraryCatalog as createCatalog,
} from '../src/open-library-catalog.mjs';
test('ISBN normalizes valid input and rejects wrong checksums', () => {
  assert.equal(normalizeIsbn('978-0-14-032872-1'), '9780140328721');
  assert.equal(normalizeIsbn('0-14-032872-6'), '0140328726');
  assert.equal(normalizeIsbn('Solaris'), null);
  assert.throws(
    () => normalizeIsbn('9780140328722'),
    (e) => e.code === 'INVALID_ISBN',
  );
});
const clock = { now: () => Date.now(), sleep: async () => {} };
test('search uses actual query and exposes partial metadata honestly', async () => {
  let url;
  const c = createCatalog({
    clock,
    fetchImpl: async (u) => {
      url = new URL(u);
      return Response.json({
        docs: [
          {
            key: '/works/OL1W',
            title: 'Solaris',
            author_name: ['Stanisław Lem'],
            cover_edition_key: 'OL1M',
            cover_i: 5,
          },
          { key: '/works/OL2W', title: 'Bez autora' },
        ],
      });
    },
  });
  const r = await c.search('Solaris');
  assert.equal(url.searchParams.get('q'), 'Solaris');
  assert.equal(url.searchParams.get('limit'), '20');
  assert.equal(r[0].editionId, '/books/OL1M');
  assert.equal(r[1].coverId, null);
  assert.deepEqual(r[1].authors, []);
  assert.equal(r[1].language, null);
});
test('ISBN resolves one edition and its author, never guesses language', async () => {
  const c = createCatalog({
    clock,
    fetchImpl: async (u) =>
      new URL(u).pathname.startsWith('/authors/')
        ? Response.json({ name: 'Roald Dahl' })
        : Response.json({
            key: '/books/OL7353617M',
            title: 'Matilda',
            authors: [{ key: '/authors/OL1A' }],
            isbn_13: ['9780140328721'],
            publishers: ['Puffin'],
            covers: [99],
            number_of_pages: 240,
          }),
  });
  const [r] = await c.search('9780140328721');
  assert.equal(r.id, '/books/OL7353617M');
  assert.deepEqual(r.authors, ['Roald Dahl']);
  assert.equal(r.language, null);
  assert.equal(r.isbn, '9780140328721');
});
test('catalog failures and unsafe edition identifiers are rejected', async () => {
  const c = createCatalog({ clock, fetchImpl: async () => new Response('', { status: 429 }) });
  await assert.rejects(
    () => c.search('Solaris'),
    (e) => e.code === 'CATALOG_UNAVAILABLE',
  );
  await assert.rejects(() => c.resolveEdition('../secrets'));
});
test('search displays the matching Polish edition with its cover and identity', async () => {
  let url;
  const c = createCatalog({
    clock,
    fetchImpl: async (u) => {
      url = new URL(u);
      return Response.json({
        docs: [
          {
            key: '/works/OL1W',
            title: 'The Witcher',
            author_name: ['Andrzej Sapkowski'],
            cover_edition_key: 'OL99M',
            cover_i: 99,
            editions: {
              docs: [
                { key: '/books/OL42M', title: 'Ostatnie życzenie', cover_i: 42, language: ['pol'] },
              ],
            },
          },
        ],
      });
    },
  });
  const [result] = await c.search('Sapkowski');
  assert.equal(url.searchParams.get('lang'), 'pl');
  assert.ok(url.searchParams.get('fields').includes('editions'));
  assert.equal(result.title, 'Ostatnie życzenie');
  assert.equal(result.editionId, '/books/OL42M');
  assert.equal(result.coverId, 42);
  assert.equal(result.language, 'pol');
});
test('search returns bounded work subjects for category suggestions', async () => {
  let url;
  const c = createCatalog({
    clock,
    fetchImpl: async (u) => {
      url = new URL(u);
      return Response.json({
        docs: [
          {
            key: '/works/OL1W',
            title: 'Solaris',
            subject: ['Science fiction', 42, 'x'.repeat(200), 'Science fiction'],
          },
        ],
      });
    },
  });
  const [r] = await c.search('Solaris');
  assert.ok(url.searchParams.get('fields').split(',').includes('subject'));
  assert.deepEqual(r.subjects, ['Science fiction']);
});
test('ISBN editions receive topics from their work while topic failure stays optional', async () => {
  const record = {
    key: '/books/OL1M',
    title: 'Matilda',
    authors: [],
    works: [{ key: '/works/OL2W' }],
  };
  const c = createCatalog({
    clock,
    fetchImpl: async (u) =>
      Response.json(
        new URL(u).pathname.startsWith('/works/')
          ? { subjects: ['Juvenile fiction', 'Fantasy'] }
          : record,
      ),
  });
  assert.deepEqual((await c.search('9780140328721'))[0].subjects, ['Juvenile fiction', 'Fantasy']);
  const offlineWork = createCatalog({
    clock,
    fetchImpl: async (u) => {
      if (new URL(u).pathname.startsWith('/works/')) throw new Error('offline topics');
      return Response.json(record);
    },
  });
  const [r] = await offlineWork.search('9780140328721');
  assert.equal(r.title, 'Matilda');
  assert.deepEqual(r.subjects, []);
});
