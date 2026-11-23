import { createHash } from 'node:crypto';
import { problem } from './domain.mjs';
import { migrateState } from './migrations.mjs';
import { imageMime } from './covers.mjs';
import { t } from '../public/shared/i18n.mjs';
export async function createBackup(state, covers, spines) {
  const images = [],
    spineImages = [];
  for (const coverId of new Set(state.books.map((b) => b.coverId).filter(Boolean))) {
    const { bytes, mime } = await covers.read(coverId);
    images.push({ coverId, mime, base64: bytes.toString('base64') });
  }
  for (const assetId of new Set(state.books.map((b) => b.spine?.assetId).filter(Boolean))) {
    const { bytes, mime } = await spines.read(assetId);
    spineImages.push({ assetId, mime, base64: bytes.toString('base64') });
  }
  const backup = { format: 'bookshelf-backup', version: 2, state, images, spineImages };
  if (Buffer.byteLength(JSON.stringify(backup, null, 2), 'utf8') > 64 * 1024 * 1024)
    throw problem(
      'TOO_LARGE',
      t(
        'Kopia przekracza limit 64 MB. Zatrzymaj aplikację i skopiuj cały folder data, aby zachować kolekcję i obrazy.',
      ),
    );
  return backup;
}
export function validateBackup(input) {
  if (
    input?.format !== 'bookshelf-backup' ||
    ![1, 2].includes(input.version) ||
    input.state?.schemaVersion !== input.version ||
    !Array.isArray(input.images) ||
    (input.version === 2 && !Array.isArray(input.spineImages))
  )
    throw problem('INVALID', t('Nieobsługiwany format kopii.'));
  const state = migrateState(input.state);
  function decode(list, key) {
    const seen = new Set();
    return list.map((x) => {
      if (
        typeof x.base64 !== 'string' ||
        x.base64.length > 7 * 1024 * 1024 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(x.base64)
      )
        throw problem('INVALID', t('Nieprawidłowy obraz w kopii.'));
      const bytes = Buffer.from(x.base64, 'base64'),
        hash = createHash('sha256').update(bytes).digest('hex');
      if (
        bytes.length > 5 * 1024 * 1024 ||
        hash !== x[key] ||
        seen.has(hash) ||
        imageMime(bytes) !== x.mime
      )
        throw problem('INVALID', t('Uszkodzony obraz w kopii.'));
      seen.add(hash);
      return { [key]: hash, mime: x.mime, bytes };
    });
  }
  const images = decode(input.images, 'coverId'),
    spineImages = decode(input.spineImages ?? [], 'assetId'),
    coverIds = new Set(images.map((x) => x.coverId)),
    spineIds = new Set(spineImages.map((x) => x.assetId));
  if (
    state.books.some(
      (b) => (b.coverId && !coverIds.has(b.coverId)) || (b.spine && !spineIds.has(b.spine.assetId)),
    )
  )
    throw problem('INVALID', t('Kopia nie zawiera wszystkich obrazów.'));
  return {
    state,
    images,
    spineImages,
    summary: {
      books: state.books.length,
      shelves: state.shelves.length,
      images: images.length,
      spines: spineImages.length,
    },
  };
}
