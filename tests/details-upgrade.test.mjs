import test from 'node:test';
import { topLevelStatement } from './helpers/source.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createClientUpgrade } from '../public/manager/client-upgrade.mjs';
const source = await fs.readFile(new URL('../public/manager/app.mjs', import.meta.url), 'utf8');
test('actual upgrade wiring preserves unsaved status/date in lightweight details', () => {
  let reloads = 0,
    message = '';
  const context = vm.createContext({
    createClientUpgrade,
    $: () => ({ hidden: true }),
    layoutPanel: null,
    importPanel: null,
    detailDirty: () => true,
    location: { reload: () => reloads++ },
    notice: (text) => (message = text),
  });
  vm.runInContext(
    topLevelStatement(source, 'const clientUpgrade =') +
      'clientUpgrade.available();',
    context,
  );
  assert.equal(reloads, 0);
  assert.match(message, /zmian|formularz/i);
});
test('closing lightweight details releases a pending version upgrade', () => {
  let closed,
    checked = 0;
  const context = vm.createContext({
    $: () => ({ addEventListener: (_, fn) => (closed = fn) }),
    detailsGuard: { reset() {} },
    detailBookId: 'book',
    document: { querySelector: () => null },
    CSS: { escape: (x) => x },
    clientUpgrade: { editorClosed: () => checked++ },
  });
  const start = source.indexOf("$('book-details').addEventListener('close'");
  vm.runInContext(source.slice(start, source.indexOf('\nfunction populate', start)), context);
  closed();
  assert.equal(checked, 1);
});
