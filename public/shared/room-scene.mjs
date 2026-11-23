import { ANNUAL_SCENES } from './annual-scenes.mjs';
import { calibrateShelfContacts } from './shelf-contact.mjs';
import { t } from './i18n.mjs';
// Pixel measurements of the approved 1672 x 941 room, normalized for every layer.
const rect = (x, y, width, height) => ({
  x: x / 1672,
  y: y / 941,
  width: width / 1672,
  height: height / 941,
});
const slot = (id, x, y, width, height, frontX, frontY, frontWidth) => ({
  id,
  books: rect(x, y, width, height),
  front: rect(frontX, frontY, frontWidth, 18),
});
export const DEFAULT_ROOM_ID = 'reading-room-v1';
export const ROOM_SCENE = calibrateShelfContacts({
  id: DEFAULT_ROOM_ID,
  name: t('Orzechowy pokój'),
  description: t('Dotychczasowe wnętrze, w dzień i wieczorem'),
  lighting: 'theme',
  bookHeight: 88,
  aspectRatio: 16 / 9,
  assets: { light: '/assets/room/day.png', dark: '/assets/room/night.png' },
  wallColors: { light: '#d0bda2', dark: '#433025' },
  slots: [
    slot('top-left', 506, 58, 508, 117, 488, 174, 551),
    slot('top-right', 1091, 58, 512, 117, 1072, 174, 551),
    slot('middle-left', 506, 246, 285, 113, 488, 358, 323),
    slot('middle-center', 861, 246, 305, 114, 842, 358, 341),
    slot('middle-right', 1230, 246, 373, 114, 1210, 358, 414),
    slot('bottom-left', 506, 430, 508, 104, 488, 532, 551),
    slot('bottom-right', 1091, 430, 336, 104, 1072, 532, 551),
  ],
});
function room(id, name, description, lighting, asset, slots, bookHeight, alternate) {
  return calibrateShelfContacts({
    id,
    name,
    description,
    lighting: 'theme',
    bookHeight,
    aspectRatio: 16 / 9,
    assets:
      lighting === 'evening'
        ? { light: alternate, dark: asset }
        : { light: asset, dark: alternate },
    wallColors: { light: '#d0bda2', dark: '#433025' },
    slots,
  });
}
// Measurements follow each photograph. Shorter usable spans exclude lamps, foliage and chairs.
export const ROOM_SCENES = [
  ROOM_SCENE,
  room(
    'oak-library',
    t('Jasny dąb'),
    t('Ciepłe drewno i lniany fotel'),
    'day',
    '/assets/room/oak.png',
    [
      slot('oak-top-left', 438, 72, 365, 183, 421, 253, 395),
      slot('oak-top-center', 839, 72, 387, 183, 826, 253, 414),
      slot('oak-top-right', 1265, 72, 365, 183, 1250, 253, 401),
      slot('oak-bottom-left', 438, 286, 365, 210, 421, 494, 395),
      slot('oak-bottom-center', 839, 286, 387, 210, 826, 494, 414),
      slot('oak-bottom-right', 1265, 286, 365, 210, 1250, 494, 401),
    ],
    115,
    '/assets/room/oak-night.png',
  ),
  room(
    'green-library',
    t('Zielona biblioteka'),
    t('Oliwkowa zabudowa i skórzany fotel'),
    'day',
    '/assets/room/green.png',
    [
      slot('green-top-left', 395, 82, 260, 187, 383, 267, 281),
      slot('green-top-center-left', 698, 82, 250, 187, 684, 267, 274),
      slot('green-top-center-right', 988, 82, 258, 187, 976, 267, 278),
      slot('green-top-right', 1282, 82, 247, 187, 1272, 267, 274),
      slot('green-bottom-left', 395, 301, 260, 195, 383, 494, 281),
      slot('green-bottom-center-left', 698, 301, 250, 195, 684, 494, 274),
      slot('green-bottom-center-right', 988, 301, 258, 195, 976, 494, 278),
      slot('green-bottom-right', 1282, 301, 105, 195, 1272, 494, 274),
    ],
    110,
    '/assets/room/green-night.png',
  ),
  room(
    'window-reading',
    t('Czytelnia przy oknie'),
    t('Biała biblioteka i miejsce wśród zieleni'),
    'day',
    '/assets/room/window.png',
    [
      slot('window-top-left', 426, 87, 286, 111, 418, 196, 301),
      slot('window-top-right', 1309, 87, 303, 111, 1300, 196, 320),
      slot('window-second-left', 426, 225, 286, 121, 418, 344, 301),
      slot('window-second-right', 1309, 225, 303, 121, 1300, 344, 320),
      slot('window-third-left', 426, 370, 286, 124, 418, 492, 301),
      slot('window-third-right', 1309, 370, 303, 124, 1300, 492, 320),
      slot('window-bottom-left', 426, 515, 286, 118, 418, 631, 301),
      slot('window-bottom-right', 1309, 515, 174, 118, 1300, 631, 320),
    ],
    90,
    '/assets/room/window-night.png',
  ),
  room(
    'walnut-library',
    t('Orzechowa biblioteka'),
    t('Orzech, miękki fotel i światło z okna'),
    'evening',
    '/assets/room/walnut.png',
    [
      slot('walnut-top-left', 489, 47, 450, 111, 470, 156, 486),
      slot('walnut-top-right', 996, 47, 436, 111, 981, 156, 485),
      slot('walnut-second-left', 489, 191, 450, 113, 470, 302, 486),
      slot('walnut-second-right', 996, 191, 436, 113, 981, 302, 485),
      slot('walnut-third-left', 489, 339, 450, 104, 470, 441, 486),
      slot('walnut-third-right', 996, 339, 436, 104, 981, 441, 485),
      slot('walnut-bottom-left', 489, 477, 450, 94, 470, 569, 486),
      slot('walnut-bottom-right', 996, 477, 292, 94, 981, 569, 485),
    ],
    82,
    '/assets/room/walnut-day.png',
  ),
  room(
    'navy-study',
    t('Granatowy gabinet'),
    t('Spokojne miejsce do czytania i pracy'),
    'day',
    '/assets/room/navy.png',
    [
      slot('navy-top-left', 466, 69, 314, 115, 453, 182, 338),
      slot('navy-top-center', 831, 69, 400, 115, 819, 182, 422),
      slot('navy-top-right', 1302, 69, 326, 115, 1289, 182, 350),
      slot('navy-middle-left', 466, 225, 314, 136, 453, 359, 338),
      slot('navy-middle-center', 831, 225, 400, 136, 819, 359, 422),
      slot('navy-middle-right', 1302, 225, 326, 136, 1289, 359, 350),
      slot('navy-bottom-left', 466, 400, 252, 164, 453, 562, 338),
      slot('navy-bottom-right', 1302, 400, 326, 164, 1289, 562, 350),
    ],
    96,
    '/assets/room/navy-night.png',
  ),
  ...ANNUAL_SCENES,
];
export function getRoomScene(id = DEFAULT_ROOM_ID) {
  const scene = ROOM_SCENES.find((s) => s.id === id);
  if (!scene) throw new Error('Invalid room selection');
  return scene;
}
export function validateScene(scene) {
  if (
    !scene ||
    !Number.isFinite(scene.aspectRatio) ||
    scene.aspectRatio <= 0 ||
    !Array.isArray(scene.slots) ||
    !scene.slots.length ||
    scene.slots.length > 32 ||
    new Set(scene.slots.map((s) => s.id)).size !== scene.slots.length
  )
    throw new Error('Invalid room scene');
  for (const s of scene.slots)
    for (const r of [s.books, s.front])
      if (
        !r ||
        ![r.x, r.y, r.width, r.height].every(Number.isFinite) ||
        r.x < 0 ||
        r.y < 0 ||
        r.width <= 0 ||
        r.height <= 0 ||
        r.x + r.width > 1 ||
        r.y + r.height > 1
      )
        throw new Error('Invalid room bounds');
  for (const s of scene.slots)
    if (
      s.contactY !== undefined &&
      (!Number.isFinite(s.contactY) ||
        s.contactY < 0 ||
        s.contactY > 1 ||
        Math.abs(s.books.y + s.books.height - s.contactY) > 1e-10 ||
        s.front.y + 1e-10 < s.contactY)
    )
      throw new Error('Invalid shelf contact');
  return scene;
}
ROOM_SCENES.forEach(validateScene);
export function fitScene(scene, { width, height, iconSpace }) {
  if (
    ![width, height, iconSpace].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0 ||
    iconSpace < 0 ||
    iconSpace > 0.3
  )
    throw new Error('Invalid viewport');
  const w = Math.max(width, height * scene.aspectRatio),
    h = w / scene.aspectRatio;
  if (scene.annual) {
    // A month owns one physical shelf. Cover-cropping must never remove it.
    const first = Math.min(...scene.slots.map((s) => s.books.x));
    const bottom = Math.max(...scene.slots.map((s) => s.front.y + s.front.height));
    const annualWidth = Math.min(
      w,
      ((height - 24) / bottom) * scene.aspectRatio,
      (width * (1 - iconSpace)) / (1 - first),
    );
    return {
      x: width - annualWidth,
      y: 0,
      width: annualWidth,
      height: annualWidth / scene.aspectRatio,
    };
  }
  // Keep the shelf wall visible: crop the left edge or floor, never add bars.
  return { x: width - w, y: 0, width: w, height: h };
}
