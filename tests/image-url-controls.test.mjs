import test from 'node:test';
import assert from 'node:assert/strict';
import { importDom } from './helpers/import-dom.mjs';
const { createImageUrlControl } = await import('../public/manager/image-url.mjs').catch(() => ({}));
function setup(t, options = {}) {
  assert.equal(typeof createImageUrlControl, 'function');
  const { doc, root } = importDom(),
    previous = globalThis.document;
  globalThis.document = doc;
  t.after(() => (globalThis.document = previous));
  const loaded = [],
    control = createImageUrlControl(root, {
      label: 'Link do okładki',
      onImport: async (value) => loaded.push(value),
      ...options,
    });
  const input = root.querySelector('input'),
    button = root.querySelector('button');
  input.value = 'https://images.example/a.jpg';
  return { root, input, button, control, loaded };
}
test('a URL imports through the local endpoint and leaves the chosen file control independent', async (t) => {
  let requested;
  const image = { mime: 'image/png', base64: 'AQID' };
  const a = setup(t, {
    download: async (url, signal) => {
      requested = { url, signal };
      return image;
    },
  });
  assert.equal(a.input.type, 'url');
  assert.equal(a.button.type, 'button');
  await a.button.onclick();
  assert.equal(requested.url, 'https://images.example/a.jpg');
  assert.ok(requested.signal instanceof AbortSignal);
  assert.deepEqual(a.loaded, [image]);
  assert.equal(a.button.disabled, false);
});
test('a failed image URL leaves the existing image untouched and permits a retry', async (t) => {
  let attempt = 0;
  const image = { mime: 'image/png', base64: 'AQID' };
  const a = setup(t, {
    download: async () => {
      if (++attempt === 1) throw Error('Podaj link do obrazu.');
      return image;
    },
  });
  await a.button.onclick();
  assert.equal(a.loaded.length, 0);
  assert.match(a.root.textContent, /Podaj link do obrazu/);
  assert.equal(a.input.disabled, false);
  await a.button.onclick();
  assert.deepEqual(a.loaded, [image]);
});
test('closing or changing an editor cancels the download and cannot import its late result', async (t) => {
  let release, capturedSignal;
  const pending = new Promise((resolve) => (release = resolve));
  const a = setup(t, {
    download: async (_url, signal) => {
      capturedSignal = signal;
      return pending;
    },
  });
  const work = a.button.onclick();
  a.control.reset();
  release({ mime: 'image/png', base64: 'AQID' });
  await work;
  assert.equal(capturedSignal.aborted, true);
  assert.equal(a.loaded.length, 0);
  assert.equal(a.input.value, '');
  assert.equal(a.button.disabled, false);
});
test('invalid URLs never start a download and Enter does not submit the book form', async (t) => {
  let downloads = 0;
  const a = setup(t, {
    download: async () => {
      downloads++;
      return {};
    },
  });
  a.input.value = 'https://';
  await a.button.onclick();
  assert.equal(downloads, 0);
  a.input.value = 'https://images.example/a.jpg';
  let prevented = false,
    stopped = false;
  await a.input.onkeydown({
    key: 'Enter',
    preventDefault() {
      prevented = true;
    },
    stopPropagation() {
      stopped = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(stopped, true);
  assert.equal(downloads, 1);
});
test('a file upload can disable URL import until it finishes', async (t) => {
  let downloads = 0;
  const a = setup(t, {
    download: async () => {
      downloads++;
      return {};
    },
  });
  assert.equal(typeof a.control.setDisabled, 'function');
  a.control.setDisabled(true);
  await a.button.onclick();
  assert.equal(downloads, 0);
  assert.equal(a.input.disabled, true);
  a.control.reset();
  assert.equal(a.input.disabled, true);
  a.control.setDisabled(false);
  a.input.value = 'https://images.example/a.jpg';
  await a.button.onclick();
  assert.equal(downloads, 1);
});
