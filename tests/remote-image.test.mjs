import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { png } from './helpers/images.mjs';
const { downloadRemoteImage } = await import('../src/remote-image.mjs').catch(() => ({}));
function transport(routes = {}) {
  const calls = [];
  const requestImpl = (url, options, receive) => {
    const request = new EventEmitter();
    let response;
    request.destroy = (error) => {
      if (request.destroyed) return;
      request.destroyed = true;
      queueMicrotask(() => request.emit('error', error ?? new Error('closed')));
      response?.destroy();
    };
    request.end = () =>
      queueMicrotask(() => {
        if (request.destroyed) return;
        options.lookup(url.hostname, { all: true }, (error, addresses) => {
          if (error) {
            request.destroy(error);
            return;
          }
          calls.push({ url: url.href, options, addresses });
          const route = routes[url.hostname] ?? {},
            chunks = route.chunks ?? [route.bytes ?? png];
          if (route.hang) return;
          response = Readable.from(chunks);
          response.statusCode = route.status ?? 200;
          response.headers = route.headers ?? { 'content-type': 'image/png' };
          receive(response);
        });
      });
    options.signal?.addEventListener('abort', () => request.destroy(options.signal.reason), {
      once: true,
    });
    return request;
  };
  return { calls, requestImpl };
}
const lookup = async () => [{ address: '93.184.215.14', family: 4 }];
function check() {
  assert.equal(typeof downloadRemoteImage, 'function');
}
test('a public image is downloaded with pinned DNS and its actual format, without cookies', async () => {
  check();
  const provider = transport();
  let resolutions = 0;
  const result = await downloadRemoteImage('https://images.example/cover?size=large', {
    ...provider,
    lookup: async () => {
      resolutions++;
      return lookup();
    },
  });
  assert.deepEqual(result, { bytes: png, mime: 'image/png' });
  assert.equal(resolutions, 1);
  assert.deepEqual(provider.calls[0].addresses, [{ address: '93.184.215.14', family: 4 }]);
  assert.equal(provider.calls[0].options.agent, false);
  assert.equal(provider.calls[0].options.headers.Cookie, undefined);
  assert.equal(provider.calls[0].options.headers.Authorization, undefined);
});
test('nonpublic, credentialed and non-HTTPS targets never reach the transport', async () => {
  check();
  const provider = transport();
  for (const url of [
    'http://images.example/a',
    'file:///C:/private',
    'data:image/png;base64,a',
    'https://me:secret@images.example/a',
    'https://127.1/a',
    'https://2130706433/a',
    'https://[::1]/a',
    'https://[::ffff:127.0.0.1]/a',
    'https://169.254.169.254/a',
    'https://10.0.0.1/a',
    'https://192.168.1.1/a',
    'https://images.example:47831/a',
  ])
    await assert.rejects(
      downloadRemoteImage(url, { ...provider, lookup }),
      (e) => e.code === 'INVALID',
    );
  for (const address of [
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '169.254.0.1',
    '100.64.0.1',
    '192.0.2.3',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    'fc00::1',
    'fe80::1',
    '2001:db8::1',
    '2002:7f00:1::',
  ])
    await assert.rejects(
      downloadRemoteImage('https://images.example/a', {
        ...provider,
        lookup: async () => [{ address, family: address.includes(':') ? 6 : 4 }],
      }),
      (e) => e.code === 'INVALID',
    );
  assert.equal(provider.calls.length, 0);
});
test('mixed public/private DNS answers and redirects into the local network are blocked', async () => {
  check();
  const provider = transport({
    'images.example': { status: 302, headers: { location: 'https://127.0.0.1/private' } },
  });
  await assert.rejects(
    downloadRemoteImage('https://images.example/a', {
      ...provider,
      lookup: async () => [
        { address: '93.184.215.14', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ],
    }),
    (e) => e.code === 'INVALID',
  );
  assert.equal(provider.calls.length, 0);
  await assert.rejects(
    downloadRemoteImage('https://images.example/a', { ...provider, lookup }),
    (e) => e.code === 'INVALID',
  );
  assert.equal(provider.calls.length, 1);
});
test('a public redirect is revalidated and an endless redirect is bounded', async () => {
  check();
  const provider = transport({
    'images.example': { status: 302, headers: { location: 'https://cdn.example/cover' } },
  });
  assert.deepEqual(await downloadRemoteImage('https://images.example/a', { ...provider, lookup }), {
    bytes: png,
    mime: 'image/png',
  });
  assert.equal(provider.calls.length, 2);
  const loop = transport({ 'images.example': { status: 302, headers: { location: '/again' } } });
  await assert.rejects(
    downloadRemoteImage('https://images.example/a', { ...loop, lookup }),
    (e) => e.code === 'IMAGE_UNAVAILABLE',
  );
  assert.ok(loop.calls.length <= 4);
});
test('HTML, corrupt files and oversized streams are rejected before an image is returned', async () => {
  check();
  for (const route of [
    { bytes: Buffer.from('<html>not an image</html>'), headers: { 'content-type': 'text/html' } },
    { bytes: png.subarray(0, 30) },
    { headers: { 'content-type': 'image/png', 'content-length': String(6 * 1024 * 1024) } },
    { chunks: [Buffer.alloc(3 * 1024 * 1024), Buffer.alloc(3 * 1024 * 1024)] },
    { headers: { 'content-type': 'image/png', 'content-encoding': 'gzip' } },
  ]) {
    const provider = transport({ 'images.example': route });
    await assert.rejects(
      downloadRemoteImage('https://images.example/a', { ...provider, lookup }),
      (e) => ['INVALID', 'TOO_LARGE', 'IMAGE_UNAVAILABLE'].includes(e.code),
    );
  }
});
test('cancellation interrupts a pending download and does not return a partial image', async () => {
  check();
  const provider = transport({ 'images.example': { hang: true } }),
    controller = new AbortController();
  const result = downloadRemoteImage('https://images.example/a', {
    ...provider,
    lookup,
    signal: controller.signal,
  });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await assert.rejects(result, (e) => e.name === 'AbortError');
  const preaborted = new AbortController();
  preaborted.abort();
  await assert.rejects(
    downloadRemoteImage('https://images.example/a', {
      ...provider,
      lookup,
      signal: preaborted.signal,
    }),
    (e) => e.name === 'AbortError',
  );
  assert.equal(provider.calls.length, 1);
});
