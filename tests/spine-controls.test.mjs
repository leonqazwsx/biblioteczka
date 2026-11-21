import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSpineControls, renderAiSettings } from '../public/manager/spine-controls.mjs';
import { importDom } from './helpers/import-dom.mjs';
const book = { id: 'book-a', coverId: 'cover-a', spineGeneration: 2, spine: null };
const status = { available: true, enabled: true, connection: 'online', jobs: [] };
function dom(t) {
  const result = importDom(),
    previous = globalThis.document;
  globalThis.document = result.doc;
  t.after(() => (globalThis.document = previous));
  return result;
}
test('automatic controls keep file and URL import without generation actions', (t) => {
  const { root } = dom(t);
  renderSpineControls(root, { book, status, onUpload() {} });
  assert.equal(root.querySelectorAll('button').length, 1);
  assert.equal(root.querySelectorAll('input').length, 2);
  assert.doesNotMatch(root.textContent, /OPENAI_API_KEY|Włącz AI|Wygeneruj|opłat|USD/i);
});

test('URL input survives status refresh, uses the latest callback and cancels for another book', async (t) => {
  const { root } = dom(t),
    uploads = [];
  let release;
  const pending = new Promise((resolve) => (release = resolve));
  renderSpineControls(root, {
    book,
    status,
    onUpload: () => assert.fail('old callback'),
    downloadImage: async () => pending,
  });
  const input = root.querySelectorAll('input').find((input) => input.type === 'url'),
    button = root.querySelector('button');
  assert.ok(input);
  input.value = 'https://images.example/spine.png';
  renderSpineControls(root, {
    book,
    status,
    onUpload: async (...args) => uploads.push(args),
    downloadImage: async () => pending,
  });
  assert.equal(
    root.querySelectorAll('input').find((input) => input.type === 'url'),
    input,
  );
  const work = button.onclick();
  release({ mime: 'image/png', base64: 'AQID' });
  await work;
  assert.deepEqual(uploads, [[book.id, { mime: 'image/png', base64: 'AQID' }]]);
  let finish;
  const delayed = new Promise((resolve) => (finish = resolve));
  renderSpineControls(root, {
    book,
    status,
    onUpload: () => assert.fail('closed book imported'),
    downloadImage: async () => delayed,
  });
  input.value = 'https://images.example/spine.png';
  const obsolete = button.onclick();
  renderSpineControls(root, {
    book: { ...book, id: 'book-b' },
    status,
    onUpload: () => assert.fail('wrong book imported'),
  });
  finish({ mime: 'image/png', base64: 'AQID' });
  await obsolete;
});
for (const state of ['queued', 'generating'])
  test(`simple ${state} message`, (t) => {
    const { root } = dom(t);
    renderSpineControls(root, {
      book,
      status: { ...status, jobs: [{ bookId: book.id, generation: 2, state }] },
      onUpload() {},
    });
    assert.equal(root.querySelector('p').textContent, 'Ilustracja w przygotowaniu');
  });
test('offline message and status refresh preserve file focus and current callback', async (t) => {
  const { root, doc } = dom(t),
    uploads = [];
  renderSpineControls(root, { book, status, onUpload: () => assert.fail('old callback') });
  const file = root.querySelector('input');
  file.focus();
  renderSpineControls(root, {
    book,
    status: {
      ...status,
      connection: 'offline',
      jobs: [{ bookId: book.id, generation: 2, state: 'queued' }],
    },
    onUpload: async (...args) => uploads.push(args),
  });
  assert.equal(
    root.querySelector('p').textContent,
    'Ilustracja pojawi się po odzyskaniu połączenia',
  );
  assert.equal(root.querySelector('input'), file);
  assert.equal(doc.activeElement, file);
  file.files = [
    { type: 'image/png', size: 3, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer },
  ];
  await file.onchange();
  assert.deepEqual(uploads, [[book.id, { mime: 'image/png', base64: 'AQID' }]]);
});
test('manual image remains described independently of queued work; settings contain no keys or billing controls', (t) => {
  const { root } = dom(t);
  renderSpineControls(root, {
    book: { ...book, spine: { kind: 'manual' } },
    status,
    onUpload() {},
  });
  assert.match(root.textContent, /Własna ilustracja/);
  renderAiSettings(root, { status });
  assert.equal(root.querySelectorAll('button,input').length, 0);
  assert.doesNotMatch(root.textContent, /klucz|OpenAI|USD|płatne|Włącz AI/i);
});
test('a cover-backed binding is identified honestly while AI is disconnected', (t) => {
  const { root } = dom(t);
  renderSpineControls(root, {
    book,
    status: { available: false, connection: 'unconfigured', jobs: [] },
    onUpload() {},
  });
  assert.match(root.querySelector('p').textContent, /okładki/i);
  assert.doesNotMatch(root.querySelector('p').textContent, /Ilustracja zapisana|w przygotowaniu/i);
  renderAiSettings(root, { status: { available: false, connection: 'unconfigured', jobs: [] } });
  assert.match(root.textContent, /okładek/i);
});
test('an unavailable configured generator is not described as unconfigured', (t) => {
  const { root } = dom(t);
  renderAiSettings(root, { status: { available: false, connection: 'offline', jobs: [] } });
  assert.doesNotMatch(root.textContent, /nie jest podłączone/i);
  assert.match(root.textContent, /okładek/i);
});

test('quota and authorization messages refresh in place without exposing provider details', (t) => {
  const { root, doc } = dom(t);
  renderSpineControls(root, { book, status, onUpload() {} });
  const file = root.querySelector('input');
  file.focus();
  for (const message of [
    'Ilustracja czeka na odnowienie limitu',
    'Automatyczne ilustracje są obecnie niedostępne.',
  ]) {
    renderSpineControls(root, {
      book,
      status: { ...status, jobs: [{ bookId: book.id, generation: 2, state: 'queued', message }] },
      onUpload() {},
    });
    assert.equal(root.querySelector('p').textContent, message);
    assert.equal(root.querySelector('input'), file);
    assert.equal(doc.activeElement, file);
  }
  renderSpineControls(root, {
    book,
    status: {
      ...status,
      jobs: [
        {
          bookId: book.id,
          generation: 2,
          state: 'queued',
          message: 'PROVIDER_QUOTA secret raw detail',
        },
      ],
    },
    onUpload() {},
  });
  assert.equal(root.querySelector('p').textContent, 'Ilustracja w przygotowaniu');
});
