import { t } from '../public/shared/i18n.mjs';
const failure = (code, message) => {
  throw Object.assign(new Error(message), { code });
};
export function parseCsv(
  text,
  { maxRecords = 10000, maxColumns = 100, maxCellLength = 100000 } = {},
) {
  if (typeof text !== 'string') failure('INVALID_CSV', t('Nieprawidłowy plik CSV.'));
  if (text.startsWith('\uFEFF')) text = text.slice(1);
  let headers = null,
    cells = [],
    cell = '',
    mode = 'start',
    recordNumber = 0;
  const records = [];
  const append = (char) => {
    cell += char;
    if (cell.length > maxCellLength)
      failure('TOO_LARGE', t('Komórka CSV przekracza dozwolony rozmiar.'));
  };
  const field = () => {
    cells.push(cell);
    if (cells.length > maxColumns) failure('TOO_LARGE', 'CSV zawiera zbyt wiele kolumn.');
    cell = '';
    mode = 'start';
  };
  const record = () => {
    field();
    if (headers === null) {
      headers = cells.map((v) => v.trim());
      const keys = headers.map((v) => v.toLocaleLowerCase('pl'));
      if (headers.some((v) => !v) || new Set(keys).size !== keys.length)
        failure('INVALID_CSV', t('CSV ma puste lub powtórzone nagłówki.'));
    } else {
      recordNumber++;
      if (cells.some((v) => v.trim())) {
        if (cells.length !== headers.length)
          failure(
            'INVALID_CSV',
            t('Nieprawidłowa liczba komórek w pozycji {record}.', { record: recordNumber }),
          );
        if (records.length >= maxRecords) failure('TOO_LARGE', 'CSV zawiera zbyt wiele pozycji.');
        records.push({ recordNumber, cells });
      }
    }
    cells = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (mode === 'quote') {
      if (c === '"') {
        if (text[i + 1] === '"') {
          append('"');
          i++;
        } else mode = 'after';
      } else append(c);
      continue;
    }
    if (c === ',') {
      field();
      continue;
    }
    if (c === '\r' || c === '\n') {
      record();
      if (c === '\r' && text[i + 1] === '\n') i++;
      continue;
    }
    if (mode === 'after')
      failure('INVALID_CSV', t('Nieprawidłowy tekst po zamknięciu cudzysłowu.'));
    if (c === '"') {
      if (mode !== 'start') failure('INVALID_CSV', t('Nieprawidłowy cudzysłów w komórce.'));
      mode = 'quote';
    } else {
      append(c);
      mode = 'bare';
    }
  }
  if (mode === 'quote') failure('INVALID_CSV', t('Nie zamknięto cudzysłowu w CSV.'));
  if (cell.length || cells.length || mode !== 'start') record();
  if (headers === null) failure('INVALID_CSV', t('CSV nie zawiera nagłówków.'));
  return { headers, records };
}
