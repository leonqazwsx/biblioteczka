import test from 'node:test';
import assert from 'node:assert/strict';
const { suggestCategory, suggestShelf, CATEGORY_PRESETS } = await import(
  '../public/shared/categories.mjs'
).catch(() => ({}));
test('specific catalog genres outrank generic fiction and English/Polish names work', () => {
  assert.equal(typeof suggestCategory, 'function');
  for (const [topics, name] of [
    [['Fiction', 'Science fiction'], 'Science fiction'],
    [['Detective and mystery stories', 'Fiction'], 'Kryminał'],
    [['Romance fiction'], 'Romans'],
    [['Biography'], 'Biografie'],
    [['History'], 'Historia'],
    [['Juvenile fiction', 'Fantasy'], 'Dzieci i młodzież'],
    [['Self-help'], 'Poradniki'],
    [['Science'], 'Literatura popularnonaukowa'],
    [['Comics and graphic novels'], 'Komiksy'],
    [['Nonfiction'], 'Literatura faktu'],
    [['Fiction'], 'Literatura piękna'],
    [['Powieść kryminalna'], 'Kryminał'],
  ])
    assert.equal(suggestCategory(topics)?.name, name);
});
test('missing and equally competing genres are honest fallbacks without title guessing', () => {
  assert.equal(typeof suggestCategory, 'function');
  for (const topics of [[], null, ['Unknown subject'], ['Fantasy', 'Mystery']])
    assert.equal(suggestCategory(topics), null);
});
test('shelf matching honors names after renaming and offers a new category atomically', () => {
  assert.equal(typeof suggestShelf, 'function');
  const shelves = [
    { id: 'fantasy', name: 'Moje ulubione' },
    { id: 'mine', name: 'Science fiction' },
    { id: 'other', name: 'Pozostałe' },
  ];
  assert.equal(suggestShelf(['Science fiction'], shelves).shelfId, 'mine');
  const withoutAlias = shelves.filter((s) => s.id !== 'mine');
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(suggestShelf(['Fantasy'], withoutAlias)).filter(([k]) =>
        ['shelfId', 'newShelfName'].includes(k),
      ),
    ),
    { shelfId: null, newShelfName: 'Fantasy' },
  );
  assert.equal(suggestShelf([], shelves).shelfId, 'other');
  assert.equal(suggestShelf([], []).newShelfName, 'Pozostałe');
});
test('expanded presets offer literal categories and specific topics beat broad catalog labels', () => {
  const cases = [
    [['Horror fiction', 'Fiction'], 'Horror'],
    [['Historical fiction', 'History'], 'Powieść historyczna'],
    [['Poetry', 'Fiction'], 'Poezja'],
    [['Drama', 'Literature'], 'Dramat'],
    [['Psychology', 'Science'], 'Psychologia'],
    [['Philosophy', 'Nonfiction'], 'Filozofia'],
    [['Business & Economics', 'Nonfiction'], 'Biznes i ekonomia'],
    [['Technology & Engineering', 'Science'], 'Technologia'],
    [['Travel guides', 'Nonfiction'], 'Podróże'],
    [['Cookbooks', 'Self-help'], 'Kulinaria'],
    [['Sports & Recreation', 'Nonfiction'], 'Sport'],
    [['Art', 'Nonfiction'], 'Sztuka'],
    [['Religion and spirituality', 'Nonfiction'], 'Religia i duchowość'],
    [['Powieść historyczna'], 'Powieść historyczna'],
    [['Psychologia'], 'Psychologia'],
    [['Kulinaria'], 'Kulinaria'],
  ];
  for (const [subjects, name] of cases) {
    assert.equal(suggestCategory(subjects)?.name, name, subjects.join(', '));
    assert.equal(suggestShelf(subjects, []).newShelfName, name);
  }
  assert.ok(Array.isArray(CATEGORY_PRESETS));
  assert.ok(CATEGORY_PRESETS.every((name) => typeof name === 'string'));
  assert.equal(new Set(CATEGORY_PRESETS).size, CATEGORY_PRESETS.length);
  for (const [, name] of cases) assert.ok(CATEGORY_PRESETS.includes(name));
});
test('expanded equally specific competing categories keep the fallback honest', () => {
  for (const topics of [
    ['Horror', 'Mystery'],
    ['Historical fiction', 'Romance fiction'],
    ['Poetry', 'Drama'],
  ])
    assert.equal(suggestCategory(topics), null);
  assert.equal(suggestShelf(['Horror', 'Mystery'], []).newShelfName, 'Pozostałe');
});
test('expanded Polish aliases reuse an existing shelf without mutating assignments', () => {
  const shelves = [
      { id: 'art', name: 'Arts' },
      { id: 'religion', name: 'Duchowość' },
      { id: 'food', name: 'Gotowanie' },
    ],
    before = structuredClone(shelves);
  for (const [subjects, id] of [
    [['Sztuka'], 'art'],
    [['Religion'], 'religion'],
    [['Cooking'], 'food'],
  ])
    assert.equal(suggestShelf(subjects, shelves).shelfId, id);
  assert.deepEqual(shelves, before);
});
