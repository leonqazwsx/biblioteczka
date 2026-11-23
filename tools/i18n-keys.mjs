// Finds translatable texts in the project and reports what public/locales/en.json is missing.
// Usage: node tools/i18n-keys.mjs            -> lists missing and unused keys
//        node tools/i18n-keys.mjs --untranslated -> lists Polish literals not wrapped in t()
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRANSLATED_ATTRIBUTES, htmlKey } from '../public/shared/i18n.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const POLISH = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;

function walk(dir, extensions, skip = []) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (skip.some((s) => full.includes(s))) continue;
    if (entry.isDirectory()) out.push(...walk(full, extensions, skip));
    else if (extensions.includes(path.extname(entry.name))) out.push(full);
  }
  return out;
}

export const sourceFiles = () => [
  ...walk(path.join(ROOT, 'public'), ['.mjs', '.html'], [path.join('public', 'assets')]),
  ...walk(path.join(ROOT, 'src'), ['.mjs']),
  ...walk(path.join(ROOT, 'host', 'Biblioteczka.Host'), ['.cs'], ['bin', 'obj']),
];

/** Reads JS/C# string literal bodies starting at `i` (the opening quote). Returns [value, endIndex]. */
/** Value is null for template literals with ${…}; the end index then points at the closing backtick. */
function readLiteral(text, i) {
  const quote = text[i];
  let value = '',
    interpolated = false;
  for (let j = i + 1; j < text.length; j++) {
    const c = text[j];
    if (c === '\\') {
      const next = text[j + 1];
      value += next === 'n' ? '\n' : next === 't' ? '\t' : next;
      j++;
    } else if (c === quote) return [interpolated ? null : value, j];
    else if (quote === '`' && c === '$' && text[j + 1] === '{') {
      interpolated = true;
      j = skipExpression(text, j + 2);
    } else value += c;
  }
  return [null, text.length];
}

/** Skips a ${…} expression (which may contain strings and nested templates); returns the index of its '}'. */
function skipExpression(text, j) {
  for (let depth = 1; j < text.length; j++) {
    const c = text[j];
    if (c === "'" || c === '"' || c === '`') j = readLiteral(text, j)[1];
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return j;
  }
  return j;
}

/** Keys used in a file: t('…') / translate(lang, '…') in JS, L.T("…") in C#, data-i18n in HTML. */
export function keysIn(file) {
  const text = fs.readFileSync(file, 'utf8');
  const keys = [];
  const call = file.endsWith('.cs')
    ? /\bL\.T\(\s*(?=")/g
    : /(?<![\w.$])t\(\s*(?=['"`])|\btranslate\(\s*[\w.()]+,\s*(?=['"`])/g;
  for (const match of text.matchAll(call)) {
    const [value] = readLiteral(text, match.index + match[0].length);
    if (value !== null) keys.push(value);
  }
  if (file.endsWith('.html')) {
    // Mirrors translateDocument(): every text node and the translated attributes.
    const html = text.replace(/<(script|style)\b[\s\S]*?<\/\1>/g, '').replace(/<!--[\s\S]*?-->/g, '');
    for (const m of html.matchAll(/>([^<]+)</g)) {
      const key = htmlKey(m[1].replaceAll('&nbsp;', ' '));
      if (key) keys.push(key);
    }
    for (const name of TRANSLATED_ATTRIBUTES)
      for (const m of html.matchAll(new RegExp('\\s' + name + '="([^"]*)"', 'g'))) {
        const key = htmlKey(m[1]);
        if (key) keys.push(key);
      }
  }
  return keys;
}

export function allKeys() {
  const keys = new Map();
  for (const file of sourceFiles())
    for (const key of keysIn(file)) keys.set(key, path.relative(ROOT, file));
  return keys;
}

export const readDictionary = () =>
  JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'locales', 'en.json'), 'utf8'));

/** Polish string literals in JS that are not translation keys (likely forgotten texts). */
export function untranslated(allow = []) {
  const found = [];
  for (const file of sourceFiles().filter((f) => f.endsWith('.mjs'))) {
    const text = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file).replaceAll('\\', '/');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '/' && text[i + 1] === '/') {
        i = text.indexOf('\n', i);
        if (i < 0) break;
        continue;
      }
      if (c === '/' && text[i + 1] === '*') {
        i = text.indexOf('*/', i + 2) + 1;
        continue;
      }
      if (c !== "'" && c !== '"' && c !== '`') continue;
      const [value, end] = readLiteral(text, i);
      const literal = text.slice(i, end + 1);
      if (value !== null ? POLISH.test(value) : POLISH.test(literal)) {
        const before = text.slice(Math.max(0, i - 40), i);
        const isKey = /(?<![\w.$])t\(\s*$|\btranslate\(\s*[\w.()]+,\s*$/.test(before);
        const line = text.slice(0, i).split('\n').length;
        const shown = (value ?? literal).slice(0, 80);
        if (!isKey && !allow.some((a) => a.file === rel && a.test.test(shown)))
          found.push(`${rel}:${line} ${JSON.stringify(shown)}`);
      }
      i = end;
    }
  }
  return found;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--untranslated')) {
    const { I18N_ALLOW } = await import('../tests/i18n-allow.mjs');
    for (const line of untranslated(I18N_ALLOW)) console.log(line);
  } else {
    const keys = allKeys(),
      dictionary = readDictionary();
    const missing = [...keys].filter(([key]) => !Object.hasOwn(dictionary, key));
    const unused = Object.keys(dictionary).filter((key) => !keys.has(key));
    console.log('keys:', keys.size, 'missing:', missing.length, 'unused:', unused.length);
    if (process.argv.includes('--json'))
      console.log(JSON.stringify(Object.fromEntries(missing.map(([k]) => [k, ''])), null, 2));
    else for (const [key, file] of missing) console.log('missing', file, JSON.stringify(key));
    for (const key of unused) console.log('unused', JSON.stringify(key));
  }
}
