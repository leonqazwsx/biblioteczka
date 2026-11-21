import { resolveLighting } from './lighting.mjs';
export function watchLighting({
  getSettings,
  onChange,
  now = () => new Date(),
  schedule = setInterval,
  cancel = clearInterval,
  visibilityTarget = globalThis.document,
}) {
  let current = resolveLighting(getSettings(), now());
  const sync = () => {
    current = resolveLighting(getSettings(), now());
  };
  const tick = () => {
    const settings = getSettings();
    if (settings.lighting !== 'auto') return;
    const next = resolveLighting(settings, now());
    if (next !== current) {
      current = next;
      onChange(next);
    }
  };
  const visible = () => {
    if (!visibilityTarget.hidden) tick();
  };
  const timer = schedule(tick, 60000);
  visibilityTarget?.addEventListener('visibilitychange', visible);
  return {
    sync,
    dispose() {
      cancel(timer);
      visibilityTarget?.removeEventListener('visibilitychange', visible);
    },
  };
}
