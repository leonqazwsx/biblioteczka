import {pathToFileURL} from 'node:url';
import {openJobStore} from './job-store.mjs';
import {problem} from '../../src/domain.mjs';

export async function resolveUncertain({dataDir, workId, resolution}) {
  if (resolution !== 'failed') throw problem('INVALID', 'Dozwolone rozstrzygnięcie: failed.');
  const store = await openJobStore({dataDir});
  try {
    if (store.work(workId).state !== 'uncertain') throw problem('CONFLICT', 'Zadanie nie jest niepewne.');
    await store.transition(workId, {state: 'failed', errorCode: 'OPERATOR_RESOLVED', retryAt: null});
    await store.prune();
  } finally {await store.close();}
}
export async function resolveAuthorizationPause({dataDir}) {
  const store = await openJobStore({dataDir});
  try {await store.resumeAuthorization();} finally {await store.close();}
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  (process.argv[3] === 'resume-authorization' ? resolveAuthorizationPause({dataDir: process.argv[2]}) :
    resolveUncertain({dataDir: process.argv[2], workId: process.argv[3], resolution: process.argv[4]})).catch(error => {
    console.error(error.code ?? 'ADMIN_ERROR'); process.exitCode = 1;
  });
}
