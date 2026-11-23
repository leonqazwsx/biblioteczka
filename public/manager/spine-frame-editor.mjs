import { el } from '../shared/api.mjs';
import {
  DEFAULT_SPINE_FRAME,
  effectiveSpineFrame,
  normalizeSpineFrame,
} from '../shared/spine-frame.mjs';
import { t } from '../shared/i18n.mjs';
const clone = (value) => (value ? { ...value } : null);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const imageId = (spine) => (/^[a-f0-9]{64}$/.test(spine?.assetId ?? '') ? spine.assetId : null);
export function createSpineFrameDraft() {
  let assetId = null,
    original = null,
    current = null,
    stale = false;
  const isDirty = () => !same(original, current);
  function reset(spine) {
    assetId = imageId(spine);
    original = assetId ? normalizeSpineFrame(effectiveSpineFrame(spine.frame)) : null;
    current = clone(original);
    stale = false;
  }
  return {
    reset,
    receive(spine) {
      const nextId = imageId(spine),
        next = nextId ? normalizeSpineFrame(effectiveSpineFrame(spine.frame)) : null;
      if (nextId !== assetId || !same(next, original)) {
        if (isDirty() || stale) stale = true;
        else reset(spine);
      }
    },
    set(key, value) {
      if (!assetId || stale || !['x', 'y', 'zoom'].includes(key))
        throw new Error(t('Kadr nie jest dostępny.'));
      current = normalizeSpineFrame({ ...effectiveSpineFrame(current), [key]: value });
    },
    restoreDefault() {
      if (assetId && !stale) current = null;
    },
    isDirty,
    isStale: () => stale,
    hasImage: () => !!assetId,
    dirtySnapshot: () => (isDirty() ? { assetId, frame: clone(current) } : null),
    value: (spine) =>
      imageId(spine) === assetId && !stale
        ? effectiveSpineFrame(current)
        : effectiveSpineFrame(spine?.frame),
    current: () => effectiveSpineFrame(current),
    patch() {
      if (stale)
        throw Object.assign(
          new Error(
            t('Ilustracja zmieniła się. Otwórz aktualną wersję książki przed zapisaniem kadru.'),
          ),
          { code: 'CONFLICT' },
        );
      return isDirty() ? { assetId, frame: clone(current) } : null;
    },
  };
}
export function createSpineFrameEditor(root, { onChange, onConflict = () => {} }) {
  const draft = createSpineFrameDraft(),
    details = el('details', 'spine-frame-editor'),
    summary = el('summary', '', t('Dopasuj kadr')),
    fields = el('div', 'spine-frame-fields');
  const description = el(
      'p',
      'muted',
      t('Ustaw motyw w widocznej części grzbietu. Kadr zapisze się razem ze zmianami książki.'),
    ),
    warning = el(
      'p',
      'ai-error',
      t('Ilustracja zmieniła się w drugim oknie. Szkic zachowano. Otwórz aktualną wersję książki.'),
    );
  warning.setAttribute('role', 'alert');
  warning.hidden = true;
  const controls = [];
  let visible = true;
  for (const [key, title, min, max, step] of [
    ['x', t('Położenie poziome'), 0, 100, 1],
    ['y', t('Położenie pionowe'), 0, 100, 1],
    ['zoom', t('Przybliżenie'), 100, 300, 5],
  ]) {
    const line = el('div', 'spine-frame-line'),
      label = el('label', '', title),
      output = el('output', 'spine-frame-value'),
      input = el('input');
    input.type = 'range';
    input.id = 'spine-frame-' + key;
    input.min = min;
    input.max = max;
    input.step = step;
    input.setAttribute('aria-label', title);
    label.htmlFor = input.id;
    output.htmlFor = input.id;
    input.oninput = () => {
      draft.set(key, Number(input.value) / (key === 'zoom' ? 100 : 1));
      paint();
      onChange();
    };
    line.append(label, output, input);
    fields.append(line);
    controls.push({ key, input, output });
  }
  const reset = el('button', 'text-button', t('Przywróć domyślny'));
  reset.type = 'button';
  reset.onclick = () => {
    draft.restoreDefault();
    paint();
    onChange();
  };
  details.append(summary, description, fields, reset, warning);
  root.append(details);
  function paint() {
    root.hidden = !visible || (!draft.hasImage() && !draft.isStale());
    warning.hidden = !draft.isStale();
    const frame = draft.current();
    for (const { key, input, output } of controls) {
      const value = key === 'zoom' ? Math.round(frame.zoom * 100) : frame[key];
      input.value = value;
      output.textContent = value + '%';
      input.setAttribute('aria-valuetext', value + ' procent');
      input.disabled = draft.isStale();
    }
    reset.disabled = draft.isStale();
    if (draft.isStale()) {
      details.open = true;
      onConflict();
    }
  }
  paint();
  return {
    reset(spine) {
      draft.reset(spine);
      details.open = false;
      paint();
    },
    receive(spine) {
      draft.receive(spine);
      paint();
    },
    setVisible(value) {
      visible = value;
      paint();
    },
    value: draft.value,
    patch: draft.patch,
    dirtySnapshot: draft.dirtySnapshot,
    isDirty: draft.isDirty,
  };
}
