import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { runService } from '../services/spine-service/main.mjs';
import { createCloudflareProvider } from '../services/spine-service/cloudflare-provider.mjs';
import { createSpineServiceClient } from '../src/spine-service-client.mjs';
import { run } from '../src/main.mjs';
import { image } from './helpers/cloudflare-images.mjs';
import { png } from './helpers/service-images.mjs';
const token = 'fixture-e2e-installation-token-123456789',
  apiToken = 'fixture-e2e-cf-private-token-123456789';
const provider = (fetchImpl) =>
  createCloudflareProvider({
    accountId: '0123456789abcdef0123456789abcdef',
    apiToken,
    freeConfirmed: true,
    fetchImpl,
  });
async function waitFor(read, predicate) {
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    const value = await read();
    if (predicate(value)) return value;
    await delay(25);
  }
  throw new Error('Cloudflare E2E did not settle');
}
const readJson = async (file) => JSON.parse(await fs.readFile(file));
async function assertNoSecret(dir) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, e.name);
    if (e.isDirectory()) await assertNoSecret(file);
    else {
      const bytes = await fs.readFile(file);
      assert.equal(bytes.includes(Buffer.from(apiToken)), false);
      assert.equal(bytes.includes(Buffer.from(token)), false);
    }
  }
}

test('real local HTTP resumes quota with same request and ticket then reuses cache exports and works offline', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cf-real-http-'));
  let calls = 0,
    date = new Date(),
    service,
    app;
  t.after(async () => {
    try {
      await app?.close();
    } finally {
      try {
        await service?.close();
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    }
  });
  const privateDir = path.join(root, 'private'),
    collectionDir = path.join(root, 'collection');
  const serviceOptions = {
    dataDir: privateDir,
    port: 0,
    clock: () => date,
    credentials: new Map([[token, 'fixture']]),
    provider: provider(async (url, options) => {
      calls++;
      const form = options.body;
      assert.deepEqual([...form.keys()].sort(), ['height', 'input_image_0', 'prompt', 'width']);
      return calls === 1
        ? Response.json(
            {
              success: false,
              result: null,
              errors: [{ code: 3036, message: 'quota' }],
              messages: [],
            },
            { status: 429 },
          )
        : Response.json({
            success: true,
            result: { image: png.toString('base64') },
            errors: [],
            messages: [],
          });
    }),
  };
  service = await runService(serviceOptions);
  const port = Number(new URL(service.origin).port),
    appOptions = {
      port: 0,
      appRoot: path.resolve('.'),
      dataDir: collectionDir,
      spineService: { url: service.origin, token },
    };
  app = await run(appOptions);
  const state = async () => (await fetch(app.origin + '/api/state')).json();
  const post = async (route, body) => {
    const boot = await (await fetch(app.origin + '/api/bootstrap')).json();
    const response = await fetch(app.origin + route, {
      method: 'POST',
      headers: {
        Origin: app.origin,
        'Content-Type': 'application/json',
        'X-Bookshelf-Token': boot.token,
      },
      body: JSON.stringify(body),
    });
    const value = await response.json();
    assert.ok(response.ok, JSON.stringify(value));
    return value;
  };
  const coverBytes = await image({ width: 600, height: 800 }),
    { coverId } = await post('/api/covers', {
      mime: 'image/png',
      base64: coverBytes.toString('base64'),
    });
  const add = async (title) =>
    post('/api/commands', {
      expectedRevision: (await state()).revision,
      command: {
        type: 'addBook',
        draft: { title, authors: ['Fixture Author'], shelfId: 'fantasy', status: 'read', coverId },
      },
    });
  const saved = await add('First');
  assert.equal(saved.books.length, 1);
  assert.equal(saved.books[0].spine, null);
  const privateJournal = path.join(privateDir, 'jobs.json'),
    localJournal = path.join(collectionDir, 'automatic-spines.json');
  await waitFor(
    () => readJson(privateJournal),
    (s) => s.providerPause?.kind === 'quota',
  );
  await app.close();
  app = await run(appOptions);
  await waitFor(
    async () => (await fetch(app.origin + '/api/ai/status')).json(),
    (s) => s.jobs[0]?.message === 'Ilustracja czeka na odnowienie limitu',
  );
  const before = (await readJson(localJournal)).entries[0];
  assert.equal(calls, 1);
  assert.equal((await state()).books[0].spineGeneration, 1);
  await app.close();
  await service.close();
  date = new Date((await readJson(privateJournal)).providerPause.retryAt);
  service = await runService({ ...serviceOptions, port });
  await waitFor(
    () => readJson(privateJournal),
    (s) => s.works[0].state === 'ready',
  );
  // Advance the private clock and make the persisted local deadline due, simulating the same UTC-day passage without a production test hook.
  const journal = await readJson(localJournal);
  journal.entries[0].retryAt = new Date(Date.now() - 1000).toISOString();
  await fs.writeFile(localJournal, JSON.stringify(journal));
  app = await run(appOptions);
  const completed = await waitFor(state, (s) => !!s.books[0].spine);
  assert.equal(calls, 2);
  assert.equal(completed.books[0].spine.model, 'cf-flux-2-klein-4b');
  assert.equal(completed.books[0].spineGeneration, 1);
  const after = (await readJson(localJournal)).entries[0];
  assert.equal(after.requestId, before.requestId);
  assert.equal(after.remoteJobId, before.remoteJobId);
  assert.deepEqual(after.ticket, before.ticket);
  await add('Same cover');
  await app.close();
  app = await run(appOptions);
  const cached = await waitFor(state, (s) => s.books.length === 2 && s.books.every((b) => b.spine));
  assert.equal(calls, 2);
  assert.equal(cached.books[1].spine.assetId, cached.books[0].spine.assetId);
  const backup = await (await fetch(app.origin + '/api/export')).json(),
    preview = await post('/api/import/preview', backup);
  const restored = await post('/api/import/confirm', {
    importId: preview.importId,
    expectedRevision: preview.revision,
  });
  assert.deepEqual(
    restored.books.map((b) => b.spine),
    cached.books.map((b) => b.spine),
  );
  await app.close();
  await service.close();
  app = await run({ ...appOptions, spineService: null });
  assert.deepEqual(
    (await state()).books.map((b) => b.spine),
    cached.books.map((b) => b.spine),
  );
  assert.deepEqual(
    Buffer.from(
      await (await fetch(app.origin + '/spines/' + cached.books[0].spine.assetId)).arrayBuffer(),
    ),
    png,
  );
  await assertNoSecret(root);
});

for (const [code, http, want] of [
  [3040, 429, 'queued'],
  [5035, 403, 'queued'],
  [9999, 429, 'uncertain'],
])
  test(`real provider refusal ${code} keeps scoped HTTP idempotency and safe state`, async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cf-refusal-http-'));
    let calls = 0;
    const service = await runService({
      dataDir: root,
      port: 0,
      credentials: new Map([[token, 'fixture']]),
      provider: provider(async () => {
        calls++;
        return Response.json(
          {
            success: false,
            result: null,
            errors: [{ code, message: 'private details' }],
            messages: [],
          },
          { status: http, headers: { 'Retry-After': '120' } },
        );
      }),
    });
    t.after(async () => {
      await service.close();
      await fs.rm(root, { recursive: true, force: true });
    });
    const client = createSpineServiceClient({ url: service.origin, token }),
      input = { requestId: randomUUID(), bytes: png, mime: 'image/png', priority: 'interactive' };
    const first = await client.submit(input);
    await waitFor(
      () => readJson(path.join(root, 'jobs.json')),
      (s) => s.attempts.length === 1 && s.attempts[0].state !== 'started',
    );
    const final = await client.get({ id: first.id });
    assert.equal(final.state, want);
    assert.equal((await client.submit(input)).id, first.id);
    assert.equal(calls, 1);
    await assertNoSecret(root);
  });

test('actual legacy journal migrates before local HTTP exposes ready assets without a Cloudflare call', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cf-legacy-http-'));
  await fs.cp(path.resolve('tests/fixtures/spine-service-v1'), root, { recursive: true });
  let calls = 0;
  const service = await runService({
    dataDir: root,
    port: 0,
    credentials: new Map([[token, 'legacy']]),
    provider: provider(async () => {
      calls++;
      throw Error('must not call');
    }),
  });
  t.after(async () => {
    await service.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const snapshot = await readJson(path.join(root, 'jobs.json'));
  assert.equal(snapshot.version, 2);
  const ready = snapshot.works.find((w) => w.state === 'ready'),
    client = createSpineServiceClient({ url: service.origin, token }),
    job = await client.get({ id: ready.workId });
  assert.equal(job.state, 'ready');
  assert.deepEqual((await client.download({ id: job.id, expectedResult: job.result })).bytes, png);
  assert.equal(calls, 0);
});
