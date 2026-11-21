import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID, createHash} from 'node:crypto';
import {openJobStore} from '../services/spine-service/job-store.mjs';
const {createSpineServiceServer} = await import('../services/spine-service/server.mjs').catch(() => ({}));
import {png,variant} from './helpers/service-images.mjs';
const token = 'fixture_token_installation_one_12345', other = 'fixture_token_installation_two_12345';
async function setup(t) {
  assert.equal(typeof createSpineServiceServer, 'function');
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'service-http-')), store = await openJobStore({dataDir});
  const server = createSpineServiceServer({store, worker: {wake() {}}, credentials: new Map([[token, 'one'], [other, 'two']])});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await store.close(); await fs.rm(dataDir, {recursive: true, force: true});});
  const origin = 'http://127.0.0.1:' + server.address().port;
  const post = (body, auth = token) => fetch(origin + '/v1/spine-jobs', {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + auth}, body: JSON.stringify(body)});
  return {store, origin, post};
}
const input = () => ({requestId: randomUUID(), mime: 'image/png', base64: png.toString('base64'), priority: 'interactive'});
test('authentication, idempotency, isolation and verified result over real HTTP', async t => {
  const a = await setup(t), body = input();
  assert.equal((await a.post(body, 'bad')).status, 401);
  assert.equal((await fetch(a.origin + '/v1/spine-jobs')).status, 401);
  const job = await (await a.post(body)).json(); assert.equal((await (await a.post(body)).json()).id, job.id);
  assert.equal((await fetch(a.origin + '/v1/spine-jobs/' + job.id, {headers: {Authorization: 'Bearer ' + other}})).status, 404);
  await a.store.beginAttempt({workId: job.id, day: new Date().toISOString().slice(0, 10)}); await a.store.complete({workId: job.id, bytes: png, mime: 'image/png'});
  const image = await fetch(a.origin + '/v1/spine-jobs/' + job.id + '/image', {headers: {Authorization: 'Bearer ' + token}});
  assert.equal(image.headers.get('content-type'), 'image/png'); assert.equal(image.headers.get('x-image-sha256'), createHash('sha256').update(png).digest('hex'));
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
  assert.equal(JSON.stringify(job).includes(token), false); assert.deepEqual(Object.keys(job).sort(), ['errorCode', 'id', 'result', 'retryAt', 'state']);
});
test('strict JSON, canonical base64, bounded body and rate limiting', async t => {
  const a = await setup(t);
  for (const body of [{...input(), extra: true}, {...input(), base64: png.toString('base64') + '\n'}, {...input(), mime: 'image/svg+xml'}, {...input(), requestId: '../secret'}])
    assert.equal((await a.post(body)).status, 400);
  assert.equal((await a.post({...input(), base64: 'x'.repeat(7 * 1024 * 1024)})).status, 413);
  let response; for (let n = 0; n < 60; n++) response = await a.post(input());
  assert.equal(response.status, 429); assert.ok(Number(response.headers.get('retry-after')) >= 1);
  assert.equal(a.store.queued().length, 1);
});
