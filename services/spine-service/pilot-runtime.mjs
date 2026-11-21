import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {fork} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {runService} from './main.mjs';
import {installationId} from '../../src/installation.mjs';
import {problem} from '../../src/domain.mjs';

export function clientEnvironment(env, {url, token}) {
  const clean = Object.fromEntries(Object.entries(env).filter(([key]) => !/^(?:CLOUDFLARE_|BOOKSHELF_SPINE_|OPENAI_API_KEY$)/i.test(key)));
  return {...clean, BOOKSHELF_SPINE_SERVICE_URL: url, BOOKSHELF_SPINE_SERVICE_TOKEN: token};
}

const refused = error => error?.cause?.code === 'ECONNREFUSED';
const cancelled = () => problem('PILOT_CANCELLED', 'Przerwano uruchamianie proby.');
const request = (origin, route, options = {}) => fetch(origin + route, {...options, redirect: 'error',
  signal: AbortSignal.any([AbortSignal.timeout(2000), ...(options.signal ? [options.signal] : [])])});

async function previousClient(origin, expectedInstallation, signal) {
  let response;
  try {response = await request(origin, '/api/health', {signal});}
  catch (error) {if (signal?.aborted) throw cancelled(); if (refused(error)) return null; throw problem('PORT_IN_USE', 'Nie mozna potwierdzic wlasciciela portu proby.');}
  let health; try {health = await response.json();} catch {}
  if (!response.ok || health?.appId !== 'bookshelf-wallpaper' || health.installationId !== expectedInstallation || !Number.isSafeInteger(health.pid))
    throw problem('PORT_IN_USE', 'Port proby zajmuje inny program lub inna kolekcja.');
  return health;
}
async function stopPrevious(origin, health, signal) {
  if (!health) return;
  const response = await request(origin, '/api/bootstrap', {signal});
  const bootstrap = await response.json();
  if (!response.ok || typeof bootstrap.token !== 'string') throw problem('PORT_IN_USE', 'Nie mozna bezpiecznie zamknac poprzedniego panelu proby.');
  const stopped = await request(origin, '/api/shutdown', {signal, method: 'POST', headers: {'Content-Type': 'application/json', Origin: origin, 'X-Bookshelf-Token': bootstrap.token}, body: JSON.stringify({expectedPid: health.pid})});
  if (!stopped.ok) throw problem('PORT_IN_USE', 'Poprzedni panel zmienil sie podczas uruchamiania.');
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {await request(origin, '/api/health', {signal});} catch (error) {if (signal?.aborted) throw cancelled(); if (refused(error)) return;}
    await delay(50, undefined, {signal});
  }
  throw problem('PORT_IN_USE', 'Poprzedni panel nadal zajmuje port proby.');
}

function ready(child, signal) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(problem('PILOT_CLIENT_FAILED', 'Panel proby nie uruchomil sie na czas.')), 10000);
    function finish(error, value) {
      clearTimeout(timeout); child.off('message', message); child.off('error', failed); child.off('exit', exited); signal?.removeEventListener('abort', aborted);
      if (error) reject(error); else resolve(value);
    }
    const failed = () => finish(problem('PILOT_CLIENT_FAILED', 'Nie mozna uruchomic panelu proby.'));
    const aborted = () => finish(cancelled());
    const exited = () => failed();
    const message = value => {
      if (value?.type === 'ready' && /^http:\/\/127\.0\.0\.1:\d+$/.test(value.origin)) finish(null, value.origin);
      else if (value?.type === 'failed') failed();
    };
    child.on('message', message); child.once('error', failed); child.once('exit', exited);
    signal?.addEventListener('abort', aborted, {once: true}); if (signal?.aborted) aborted();
  });
}
async function stopChild(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise(resolve => {
    let killTimer;
    const done = () => {clearTimeout(killTimer); resolve();};
    child.once('exit', done);
    killTimer = setTimeout(() => {try {child.kill();} catch {}}, 5000);
    if (child.connected) child.send({type: 'stop'}, error => {if (error) {try {child.kill();} catch {}}});
    else {try {child.kill();} catch {done();}}
  });
}

export async function startPilot({appRoot, dataRoot, provider, clientPort = 47843, servicePort = 47842, env = process.env, signal}) {
  if (!path.isAbsolute(appRoot ?? '') || !path.isAbsolute(dataRoot ?? '') ||
      ![clientPort, servicePort].every(port => Number.isSafeInteger(port) && port >= 0 && port <= 65535))
    throw problem('SERVICE_CONFIG', 'Nieprawidlowa lokalizacja lub port proby.');
  const collection = path.join(dataRoot, 'collection'), origin = 'http://127.0.0.1:' + clientPort;
  const check = () => {if (signal?.aborted) throw cancelled();}; check();
  const previous = clientPort ? await previousClient(origin, installationId(appRoot, collection), signal) : null;
  const token = randomBytes(32).toString('hex'); let service, child, closing, started = false;
  const onAbort = () => {if (started) close().catch(() => {});};
  const close = () => closing ??= (async () => {signal?.removeEventListener('abort', onAbort); try {await stopChild(child);} finally {await service?.close();}})();
  signal?.addEventListener('abort', onAbort, {once: true});
  try {
    check();
    service = await runService({dataDir: path.join(dataRoot, 'service'), port: servicePort,
      credentials: new Map([[token, 'pilot-local']]), provider});
    check(); await stopPrevious(origin, previous, signal); check();
    child = fork(fileURLToPath(new URL('./pilot.mjs', import.meta.url)), ['--client', appRoot, collection, String(clientPort)], {
      env: clientEnvironment(env, {url: service.origin, token}), execArgv: [], windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc']});
    const clientOrigin = await ready(child, signal); check(); started = true;
    child.once('exit', () => {close().catch(() => {});});
    return {origin: clientOrigin, serviceOrigin: service.origin, close};
  } catch (error) {await close(); throw signal?.aborted ? cancelled() : error;}
}
