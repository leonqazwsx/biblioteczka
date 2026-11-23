import { request, el } from '../shared/api.mjs';
import { t } from '../shared/i18n.mjs';
export async function renderWindowsSettings(root) {
  const statusLine = el('p', 'muted', t('Odczytywanie ustawień Windows…'));
  root.append(statusLine);
  try {
    let status = await request('/api/windows');
    if (!root.isConnected) return;
    if (!status.supported) {
      statusLine.textContent = t('Autostart i ikona w zasobniku są dostępne w wersji Windows.');
      return;
    }
    const label = el('label', 'checkbox-label'),
      control = el('input');
    control.type = 'checkbox';
    control.checked = status.autostart;
    control.disabled = status.conflict || (!status.autostart && !status.canEnable);
    label.append(control, el('span', '', t('Uruchamiaj Biblioteczkę po zalogowaniu do Windows')));
    root.append(label);
    statusLine.textContent =
      status.message ||
      t(
        'Włączany przy pierwszym uruchomieniu, żeby tapeta wracała po restarcie komputera. Ustawienie dotyczy tego komputera i nie trafia do kopii kolekcji.',
      );
    control.onchange = async () => {
      control.disabled = true;
      try {
        status = await request('/api/windows', {
          method: 'POST',
          body: { autostart: control.checked },
        });
        control.checked = status.autostart;
        statusLine.textContent = status.autostart
          ? t('Autostart jest włączony.')
          : t('Autostart jest wyłączony.');
      } catch (e) {
        control.checked = status.autostart;
        statusLine.textContent = e.message;
      } finally {
        control.disabled = status.conflict || (!status.autostart && !status.canEnable);
      }
    };
  } catch (e) {
    statusLine.textContent = e.message;
  }
}
