export function roomSelectionPatch(scene) {
  // Room appearance must not silently replace the user's date/genre filter.
  return { room: scene.id };
}

export function isMonthlyView(settings, scene) {
  return scene.annual === true && settings.grouping === 'months';
}

export function readingYearPatch(value) {
  const text = String(value ?? '').trim(),
    year = Number(text);
  if (!/^\d{1,4}$/.test(text) || !Number.isInteger(year) || year < 1 || year > 9999)
    throw new Error('Wpisz pełny rok od 1 do 9999.');
  return { readingYear: year };
}

export function readingYearValue(settings, date = new Date()) {
  return Number.isInteger(settings.readingYear) &&
    settings.readingYear >= 1 &&
    settings.readingYear <= 9999
    ? settings.readingYear
    : date.getFullYear();
}
