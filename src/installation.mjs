import path from 'node:path';
import { createHash } from 'node:crypto';
export function installationId(appRoot, dataDir = path.join(appRoot, 'data')) {
  const normalize = (value) => {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return createHash('sha256')
    .update(normalize(appRoot) + '\n' + normalize(dataDir))
    .digest('hex');
}
