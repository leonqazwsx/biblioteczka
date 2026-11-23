// One-off codemod: wraps Polish string literals in t('…') and adds the i18n import.
// Skips (and reports) literals that need a human: object keys, comparisons, template literals with ${}.
// Usage: node tools/i18n-wrap.mjs <file.mjs> [...]
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './i18n-keys.mjs';

const POLISH = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;
const I18N = path.join(ROOT, 'public', 'shared', 'i18n.mjs');

function literals(text) {
  const found = [];
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
    let j = i + 1,
      interpolated = false;
    for (; j < text.length; j++) {
      if (text[j] === '\\') j++;
      else if (text[j] === c) break;
      else if (c === '`' && text[j] === '$' && text[j + 1] === '{') interpolated = true;
    }
    found.push({ start: i, end: j + 1, raw: text.slice(i, j + 1), interpolated });
    i = j;
  }
  return found;
}

for (const file of process.argv.slice(2)) {
  let text = fs.readFileSync(file, 'utf8');
  const edits = [],
    review = [];
  for (const lit of literals(text)) {
    if (!POLISH.test(lit.raw)) continue;
    const before = text.slice(Math.max(0, lit.start - 40), lit.start);
    const after = text.slice(lit.end, lit.end + 6);
    const line = text.slice(0, lit.start).split('\n').length;
    if (/(?<![\w.$])t\(\s*$/.test(before)) continue;
    if (lit.interpolated) review.push(`${line}: template ${lit.raw.slice(0, 70)}`);
    else if (/^\s*:/.test(after) && /[{,]\s*$/.test(before))
      review.push(`${line}: object key ${lit.raw}`);
    else if (/[!=]==?\s*$/.test(before) || /^\s*[!=]==?/.test(after))
      review.push(`${line}: comparison ${lit.raw}`);
    else if (/\bcase\s*$/.test(before)) review.push(`${line}: case ${lit.raw}`);
    else edits.push(lit);
  }
  for (const lit of edits.reverse())
    text = text.slice(0, lit.start) + 't(' + lit.raw + ')' + text.slice(lit.end);
  if (edits.length && !/import \{[^}]*\bt\b[^}]*\} from '[^']*i18n\.mjs'/.test(text)) {
    let rel = path.relative(path.dirname(file), I18N).replaceAll('\\', '/');
    if (!rel.startsWith('.')) rel = './' + rel;
    const imports = [...text.matchAll(/^import [^;]+;\n/gm)];
    const at = imports.length ? imports.at(-1).index + imports.at(-1)[0].length : 0;
    text = text.slice(0, at) + `import { t } from '${rel}';\n` + text.slice(at);
  }
  fs.writeFileSync(file, text);
  console.log(
    `${path.relative(ROOT, file)}: wrapped ${edits.length}${review.length ? ', review:' : ''}`,
  );
  for (const r of review) console.log('   ' + r);
}
