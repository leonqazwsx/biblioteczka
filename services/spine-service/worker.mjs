import {providerConfigHash, validateProviderConfig} from './provider-config.mjs';

export function createWorker({store, provider, clock = () => new Date(), onState = () => {}}) {
  const expectedConfig = providerConfigHash(validateProviderConfig(provider?.config));
  let running = null, closing = false, halted = false, requested = false, timer = null, controller = null;
  const notify = () => {try {onState();} catch { /* Observers cannot invalidate durable work. */ }};
  const schedule = retryAt => {
    if (!retryAt || closing) return;
    timer = setTimeout(wake, Math.min(2147483647, Math.max(1000, Date.parse(retryAt) - clock().getTime()))); timer.unref();
  };
  async function drain() {
    do {
      requested = false;
      while (!closing && !halted) {
        const incompatible = store.queued().find(work => work.configHash !== expectedConfig);
        if (incompatible) {
          await store.transition(incompatible.workId, {state: 'failed', errorCode: 'CONFIG_CHANGED'}); await store.prune(clock()); notify(); continue;
        }
        const next = store.nextWork(); if (!next.workId) {schedule(next.retryAt); break;}
        const work = store.work(next.workId);
        let cover;
        try {cover = await store.readCover(work.workId);}
        catch {await store.transition(work.workId, {state: 'failed', errorCode: 'INVALID_COVER'}); await store.prune(clock()); notify(); continue;}
        if (closing) break;
        const reservation = await store.reserveAttempt({workId: work.workId, day: clock().toISOString().slice(0, 10), limit: 10});
        if (!reservation) {schedule(store.nextWork().retryAt); break;}
        if (closing) {await store.transition(work.workId, {state: 'uncertain', errorCode: 'INTERRUPTED', retryAt: null}); break;}
        notify(); controller = new AbortController();
        try {
          const aborted = new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(Object.assign(new Error('Interrupted'), {code: 'INTERRUPTED'})), {once: true}));
          const result = await Promise.race([provider.generate({coverBytes: cover.bytes, coverMime: cover.mime, signal: controller.signal}), aborted]);
          await store.complete({workId: work.workId, attemptId: reservation.attemptId, bytes: result.bytes, mime: result.mime});
        } catch (error) {
          const kind = {PROVIDER_QUOTA: 'quota', PROVIDER_CAPACITY: 'capacity', PROVIDER_AUTH: 'authorization'}[error?.code];
          if (kind) await store.deferAttempt({workId: work.workId, attemptId: reservation.attemptId, kind, retryAfterMs: error.retryAfterMs ?? 0, uncertain: kind === 'authorization' && error.uncertain === true});
          else await store.transition(work.workId, {state: error?.code === 'AI_REJECTED' ? 'failed' : 'uncertain',
            errorCode: error?.code === 'AI_REJECTED' ? 'AI_REJECTED' : 'PROVIDER_UNCERTAIN', retryAt: null});
        } finally {controller = null; notify();}
        await store.prune(clock());
      }
    } while (requested && !closing && !halted);
  }
  function wake() {
    if (closing || halted) return;
    clearTimeout(timer); timer = null; requested = true;
    if (!running) running = drain().catch(() => {halted = true; notify();}).finally(() => {
      running = null; if (requested && !closing && !halted) wake();
    });
  }
  return {
    wake,
    async idle() {while (running) await running;},
    async close() {closing = true; clearTimeout(timer); controller?.abort(); if (running) await running;}
  };
}
