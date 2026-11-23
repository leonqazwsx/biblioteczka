// Adds translations to public/locales/en.json and keeps it sorted like the Polish keys.
// Usage: node tools/i18n-add.mjs translations.json
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './i18n-keys.mjs';

const file = path.join(ROOT, 'public', 'locales', 'en.json');
const dictionary = {
  ...JSON.parse(fs.readFileSync(file, 'utf8')),
  ...JSON.parse(fs.readFileSync(process.argv[2], 'utf8')),
};
const sorted = Object.fromEntries(
  Object.keys(dictionary)
    .sort((a, b) => a.localeCompare(b, 'pl'))
    .map((k) => [k, dictionary[k]]),
);
fs.writeFileSync(file, JSON.stringify(sorted, null, 2) + '\n');
console.log('en.json:', Object.keys(sorted).length, 'keys');
