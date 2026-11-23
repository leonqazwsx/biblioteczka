// Translations. The Polish source text is the key (gettext style): t('Dodaj książkę').
// Polish needs no dictionary; public/locales/en.json maps each Polish text to English.
// Placeholders use braces: t('Przeczytano: {date}', { date }).
// The same module runs in the browser (panel, wallpaper) and in Node (server messages).
import en from '../locales/en.json' with { type: 'json' };

export const LANGUAGES = ['pl', 'en'];
const dictionaries = { pl: null, en };

/** Picks 'pl' for Polish, 'en' for everything else; 'pl' when nothing is known. */
export function detectLanguage(candidates) {
  const list = (Array.isArray(candidates) ? candidates : [candidates]).filter(
    (c) => typeof c === 'string' && c.trim(),
  );
  if (!list.length) return 'pl';
  return list[0].trim().toLowerCase().startsWith('pl') ? 'pl' : 'en';
}

function initialLanguage() {
  if (typeof navigator !== 'undefined' && navigator.languages)
    return detectLanguage([...navigator.languages]);
  if (typeof process !== 'undefined' && process.env?.BIBLIOTECZKA_LANG)
    return detectLanguage(process.env.BIBLIOTECZKA_LANG);
  return 'pl';
}

let current = initialLanguage();

export const language = () => current;

export function setLanguage(lang) {
  current = LANGUAGES.includes(lang) ? lang : 'pl';
}

function fill(template, params) {
  return params
    ? template.replace(/\{(\w+)\}/g, (match, key) =>
        Object.hasOwn(params, key) ? String(params[key]) : match,
      )
    : template;
}

/** Translates `text` into the given language. */
export function translate(lang, text, params) {
  const dictionary = dictionaries[lang];
  return fill(dictionary && Object.hasOwn(dictionary, text) ? dictionary[text] : text, params);
}

/** Translates `text` into the current language. */
export const t = (text, params) => translate(current, text, params);

/** Locale for Intl formatting (dates, sorting, numbers). */
export const locale = () => (current === 'pl' ? 'pl-PL' : 'en-US');

/**
 * Translates static HTML marked with data-i18n (text content) and
 * data-i18n-attr="aria-label,placeholder,title" (attribute values). The Polish text in the HTML is the key.
 */
export function translateDocument(root = document) {
  root.documentElement && (root.documentElement.lang = current);
  for (const node of root.querySelectorAll('[data-i18n]'))
    node.textContent = t(node.textContent.trim());
  for (const node of root.querySelectorAll('[data-i18n-attr]'))
    for (const name of node.getAttribute('data-i18n-attr').split(','))
      if (node.hasAttribute(name.trim()))
        node.setAttribute(name.trim(), t(node.getAttribute(name.trim())));
  if (root.title) root.title = t(root.title);
}
