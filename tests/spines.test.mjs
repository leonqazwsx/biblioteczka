import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSpine, contrastRatio } from '../public/shared/spines.mjs';
test('spine is stable, uses supplied cover color and readable foreground', () => {
  const b = { title: 'Solaris', authors: ['Stanisław Lem'], pageCount: 300, palette: ['#23435a'] };
  const a = makeSpine(b);
  assert.deepEqual(makeSpine(b), a);
  assert.equal(a.palette[0], '#23435a');
  assert.ok(contrastRatio(a.palette[0], a.foreground) >= 4.5);
  assert.ok(a.width >= 46 && a.width <= 96);
});
test('missing cover still has deterministic colors and bounded width', () => {
  const b = { title: 'Lalka', authors: ['Prus'], pageCount: null };
  assert.deepEqual(makeSpine(b), makeSpine(b));
  assert.equal(makeSpine({ ...b, pageCount: 100000 }).width, 96);
  assert.ok(contrastRatio(makeSpine(b).palette[0], makeSpine(b).foreground) >= 4.5);
});
test('saved style is preserved and cover palette supplies an accent', () => {
  const visual = makeSpine({
    title: 'Żółć i źdźbło',
    authors: ['Łukasz Ćwik'],
    palette: ['#23435a', '#d6aa64'],
    spineStyle: 4,
  });
  assert.equal(visual.spineStyle, 4);
  assert.equal(visual.accent, '#d6aa64');
  assert.ok(contrastRatio(visual.accent, visual.accentForeground) >= 4.5);
});

test('binding materials remain stable when reading metadata changes', () => {
  const original = {
    title: 'Solaris',
    authors: ['Stanisław Lem'],
    pageCount: 300,
    spineStyle: 3,
    status: 'to-read',
  };
  const material = makeSpine(original).material;
  assert.ok(
    ['paper', 'cloth', 'hardcover'].includes(material),
    'a binding needs a supported surface',
  );
  assert.equal(
    makeSpine({ ...original, status: 'read', readDate: '2026-10-10', shelfId: 'science-fiction' })
      .material,
    material,
  );
  assert.equal(
    makeSpine({ ...original, title: 'Solaris — poprawiony tytuł', authors: ['S. Lem'] }).material,
    material,
  );
});
