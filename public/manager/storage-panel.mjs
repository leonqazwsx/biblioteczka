import { el } from '../shared/api.mjs';
import { t } from '../shared/i18n.mjs';
const names = { covers: t('Okładki'), spines: t('Grzbiety'), quarantine: t('Kwarantanna') };
function bytes(value) {
  return value >= 1048576
    ? (value / 1048576).toLocaleString('pl', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }) + ' MiB'
    : (value / 1024).toLocaleString('pl', { maximumFractionDigits: 1 }) + ' KiB';
}
export async function renderStorageSettings(
  root,
  { request, confirm = (message) => globalThis.confirm(message) },
) {
  let report,
    busy = false;
  const header = () => {
    root.replaceChildren(
      el('h2', '', t('Obrazy na dysku')),
      el('p', '', t('Sprawdź zajęte miejsce i bezpiecznie uporządkuj nieużywane ilustracje.')),
    );
  };
  const showError = (error) => {
    if (!root.isConnected) return;
    const text = el('p', 'error', error.message);
    text.setAttribute('role', 'alert');
    root.append(text);
  };
  const action = (label, run, cls = 'secondary') => {
    const button = el('button', cls, label);
    button.type = 'button';
    button.onclick = async () => {
      if (busy) return;
      busy = true;
      button.disabled = true;
      try {
        await run();
      } catch (error) {
        showError(error);
      } finally {
        busy = false;
        if (button.isConnected) button.disabled = false;
      }
    };
    return button;
  };
  const load = async () => {
    const next = await request('/api/storage');
    if (root.isConnected) {
      report = next;
      paint();
    }
  };
  const change = async (url, body) => {
    const result = await request(url, {
      method: 'POST',
      body: { expectedRevision: report.revision, ...body },
    });
    if (root.isConnected) {
      report = result.report;
      paint();
    }
  };
  const paint = () => {
    header();
    const totals = el('dl', 'storage-totals');
    for (const kind of ['covers', 'spines', 'quarantine']) {
      const data = report.totals[kind];
      totals.append(
        el('dt', '', names[kind]),
        el('dd', '', data.count + t(' obrazów · ') + bytes(data.bytes)),
      );
    }
    root.append(totals);
    root.append(
      el(
        'p',
        'muted',
        t(
          'Chronimy obrazy używane przez kolekcję, kopię zapasową i AI. Nowe pliki pozostają chronione przez ',
        ) +
          report.graceDays +
          t(
            ' dni. Kwarantanna pozwala cofnąć porządkowanie; na tym etapie miejsce na dysku nie jest jeszcze zwalniane.',
          ),
      ),
    );
    if (!report.cleanupAllowed) {
      const blockers = el('div', 'error');
      blockers.setAttribute('role', 'alert');
      blockers.append(el('p', '', t('Porządkowanie jest wstrzymane:')));
      for (const message of report.blockers) blockers.append(el('p', '', message));
      root.append(blockers);
    } else if (report.candidates.length) {
      const total = report.candidates.reduce((sum, asset) => sum + asset.bytes, 0);
      root.append(
        el('p', '', t('Nieużywane obrazy: ') + report.candidates.length + ' · ' + bytes(total)),
      );
      root.append(
        action(t('Przenieś do kwarantanny'), () =>
          change('/api/storage/quarantine', {
            assets: report.candidates.map(({ kind, id }) => ({ kind, id })),
          }),
        ),
      );
    } else root.append(el('p', 'muted', t('Brak obrazów kwalifikujących się do porządkowania.')));
    root.append(
      el(
        'p',
        'muted',
        t('Trwałe usunięcie jest dostępne dopiero po ') +
          report.retentionDays +
          t(' dni i ponownym sprawdzeniu wszystkich odniesień.'),
      ),
    );
    for (const batch of report.quarantine) {
      const row = el('div', 'storage-batch');
      const date = new Date(batch.createdAt);
      const label = Number.isFinite(+date) ? date.toLocaleDateString('pl') : t('data niedostępna');
      row.append(
        el(
          'p',
          '',
          t('Kopia z ') + label + ' · ' + batch.count + t(' obrazów · ') + bytes(batch.bytes),
        ),
      );
      if (batch.count)
        row.append(
          action(t('Przywróć obrazy'), () =>
            change('/api/storage/restore', { quarantineId: batch.id }),
          ),
        );
      if (batch.purgeEligible && report.cleanupAllowed)
        row.append(
          action(
            t('Usuń na stałe · ') + bytes(batch.eligibleBytes),
            async () => {
              if (
                confirm(
                  t('Usunąć na stałe ') +
                    batch.count +
                    t(' obrazów (') +
                    bytes(batch.eligibleBytes) +
                    t(') z kwarantanny? Tej operacji nie można cofnąć.'),
                )
              )
                await change('/api/storage/purge', { quarantineId: batch.id });
            },
            'secondary danger-button',
          ),
        );
      root.append(row);
    }
    root.append(action(t('Odśwież raport'), load));
  };
  header();
  root.append(el('p', 'muted', t('Sprawdzam lokalne obrazy…')));
  try {
    await load();
  } catch (error) {
    showError(error);
  }
}
