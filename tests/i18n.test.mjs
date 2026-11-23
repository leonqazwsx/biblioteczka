import test from 'node:test';
import assert from 'node:assert/strict';
import { allKeys, readDictionary, untranslated } from '../tools/i18n-keys.mjs';
import { I18N_ALLOW } from './i18n-allow.mjs';
import { detectLanguage, translate } from '../public/shared/i18n.mjs';

const keys = allKeys(),
  dictionary = readDictionary();
const placeholders = (text) => (text.match(/\{\w+\}/g) ?? []).sort().join(',');

test('every interface text has an English translation and nothing is left over', () => {
  const missing = [...keys.keys()].filter((key) => !Object.hasOwn(dictionary, key));
  const unused = Object.keys(dictionary).filter((key) => !keys.has(key));
  assert.deepEqual(missing, [], 'add these to public/locales/en.json (node tools/i18n-keys.mjs)');
  assert.deepEqual(unused, [], 'remove these from public/locales/en.json');
});

test('translations keep placeholders and the spacing around text fragments', () => {
  for (const [key, value] of Object.entries(dictionary)) {
    assert.ok(typeof value === 'string' && value.trim(), 'empty translation for ' + key);
    assert.equal(placeholders(value), placeholders(key), 'placeholders differ for ' + key);
    assert.equal(value.match(/^\s*/)[0], key.match(/^\s*/)[0], 'leading space differs for ' + key);
    assert.equal(value.match(/\s*$/)[0], key.match(/\s*$/)[0], 'trailing space differs for ' + key);
  }
});

test('no Polish interface text is left outside t()', () => {
  assert.deepEqual(untranslated(I18N_ALLOW), []);
});

test('language detection and translation fall back safely', () => {
  assert.equal(detectLanguage(['pl-PL', 'en-US']), 'pl');
  assert.equal(detectLanguage(['en-GB', 'pl']), 'en');
  assert.equal(detectLanguage(['de-DE']), 'en');
  assert.equal(detectLanguage([]), 'pl');
  assert.equal(translate('en', 'Dodaj książkę'), 'Add book');
  assert.equal(translate('pl', 'Dodaj książkę'), 'Dodaj książkę');
  assert.equal(translate('en', 'Tekst bez tłumaczenia'), 'Tekst bez tłumaczenia');
  assert.equal(translate('en', 'Przeczytano: {date}', { date: '29.02.2024' }), 'Read: 29.02.2024');
  assert.equal(translate('pl', 'Strona {page} / {pages}', { page: 2 }), 'Strona 2 / {pages}');
});
