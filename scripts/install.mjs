import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publish } from './publish.mjs';
const args = process.argv.slice(2),
  value = (name) => {
    const i = args.indexOf(name);
    return i < 0 ? undefined : args[i + 1];
  };
try {
  const sourceRoot = path.resolve(
    value('--source') ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'),
  );
  const target = value('--target');
  if (!target || !path.isAbsolute(target))
    throw new Error('Wybierz bezwzględną ścieżkę folderu Biblioteczka.');
  const result = await publish({
    sourceRoot,
    targetRoot: target,
    runtimePath: path.join(sourceRoot, 'runtime'),
    port: Number(value('--port') ?? 47831),
  });
  console.log(JSON.stringify(result, null, 2));
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
