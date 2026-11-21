import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { importDom } from './helpers/import-dom.mjs';
import { createBookCard } from '../public/manager/book-card.mjs';
const source = await fs.readFile(new URL('../public/manager/app.mjs', import.meta.url), 'utf8'),
  focus = source.slice(
    source.indexOf('function captureManagerFocus()'),
    source.indexOf('\nfunction editorFields'),
  );
function fixture() {
  const { doc, root } = importDom();
  globalThis.document = doc;
  const create = doc.createElement.bind(doc);
  const all = () => {
    const list = [];
    function visit(n) {
      list.push(n);
      n.children.forEach(visit);
    }
    visit(root);
    return list;
  };
  doc.createElement = (tag) => {
    const n = create(tag);
    n.style = { setProperty() {} };
    n.closest = (selector) => {
      for (let p = n; p; p = p.parent) {
        if (
          (selector === '[data-book-id]' && p.dataset.bookId) ||
          (selector === '.book-actions' && p.className.split(' ').includes('book-actions')) ||
          (selector === '.book-card' && p.className.split(' ').includes('book-card'))
        )
          return p;
      }
      return null;
    };
    const query = n.querySelector.bind(n);
    n.querySelector = (selector) =>
      selector === '.book-cover-button'
        ? all().find(
            (x) => x.closest('[data-book-id]') === n && x.className === 'book-cover-button',
          )
        : query(selector);
    n.getClientRects = () =>
      n.closest('.book-actions') && !n.closest('.book-actions').open && n.tagName !== 'SUMMARY'
        ? []
        : [{}];
    return n;
  };
  const card = (id) =>
    createBookCard(
      { id, title: id, authors: ['Author'], status: 'to-read', order: 0 },
      {
        manual: true,
        index: 1,
        count: 3,
        onInspect() {},
        onEdit() {},
        onDelete() {},
        onMove() {},
        onDrop() {},
      },
    );
  let a = card('a'),
    b = card('b');
  root.append(a, b);
  const search = doc.createElement('input');
  search.id = 'collection-search';
  root.append(search);
  doc.querySelectorAll = (selector) =>
    all().filter((n) => selector === '.book-card' && n.className.split(' ').includes('book-card'));
  doc.querySelector = (selector) => {
    const match = selector.match(/data-focus-key="([^"]+)"/);
    return match ? all().find((n) => n.dataset.focusKey === match[1]) : null;
  };
  const c = vm.createContext({
    document: doc,
    $: (id) => all().find((n) => n.id === id),
    CSS: { escape: (x) => x },
  });
  vm.runInContext(focus, c);
  return { doc, root, c, card, all, search };
}
test('every row action has a stable focus identity', () => {
  const f = fixture();
  for (const n of f
    .all()
    .filter((n) => n.closest('[data-book-id]') && ['BUTTON', 'SUMMARY'].includes(n.tagName))) {
    n.focus();
    const saved = vm.runInContext('captureManagerFocus()', f.c);
    assert.ok(saved?.key, 'Missing key for ' + n.tagName + ' ' + n.textContent);
  }
});
test('refresh restores an inner action and reopens its disclosure', () => {
  const f = fixture(),
    move = f.all().find((n) => n.textContent === 'Przesuń później');
  move.closest('.book-actions').open = true;
  move.focus();
  f.c.saved = vm.runInContext('captureManagerFocus()', f.c);
  f.root.replaceChildren(f.card('a'), f.card('b'), f.search);
  vm.runInContext('restoreManagerFocus(saved)', f.c);
  assert.equal(f.doc.activeElement?.textContent, 'Przesuń później');
  assert.equal(f.doc.activeElement?.isConnected, true);
  assert.equal(f.doc.activeElement.closest('.book-actions').open, true);
});
test('deleted focused card falls back to the nearest remaining cover', () => {
  const f = fixture(),
    cover = f.all().find((n) => n.dataset.focusKey === 'book:a');
  cover.focus();
  f.c.saved = vm.runInContext('captureManagerFocus()', f.c);
  f.root.replaceChildren(f.card('b'), f.search);
  vm.runInContext('restoreManagerFocus(saved)', f.c);
  assert.equal(f.doc.activeElement.dataset.focusKey, 'book:b');
});
test('empty collection restores focus to search after deleting the last card', () => {
  const f = fixture(),
    cover = f.all().find((n) => n.dataset.focusKey === 'book:a');
  cover.focus();
  f.c.saved = vm.runInContext('captureManagerFocus()', f.c);
  f.root.replaceChildren(f.search);
  vm.runInContext('restoreManagerFocus(saved)', f.c);
  assert.equal(f.doc.activeElement.id, 'collection-search');
});
