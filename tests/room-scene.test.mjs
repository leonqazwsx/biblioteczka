import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const { ROOM_SCENE, validateScene, fitScene } = await import(
  '../public/shared/room-scene.mjs'
).catch(() => ({}));
const roomModule = await import('../public/shared/room-scene.mjs');
test('room covers the whole desktop even with an icon strip', () => {
  assert.deepEqual(fitScene(ROOM_SCENE, { width: 1920, height: 1080, iconSpace: 0.2 }), {
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
  });
});
test('different desktop ratios fill every edge without stretching the room', () => {
  for (const [width, height] of [
    [1920, 1200],
    [1600, 1200],
    [3440, 1440],
    [5120, 1440],
  ])
    for (const iconSpace of [0, 0.2, 0.3]) {
      const r = fitScene(ROOM_SCENE, { width, height, iconSpace });
      assert.ok(
        r.x <= 0 && r.y <= 0 && r.x + r.width >= width - 0.001 && r.y + r.height >= height - 0.001,
      );
      assert.ok(Math.abs(r.width / r.height - 16 / 9) < 0.00001);
    }
});
test('invalid scene geometry cannot position books outside their background', () => {
  assert.equal(typeof validateScene, 'function');
  validateScene(ROOM_SCENE);
  assert.throws(() => validateScene({ ...ROOM_SCENE, slots: [] }));
  const slots = structuredClone(ROOM_SCENE.slots);
  slots[0].books.x = 0.99;
  assert.throws(() => validateScene({ ...ROOM_SCENE, slots }));
  slots[0] = structuredClone(ROOM_SCENE.slots[0]);
  slots[1].id = slots[0].id;
  assert.throws(() => validateScene({ ...ROOM_SCENE, slots }));
});
test('day and night scene assets have matching pixel geometry', async () => {
  const files = await Promise.all(
    ['day', 'night'].map((n) =>
      fs.readFile(new URL('../public/assets/room/' + n + '.png', import.meta.url)),
    ),
  );
  for (const b of files) assert.equal(b.subarray(1, 4).toString(), 'PNG');
  assert.deepEqual(files[0].subarray(16, 24), files[1].subarray(16, 24));
});
test('selected rooms use their own shelf measurements and packaged images', async () => {
  assert.equal(typeof roomModule.getRoomScene, 'function');
  const chosen = roomModule.getRoomScene('oak-library');
  assert.notEqual(chosen, ROOM_SCENE);
  assert.equal(chosen.slots.length, 6);
  assert.doesNotThrow(() => validateScene(chosen));
  assert.equal(roomModule.getRoomScene().id, 'reading-room-v1');
  assert.throws(() => roomModule.getRoomScene('missing'));
  for (const room of roomModule.ROOM_SCENES) {
    validateScene(room);
    for (const asset of new Set(Object.values(room.assets))) {
      const image = await fs.readFile(new URL('../public' + asset, import.meta.url));
      assert.equal(image.readUInt32BE(16), 1672);
      assert.equal(image.readUInt32BE(20), 941);
    }
  }
});
test('every room includes different day and evening photographs', async () => {
  for (const scene of roomModule.ROOM_SCENES) {
    assert.notEqual(
      scene.assets.light,
      scene.assets.dark,
      scene.id + ' needs both lighting variants',
    );
    const [day, evening] = await Promise.all(
      [scene.assets.light, scene.assets.dark].map((asset) =>
        fs.readFile(new URL('../public' + asset, import.meta.url)),
      ),
    );
    assert.notDeepEqual(day, evening, scene.id + ' variants must differ');
  }
});
