import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, applyCommand } from '../src/domain.mjs';
import { renderScene } from '../public/wallpaper/scene-renderer.mjs';
class Element {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.dataset = {};
    this.style = {
      setProperty(k, v) {
        this[k] = v;
      },
    };
    this.classList = { add() {} };
  }
  append(...nodes) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes) {
    this.children = nodes;
  }
  setAttribute(k, v) {
    this[k] = v;
  }
  addEventListener() {}
  remove() {
    this.removed = true;
  }
}
function dom(t) {
  const prev = globalThis.document;
  globalThis.document = {
    body: new Element('body'),
    createElement: (tag) => new Element(tag),
    createElementNS: (_, tag) => new Element(tag),
  };
  t.after(() => (globalThis.document = prev));
  return new Element('main');
}
function fixture() {
  let s = createInitialState();
  s = applyCommand(s, {
    type: 'addBook',
    draft: { title: 'A', authors: ['B'], shelfId: 'fantasy', status: 'read' },
  });
  s.settings.roomLayouts = {
    [s.settings.room]: {
      enabled: true,
      cavities: {
        'top-left': { source: null, decoration: 'plant' },
        'top-right': { source: null, decoration: 'vase' },
      },
      placements: {},
    },
  };
  return s;
}
const params = (state) => ({
  state,
  page: 0,
  width: 1920,
  height: 1080,
  onBook() {},
  onTooltip() {},
  onLeave() {},
});
test('legacy decorations are not rendered and books retain their placement', (t) => {
  const root = dom(t),
    s = fixture();
  renderScene(root, params(s));
  const sections = root.children.filter((n) => n.className === 'room-cavity');
  assert.equal(
    sections.flatMap((section) => section.children).filter((n) => n.className === 'room-decoration')
      .length,
    0,
  );
  assert.equal(
    sections.flatMap((section) => section.children).filter((n) => n.tagName === 'button').length,
    1,
  );
});
test('embedded preview scopes lighting and keeps geometry across day and evening', (t) => {
  const root = dom(t),
    s = fixture();
  document.body.style.background = 'original';
  s.settings.lighting = 'day';
  renderScene(root, { ...params(s), embedded: true });
  const first = root.children
    .filter((n) => n.className === 'room-cavity')
    .map((n) => ({
      left: n.style.left,
      top: n.style.top,
      width: n.style.width,
      height: n.style.height,
    }));
  assert.equal(document.body.style.background, 'original');
  assert.equal(document.body.dataset.sceneLighting, undefined);
  assert.equal(root.dataset.sceneLighting, 'day');
  s.settings.lighting = 'evening';
  renderScene(root, { ...params(s), embedded: true });
  assert.equal(root.dataset.sceneLighting, 'evening');
  assert.deepEqual(
    root.children
      .filter((n) => n.className === 'room-cavity')
      .map((n) => ({
        left: n.style.left,
        top: n.style.top,
        width: n.style.width,
        height: n.style.height,
      })),
    first,
  );
});
test('automatic/default layout does not create decoration images', (t) => {
  const root = dom(t),
    s = createInitialState();
  renderScene(root, params(s));
  assert.equal(
    root.children.flatMap((n) => n.children).filter((n) => n.className === 'room-decoration')
      .length,
    0,
  );
});
