import { t } from './i18n.mjs';
export const LIGHTING_OPTIONS = [
  ['theme', t('Zgodnie z motywem')],
  ['day', t('Dzień')],
  ['evening', t('Wieczór')],
  ['auto', t('Automatycznie · 07:00–19:00')],
];
export function resolveLighting(settings, date = new Date()) {
  if (settings.lighting === 'day' || settings.lighting === 'evening') return settings.lighting;
  if (settings.lighting === 'auto')
    return date.getHours() >= 7 && date.getHours() < 19 ? 'day' : 'evening';
  return settings.theme === 'dark' ? 'evening' : 'day';
}
export function roomPresentation(scene, settings, date = new Date()) {
  const lighting = resolveLighting(settings, date),
    key = lighting === 'day' ? 'light' : 'dark';
  return { asset: scene.assets[key], wallColor: scene.wallColors[key], lighting };
}
