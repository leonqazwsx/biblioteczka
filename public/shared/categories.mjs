import { t } from './i18n.mjs';
const normalized = (v) =>
  v
    .toLocaleLowerCase('pl')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
export function cleanSubjects(value) {
  return Array.isArray(value)
    ? [
        ...new Set(
          value
            .filter((s) => typeof s === 'string' && s.trim() && s.trim().length <= 160)
            .map((s) => s.trim()),
        ),
      ].slice(0, 80)
    : [];
}
const rules = [
  {
    name: t('Dzieci i młodzież'),
    score: 100,
    match: /\b(juvenile|young adult|children|childrens|dzieci|dziecieca|mlodziez|mlodziezowa)\b/,
    aliases: ['Dzieci i młodzież', 'Dla dzieci', 'Literatura dziecięca', 'Young adult'],
  },
  {
    name: t('Komiksy'),
    score: 90,
    match: /\b(comics|comic books|graphic novels|manga|komiks|komiksy)\b/,
    aliases: ['Komiksy', 'Comics', 'Manga'],
  },
  {
    name: t('Fantasy'),
    score: 70,
    match:
      /\b(fantasy|fantastyka(?! naukow)|(?<!naukowo )fantastyczna|(?<!naukowo )fantastyczne)\b/,
    aliases: ['Fantasy', 'Fantastyka'],
  },
  {
    name: t('Science fiction'),
    score: 70,
    match:
      /\b(science fiction|sci fi|sf|sciencefiction|fantastyka naukowa|fantastyka naukowo|naukowo fantastyczna|naukowo fantastyczne|dystopian|dystopia|dystopie)\b/,
    aliases: ['Science fiction', 'Sci-fi', 'SF', 'Fantastyka naukowa'],
  },
  {
    name: t('Kryminał'),
    score: 70,
    match: /\b(mystery|detective|crime fiction|kryminal|kryminalna|kryminalne)\b/,
    aliases: ['Kryminał', 'Kryminały', 'Crime', 'Mystery'],
  },
  {
    name: t('Thriller'),
    score: 70,
    match: /\b(thriller|thrillers|suspense|sensacja|sensacyjne|sensacyjna)\b/,
    aliases: ['Thriller', 'Thrillery', 'Sensacja'],
  },
  {
    name: t('Literatura obyczajowa'),
    score: 70,
    match:
      /\b(contemporary fiction|domestic fiction|family fiction|literatura obyczajowa|powiesc obyczajowa|obyczajowe|obyczajowa)\b/,
    aliases: ['Literatura obyczajowa', 'Obyczajowe', 'Powieść obyczajowa'],
  },
  {
    name: t('Klasyka'),
    score: 40,
    match: /\b(classics|classic literature|literary classics|klasyka|literatura klasyczna)\b/,
    aliases: ['Klasyka', 'Literatura klasyczna', 'Classics'],
  },
  {
    name: t('Reportaż'),
    score: 60,
    match: /\b(reportage|reportaz|reportaze|literary journalism)\b/,
    aliases: ['Reportaż', 'Reportaże', 'Reportage'],
  },
  {
    name: t('Romans'),
    score: 70,
    match: /\b(romance fiction|love stories|romans|romanse|romantyczna)\b|^romance$/,
    aliases: ['Romans', 'Romanse', 'Romance'],
  },
  {
    name: t('Horror'),
    score: 70,
    match: /\b(horror|horrory|ghost stories|opowiesci grozy|literatura grozy)\b/,
    aliases: ['Horror', 'Groza', 'Literatura grozy'],
  },
  {
    name: t('Powieść historyczna'),
    score: 70,
    match: /\b(historical fiction|historical novels|powiesc historyczna|powiesci historyczne)\b/,
    aliases: ['Powieść historyczna', 'Powieści historyczne', 'Historical fiction'],
  },
  {
    name: t('Poezja'),
    score: 70,
    match: /\b(poetry|poems|poezja|wiersze)\b/,
    aliases: ['Poezja', 'Poetry'],
  },
  {
    name: t('Dramat'),
    score: 70,
    match: /\b(drama|plays|dramat|dramaty)\b/,
    aliases: ['Dramat', 'Dramaty', 'Drama'],
  },
  {
    name: t('Psychologia'),
    score: 70,
    match: /\b(psychology|psychological|psychologia|psychologiczne|psychologiczna)\b/,
    aliases: ['Psychologia', 'Psychology'],
  },
  {
    name: t('Filozofia'),
    score: 70,
    match: /\b(philosophy|philosophical|filozofia|filozoficzne|filozoficzna)\b/,
    aliases: ['Filozofia', 'Philosophy'],
  },
  {
    name: t('Biznes i ekonomia'),
    score: 70,
    match:
      /\b(business|economics|economy|finance|management|biznes|ekonomia|ekonomiczne|finanse|zarzadzanie)\b/,
    aliases: ['Biznes i ekonomia', 'Biznes', 'Ekonomia', 'Business', 'Economics', 'Finanse'],
  },
  {
    name: t('Technologia'),
    score: 70,
    match:
      /\b(technology|engineering|computers|computer science|programming|technologia|technologie|technika|informatyka|programowanie)\b/,
    aliases: ['Technologia', 'Technika', 'Informatyka', 'Technology'],
  },
  {
    name: t('Podróże'),
    score: 70,
    match: /\b(travel|tourism|podroze|podroz|turystyka|przewodniki turystyczne)\b/,
    aliases: ['Podróże', 'Turystyka', 'Travel'],
  },
  {
    name: t('Kulinaria'),
    score: 70,
    match:
      /\b(cookbooks|cooking|cookery|food|recipes|kulinaria|gotowanie|kuchnia|przepisy kulinarne)\b/,
    aliases: ['Kulinaria', 'Gotowanie', 'Kuchnia', 'Cooking', 'Cookbooks'],
  },
  {
    name: t('Sport'),
    score: 70,
    match: /\b(sport|sports|recreation|fitness|sportowe|sportowa)\b/,
    aliases: ['Sport', 'Sports'],
  },
  {
    name: t('Sztuka'),
    score: 70,
    match: /\b(art|arts|painting|music|architecture|sztuka|sztuki|malarstwo|muzyka|architektura)\b/,
    aliases: ['Sztuka', 'Art', 'Arts'],
  },
  {
    name: t('Religia i duchowość'),
    score: 70,
    match:
      /\b(religion|religious|spirituality|spiritual|theology|religia|religie|religijne|duchowosc|teologia)\b/,
    aliases: ['Religia i duchowość', 'Religia', 'Duchowość', 'Religion', 'Spirituality'],
  },
  {
    name: t('Poradniki'),
    score: 60,
    match:
      /\b(self help|selfhelp|personal development|poradniki|poradnik|rozwoj osobisty|cookbooks|cooking)\b/,
    aliases: ['Poradniki', 'Rozwój osobisty', 'Self-help'],
  },
  {
    name: t('Biografie'),
    score: 55,
    match: /\b(biography|autobiography|biografie|biografia|autobiografia|memoirs)\b/,
    aliases: ['Biografie', 'Biografia', 'Biography'],
  },
  {
    name: t('Historia'),
    score: 50,
    match: /\b(history|historia|historyczne)\b/,
    aliases: ['Historia', 'History'],
  },
  {
    name: t('Literatura popularnonaukowa'),
    score: 50,
    match:
      /\b(science|mathematics|physics|psychology|philosophy|nauka|matematyka|fizyka|psychologia|filozofia)\b/,
    aliases: ['Literatura popularnonaukowa', 'Nauka', 'Popularnonaukowe', 'Science'],
  },
  {
    name: t('Literatura faktu'),
    score: 20,
    match: /\b(nonfiction|non fiction|reportage|reportaz|literatura faktu)\b/,
    aliases: ['Literatura faktu', 'Nonfiction'],
  },
  {
    name: t('Literatura piękna'),
    score: 10,
    match: /\bfiction\b|\b(literatura piekna|beletrystyka|powiesc)\b/,
    aliases: ['Literatura piękna', 'Beletrystyka', 'Fiction'],
  },
];
// Category names are translated (they become shelf names in the user's language); aliases stay in
// both languages so existing shelves match whatever language they were created in.
for (const rule of rules) if (!rule.aliases.includes(rule.name)) rule.aliases.push(rule.name);
export const OTHER_CATEGORY = t('Pozostałe');
const OTHER_ALIASES = [...new Set(['Pozostałe', 'Inne', 'Other', OTHER_CATEGORY])];
export const CATEGORY_PRESETS = Object.freeze(rules.map((rule) => rule.name));
export function shelfForCategory(name, shelves) {
  const aliases =
    rules.find((rule) => rule.name === name)?.aliases ??
    (name === OTHER_CATEGORY ? OTHER_ALIASES : [name]);
  return (
    shelves.find((shelf) =>
      aliases.some((alias) => normalized(alias) === normalized(shelf.name)),
    ) ?? null
  );
}
export function suggestCategory(subjects) {
  const topics = cleanSubjects(subjects).map(normalized),
    matches = rules.filter((rule) => topics.some((topic) => rule.match.test(topic)));
  if (!matches.length) return null;
  const best = Math.max(...matches.map((r) => r.score)),
    winners = matches.filter((r) => r.score === best);
  return winners.length === 1 ? { name: winners[0].name, reason: t('Tematy w katalogu') } : null;
}
export function suggestShelf(subjects, shelves) {
  const category = suggestCategory(subjects),
    name = category?.name ?? OTHER_CATEGORY;
  const shelf = shelfForCategory(name, shelves);
  return {
    shelfId: shelf?.id ?? null,
    newShelfName: shelf ? null : name,
    message: category
      ? t('Propozycja z tematów katalogu: {name}. Możesz wybrać inną półkę.', { name })
      : t('Brak jednoznacznego gatunku w katalogu. Proponuję {name}; możesz wybrać inną półkę.', {
          name,
        }),
  };
}
