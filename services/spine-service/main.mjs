import { pathToFileURL } from 'node:url';
import { openJobStore } from './job-store.mjs';
import { createWorker } from './worker.mjs';
import { createSpineServiceServer } from './server.mjs';
import { serviceConfig, cloudflareProviderConfig } from './config.mjs';
import { problem } from '../../src/domain.mjs';
import { validateProviderConfig } from './provider-config.mjs';

export async function runService({
  dataDir,
  port = 47842,
  host = '127.0.0.1',
  credentials,
  provider,
  clock = () => new Date(),
  maintenanceIntervalMs = 60000,
}) {
  if (!provider || typeof provider.generate !== 'function')
    throw problem('SERVICE_CONFIG', 'Brak dostawcy ilustracji.');
  validateProviderConfig(provider.config);
  if (
    !Number.isSafeInteger(maintenanceIntervalMs) ||
    maintenanceIntervalMs < 1 ||
    maintenanceIntervalMs > 2147483647
  )
    throw problem('SERVICE_CONFIG', 'Nieprawidłowy okres konserwacji.');
  const store = await openJobStore({ dataDir, clock, config: provider.config }),
    worker = createWorker({ store, provider, clock });
  let server, maintenance;
  try {
    server = createSpineServiceServer({ store, worker, credentials, clock });
    await store.prune(clock());
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, resolve);
    });
    maintenance = setInterval(() => store.prune(clock()).catch(() => {}), maintenanceIntervalMs);
    maintenance.unref();
    worker.wake();
    let closing;
    return {
      origin: `http://${host.includes(':') ? '[' + host + ']' : host}:${server.address().port}`,
      close() {
        return (closing ??= (async () => {
          clearInterval(maintenance);
          const stopped = new Promise((resolve) => server.close(resolve));
          server.closeAllConnections();
          await worker.close();
          await stopped;
          await store.close();
        })());
      },
    };
  } catch (error) {
    clearInterval(maintenance);
    server?.close();
    await worker.close();
    await store.close();
    throw error;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  (async () => {
    const providerOptions = cloudflareProviderConfig();
    const { createCloudflareProvider } = await import('./cloudflare-provider.mjs');
    const provider = createCloudflareProvider(providerOptions);
    const service = await runService({ ...serviceConfig(), provider });
    console.log('Private spine service ready.');
    for (const signal of ['SIGINT', 'SIGTERM'])
      process.once(signal, () =>
        service.close().catch(() => {
          process.exitCode = 1;
        }),
      );
  })().catch((error) => {
    console.error(error.code ?? 'SERVICE_ERROR');
    process.exitCode = 1;
  });
}
