import { bookMotionGeometry } from './book-motion-geometry.mjs';
import { readingDateLabel } from '../shared/reading-date.mjs';
import { t } from '../shared/i18n.mjs';

export function loadBookCover(
  book,
  {
    document = globalThis.document,
    signal,
    clock = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id) },
    timeoutMs = 3000,
  } = {},
) {
  return new Promise((resolve, reject) => {
    if (!/^[a-f0-9]{64}$/.test(book?.coverId ?? '')) {
      reject(Error('Invalid local cover'));
      return;
    }
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const image = document.createElement('img');
    let settled = false,
      timer;
    function finish(error) {
      if (settled) return;
      settled = true;
      clock.clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      signal?.removeEventListener('abort', abort);
      if (error) {
        image.removeAttribute('src');
        reject(error);
      } else resolve(image);
    }
    function abort() {
      finish(new DOMException('Aborted', 'AbortError'));
    }
    image.alt = '';
    image.draggable = false;
    image.decoding = 'async';
    image.onload = () => {
      if (!(image.naturalWidth > 0 && image.naturalHeight > 0)) {
        finish(Error('Invalid cover dimensions'));
        return;
      }
      if (typeof image.decode !== 'function') {
        finish();
        return;
      }
      try {
        image.decode().then(
          () => finish(),
          () => finish(Error('Cover decode failed')),
        );
      } catch {
        finish(Error('Cover decode failed'));
      }
    };
    image.onerror = () => finish(Error('Cover unavailable'));
    timer = clock.setTimeout(() => finish(Error('Cover timed out')), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    image.src = '/covers/' + book.coverId;
  });
}

export function createBookMotion({
  root,
  volume,
  shadow,
  info,
  closeButton,
  caption,
  author,
  genre,
  date,
  status,
  onDetails,
  onStart = () => {},
  getGenre = () => null,
  viewport = () => ({ width: innerWidth, height: innerHeight }),
  getIconSpace = () => 0.2,
  target = document,
  windowTarget = window,
  reducedMotion = windowTarget.matchMedia('(prefers-reduced-motion: reduce)'),
  loadCover = (book, options) => loadBookCover(book, { ...options, document: target }),
  getTransform = (element) =>
    windowTarget.getComputedStyle?.(element)?.transform ?? element.style.transform,
}) {
  let active = null,
    pending = null,
    serial = 0,
    disposed = false,
    keyboard = false;
  const blocked = () => !!target.querySelector('dialog[open]');
  const isActive = () => !!(active || pending);
  function hideInfo() {
    info.hidden = true;
    info.dataset.ready = 'false';
    info.inert = true;
  }
  function hide() {
    volume.hidden = true;
    hideInfo();
    shadow.hidden = true;
    volume.replaceChildren();
    volume.setAttribute('aria-busy', 'false');
    status.textContent = '';
  }
  function invalidate() {
    serial++;
    pending?.controller.abort();
    pending = null;
  }
  function clean(current, restoreFocus = false) {
    current.animation?.cancel();
    current.shadowAnimation?.cancel();
    if (active !== current) return;
    current.source.classList.remove('book-in-hand');
    active = null;
    hide();
    const focus = target.activeElement;
    if (
      restoreFocus &&
      current.source.isConnected &&
      (!focus || focus === target.body || volume.contains(focus) || info.contains(focus))
    )
      current.source.focus({ preventScroll: true });
  }
  function reset({ restoreFocus = false } = {}) {
    invalidate();
    if (active) clean(active, restoreFocus);
    else hide();
  }
  function retire(current, { restoreFocus = false } = {}) {
    if (!current) return Promise.resolve();
    current.restoreFocus = restoreFocus;
    if (current.closing) return current.closing;
    current.closing = (async () => {
      hideInfo();
      volume.setAttribute('aria-busy', 'true');
      if (!reducedMotion.matches && typeof volume.animate === 'function') {
        const live = getTransform(volume),
          pose = live && live !== 'none' ? live : current.geometry.end.transform;
        const opacity = Number(windowTarget.getComputedStyle?.(shadow)?.opacity ?? 0.45);
        volume.style.transform = pose;
        shadow.style.transform = getTransform(shadow) || 'none';
        current.animation?.cancel();
        current.shadowAnimation?.cancel();
        const frames = [
          { transform: pose, offset: 0 },
          ...(current.opened ? [{ ...current.geometry.pull, offset: 0.72 }] : []),
          { ...current.geometry.start, offset: 1 },
        ];
        const timing = { duration: 680, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'forwards' };
        try {
          current.animation = volume.animate(frames, timing);
          const completed = current.animation.finished.catch(() => {});
          current.shadowAnimation = shadow.animate(
            [{ opacity: Number.isFinite(opacity) ? opacity : 0.45 }, { opacity: 0 }],
            timing,
          );
          current.shadowAnimation.finished.catch(() => {});
          await completed;
        } catch {} // A failed/cancelled return must still restore the shelf source.
      }
      clean(current, current.restoreFocus);
    })();
    return current.closing;
  }
  async function close() {
    invalidate();
    await retire(active, { restoreFocus: true });
  }
  function prepareInfo(book) {
    caption.textContent = book.title;
    author.textContent = book.authors.join(', ');
    genre.textContent = getGenre(book) || t('Bez gatunku');
    date.textContent = readingDateLabel(book) || t('Data przeczytania nieuzupełniona');
    info.dataset.ready = 'false';
    info.inert = true;
    info.style.width = '';
    info.style.maxHeight = '';
    info.style.setProperty('--info-height', 'initial');
    info.hidden = false;
    const { width, height } = info.getBoundingClientRect();
    const content = info.querySelector('.book-motion-info-content');
    if (content) content.scrollTop = 0;
    return { width, height };
  }
  function face(name) {
    const node = target.createElement('span');
    node.className = 'book-volume-face ' + name;
    node.setAttribute('aria-hidden', 'true');
    return node;
  }
  function build(book, source, image, geometry) {
    const front = face('book-volume-front');
    front.append(image);
    const spine = face('book-volume-spine'),
      context = target.createElement('span'),
      visual = source.querySelector('.spine-visual')?.cloneNode(true);
    context.className = 'spine-art';
    context.setAttribute('aria-hidden', 'true');
    for (const property of ['style', 'material'])
      if (source.dataset[property]) context.dataset[property] = source.dataset[property];
    if (visual) context.append(visual);
    spine.append(context);
    volume.replaceChildren(
      front,
      face('book-volume-back'),
      spine,
      face('book-volume-pages'),
      face('book-volume-top'),
      face('book-volume-bottom'),
    );
    Object.assign(volume.style, {
      width: geometry.model.width + 'px',
      height: geometry.model.height + 'px',
      transform: geometry.start.transform,
    });
    volume.style.setProperty('--volume-depth', geometry.model.depth + 'px');
    for (const property of ['--spine', '--letter', '--spine-accent'])
      volume.style.setProperty(property, source.style.getPropertyValue(property));
    volume.setAttribute('aria-label', t('Odłóż książkę: ') + book.title);
    volume.setAttribute('aria-busy', 'true');
    Object.assign(info.style, {
      left: geometry.info.x + 'px',
      top: geometry.info.y + 'px',
      width: geometry.info.width + 'px',
      maxHeight: geometry.info.height + 'px',
    });
    info.style.setProperty('--info-height', geometry.info.height + 'px');
    volume.hidden = false;
    shadow.hidden = false;
    source.classList.add('book-in-hand');
  }
  async function open(book) {
    if (disposed || blocked()) return;
    if (active?.book.id === book.id && !active.closing) {
      await close();
      return;
    }
    if (pending?.bookId === book.id) return;
    invalidate();
    const token = serial,
      keyboardActivation = keyboard,
      initialFocus = target.activeElement;
    onStart();
    if (active) await retire(active);
    if (disposed || token !== serial || blocked()) return;
    const source = [...root.querySelectorAll('.book')].find(
      (node) => node.dataset.bookId === book.id,
    );
    if (!source || !book.coverId || typeof volume.animate !== 'function') {
      onDetails(book);
      return;
    }
    const controller = new AbortController();
    pending = { controller, bookId: book.id };
    status.textContent = t('Wczytuję okładkę…');
    try {
      const image = await loadCover(book, { signal: controller.signal });
      if (
        disposed ||
        token !== serial ||
        controller.signal.aborted ||
        !source.isConnected ||
        blocked()
      )
        return;
      const infoSize = prepareInfo(book),
        geometry = bookMotionGeometry({
          rect: source.getBoundingClientRect(),
          coverRatio: image.naturalWidth / image.naturalHeight,
          ...viewport(),
          iconSpace: getIconSpace(),
          infoSize,
        });
      pending = null;
      build(book, source, image, geometry);
      const current = { book, source, geometry };
      active = current;
      if (reducedMotion.matches) {
        volume.style.transform = geometry.end.transform;
        shadow.hidden = true;
      } else {
        current.animation = volume.animate(
          [
            { ...geometry.start, offset: 0 },
            { ...geometry.pull, offset: 0.25 },
            { transform: geometry.end.transform, offset: 1 },
          ],
          { duration: 820, easing: 'cubic-bezier(.22,.68,.18,1)', fill: 'forwards' },
        );
        const completed = current.animation.finished.catch(() => {});
        Object.assign(shadow.style, {
          width: geometry.end.width + 'px',
          height: geometry.end.height + 'px',
        });
        current.shadowAnimation = shadow.animate(
          [
            {
              transform: `translate(${geometry.end.x + 12}px,${geometry.end.y + 12}px)`,
              opacity: 0,
            },
            {
              transform: `translate(${geometry.end.x + 12}px,${geometry.end.y + 12}px)`,
              opacity: 0.45,
            },
          ],
          { duration: 820, fill: 'forwards' },
        );
        current.shadowAnimation.finished.catch(() => {});
        await completed;
      }
      if (!disposed && token === serial && active === current && !current.closing) {
        current.opened = true;
        volume.style.transform = geometry.end.transform;
        info.dataset.ready = 'true';
        info.inert = false;
        volume.setAttribute('aria-busy', 'false');
        status.textContent = t('Podgląd okładki: ') + book.title;
        if (
          keyboardActivation &&
          (target.activeElement === initialFocus || target.activeElement === target.body)
        )
          closeButton.focus({ preventScroll: true });
      }
    } catch (error) {
      if (!disposed && token === serial && !controller.signal.aborted) {
        if (active) clean(active);
        else hide();
        pending = null;
        onDetails(book);
      }
    } finally {
      if (pending?.controller === controller) {
        pending = null;
        if (!active) status.textContent = '';
      }
    }
  }
  function keydown(event) {
    keyboard = true;
    if (event.key === 'Escape' && isActive() && !blocked()) {
      event.preventDefault();
      void close();
    }
  }
  function pointerdown(event) {
    keyboard = false;
    if (!isActive()) return;
    const node = event.target;
    if (
      volume.contains(node) ||
      info.contains(node) ||
      (node?.closest?.('.book') && root.contains(node))
    )
      return;
    void close();
  }
  function dialog() {
    if (blocked() && isActive()) reset();
  }
  function hidden() {
    if (target.hidden) reset();
  }
  // A desktop wallpaper can lose window focus while it stays visible. Let
  // explicit return finish; only actual lifecycle changes discard the model.
  const listeners = [
    [volume, 'click', close],
    [closeButton, 'click', close],
    [target, 'keydown', keydown],
    [target, 'pointerdown', pointerdown],
    [target, 'focusin', dialog],
    [target, 'visibilitychange', hidden],
    [windowTarget, 'resize', reset],
    [reducedMotion, 'change', reset],
  ];
  for (const [node, type, listener] of listeners) node.addEventListener(type, listener);
  hide();
  return {
    open,
    close,
    reset,
    isActive,
    destroy() {
      if (disposed) return;
      disposed = true;
      reset();
      for (const [node, type, listener] of listeners) node.removeEventListener(type, listener);
    },
  };
}
