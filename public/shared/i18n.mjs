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

// The server gets its language from the host (BIBLIOTECZKA_LANG). Node also has navigator.languages
// (the system locale), so the browser check must not run there.
function initialLanguage() {
  if (typeof process !== 'undefined' && process.env?.BIBLIOTECZKA_LANG)
    return detectLanguage(process.env.BIBLIOTECZKA_LANG);
  if (typeof document !== 'undefined' && typeof navigator !== 'undefined' && navigator.languages)
    return detectLanguage([...navigator.languages]);
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

/** Attributes of static HTML that hold interface text. */
export const TRANSLATED_ATTRIBUTES = ['aria-label', 'placeholder', 'title', 'alt'];

/** Whitespace-normalized text of an HTML text node, or null when it has no letters. */
export const htmlKey = (text) => (/\p{L}/u.test(text) ? text.trim().replace(/\s+/g, ' ') : null);

/**
 * Translates the static HTML of a page once at startup: every text node and the attributes above.
 * The Polish text in the HTML is the key, so the HTML files stay readable and need no markup.
 */
export function translateDocument(doc = globalThis.document) {
  if (!doc?.createTreeWalker) return;
  doc.documentElement.lang = current;
  doc.title = t(htmlKey(doc.title) ?? doc.title);
  if (current === 'pl') return;
  const walker = doc.createTreeWalker(doc.body, 4 /* NodeFilter.SHOW_TEXT */);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const key = htmlKey(node.nodeValue);
    if (!key) continue;
    const [, lead, , trail] = node.nodeValue.match(/^(\s*)([\s\S]*?)(\s*)$/);
    node.nodeValue = lead + t(key) + trail;
  }
  for (const name of TRANSLATED_ATTRIBUTES)
    for (const element of doc.body.querySelectorAll(`[${name}]`)) {
      const key = htmlKey(element.getAttribute(name));
      if (key) element.setAttribute(name, t(key));
    }
}
