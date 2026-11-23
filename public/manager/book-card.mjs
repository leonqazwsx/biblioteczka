import { el } from '../shared/api.mjs';
import { makeSpine } from '../shared/spines.mjs';
import { readingDateLabel } from '../shared/reading-date.mjs';
import { t } from '../shared/i18n.mjs';

export function createBookCard(
  book,
  {
    shelfName,
    manual,
    index,
    count,
    onInspect = onEdit,
    onEdit,
    onDelete,
    onMove,
    onDrop,
    selecting = false,
    selected = false,
    onSelect,
  },
) {
  const row = el('article', 'book-row book-card');
  row.dataset.bookId = book.id;
  row.draggable = manual;
  if (selecting) {
    const label = el('label', 'book-selection'),
      check = el('input');
    check.type = 'checkbox';
    check.checked = selected;
    check.dataset.focusKey = 'select:' + book.id;
    check.setAttribute('aria-label', t('Zaznacz: ') + book.title);
    check.onchange = () => onSelect(check.checked);
    label.append(check);
    row.append(label);
  }
  row.ondragstart = (event) => event.dataTransfer.setData('text/plain', book.id);
  row.ondragover = (event) => event.preventDefault();
  row.ondrop = (event) => {
    event.preventDefault();
    if (manual) onDrop(event.dataTransfer.getData('text/plain'));
  };
  const cover = el('button', 'book-cover-button');
  cover.type = 'button';
  cover.dataset.focusKey = 'book:' + book.id;
  cover.setAttribute('aria-label', t('Szczegóły książki: ') + book.title);
  cover.onclick = onInspect;
  const fallback = () => {
    const spine = makeSpine(book),
      art = el('span', 'cover-fallback');
    art.style.setProperty('--cover-color', spine.palette[0]);
    art.style.setProperty('--cover-ink', spine.foreground);
    art.append(
      el('span', 'fallback-title', book.title),
      el('span', 'fallback-author', book.authors.join(', ')),
    );
    cover.replaceChildren(art);
  };
  if (book.coverId) {
    const image = el('img', 'mini-cover');
    image.src = '/covers/' + book.coverId;
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.onerror = fallback;
    cover.append(image);
  } else fallback();
  const info = el('div', 'book-info');
  info.append(el('strong', '', book.title), el('p', '', book.authors.join(', ')));
  const status = el('div', 'book-status');
  const date = readingDateLabel(book);
  if (date) status.append(el('small', 'read-date-label', date));
  const actions = el('div', 'row-actions'),
    menu = el('details', 'book-actions'),
    summary = el('summary', '', t('Więcej')),
    extra = el('div', 'book-actions-list');
  summary.dataset.focusKey = 'more:' + book.id;
  summary.setAttribute('aria-label', t('Więcej działań dla: ') + book.title);
  menu.append(summary, extra);
  if (manual)
    for (const [text, delta] of [
      ['↑', -1],
      ['↓', 1],
    ]) {
      const move = el('button', '', delta < 0 ? t('Przesuń wcześniej') : t('Przesuń później'));
      move.type = 'button';
      move.dataset.focusKey = 'move:' + delta + ':' + book.id;
      move.disabled = !manual || index + delta < 0 || index + delta >= count;
      move.title = delta < 0 ? t('Przesuń wcześniej') : t('Przesuń później');
      move.setAttribute('aria-label', move.title + ': ' + book.title);
      move.onclick = () => onMove(index + delta);
      extra.append(move);
    }
  const edit = el('button', '', t('Edytuj'));
  edit.type = 'button';
  edit.dataset.focusKey = 'edit:' + book.id;
  edit.setAttribute('aria-label', t('Edytuj: ') + book.title);
  edit.onclick = onEdit;
  const remove = el('button', 'delete', t('Usuń książkę'));
  remove.type = 'button';
  remove.dataset.focusKey = 'delete:' + book.id;
  remove.title = t('Usuń książkę');
  remove.setAttribute('aria-label', t('Usuń: ') + book.title);
  remove.onclick = onDelete;
  extra.append(remove);
  actions.append(edit, menu);
  info.setAttribute('title', shelfName);
  row.append(cover, info, status, actions);
  return row;
}
