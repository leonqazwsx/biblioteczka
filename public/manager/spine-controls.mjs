import { el, request } from '../shared/api.mjs';
import { createImageUrlControl } from './image-url.mjs';
import { t } from '../shared/i18n.mjs';
const controls = new WeakMap();
const waitingMessages = new Set([
  t('Ilustracja czeka na odnowienie limitu'),
  t('Automatyczne ilustracje są obecnie niedostępne.'),
]);

export function renderAiSettings(root) {
  root.replaceChildren(
    el('h2', '', t('Ilustracje grzbietów')),
    el('p', '', t('Grzbiety korzystają z grafiki zapisanych okładek.')),
    el(
      'p',
      'muted',
      t(
        'Zapisane ilustracje działają również bez internetu. W danych książki możesz dodać obraz z pliku lub linku i dopasować kadr.',
      ),
    ),
  );
}

export function renderSpineControls(root, params) {
  const { book, status } = params,
    key = book?.id ?? null;
  let view = controls.get(root);
  if (!view || view.key !== key || !root.contains(view.info)) {
    view?.urlControl?.cancel();
    const info = el('p', 'spine-job');
    info.setAttribute('role', 'status');
    root.replaceChildren(info);
    view = { key, info, params };
    controls.set(root, view);
    if (book) {
      const label = el(
          'label',
          'spine-upload',
          t('Wgraj ilustrację grzbietu · JPEG, PNG, WebP do 5 MiB'),
        ),
        file = el('input');
      file.type = 'file';
      file.accept = 'image/jpeg,image/png,image/webp';
      file.setAttribute('aria-label', t('Wgraj ilustrację grzbietu'));
      file.onchange = async () => {
        const selected = file.files[0];
        if (!selected) return;
        view.urlControl.cancel();
        view.urlControl.setDisabled(true);
        view.fileBusy = true;
        const selectedParams = view.params;
        file.disabled = true;
        try {
          if (
            !['image/jpeg', 'image/png', 'image/webp'].includes(selected.type) ||
            selected.size > 5 * 1024 * 1024
          )
            throw new Error(t('Wybierz JPEG, PNG lub WebP do 5 MiB.'));
          const bytes = new Uint8Array(await selected.arrayBuffer());
          let binary = '';
          for (let i = 0; i < bytes.length; i += 32768)
            binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
          await selectedParams.onUpload(selectedParams.book.id, {
            mime: selected.type,
            base64: btoa(binary),
          });
        } catch (error) {
          if (root.contains(info)) {
            info.textContent = error.message;
            info.className = 'spine-job ai-error';
          }
        } finally {
          file.value = '';
          file.disabled = false;
          view.fileBusy = false;
          view.urlControl.setDisabled(false);
        }
      };
      label.append(file);
      root.append(label);
      view.urlControl = createImageUrlControl(root, {
        label: t('Link do ilustracji grzbietu'),
        onStart: () => {
          file.disabled = true;
        },
        onFinish: () => {
          file.disabled = !!view.fileBusy;
        },
        download: (url, signal) =>
          view.params.downloadImage
            ? view.params.downloadImage(url, signal)
            : request('/api/images/from-url', { method: 'POST', body: { url }, signal }),
        onImport: (image) => {
          const selectedParams = view.params;
          return selectedParams.onUpload(selectedParams.book.id, image);
        },
      });
    }
  }
  view.params = params;
  const job = status.jobs?.find(
    (job) => job.bookId === book?.id && job.generation === book.spineGeneration,
  );
  view.info.className = 'spine-job';
  view.info.textContent = book?.spine
    ? book.spine.kind === 'ai'
      ? t('Ilustracja zapisana lokalnie.')
      : t('Własna ilustracja zapisana lokalnie.')
    : status.connection === 'offline' && job
      ? t('Ilustracja pojawi się po odzyskaniu połączenia')
      : ['queued', 'generating'].includes(job?.state)
        ? waitingMessages.has(job.message)
          ? job.message
          : t('Ilustracja w przygotowaniu')
        : !book
          ? status.available
            ? t('Po zapisaniu książki ilustracja przygotuje się automatycznie.')
            : t('Po zapisaniu możesz dodać własną ilustrację.')
          : book.coverId
            ? t('Grafika z okładki. Możesz dodać własną ilustrację.')
            : t(
                'Dodaj okładkę, aby pojawiła się grafika grzbietu. Możesz też wgrać własną ilustrację.',
              );
}
export function cancelSpineImageImport(root) {
  controls.get(root)?.urlControl?.cancel();
}
