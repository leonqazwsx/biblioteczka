import sharp from 'sharp';
import { validateImageBytes } from '../../src/image-validation.mjs';
import { problem } from '../../src/domain.mjs';

export async function createCoverReference({ coverBytes, coverMime }) {
  try {
    validateImageBytes(coverBytes, coverMime);
    const bytes = await sharp(coverBytes, {
      limitInputPixels: 16000000,
      animated: false,
      failOn: 'warning',
    })
      .autoOrient()
      .resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 90 })
      .toBuffer();
    validateImageBytes(bytes, 'image/jpeg');
    return { bytes, mime: 'image/jpeg' };
  } catch {
    throw problem('AI_REJECTED', 'Nie można przygotować okładki referencyjnej.');
  }
}
