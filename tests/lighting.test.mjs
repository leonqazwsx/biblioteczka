import test from 'node:test';
import assert from 'node:assert/strict';
const { resolveLighting, roomPresentation } = await import('../public/shared/lighting.mjs').catch(
  () => ({}),
);
const at = (hour, minute = 0) => new Date(2026, 9, 5, hour, minute);
test('explicit scene light stays independent from the panel theme', () => {
  assert.equal(typeof resolveLighting, 'function');
  for (const theme of ['light', 'dark']) {
    assert.equal(resolveLighting({ theme, lighting: 'day' }, at(23)), 'day');
    assert.equal(resolveLighting({ theme, lighting: 'evening' }, at(12)), 'evening');
  }
  assert.equal(resolveLighting({ theme: 'light', lighting: 'theme' }, at(23)), 'day');
  assert.equal(resolveLighting({ theme: 'dark' }, at(12)), 'evening');
});
test('automatic light uses local wall-clock boundaries without changing settings', () => {
  assert.equal(typeof resolveLighting, 'function');
  const settings = { theme: 'dark', lighting: 'auto' },
    before = structuredClone(settings);
  for (const [hour, minute, expected] of [
    [0, 0, 'evening'],
    [6, 59, 'evening'],
    [7, 0, 'day'],
    [18, 59, 'day'],
    [19, 0, 'evening'],
    [23, 59, 'evening'],
  ])
    assert.equal(resolveLighting(settings, at(hour, minute)), expected);
  assert.deepEqual(settings, before);
});
test('background and foreground consumers receive one resolved room asset', () => {
  assert.equal(typeof roomPresentation, 'function');
  const scene = {
    assets: { light: 'day.png', dark: 'night.png' },
    wallColors: { light: '#fff', dark: '#111' },
  };
  assert.deepEqual(roomPresentation(scene, { theme: 'dark', lighting: 'day' }, at(0)), {
    asset: 'day.png',
    wallColor: '#fff',
    lighting: 'day',
  });
  assert.deepEqual(roomPresentation(scene, { theme: 'light', lighting: 'auto' }, at(19)), {
    asset: 'night.png',
    wallColor: '#111',
    lighting: 'evening',
  });
});
