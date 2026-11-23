import { t } from '../shared/i18n.mjs';
export function createClientUpgrade({ isEditing, reload, notice }) {
  let pending = false;
  return {
    available() {
      if (isEditing()) {
        pending = true;
        notice(
          t(
            'Jest nowa wersja Biblioteczki. Zapisz lub odrzuć wszystkie niezapisane zmiany w formularzu, rozmieszczeniu i imporcie; panel odświeży się, gdy wszystkie będą zamknięte.',
          ),
        );
      } else reload();
    },
    editorClosed() {
      if (pending && !isEditing()) {
        pending = false;
        reload();
      }
    },
  };
}
