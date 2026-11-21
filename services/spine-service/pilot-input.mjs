import {createInterface} from 'node:readline';
import {Writable} from 'node:stream';
import {problem} from '../../src/domain.mjs';

export function accountId(value) {
  const result = typeof value === 'string' ? value.trim() : '';
  if (!/^[0-9a-f]{32}$/i.test(result)) throw problem('PILOT_ACCOUNT_ID', 'Account ID musi miec 32 znaki: cyfry i litery a-f. Wklej samo ID, bez adresu strony.');
  return result;
}
export function apiToken(value) {
  const result = typeof value === 'string' ? value.trim() : '';
  if (!/^[\x21-\x7e]{24,512}$/.test(result) || /['"]/.test(result)) throw problem('PILOT_API_TOKEN', 'Wklej sam token Workers AI, bez Bearer, cudzyslowow i spacji.');
  return result;
}
export function operatorConfig(input) {
  if (input.freeConfirmed !== true) throw problem('PILOT_FREE_REQUIRED', 'Najpierw potwierdz plan Workers Free w panelu konta.');
  return {accountId: accountId(input.accountId), apiToken: apiToken(input.apiToken), freeConfirmed: true};
}

export function createHiddenPrompt({input = process.stdin, output = process.stdout} = {}) {
  if (!input.isTTY) throw problem('PILOT_TERMINAL_REQUIRED', 'Uruchom probe w zwyklym oknie terminala.');
  const muted = new Writable({write(_chunk, _encoding, callback) {callback();}});
  muted.columns = output.columns ?? 80;
  const terminal = createInterface({input, output: muted, terminal: true, historySize: 0});
  input.ref?.();
  const queued = []; let pending, closed = false, closing;
  function close() {
    if (closing) return closing; closed = true;
    input.pause(); queued.length = 0;
    if (pending) {pending.reject(problem('PILOT_CANCELLED', 'Przerwano wpisywanie.')); pending = null; output.write('\n');}
    // Let the Windows console finish its pending read before restoring cooked mode.
    return closing = new Promise(setImmediate).then(() => {terminal.close(); input.unref?.(); muted.end();});
  }
  terminal.on('line', value => {
    if (pending) {const answer = pending; pending = null; output.write('\n'); answer.resolve(value);}
    else if (queued.length < 10) queued.push(value);
    else close();
  });
  terminal.once('SIGINT', close); terminal.once('close', close);
  return {
    ask(label) {
      if (closed) return Promise.reject(problem('PILOT_CANCELLED', 'Przerwano wpisywanie.'));
      if (pending) throw problem('PILOT_PROMPT_BUSY', 'Najpierw zakoncz poprzednie pole.');
      output.write(label);
      if (queued.length) {output.write('\n'); return Promise.resolve(queued.shift());}
      return new Promise((resolve, reject) => {pending = {resolve, reject};});
    }, close
  };
}
export async function readHiddenLine(label, options) {
  const prompt = createHiddenPrompt(options);
  try {return await prompt.ask(label);} finally {await prompt.close();}
}
