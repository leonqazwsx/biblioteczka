import { el } from '../shared/api.mjs';
import { t } from '../shared/i18n.mjs';

export function createBookPicker({ onBook, onOpen = () => {} }) {
  let books = [];
  const opener = el('button', null, t('Lista książek'));
  opener.id = 'book-picker-open';
  opener.type = 'button';
  opener.setAttribute('aria-haspopup', 'dialog');
  opener.setAttribute('aria-controls', 'book-picker');
  const dialog = el('dialog');
  dialog.id = 'book-picker';
  dialog.setAttribute('aria-labelledby', 'book-picker-title');
  const heading = el('h2', null, t('Książki na tej stronie'));
  heading.id = 'book-picker-title';
  const close = el('button', 'close-card', '×');
  close.type = 'button';
  close.setAttribute('aria-label', t('Zamknij listę książek'));
  close.onclick = () => dialog.close();
  const label = el('label', null, t('Szukaj książki na tej stronie')),
    search = el('input');
  search.id = 'book-picker-search';
  search.type = 'search';
  search.autocomplete = 'off';
  label.htmlFor = search.id;
  const list = el('div', 'picker-list'),
    status = el('p', 'picker-count');
  status.setAttribute('role', 'status');
  function paint() {
    const focused = document.activeElement?.dataset?.pickerBookId,
      query = search.value.trim().toLocaleLowerCase('pl');
    const matches = books.filter((book) =>
      (book.title + ' ' + book.authors.join(' ')).toLocaleLowerCase('pl').includes(query),
    );
    list.replaceChildren();
    for (const book of matches) {
      const button = el('button', 'picker-book');
      button.type = 'button';
      button.dataset.pickerBookId = book.id;
      button.append(
        el('span', 'picker-title', book.title),
        el('span', 'picker-meta', book.authors.join(', ')),
      );
      button.onclick = () => {
        dialog.close();
        onBook(book);
      };
      list.append(button);
      if (book.id === focused) button.focus({ preventScroll: true });
    }
    status.textContent = matches.length
      ? t('{shown} z {total} książek', { shown: matches.length, total: books.length })
      : t('Brak pasujących książek na tej stronie.');
  }
  search.addEventListener('input', paint);
  opener.onclick = () => {
    onOpen();
    search.value = '';
    paint();
    dialog.showModal();
    search.focus();
  };
  dialog.append(close, heading, label, search, status, list);
  document.body.append(opener, dialog);
  return {
    update(next) {
      if (next === books) return;
      books = next;
      if (dialog.open) paint();
    },
  };
}
