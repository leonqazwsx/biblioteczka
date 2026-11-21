import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openCoverStore } from '../src/covers.mjs';
import { png as validPng } from './helpers/images.mjs';
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB9kAAAAASUVORK5CYII=',
  'base64',
);
test('covers persist by content hash and never accept paths or disguised HTML', async (t) => {
  const p = await fs.mkdtemp(path.join(os.tmpdir(), 'bookshelf-covers-'));
  t.after(() => fs.rm(p, { recursive: true, force: true }));
  const c = await openCoverStore(p);
  const x = await c.put(PNG, 'image/png'),
    y = await c.put(PNG, 'image/png');
  assert.equal(x.coverId, y.coverId);
  assert.deepEqual((await c.read(x.coverId)).bytes, PNG);
  await assert.rejects(() => c.read('../library.json'));
  await assert.rejects(() => c.put(Buffer.from('<script>bad</script>'), 'image/jpeg'));
  await assert.rejects(() => c.put(PNG, 'image/svg+xml'));
});
test('failed repeated cover upload never truncates an existing collection image', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookshelf-cover-atomic-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const first = await openCoverStore(root);
  const saved = await first.put(PNG, 'image/png');
  let writes = 0;
  const adapter = {
    ...fs,
    writeFile: async (file, bytes) => {
      writes++;
      await fs.writeFile(file, bytes.subarray(0, 10));
      throw Object.assign(new Error('full'), { code: 'ENOSPC' });
    },
  };
  const failing = await openCoverStore(root, { fsAdapter: adapter });
  await failing.put(PNG, 'image/png');
  assert.equal(writes, 0);
  assert.deepEqual((await first.read(saved.coverId)).bytes, PNG);
  const changed = Buffer.concat([PNG, Buffer.from([1])]);
  await assert.rejects(() => failing.put(changed, 'image/png'));
  assert.deepEqual((await first.read(saved.coverId)).bytes, PNG);
  assert.deepEqual(await fs.readdir(path.join(root, 'covers')), [saved.coverId]);
});
test('catalogue fetch uses the shared loader and verifies cached local bytes before saving again', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookshelf-cover-cache-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let loads = 0,
    saves = 0;
  const imageLoader = {
    load: async (input, { signal }) => {
      assert.deepEqual(input, { kind: 'id', value: 14425283, size: 'L' });
      signal?.throwIfAborted();
      loads++;
      return { bytes: validPng, mime: 'image/png' };
    },
  };
  const covers = await openCoverStore(root, {
      imageLoader,
      fetchImpl: () => {
        throw Error('legacy provider must not be used');
      },
    }),
    save = (...args) => {
      saves++;
      return covers.put(...args);
    };
  const first = await covers.fetchCatalogCover(14425283, { save });
  assert.equal(loads, 1);
  assert.deepEqual(await covers.fetchCatalogCover(14425283, { save }), first);
  assert.equal(loads, 1);
  assert.equal(saves, 2);
  await fs.unlink(path.join(root, 'covers', first.coverId));
  assert.deepEqual(await covers.fetchCatalogCover(14425283, { save }), first);
  assert.equal(loads, 2);
  assert.deepEqual((await covers.read(first.coverId)).bytes, validPng);
  await fs.writeFile(path.join(root, 'covers', first.coverId), Buffer.from('broken'));
  assert.deepEqual(await covers.fetchCatalogCover(14425283, { save }), first);
  assert.equal(loads, 3);
  assert.deepEqual((await covers.read(first.coverId)).bytes, validPng);
});
test('cached local catalogue fetch still honors a preaborted consumer and save callback', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookshelf-cover-cached-abort-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let saves = 0;
  const covers = await openCoverStore(root, {
    imageLoader: { load: async () => ({ bytes: validPng, mime: 'image/png' }) },
  });
  await covers.fetchCatalogCover(3);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    covers.fetchCatalogCover(3, { signal: controller.signal, save: () => saves++ }),
    { name: 'AbortError' },
  );
  assert.equal(saves, 0);
});
