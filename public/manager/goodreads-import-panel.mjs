import { el } from '../shared/api.mjs';
import { formatReadDate } from '../shared/calendar-date.mjs';
import { rememberLayoutFocus } from './layout-focus.mjs';
import { createGoodreadsImportController } from './goodreads-import-controller.mjs';
export async function readGoodreadsFile(file) {
  if (!file || file.size > 10 * 1024 * 1024)
    throw new Error('Plik CSV może mieć maksymalnie 10 MiB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > 10 * 1024 * 1024)
    throw new Error('Plik CSV może mieć maksymalnie 10 MiB.');
  let text = '';
  for (let i = 0; i < bytes.length; i += 32768)
    text += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(text);
}
export function createGoodreadsImportPanel({
  request,
  onImported,
  onDirtyChange = () => {},
  notice = () => {},
}) {
  const c = createGoodreadsImportController({
    request,
    onImported,
    onDirtyChange: (dirty) => onDirtyChange(dirty || reading),
  });
  let root = null,
    state = null,
    reading = false,
    timer = null;
  function action(text, fn, label) {
    const b = el('button', 'secondary', text);
    b.type = 'button';
    b.disabled = c.saving || reading;
    if (label) b.setAttribute('aria-label', label);
    b.onclick = async () => {
      try {
        const pending = fn();
        paint();
        await pending;
        paint();
      } catch (e) {
        notice(c.snapshot.message || e.message, true);
        paint();
      }
    };
    return b;
  }
  function paint() {
    clearTimeout(timer);
    timer = null;
    if (!root?.isConnected) return;
    const restore = rememberLayoutFocus(root),
      s = c.snapshot,
      p = s.preview,
      selected = new Set(s.selectedRowIds);
    root.replaceChildren();
    const label = el('label', '', 'Plik Goodreads CSV'),
      file = el('input');
    file.type = 'file';
    file.accept = '.csv,text/csv';
    file.setAttribute('aria-label', 'Plik Goodreads CSV');
    file.disabled = c.saving || reading;
    label.append(file);
    root.append(label);
    file.onchange = async () => {
      try {
        const chosen = file.files?.[0];
        if (!chosen) return;
        if (
          c.isDirty &&
          !confirm('Zastąpić obecny podgląd CSV? Niezapisane wybory zostaną odrzucone.')
        )
          return;
        reading = true;
        onDirtyChange(true);
        paint();
        const base64 = await readGoodreadsFile(chosen);
        const pending = c.load(base64);
        paint();
        await pending;
      } catch (e) {
        notice(e.message, true);
      } finally {
        reading = false;
        file.value = '';
        onDirtyChange(c.isDirty);
        paint();
      }
    };
    const feedback = el(
      'p',
      'import-feedback',
      reading || s.loading
        ? 'Odczytuję plik…'
        : s.saving
          ? 'Dołączam książki…'
          : s.stale
            ? 'Kolekcja zmieniła się lub podgląd wygasł. Wybory zachowano. Wczytaj CSV ponownie.'
            : s.message || '',
    );
    feedback.setAttribute('role', s.error ? 'alert' : 'status');
    root.append(feedback);
    if (!p) {
      root.append(
        el(
          'p',
          'muted',
          'Wybierz eksport CSV, aby sprawdzić przeczytane książki, daty i proponowane gatunki przed dołączeniem.',
        ),
      );
      restore();
      return;
    }
    root.append(
      el(
        'p',
        'import-summary',
        `${p.summary.addable} nowych · ${p.summary.duplicates} duplikatów · ${p.summary.invalid} błędnych pozycji · ${p.summary.skipped ?? 0} pominiętych bez oznaczenia przeczytania`,
      ),
    );
    if (p.summary.newShelves)
      root.append(
        el(
          'p',
          'muted',
          `Proponowane nowe półki: ${p.summary.newShelves}. Możesz wybrać istniejącą półkę w tabeli.`,
        ),
      );
    for (const text of p.notices) root.append(el('p', 'muted', text));
    root.append(
      el(
        'p',
        'muted',
        'Propozycje kategorii pochodzą z półek w pliku. Sprawdź je przed zapisaniem. Podgląd jest ważny przez 10 minut.',
      ),
    );
    const allLabel = el('label', 'checkbox-label'),
      all = el('input');
    all.type = 'checkbox';
    all.checked = selected.size === p.summary.addable && p.summary.addable > 0;
    all.indeterminate = selected.size > 0 && selected.size < p.summary.addable;
    all.disabled = c.saving || reading || !p.summary.addable;
    all.setAttribute('aria-label', 'Wybierz wszystkie nowe książki');
    all.onchange = () => {
      c.selectAll(all.checked);
      paint();
    };
    allLabel.append(all, el('span', '', 'Wybierz wszystkie nowe książki (cały plik)'));
    root.append(allLabel);
    const wrap = el('div', 'import-table-wrap'),
      table = el('table', 'import-table'),
      head = el('thead'),
      header = el('tr'),
      body = el('tbody');
    table.setAttribute('aria-label', 'Podgląd książek z Goodreads');
    for (const title of ['Wybór', 'Tytuł', 'Autorzy', 'Przeczytano', 'Gatunek', 'Uwagi']) {
      const th = el('th', '', title);
      th.setAttribute('scope', 'col');
      header.append(th);
    }
    head.append(header);
    table.append(head, body);
    wrap.append(table);
    root.append(wrap);
    for (const row of s.rows) {
      const tr = el('tr'),
        pick = el('td'),
        check = el('input');
      check.type = 'checkbox';
      check.setAttribute('aria-label', 'Wybierz pozycję ' + row.recordNumber);
      check.checked = selected.has(row.rowId);
      check.disabled = c.saving || reading || !row.selectable;
      check.onchange = () => {
        c.select(row.rowId, check.checked);
        paint();
      };
      pick.append(check);
      const title = el('th', '', row.display.title || 'Brak tytułu');
      title.setAttribute('scope', 'row');
      const author = el('td', '', row.display.authors.join('; ') || 'Brak autora'),
        date = el('td', 'import-date', formatReadDate(row.display.readDate) || '—'),
        category = el('td'),
        notes = el('td', 'import-notes');
      if (row.selectable) {
        const choice = s.overrides[row.rowId] ?? row.candidate;
        const shelf = el('select');
        shelf.setAttribute('aria-label', 'Półka pozycji ' + row.recordNumber);
        for (const item of state.shelves) {
          const option = el('option', '', item.name);
          option.value = item.id;
          shelf.append(option);
        }
        const newName = choice.newShelfName ?? row.category.newShelfName;
        if (newName) {
          const option = el('option', '', newName + ' · nowa półka');
          option.value = 'new:' + newName;
          shelf.append(option);
        }
        shelf.value = choice.shelfId ?? 'new:' + choice.newShelfName;
        shelf.disabled = c.saving || reading;
        shelf.onchange = () => {
          const value = shelf.value;
          c.override(
            row.rowId,
            value.startsWith('new:')
              ? { shelfId: null, newShelfName: value.slice(4) }
              : { shelfId: value, newShelfName: null },
          );
          paint();
        };
        category.append(shelf);
      } else {
        category.textContent = row.category
          ? (state.shelves.find((s) => s.id === row.category.shelfId)?.name ??
            row.category.newShelfName)
          : '—';
      }
      const messages = [...row.errors, ...row.warnings];
      if (row.duplicate) {
        const reason = {
          isbn: 'ten sam ISBN',
          goodreads: 'ta sama książka Goodreads',
          'title-author': 'ten sam tytuł i autor',
        }[row.duplicate.reason];
        messages.unshift(
          row.duplicate.kind === 'file'
            ? `Powtórzenie pozycji ${row.duplicate.recordNumber} · ${reason}.`
            : `Już w biblioteczce · ${reason}.`,
        );
      }
      for (const text of messages)
        notes.append(el('p', row.errors.length ? 'import-error' : '', text));
      tr.append(pick, title, author, date, category, notes);
      body.append(tr);
    }
    const footer = el('div', 'import-actions'),
      previous = action('←', () => c.setPage(s.page - 1), 'Poprzednia strona importu'),
      next = action('→', () => c.setPage(s.page + 1), 'Następna strona importu');
    previous.disabled = previous.disabled || s.page === 0;
    next.disabled = next.disabled || s.page === s.pageCount - 1;
    footer.append(previous, el('span', '', `Strona ${s.page + 1} / ${s.pageCount}`), next);
    const save = action(`Dołącz ${selected.size} książek`, () => c.confirm());
    save.className = 'primary';
    save.disabled = save.disabled || !selected.size || s.stale;
    footer.append(
      save,
      action('Odrzuć podgląd', () => {
        if (confirm('Odrzucić podgląd CSV i niezapisane wybory?')) c.discard();
      }),
    );
    root.append(footer);
    if (!s.stale) {
      timer = setTimeout(paint, Math.max(1, p.expiresAt - Date.now() + 1));
      timer.unref?.();
    }
    restore();
  }
  return {
    mount(nextRoot, nextState) {
      root = nextRoot;
      state = nextState;
      c.receive(nextState);
      paint();
    },
    receive(next) {
      state = next;
      c.receive(next);
      paint();
    },
    isDirty: () => reading || c.isDirty,
    unmount() {
      clearTimeout(timer);
      timer = null;
      root = null;
    },
  };
}
