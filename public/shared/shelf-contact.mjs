// Photographic contact calibration, original 1672 × 941 pixels.
// Each entry: [slot ID, spine contact Y, front-face Y, front-face height].
// Contact sits ON the upper support plane; only the forward face may occlude it.
// Day/evening pairs were checked together (registration within about 1–2 px).
const CONTACTS = {
  'reading-room-v1': [
    ['top-left', 178, 186, 3],
    ['top-right', 178, 186, 3],
    ['middle-left', 363, 371, 3],
    ['middle-center', 364, 372, 3],
    ['middle-right', 364, 373, 3],
    ['bottom-left', 539, 547, 3],
    ['bottom-right', 540, 548, 3],
  ],
  'oak-library': [
    ['oak-top-left', 254, 255, 12],
    ['oak-top-center', 254, 255, 12],
    ['oak-top-right', 254, 255, 12],
    ['oak-bottom-left', 495, 496, 9],
    ['oak-bottom-center', 495, 496, 9],
    ['oak-bottom-right', 495, 496, 9],
  ],
  'green-library': [
    ['green-top-left', 269, 270, 11],
    ['green-top-center-left', 269, 270, 11],
    ['green-top-center-right', 269, 270, 11],
    ['green-top-right', 269, 270, 11],
    ['green-bottom-left', 494, 497, 11],
    ['green-bottom-center-left', 494, 497, 11],
    ['green-bottom-center-right', 494, 497, 11],
    ['green-bottom-right', 494, 497, 11],
  ],
  'window-reading': [
    ['window-top-left', 196, 196, 13],
    ['window-top-right', 195, 195, 13],
    ['window-second-left', 342, 342, 13],
    ['window-second-right', 342, 342, 13],
    ['window-third-left', 489, 491, 13],
    ['window-third-right', 488, 491, 13],
    ['window-bottom-left', 629, 632, 23],
    ['window-bottom-right', 621, 632, 23],
  ],
  'walnut-library': [
    ['walnut-top-left', 154, 155, 14],
    ['walnut-top-right', 154, 155, 14],
    ['walnut-second-left', 300, 301, 14],
    ['walnut-second-right', 300, 301, 14],
    ['walnut-third-left', 438, 439, 15],
    ['walnut-third-right', 438, 439, 15],
    ['walnut-bottom-left', 564, 567, 11],
    ['walnut-bottom-right', 564, 567, 11],
  ],
  'navy-study': [
    ['navy-top-left', 182, 182, 17],
    ['navy-top-center', 182, 182, 17],
    ['navy-top-right', 182, 182, 17],
    ['navy-middle-left', 359, 359, 17],
    ['navy-middle-center', 358, 359, 21],
    ['navy-middle-right', 359, 359, 17],
    ['navy-bottom-left', 561, 565, 12],
    ['navy-bottom-right', 561, 565, 12],
  ],
  'annual-niches': [
    ['niches-1', 309, 315, 12],
    ['niches-2', 328, 334, 12],
    ['niches-3', 376, 382, 10],
    ['niches-4', 438, 445, 9],
    ['niches-5', 460, 469, 7],
    ['niches-6', 490, 495, 7],
    ['niches-7', 567, 573, 7],
    ['niches-8', 598, 606, 7],
    ['niches-9', 601, 607, 7],
    ['niches-10', 704, 711, 3],
    ['niches-11', 718, 726, 3],
    ['niches-12', 719, 726, 3],
  ],
  'annual-divider': [
    ['divider-1', 296, 299, 5],
    ['divider-2', 296, 299, 5],
    ['divider-3', 296, 299, 5],
    ['divider-4', 296, 299, 5],
    ['divider-5', 526, 532, 7],
    ['divider-6', 526, 532, 7],
    ['divider-7', 526, 532, 7],
    ['divider-8', 526, 532, 7],
    ['divider-9', 759, 770, 8],
    ['divider-10', 759, 770, 8],
    ['divider-11', 759, 770, 8],
    ['divider-12', 759, 770, 8],
  ],
  'annual-lines': [
    ['lines-1', 235, 239, 7],
    ['lines-2', 235, 239, 7],
    ['lines-3', 235, 239, 7],
    ['lines-4', 380, 383, 6],
    ['lines-5', 380, 383, 6],
    ['lines-6', 380, 383, 6],
    ['lines-7', 528, 530, 5],
    ['lines-8', 528, 530, 5],
    ['lines-9', 530, 532, 5],
    ['lines-10', 665, 668, 6],
    ['lines-11', 665, 668, 6],
    ['lines-12', 667, 670, 6],
  ],
  'annual-panorama': [
    ['panorama-1', 594, 598, 8],
    ['panorama-2', 594, 598, 8],
    ['panorama-3', 594, 598, 8],
    ['panorama-4', 594, 598, 8],
    ['panorama-5', 594, 598, 8],
    ['panorama-6', 594, 598, 8],
    ['panorama-7', 732, 735, 13],
    ['panorama-8', 732, 735, 13],
    ['panorama-9', 732, 735, 13],
    ['panorama-10', 732, 735, 13],
    ['panorama-11', 732, 735, 13],
    ['panorama-12', 732, 735, 13],
  ],
};

export function calibrateShelfContacts(scene) {
  const measurements = CONTACTS[scene.id];
  if (!measurements || measurements.length !== scene.slots.length)
    throw new Error('Missing shelf contact calibration: ' + scene.id);
  const byId = new Map(measurements.map(([id, ...values]) => [id, values]));
  return {
    ...scene,
    slots: scene.slots.map((slot) => {
      const data = byId.get(slot.id);
      if (!data) throw new Error('Missing shelf contact: ' + slot.id);
      const [contact, front, height] = data,
        contactY = contact / 941;
      return {
        ...slot,
        contactY,
        books: { ...slot.books, y: contactY - slot.books.height },
        front: { ...slot.front, y: front / 941, height: height / 941 },
      };
    }),
  };
}
