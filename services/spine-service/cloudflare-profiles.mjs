import { CLOUDFLARE_SPINE_CONFIG } from './provider-config.mjs';
import { SPINE_PROMPT } from '../../src/spine-provider.mjs';
import { problem } from '../../src/domain.mjs';
import { MATERIAL_SHA256 } from './material-reference.mjs';

export const QUALITY_CONFIG = Object.freeze({
  ...CLOUDFLARE_SPINE_CONFIG,
  promptVersion: 'cover-motif-cf-quality-v2',
});
export const QUALITY_9B_CONFIG = Object.freeze({
  ...QUALITY_CONFIG,
  model: 'cf-flux-2-klein-9b',
  remoteModel: '@cf/black-forest-labs/flux-2-klein-9b',
});
export const STYLE_9B_CONFIG = Object.freeze({
  ...QUALITY_9B_CONFIG,
  promptVersion: 'cover-motif-cf-style-v3',
  referenceVersion: 'sharp-480-style-v1-' + MATERIAL_SHA256,
});
export const SMOOTH_9B_CONFIG = Object.freeze({
  ...QUALITY_9B_CONFIG,
  promptVersion: 'cover-motif-cf-smooth-v4',
  width: 320,
  height: 1600,
});
export const FRAMED_9B_CONFIG = Object.freeze({
  ...SMOOTH_9B_CONFIG,
  promptVersion: 'cover-motif-cf-framed-v5',
});
export const COVER_CLEAN_9B_CONFIG = Object.freeze({
  ...QUALITY_9B_CONFIG,
  promptVersion: 'cover-clean-cf-v1',
  width: 512,
  height: 768,
});
const qualityPrompt =
  "Use the supplied book cover only as a reference for its main recognizable motif and natural color palette. Design NEW full-bleed printed artwork for one very narrow premium book spine. Show the flat surface straight-on, filling all four image edges. Recompose one clear slender central motif in the middle 25 percent of the image width, from 38 to 85 percent of its height, readable after a 1:5 central crop. Keep the upper 30 percent quiet for application typography. Translate the cover's imagery into finely engraved or stippled printed detail on realistic woven bookcloth or matte paper: visible natural fibers, restrained pigment variation, subtle handling wear, delicate dry-stamped lines. Preserve the cover's subject identity and colors. The motif is ink printed into the binding material, never a large molded sculpture. Balanced natural daylight and nuanced contrast; no muddy blur or plastic CGI gloss. Do not reproduce the whole cover. No letters, numbers, logos, title, author, decorative frame, side panels, book object, room, perspective or surrounding background. The application adds typography and binding edges.";
const stylePrompt =
  "Create NEW full-bleed illustration artwork for one narrow premium book spine. Image 1 is the ONLY reference for subject, recognizable motif and color palette. Image 2 is an unillustrated neutral cloth swatch: use ONLY its fine woven fiber structure and tactile print quality, never its pale color as the artwork palette. Reimagine the cover motif as a refined illustration printed into bookcloth with layered colored inks and restrained fine engraved detail. Preserve the cover's main hues, dark values and warm or cool balance; do not turn a colored cover into an all-beige or sepia engraving. Give the main motif a clear silhouette and readable light-dark separation. Place one slender central motif in the middle 25 percent of the width, from 38 to 85 percent of the height, so it survives a central 1:5 crop. Keep the upper 30 percent quiet in a color derived from the cover for application typography. Fine cloth fibers should enrich the printed image, never overwhelm it with coarse weave, random speckles or blur. Aim for a flat macro scan of a beautifully printed binding: subtle ink variation, natural material depth, delicate handling wear, rich controlled detail. Flat orthographic view, uniform soft daylight, artwork reaching all four edges. Do not reproduce the entire cover. No letters, numbers, title, author, logos, frames, side panels, book object, perspective, room, surrounding background or large sculpted CGI forms. The application adds the title and binding edges separately.";
export function cloudflareProfile(name = 'default') {
  if (name === 'default') return { config: CLOUDFLARE_SPINE_CONFIG, prompt: SPINE_PROMPT };
  if (name === 'quality-v2') return { config: QUALITY_CONFIG, prompt: qualityPrompt };
  if (name === 'quality-v2-9b') return { config: QUALITY_9B_CONFIG, prompt: qualityPrompt };
  if (name === 'style-v3-9b') return { config: STYLE_9B_CONFIG, prompt: stylePrompt };
  if (name === 'framed-v5-9b')
    return {
      config: FRAMED_9B_CONFIG,
      prompt:
        "Use the supplied text-free cover as the reference for subject identity, its recognizable main motif, color palette and painterly detail. Create NEW flat full-bleed illustration artwork specifically for a very narrow 1:5 book spine with a smooth matte printed finish. Show the principal subject from a distance as one COMPLETE slender central silhouette, not a portrait or a close-up. Recompose the subject vertically so its head, distinctive outline and lower end all fit inside the artwork with generous breathing room on both sides; no cropped head, cropped body, oversized face or enlarged isolated fragment. Keep the complete principal silhouette within the middle 70 percent of the image width, mainly between 35 and 85 percent of the image height. Supporting shapes may flow around it but must not obscure the complete subject. Keep the upper 35 percent calm and darker in a hue derived from the cover, suitable for a large light title added by the application. Continue the same naturally shaded background behind and around the subject all the way to all four edges, without separate panels, blank end blocks or horizontal boundaries. Preserve nuanced painterly shading, fine contours and carefully layered detail from the reference; avoid flat vector shapes, cartoon simplification, cel shading, muddy blur and plastic gloss. Preserve the cover's main hues, dark values and warm or cool balance. Smooth printed illustration without cloth weave, paper grain, noise, distress, leather or embossing. Do not reproduce the front-cover layout. No letters, words, title, author, numbers, logos, frames, book object, perspective, room, cast shadow or surrounding background. The application adds the real title and subtle binding highlights separately.",
    };
  if (name === 'cover-clean-v1-9b')
    return {
      config: COVER_CLEAN_9B_CONFIG,
      prompt:
        'Edit the supplied flat book cover. Remove every printed letter, word, number, title, author name, publisher mark and logo. Reconstruct only the background or illustration that would naturally continue behind those removed marks, using the surrounding pixels as the guide. Preserve the existing illustrated subjects, their identity, pose, shapes, positions, framing, composition, colors, brightness and drawing style. Keep the original cover aspect ratio and all existing non-text artwork. This is lettering removal, not a new cover design or a spine design. Do not invent people, animals, objects, scenery, symbols, ornament, labels or additional motifs. If a region contains only lettering on a plain background, leave a matching plain background there. Return one flat full-bleed image of the same cover artwork without any typography, watermark, border, book object, perspective, room or surrounding background.',
    };
  if (name === 'smooth-v4-9b')
    return {
      config: SMOOTH_9B_CONFIG,
      prompt:
        "Use the supplied cover as a reference for its main recognizable motif and color palette. Design a NEW illustration specifically for a very narrow 1:5 book spine, not a reduced front cover. Output flat full-bleed artwork for a smooth matte printed binding. Preserve the cover's principal hues, dark values and warm or cool balance. Build one continuous illustrated color field from top to bottom: background colors flow naturally behind the subject with no horizontal boundaries, blank end blocks, panels, labels or frames. Recompose one clear slender motif on the central vertical axis, contained within the middle 60 percent of the width with breathing room at both sides; keep its important silhouette recognizable at tiny size. Let fine supporting shapes flow along the tall composition instead of spreading sideways. Leave some quiet space around the upper central axis for a large title added by the application, integrated naturally into the same continuous background rather than a separate empty area. Clean detailed illustration, confident color and light-dark separation, restrained smooth matte finish. No visible cloth weave, paper grain, noise, distressed texture, leather or embossing. Do not recreate the entire cover layout. No letters, words, title, author, numbers, logos, book object, perspective, room, cast shadow or surrounding background. The application adds real typography and subtle binding highlights separately.",
    };
  throw problem('SERVICE_CONFIG', 'Nieznany profil ilustracji.');
}
