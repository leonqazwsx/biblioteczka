import { compact } from './helpers/source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const { createBookMotion, loadBookCover } = await import(
  '../public/wallpaper/book-motion.mjs'
).catch(() => ({}));
class FakeAnimation {
  constructor(frames, options) {
    this.frames = frames;
    this.options = options;
    this.finished = new Promise((r, j) => {
      this.resolve = r;
      this.reject = j;
    });
  }
  finish() {
    this.done = true;
    this.resolve();
  }
  reverse() {
    this.reversed = true;
    if (this.done) {
      this.done = false;
      this.finished = new Promise((r, j) => {
        this.resolve = r;
        this.reject = j;
      });
    }
  }
  cancel() {
    this.cancelled = true;
    this.reject(Error('cancelled'));
  }
}
class Node extends EventTarget {
  constructor(doc, tag = 'div') {
    super();
    this.ownerDocument = doc;
    this.tagName = tag.toUpperCase();
    this.dataset = {};
    this.attrs = new Map();
    this.children = [];
    this.hidden = false;
    this.isConnected = true;
    this.textContent = '';
    this.styles = new Map();
    this.style = {
      setProperty: (k, v) => this.styles.set(k, String(v)),
      getPropertyValue: (k) => this.styles.get(k) ?? '',
    };
    this.classes = new Set();
    this.classList = {
      add: (n) => this.classes.add(n),
      remove: (n) => this.classes.delete(n),
      contains: (n) => this.classes.has(n),
    };
    this.animations = [];
  }
  setAttribute(k, v) {
    this.attrs.set(k, String(v));
  }
  getAttribute(k) {
    return this.attrs.get(k) ?? null;
  }
  removeAttribute(k) {
    this.attrs.delete(k);
  }
  append(...nodes) {
    for (const n of nodes) {
      n.parent = this;
      this.children.push(n);
    }
  }
  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }
  contains(node) {
    return node === this || this.children.some((child) => child.contains(node));
  }
  focus() {
    this.ownerDocument.activeElement = this;
  }
  getBoundingClientRect() {
    return this.rect ?? { left: 400, top: 385, width: 18, height: 70 };
  }
  querySelector(s) {
    if (s === '.spine-visual') return this.visual ?? null;
    if (s === '.book-motion-info-content') return this.content ?? null;
    return null;
  }
  querySelectorAll(s) {
    return s === '.book' ? (this.books ?? []) : [];
  }
  closest(s) {
    return s === '.book' && this.classes.has('book') ? this : (this.parent?.closest(s) ?? null);
  }
  cloneNode() {
    const n = new Node(this.ownerDocument, this.tagName);
    n.className = this.className;
    return n;
  }
  animate(frames, options) {
    const a = new FakeAnimation(frames, options);
    this.animations.push(a);
    return a;
  }
}
const book = (id = 'one') => ({
  id,
  title: 'Książka ' + id,
  authors: ['Autor'],
  coverId: 'a'.repeat(64),
});
function fixture(options = {}) {
  assert.equal(typeof createBookMotion, 'function');
  const target = new EventTarget();
  target.createElement = (tag) => new Node(target, tag);
  target.body = new Node(target, 'body');
  target.activeElement = target.body;
  target.hidden = false;
  target.dialog = false;
  target.querySelector = () => (target.dialog ? {} : null);
  const root = new Node(target),
    volume = new Node(target, 'button'),
    shadow = new Node(target),
    info = new Node(target),
    closeButton = new Node(target, 'button'),
    caption = new Node(target),
    status = new Node(target),
    windowTarget = new EventTarget(),
    reducedMotion = new EventTarget();
  reducedMotion.matches = false;
  info.append(closeButton, caption);
  root.books = ['one', 'two', 'three'].map((id) => {
    const b = new Node(target, 'button');
    b.classList.add('book');
    b.dataset.bookId = id;
    b.visual = new Node(target, 'span');
    b.style.setProperty('--spine', '#234');
    return b;
  });
  root.append(...root.books);
  const image = () =>
      Object.assign(new Node(target, 'img'), { naturalWidth: 130, naturalHeight: 200 }),
    details = [],
    authorNode = new Node(target),
    genreNode = new Node(target),
    dateNode = new Node(target);
  info.content = new Node(target);
  info.content.scrollTop = 0;
  info.content.append(caption, authorNode, genreNode, dateNode);
  info.replaceChildren(closeButton, info.content);
  info.rect = { left: 0, top: 0, width: 260, height: 148 };
  const control = createBookMotion({
    root,
    volume,
    shadow,
    info,
    closeButton,
    caption,
    author: authorNode,
    genre: genreNode,
    date: dateNode,
    status,
    target,
    windowTarget,
    reducedMotion,
    viewport: () => ({ width: 1280, height: 720 }),
    getIconSpace: () => 0.2,
    onDetails: (b) => details.push(b),
    loadCover: async () => image(),
    ...options,
  });
  const emit = (node, type, fields = {}) => {
    const e = new Event(type);
    for (const [k, v] of Object.entries(fields)) Object.defineProperty(e, k, { value: v });
    node.dispatchEvent(e);
  };
  const flush = () => new Promise(setImmediate);
  const finish = () => {
    volume.animations.at(-1)?.finish();
    shadow.animations.at(-1)?.finish();
  };
  return {
    root,
    volume,
    shadow,
    info,
    closeButton,
    caption,
    authorNode,
    genreNode,
    dateNode,
    status,
    target,
    windowTarget,
    reducedMotion,
    control,
    image,
    details,
    emit,
    flush,
    finish,
    source: (id) => root.books.find((b) => b.dataset.bookId === id),
    open: async (id = 'one') => {
      const p = control.open(book(id));
      await flush();
      finish();
      await p;
    },
    close: async () => {
      const p = control.close();
      finish();
      await p;
    },
  };
}
test('idle control has no active cover or controls; opening preserves source layout and uses2x', async () => {
  const f = fixture();
  assert.equal(f.control.isActive(), false);
  assert.equal(f.volume.hidden, true);
  const before = f.source('one').getBoundingClientRect();
  await f.open();
  assert.equal(f.control.isActive(), true);
  assert.equal(f.info.hidden, false);
  assert.equal(f.source('one').classList.contains('book-in-hand'), true);
  assert.deepEqual(f.source('one').getBoundingClientRect(), before);
  assert.equal(f.volume.animations[0].options.duration, 820);
  assert.match(f.volume.animations[0].frames.at(-1).transform, /scale3d\(1,1,1\)/);
  assert.equal(f.root.books.filter((b) => b.classList.contains('book-in-hand')).length, 1);
  f.control.destroy();
});
test('latest cover response wins and superseded image cannot create an old overlay', async () => {
  let first, second;
  const f = fixture({
    loadCover: (b) =>
      new Promise((r) => {
        if (b.id === 'one') first = r;
        else second = r;
      }),
  });
  const a = f.control.open(book()),
    b = f.control.open(book('two'));
  second(f.image());
  await f.flush();
  f.finish();
  await b;
  first(f.image());
  await a;
  assert.match(f.volume.getAttribute('aria-label'), /two/);
  assert.equal(f.source('one').classList.contains('book-in-hand'), false);
  f.control.destroy();
});
test('Escape during loading aborts and a late image cannot hide a source', async () => {
  let release, signal;
  const f = fixture({
    loadCover: (b, options) => {
      signal = options.signal;
      return new Promise((r) => (release = r));
    },
  });
  const p = f.control.open(book());
  f.emit(f.target, 'keydown', { key: 'Escape' });
  assert.equal(signal.aborted, true);
  release(f.image());
  await p;
  assert.equal(f.control.isActive(), false);
  assert.equal(f.volume.hidden, true);
  assert.equal(f.source('one').classList.contains('book-in-hand'), false);
});
test('same selection returns and rapid further selections settle on the latest book', async () => {
  const f = fixture();
  await f.open();
  const returning = f.control.open(book());
  assert.equal(f.volume.animations.length, 2);
  const a = f.control.open(book('two')),
    b = f.control.open(book('three'));
  f.finish();
  await returning;
  await f.flush();
  f.finish();
  await Promise.all([a, b]);
  assert.match(f.volume.getAttribute('aria-label'), /three/);
  assert.equal(f.root.books.filter((x) => x.classList.contains('book-in-hand')).length, 1);
  f.control.destroy();
});
test('keyboard opening focuses unscaled return control, then restores source on return', async () => {
  const f = fixture();
  f.source('one').focus();
  f.emit(f.target, 'keydown', { key: 'Enter' });
  await f.open();
  assert.equal(f.target.activeElement, f.closeButton);
  await f.close();
  assert.equal(f.target.activeElement, f.source('one'));
  assert.equal(f.info.hidden, true);
  assert.equal(f.control.isActive(), false);
});
test('return does not steal focus from another control', async () => {
  const f = fixture();
  await f.open();
  const p = f.control.close();
  f.source('two').focus();
  f.finish();
  await p;
  assert.equal(f.target.activeElement, f.source('two'));
});
test('opening completion preserves intervening keyboard focus and pointer activation intent', async () => {
  for (const keyboard of [true, false]) {
    const f = fixture();
    f.source('one').focus();
    if (keyboard) f.emit(f.target, 'keydown', { key: 'Enter' });
    const p = f.control.open(book());
    await f.flush();
    f.emit(f.target, 'keydown', { key: 'Tab' });
    f.source('two').focus();
    f.finish();
    await p;
    assert.equal(f.target.activeElement, f.source('two'));
    f.control.destroy();
  }
});
test('rotating spine preserves noninteractive material and pattern styling context', async () => {
  const f = fixture();
  f.source('one').dataset.style = '4';
  f.source('one').dataset.material = 'paper';
  await f.open();
  const spine = f.volume.children.find((n) => n.className.includes('book-volume-spine')),
    context = spine.children[0];
  assert.equal(context.className, 'spine-art');
  assert.equal(context.tagName, 'SPAN');
  assert.equal(context.dataset.style, '4');
  assert.equal(context.dataset.material, 'paper');
  assert.equal(context.getAttribute('aria-hidden'), 'true');
  assert.ok(context.children.length);
  f.control.destroy();
});
test('missing cover, image failure and unavailable animation use existing details without hiding source', async () => {
  for (const mode of ['missing', 'failure', 'unsupported']) {
    const f = fixture(
      mode === 'failure'
        ? {
            loadCover: async () => {
              throw Error('broken image');
            },
          }
        : {},
    );
    if (mode === 'unsupported') f.volume.animate = undefined;
    const b = book();
    if (mode === 'missing') b.coverId = null;
    await f.control.open(b);
    assert.equal(f.details.length, 1, mode);
    assert.equal(f.volume.hidden, true, mode);
    assert.equal(f.source('one').classList.contains('book-in-hand'), false, mode);
  }
});
test('reduced motion reveals and returns without creating a running animation', async () => {
  const f = fixture();
  f.reducedMotion.matches = true;
  await f.control.open(book());
  assert.equal(f.volume.animations.length, 0);
  assert.match(f.volume.style.transform, /scale3d\(1,1,1\)/);
  await f.control.close();
  assert.equal(f.volume.hidden, true);
});
test('resize, hidden document, native dialog and reset restore selected sources', async () => {
  for (const event of ['resize', 'hidden', 'dialog', 'reset']) {
    const f = fixture();
    await f.open();
    if (event === 'resize') f.emit(f.windowTarget, 'resize');
    if (event === 'hidden') {
      f.target.hidden = true;
      f.emit(f.target, 'visibilitychange');
    }
    if (event === 'dialog') {
      f.target.dialog = true;
      f.emit(f.target, 'focusin');
    }
    if (event === 'reset') f.control.reset();
    assert.equal(f.volume.hidden, true, event);
    assert.equal(f.source('one').classList.contains('book-in-hand'), false, event);
    f.control.destroy();
  }
});
test('destroy cancels pending work and animations and removes activation listeners', async () => {
  let release;
  const f = fixture({ loadCover: () => new Promise((r) => (release = r)) });
  const p = f.control.open(book());
  f.control.destroy();
  release(f.image());
  await p;
  f.emit(f.volume, 'click');
  await f.control.open(book());
  assert.equal(f.volume.hidden, true);
  assert.equal(f.details.length, 0);
  const g = fixture();
  const opened = g.control.open(book());
  await g.flush();
  g.control.destroy();
  await opened;
  assert.equal(g.volume.hidden, true);
  assert.equal(g.source('one').classList.contains('book-in-hand'), false);
});
test('background click returns book but another book or controls are not intercepted', async () => {
  const f = fixture();
  await f.open();
  f.emit(f.target, 'pointerdown', { target: f.source('two') });
  assert.equal(f.volume.animations.length, 1);
  f.emit(f.target, 'pointerdown', { target: f.closeButton });
  assert.equal(f.volume.animations.length, 1);
  f.emit(f.target, 'pointerdown', { target: f.target.body });
  assert.equal(f.volume.animations.length, 2);
  f.finish();
  await f.flush();
  assert.equal(f.volume.hidden, true);
});
test('wallpaper wires the foreground reveal and retains details, picker, gear and reduced motion', async () => {
  const html = await fs.readFile('public/wallpaper.html', 'utf8'),
    app = compact(await fs.readFile('public/wallpaper/app.mjs', 'utf8')),
    css = compact(await fs.readFile('public/styles/book-motion.css', 'utf8').catch(() => ''));
  assert.match(app, /createBookMotion/);
  assert.match(app, /onBook:openBook/);
  assert.match(app, /onBook:details/);
  assert.match(html, /id="book-motion-volume"[^>]*tabindex="-1"/);
  assert.match(html, /id="book-motion-info"/);
  assert.match(html, /id="wallpaper-settings-open"/);
  assert.match(css, /pointer-events:none/);
  assert.match(css, /\.book-in-hand\s*\{visibility:hidden/);
  assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch(css, /volume:focus-visible[^}]*outline:[1-9]/);
});
test('local cover loader rejects arbitrary URLs and handles load abort and timeout', async () => {
  assert.equal(typeof loadBookCover, 'function');
  const doc = {
    createElement: () => {
      const n = new Node(doc, 'img');
      doc.img = n;
      return n;
    },
  };
  await assert.rejects(loadBookCover({ coverId: 'https://example.org/image' }, { document: doc }));
  let timeout,
    cleared = 0;
  const clock = {
    setTimeout(fn) {
      timeout = fn;
      return 1;
    },
    clearTimeout() {
      cleared++;
    },
  };
  const loaded = loadBookCover(book(), { document: doc, clock });
  assert.equal(doc.img.src, '/covers/' + 'a'.repeat(64));
  doc.img.naturalWidth = 120;
  doc.img.naturalHeight = 200;
  doc.img.onload();
  assert.equal(await loaded, doc.img);
  assert.ok(cleared);
  const controller = new AbortController(),
    aborted = loadBookCover(book(), { document: doc, clock, signal: controller.signal });
  controller.abort();
  await assert.rejects(aborted, { name: 'AbortError' });
  const expired = loadBookCover(book(), { document: doc, clock });
  timeout();
  await assert.rejects(expired, /cover/i);
});
test('default cover timers preserve browser native receiver semantics', async () => {
  const beforeSet = globalThis.setTimeout,
    beforeClear = globalThis.clearTimeout;
  let cleared = false;
  globalThis.setTimeout = function () {
    if (this !== undefined && this !== globalThis) throw TypeError('Illegal invocation');
    return 1;
  };
  globalThis.clearTimeout = function () {
    if (this !== undefined && this !== globalThis) throw TypeError('Illegal invocation');
    cleared = true;
  };
  try {
    const doc = {
      createElement: () => {
        const image = new Node(doc, 'img');
        doc.image = image;
        return image;
      },
    };
    const loaded = loadBookCover(book(), { document: doc });
    doc.image.naturalWidth = 120;
    doc.image.naturalHeight = 200;
    doc.image.onload();
    assert.equal(await loaded, doc.image);
    assert.equal(cleared, true);
  } finally {
    globalThis.setTimeout = beforeSet;
    globalThis.clearTimeout = beforeClear;
  }
});
test('cover is decoded before it can be shown and abort during decode still wins', async () => {
  for (const abort of [false, true]) {
    let release,
      settled = false;
    const doc = {
        createElement: () => {
          const n = Object.assign(new Node(doc, 'img'), {
            naturalWidth: 800,
            naturalHeight: 1272,
            decode: () => new Promise((r) => (release = r)),
          });
          doc.image = n;
          return n;
        },
      },
      controller = new AbortController(),
      clock = { setTimeout: () => 1, clearTimeout() {} };
    const loaded = loadBookCover(book(), { document: doc, clock, signal: controller.signal });
    loaded.then(
      () => {
        settled = true;
      },
      () => {},
    );
    doc.image.onload();
    await new Promise(setImmediate);
    assert.equal(settled, false, 'onload alone must not expose a still-decoding image');
    if (abort) {
      controller.abort();
      await assert.rejects(loaded, { name: 'AbortError' });
      release();
    } else {
      release();
      assert.equal(await loaded, doc.image);
    }
  }
});
test('decode failure follows the existing cover failure path', async () => {
  const doc = {
    createElement: () => {
      const n = Object.assign(new Node(doc, 'img'), {
        naturalWidth: 800,
        naturalHeight: 1272,
        decode: () => Promise.reject(Error('decode failed')),
      });
      doc.image = n;
      return n;
    },
  };
  const loaded = loadBookCover(book(), { document: doc });
  doc.image.onload();
  await assert.rejects(loaded, /decode/i);
});
test('return has its own fast-start slow-end animation and source stays hidden until it finishes', async () => {
  const f = fixture();
  await f.open();
  const opening = f.volume.animations[0],
    p = f.control.close(),
    returning = f.volume.animations[1];
  assert.ok(returning, 'return must have an independent timeline');
  assert.notEqual(returning, opening);
  assert.equal(opening.cancelled, true);
  assert.equal(returning.options.duration, 680);
  assert.equal(returning.options.easing, 'cubic-bezier(.16,1,.3,1)');
  assert.equal(returning.frames[1].offset, 0.72);
  assert.equal(f.volume.hidden, false);
  assert.equal(f.source('one').classList.contains('book-in-hand'), true);
  f.finish();
  await p;
  assert.equal(f.volume.hidden, true);
  assert.equal(f.source('one').classList.contains('book-in-hand'), false);
});
test('interrupted opening returns from its current pose instead of jumping to the fully open cover', async () => {
  const live = 'matrix3d(current-pose)',
    f = fixture({ getTransform: () => live });
  const p = f.control.open(book());
  await f.flush();
  const returning = f.control.close();
  assert.equal(f.volume.animations[1]?.frames[0].transform, live);
  assert.equal(f.volume.animations[1].frames.length, 2);
  f.finish();
  await Promise.all([p, returning]);
  assert.equal(f.volume.hidden, true);
});
test('repeated return shares one animation and reset during return drains both animation promises', async () => {
  const f = fixture();
  await f.open();
  const a = f.control.close(),
    b = f.control.close();
  assert.equal(f.volume.animations.length, 2);
  f.control.reset();
  await Promise.all([a, b]);
  await f.flush();
  assert.equal(f.volume.hidden, true);
  assert.equal(f.source('one').classList.contains('book-in-hand'), false);
});

test('return keeps the shadow at its displayed position while fading', async () => {
  const f = fixture();
  await f.open();
  f.windowTarget.getComputedStyle = (node) => ({
    transform: node === f.shadow ? 'matrix(1, 0, 0, 1, 420, 325)' : f.volume.style.transform,
    opacity: '.45',
  });
  const p = f.control.close();
  assert.equal(f.shadow.style.transform, 'matrix(1, 0, 0, 1, 420, 325)');
  f.finish();
  await p;
});

test('failed shadow creation restores the source without an unhandled volume completion', async () => {
  for (const phase of ['opening', 'return']) {
    const f = fixture();
    if (phase === 'return') await f.open();
    f.shadow.animate = () => {
      throw Error('animation unavailable');
    };
    if (phase === 'return') await f.control.close();
    else await f.control.open(book());
    await f.flush();
    assert.equal(f.volume.hidden, true, phase);
    assert.equal(f.source('one').classList.contains('book-in-hand'), false, phase);
    f.control.destroy();
  }
});

test('stale return cleanup cannot unhide a freshly reopened same source', async () => {
  const f = fixture();
  await f.open();
  const returning = f.control.close();
  f.control.reset();
  const reopening = f.control.open(book());
  await f.flush();
  assert.equal(f.control.isActive(), true);
  assert.equal(f.volume.hidden, false);
  assert.equal(f.source('one').classList.contains('book-in-hand'), true);
  f.finish();
  await Promise.all([returning, reopening]);
  f.control.destroy();
});

test('ordinary window blur does not discard a visible opening', async () => {
  const f = fixture();
  const opened = f.control.open(book());
  await f.flush();
  f.emit(f.windowTarget, 'blur');
  assert.equal(f.volume.hidden, false);
  assert.equal(f.source('one').classList.contains('book-in-hand'), true);
  f.finish();
  await opened;
  f.control.destroy();
});

test('window blur preserves the selected cover and an in-flight requested return', async () => {
  const f = fixture();
  await f.open();
  f.emit(f.windowTarget, 'blur');
  assert.equal(f.volume.hidden, false);
  const p = f.control.close(),
    returning = f.volume.animations.at(-1);
  f.emit(f.windowTarget, 'blur');
  assert.notEqual(returning.cancelled, true);
  assert.equal(f.volume.hidden, false);
  assert.equal(f.source('one').classList.contains('book-in-hand'), true);
  f.finish();
  await p;
  assert.equal(f.volume.hidden, true);
  assert.equal(f.source('one').classList.contains('book-in-hand'), false);
  f.control.destroy();
});

test('attached info contains full title authors current genre and calendar reading date', async () => {
  const f = fixture({ getGenre: () => 'Science fiction' }),
    b = {
      ...book(),
      title: 'Pełny <tytuł> & dalszy ciąg',
      authors: ['Autor pierwszy', 'Autor drugi'],
      readDate: '2024-02-29',
    };
  const p = f.control.open(b);
  await f.flush();
  f.finish();
  await p;
  assert.equal(f.caption.textContent, b.title);
  assert.equal(f.authorNode.textContent, 'Autor pierwszy, Autor drugi');
  assert.equal(f.genreNode.textContent, 'Science fiction');
  assert.equal(f.dateNode.textContent, 'Przeczytano: 29.02.2024');
  f.control.destroy();
});
test('missing reading date and genre are stated without inventing metadata', async () => {
  const f = fixture();
  await f.open();
  assert.equal(f.genreNode.textContent, 'Bez gatunku');
  assert.equal(f.dateNode.textContent, 'Data przeczytania nieuzupełniona');
  f.control.destroy();
});
test('info appears only after opening and hides before return while the source stays hidden', async () => {
  const f = fixture();
  const p = f.control.open(book());
  await f.flush();
  assert.equal(f.info.dataset.ready, 'false');
  assert.equal(f.info.inert, true);
  f.finish();
  await p;
  assert.equal(f.info.dataset.ready, 'true');
  assert.equal(f.info.inert, false);
  assert.equal(f.info.style.width, '260px');
  assert.equal(f.info.style.maxHeight, '148px');
  const returned = f.control.close();
  assert.equal(f.info.hidden, true);
  assert.equal(f.source('one').classList.contains('book-in-hand'), true);
  f.finish();
  await returned;
  assert.equal(f.volume.hidden, true);
  f.control.destroy();
});
test('each reopened information card starts at the beginning of its content', async () => {
  const f = fixture();
  await f.open();
  f.info.content.scrollTop = 221;
  await f.close();
  await f.open();
  assert.equal(f.info.content.scrollTop, 0);
  f.control.destroy();
});
