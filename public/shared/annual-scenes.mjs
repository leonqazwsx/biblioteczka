import { calibrateShelfContacts } from './shelf-contact.mjs';
import { t } from './i18n.mjs';
// Measurements belong to the empty production photographs (1672 × 941).
// Slots are in reading order: left to right, then the next lower level.
const rect = (x, y, width, height) => ({
  x: x / 1672,
  y: y / 941,
  width: width / 1672,
  height: height / 941,
});
const shelf = (
  id,
  left,
  right,
  bottom,
  height,
  frontLeft = left - 4,
  frontRight = right + 4,
  lip = 10,
) => ({
  id,
  books: rect(left, bottom - height, right - left, height),
  front: rect(frontLeft, bottom - 2, frontRight - frontLeft, lip),
});
function scene(id, conceptNumber, name, description, bookHeight, slots, wallColors) {
  return calibrateShelfContacts({
    id,
    conceptNumber,
    name: conceptNumber + ' · ' + name,
    description,
    annual: true,
    lighting: 'theme',
    aspectRatio: 1672 / 941,
    bookHeight,
    slots,
    wallColors,
    assets: { light: '/assets/room/' + id + '-day.png', dark: '/assets/room/' + id + '-night.png' },
  });
}
export const ANNUAL_SCENES = [
  scene(
    'annual-niches',
    1,
    t('Nisze w tynku'),
    t('Dwanaście półek w jasnym tynku i ciepłym dębie'),
    88,
    [
      shelf('niches-1', 390, 599, 307, 112, 377, 613, 20),
      shelf('niches-2', 715, 1208, 324, 119, 700, 1225, 19),
      shelf('niches-3', 1330, 1600, 374, 106, 1315, 1622, 14),
      shelf('niches-4', 390, 599, 439, 112, 377, 613, 18),
      shelf('niches-5', 715, 1208, 459, 119, 700, 1225, 20),
      shelf('niches-6', 1330, 1600, 488, 99, 1315, 1622, 14),
      shelf('niches-7', 390, 599, 566, 109, 377, 613, 16),
      shelf('niches-8', 715, 1208, 599, 120, 700, 1225, 20),
      shelf('niches-9', 1330, 1600, 599, 97, 1315, 1622, 15),
      shelf('niches-10', 392, 596, 696, 113, 380, 610, 12),
      shelf('niches-11', 718, 1205, 711, 92, 704, 1220, 13),
      shelf('niches-12', 1332, 1598, 712, 97, 1317, 1616, 12),
    ],
    { light: '#d2c0a4', dark: '#815b39' },
  ),
  scene(
    'annual-divider',
    4,
    t('Regał jako przegroda'),
    t('Orzech, lekki metal i ogród za otwartym regałem'),
    111,
    [294, 532, 755].flatMap((bottom, row) =>
      [
        [477, 714],
        [752, 985],
        [1027, 1259],
        [1297, 1518],
      ].map(([left, right], col) =>
        shelf('divider-' + (row * 4 + col + 1), left, right, bottom, 150, left - 6, right + 7, 13),
      ),
    ),
    { light: '#d2c4b1', dark: '#64503d' },
  ),
  scene(
    'annual-lines',
    5,
    t('Zawieszone linie'),
    t('Dwanaście stalowych półek na mineralnej ścianie'),
    78,
    [
      [
        [430, 738, 234],
        [813, 1159, 234],
        [1237, 1558, 234],
      ],
      [
        [470, 749, 379],
        [833, 1154, 379],
        [1202, 1554, 379],
      ],
      [
        [435, 741, 527],
        [822, 1159, 527],
        [1275, 1557, 527],
      ],
      [
        [420, 750, 666],
        [826, 1155, 666],
        [1205, 1557, 666],
      ],
    ].flatMap((row, r) =>
      row.map(([left, right, bottom], col) =>
        shelf('lines-' + (r * 3 + col + 1), left, right, bottom, 96, left - 9, right + 12, 11),
      ),
    ),
    { light: '#b3a99b', dark: '#765335' },
  ),
  scene(
    'annual-panorama',
    6,
    t('Niska biblioteka z widokiem'),
    t('Jesion, aluminium i spokojny pejzaż za oknem'),
    96,
    // Inner wooden edge after each aluminium jamb; lip masks retain their own bounds.
    [596, 734].flatMap((bottom, row) =>
      [
        [382, 560, 382],
        [579, 759, 579],
        [775, 953, 774],
        [971, 1149, 971],
        [1167, 1347, 1168],
        [1367, 1561, 1366],
      ].map(([left, right, frontLeft], col) =>
        shelf(
          'panorama-' + (row * 6 + col + 1),
          left,
          right,
          bottom,
          122,
          frontLeft,
          right + 6,
          12,
        ),
      ),
    ),
    { light: '#b7a48a', dark: '#825e3c' },
  ),
];
