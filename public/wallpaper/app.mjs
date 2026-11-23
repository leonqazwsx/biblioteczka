import { createBookMotion } from './book-motion.mjs';
import { createSettingsEntry } from './settings-entry.mjs';
import { api, el, request } from '../shared/api.mjs';
import { renderScene } from './scene-renderer.mjs';
import { readingDateLabel } from '../shared/reading-date.mjs';
import { watchLighting } from '../shared/lighting-clock.mjs';
import { createBookPicker } from './book-picker.mjs';
import { t, translateDocument } from '../shared/i18n.mjs';
translateDocument();
let state,
  page = 0,
  loading = false,
  queued = false;
const root = document.querySelector('#bookcase'),
  card = document.querySelector('#book-card'),
  tooltip = document.querySelector('#tooltip');
const motion = createBookMotion({
  root,
  volume: document.querySelector('#book-motion-volume'),
  shadow: document.querySelector('#book-motion-shadow'),
  info: document.querySelector('#book-motion-info'),
  closeButton: document.querySelector('#book-motion-close'),
  caption: document.querySelector('#book-motion-caption'),
  author: document.querySelector('#book-motion-author'),
  genre: document.querySelector('#book-motion-genre'),
  date: document.querySelector('#book-motion-date'),
  status: document.querySelector('#book-motion-status'),
  onDetails: details,
  onStart: hideTooltip,
  getGenre: (book) => state?.shelves.find((shelf) => shelf.id === book.shelfId)?.name,
  getIconSpace: () => state?.settings.iconSpace ?? 0.2,
});
const picker = createBookPicker({
  onBook: details,
  onOpen: () => {
    motion.reset();
    hideTooltip();
  },
});
const settingsEntry = createSettingsEntry({
  root: document.querySelector('#wallpaper-settings'),
  button: document.querySelector('#wallpaper-settings-open'),
  status: document.querySelector('#wallpaper-settings-status'),
  openSettings: async () => {
    await api.bootstrap();
    return request('/api/windows/open-settings', { method: 'POST', body: {} });
  },
});
function hideTooltip() {
  tooltip.hidden = true;
}
function showTooltip(b, event) {
  if (motion.isActive()) {
    hideTooltip();
    return;
  }
  tooltip.textContent = [b.title, b.authors.join(', '), readingDateLabel(b)]
    .filter(Boolean)
    .join('\n');
  tooltip.hidden = false;
  const box = tooltip.getBoundingClientRect();
  tooltip.style.left = Math.max(8, Math.min(event.clientX + 12, innerWidth - box.width - 8)) + 'px';
  tooltip.style.top =
    Math.max(8, Math.min(event.clientY + 14, innerHeight - box.height - 8)) + 'px';
}
function openBook(book) {
  void motion.open(book);
}
function details(b) {
  motion.reset();
  hideTooltip();
  card.dataset.bookId = b.id;
  const content = document.querySelector('#card-content');
  content.replaceChildren();
  if (b.coverId) {
    const img = el('img');
    img.src = '/covers/' + b.coverId;
    img.alt = t('Okładka książki ') + b.title;
    content.append(img);
  }
  const text = el('div');
  const title = el('h2', null, b.title);
  title.id = 'card-title';
  text.append(title, el('p', null, b.authors.join(', ')));
  const date = readingDateLabel(b);
  if (date) text.append(el('p', 'card-status', date));
  if (b.publisher) text.append(el('p', 'card-status', b.publisher));
  content.append(text);
  if (!card.open) card.showModal();
}
function render() {
  if (!state) return;
  motion.reset();
  hideTooltip();
  document.body.dataset.theme = state.settings.theme;
  const result = renderScene(root, {
    state,
    page,
    width: innerWidth,
    height: innerHeight,
    onBook: openBook,
    onTooltip: showTooltip,
    onLeave: hideTooltip,
  });
  page = result.page;
  picker.update(result.books);
  document.querySelector('#pages').hidden = result.pageCount < 2;
  document.querySelector('#previous').disabled = page === 0;
  document.querySelector('#next').disabled = page === result.pageCount - 1;
  document.querySelector('#page-label').textContent = page + 1 + ' / ' + result.pageCount;
  if (card.open) {
    const current = state.books.find((b) => b.id === card.dataset.bookId);
    if (current) details(current);
    else card.close();
  }
}
async function refresh() {
  if (loading) {
    queued = true;
    return;
  }
  loading = true;
  try {
    state = await api.state();
    lightingClock.sync();
    render();
    document.querySelector('#connection').hidden = true;
  } catch {
    document.querySelector('#connection').hidden = false;
  } finally {
    loading = false;
    if (queued) {
      queued = false;
      await refresh();
    }
  }
}
document.querySelector('#previous').onclick = () => {
  page--;
  hideTooltip();
  render();
};
document.querySelector('#next').onclick = () => {
  page++;
  hideTooltip();
  render();
};
document.querySelector('.close-card').onclick = () => card.close();
card.addEventListener('click', (e) => {
  if (e.target === card) {
    const r = card.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
      card.close();
  }
});
addEventListener('resize', () => {
  hideTooltip();
  render();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refresh();
});
const lightingClock = watchLighting({
  getSettings: () => state?.settings ?? { theme: 'light' },
  onChange: () => render(),
});
card.addEventListener('close', () => {
  if (document.activeElement === document.body) {
    const book = [...root.querySelectorAll('.book')].find(
      (button) => button.dataset.bookId === card.dataset.bookId,
    );
    (book ?? document.querySelector('#book-picker-open')).focus({ preventScroll: true });
  }
});
addEventListener('pagehide', (event) => {
  if (!event.persisted) {
    lightingClock.dispose();
    settingsEntry.destroy();
    motion.destroy();
  }
});
await refresh();
lightingClock.sync();
api.events(
  (revision) => {
    if (revision !== state?.revision) refresh();
  },
  (online) => {
    document.querySelector('#connection').hidden = online;
    if (online) refresh();
  },
);
