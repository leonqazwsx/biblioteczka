// Polish literals that are intentionally not translated, because they are data rather than interface text.
// Each entry: { file, test } — `test` matches the literal's value.
export const I18N_ALLOW = [
  // Aliases match existing shelf names in either language; they must stay as written.
  { file: 'public/shared/categories.mjs', test: /./ },
  // Biblioteka Narodowa API parameter (document kind), not interface text.
  { file: 'src/bn-catalog.mjs', test: /^książka$/ },
];
