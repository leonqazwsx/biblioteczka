import { t } from '../shared/i18n.mjs';
// The corner is detected from pointer coordinates, never by a clickable overlay.
export function createSettingsEntry({
  root,
  button,
  status,
  target = document,
  windowTarget = window,
  viewport = () => ({ width: innerWidth, height: innerHeight }),
  openSettings,
  blocked = () => !!document.querySelector('dialog[open]'),
  clock = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id) },
}) {
  let disposed = false,
    near = false,
    pointerVisible = false,
    focused = false,
    busy = false,
    notice = false,
    hideTimer = null,
    noticeTimer = null;
  const clearHide = () => {
    if (hideTimer !== null) clock.clearTimeout(hideTimer);
    hideTimer = null;
  };
  const clearNotice = () => {
    if (noticeTimer !== null) clock.clearTimeout(noticeTimer);
    noticeTimer = null;
    notice = false;
    root.dataset.error = 'false';
    status.textContent = '';
  };
  function paint() {
    if (disposed) return;
    const unavailable = blocked();
    root.dataset.visible = String(
      !target.hidden && !unavailable && (pointerVisible || focused || busy || notice),
    );
    root.setAttribute('aria-busy', String(busy));
    button.disabled = unavailable;
    button.setAttribute('aria-disabled', String(busy || unavailable));
  }
  function resetPointer() {
    near = false;
    pointerVisible = false;
    clearHide();
  }
  function leave() {
    near = false;
    if (pointerVisible && hideTimer === null)
      hideTimer = clock.setTimeout(() => {
        hideTimer = null;
        if (!near) {
          pointerVisible = false;
          paint();
        }
      }, 700);
  }
  function move(event) {
    if (disposed) return;
    const { width, height } = viewport(),
      x = event.clientX,
      y = event.clientY;
    near =
      !blocked() &&
      Number.isFinite(x) &&
      Number.isFinite(y) &&
      x >= 0 &&
      y >= 0 &&
      x < width &&
      y < height &&
      x >= width - 112 &&
      y >= height - 160;
    if (near) {
      clearHide();
      pointerVisible = true;
    } else leave();
    paint();
  }
  function focusIn(event) {
    focused = root.contains(event.target);
    if (blocked()) resetPointer();
    paint();
  }
  function focusOut(event) {
    if (root.contains(event.target)) focused = root.contains(event.relatedTarget);
    paint();
  }
  function blur() {
    focused = false;
    resetPointer();
    paint();
  }
  function resize() {
    resetPointer();
    paint();
  }
  function visibility() {
    if (target.hidden) {
      focused = false;
      resetPointer();
    }
    paint();
  }
  function windowFocus() {
    focused = root.contains(target.activeElement);
    paint();
  }
  async function activate() {
    if (disposed || busy || blocked()) return;
    clearNotice();
    busy = true;
    status.textContent = t('Otwieram ustawienia…');
    paint();
    try {
      const result = await openSettings();
      if (disposed) return;
      if (result?.opened !== true) throw Error('Open was not confirmed');
      status.textContent = '';
    } catch {
      if (disposed) return;
      status.textContent = t(
        'Nie udało się otworzyć ustawień. Kliknij zębatkę, aby spróbować ponownie.',
      );
      root.dataset.error = 'true';
      notice = true;
      noticeTimer = clock.setTimeout(() => {
        noticeTimer = null;
        notice = false;
        root.dataset.error = 'false';
        if (!busy) status.textContent = '';
        paint();
      }, 8000);
    } finally {
      if (!disposed) {
        busy = false;
        paint();
      }
    }
  }
  const listeners = [
    [target, 'pointermove', move],
    [target, 'pointerleave', leave],
    [target, 'focusin', focusIn],
    [target, 'focusout', focusOut],
    [target, 'visibilitychange', visibility],
    [windowTarget, 'blur', blur],
    [windowTarget, 'focus', windowFocus],
    [windowTarget, 'resize', resize],
    [button, 'click', activate],
  ];
  for (const [node, type, listener] of listeners) node.addEventListener(type, listener);
  root.dataset.error = 'false';
  paint();
  return {
    destroy() {
      if (disposed) return;
      disposed = true;
      clearHide();
      clearNotice();
      for (const [node, type, listener] of listeners) node.removeEventListener(type, listener);
      root.dataset.visible = 'false';
      root.setAttribute('aria-busy', 'false');
      button.disabled = false;
      button.setAttribute('aria-disabled', 'false');
    },
  };
}
