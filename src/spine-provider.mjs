import { imageMime } from './covers.mjs';
import { problem } from './domain.mjs';
export const SPINE_CONFIG = Object.freeze({
  model: 'gpt-image-2.5-flare-2026-09-08',
  promptVersion: 'cover-motif-v1',
  quality: 'medium',
  size: '1024x1536',
  output_format: 'webp',
  output_compression: 80,
});
export const SPINE_PROMPT =
  'Use the supplied cover as a visual reference. Create a NEW illustration inspired by its recognizable motifs and color palette, recomposed for a narrow vertical book spine. Flat full-bleed printed artwork fills every edge of the entire image; keep important motifs in a quiet central vertical strip that can be cropped to a 1:5 spine. Subtle matte printed paper texture. Do not copy the entire cover, stretch it, show a physical book, perspective, room, border, surrounding background, letters, title, author or logos. No text. The app adds readable text and realistic binding edges separately.';
export function createSpineProvider({ apiKey, fetchImpl = fetch, timeoutMs = 180000 } = {}) {
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  return {
    available: !!key,
    config: SPINE_CONFIG,
    async generate({ coverBytes, coverMime, signal }) {
      if (!key)
        throw problem(
          'AI_UNAVAILABLE',
          'Skonfiguruj klucz API na tym komputerze i uruchom aplikację ponownie.',
        );
      if (
        !Buffer.isBuffer(coverBytes) ||
        coverBytes.length > 5 * 1024 * 1024 ||
        imageMime(coverBytes) !== coverMime
      )
        throw problem('INVALID', 'Nieprawidłowa okładka referencyjna.');
      const timer = AbortSignal.timeout(timeoutMs),
        combined = signal ? AbortSignal.any([signal, timer]) : timer,
        f = new FormData();
      for (const [name, value] of Object.entries(SPINE_CONFIG))
        if (name !== 'promptVersion') f.set(name, String(value));
      f.set('n', '1');
      f.set('background', 'opaque');
      f.set('prompt', SPINE_PROMPT);
      f.append(
        'image[]',
        new Blob([coverBytes], { type: coverMime }),
        'cover.' + { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[coverMime],
      );
      let r;
      try {
        r = await fetchImpl('https://api.openai.com/v1/images/edits', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + key },
          body: f,
          signal: combined,
        });
      } catch {
        throw problem(
          combined.aborted ? 'AI_TIMEOUT' : 'AI_UNAVAILABLE',
          combined.aborted
            ? 'Generowanie przerwano lub przekroczyło czas. Próba może zostać rozliczona.'
            : 'Nie udało się połączyć z usługą AI. Spróbuj ponownie ręcznie.',
        );
      }
      if (!r.ok)
        throw problem(
          r.status === 400 ? 'AI_REJECTED' : 'AI_UNAVAILABLE',
          r.status === 400
            ? 'Usługa AI odrzuciła żądanie. Sprawdź okładkę i konfigurację.'
            : 'Usługa AI jest niedostępna. Sprawdź klucz, dostęp do modelu i limit konta.',
        );
      let data;
      try {
        data = await r.json();
      } catch {
        throw problem('INVALID', 'Usługa AI zwróciła nieprawidłowe dane.');
      }
      const encoded = data.data?.[0]?.b64_json;
      if (
        typeof encoded !== 'string' ||
        encoded.length > 7 * 1024 * 1024 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
      )
        throw problem('INVALID', 'Usługa AI nie zwróciła poprawnej ilustracji.');
      const bytes = Buffer.from(encoded, 'base64');
      if (bytes.length > 5 * 1024 * 1024) throw problem('TOO_LARGE', 'Ilustracja AI jest za duża.');
      const mime = imageMime(bytes),
        u = data.usage,
        values = [
          u?.input_tokens_details?.text_tokens,
          u?.input_tokens_details?.image_tokens,
          u?.output_tokens,
        ];
      const usage = values.every((v) => Number.isSafeInteger(v) && v >= 0)
        ? { textInput: values[0], imageInput: values[1], imageOutput: values[2] }
        : null;
      return { bytes, mime, usage };
    },
  };
}
