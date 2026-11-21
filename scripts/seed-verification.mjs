// Only the isolated verification server is modified; never the user's port 47831.
const origin = 'http://127.0.0.1:47832';
const { token } = await fetch(origin + '/api/bootstrap').then((r) => r.json());
let state = await fetch(origin + '/api/state').then((r) => r.json());
const titles = [
  ['Solaris', 'Stanisław Lem'],
  ['Diuna', 'Frank Herbert'],
  ['Hobbit', 'J.R.R. Tolkien'],
  ['Ziemiomorze', 'Ursula K. Le Guin'],
  ['Fundacja', 'Isaac Asimov'],
  ['Opowieść podręcznej', 'Margaret Atwood'],
  ['Niezwyciężony', 'Stanisław Lem'],
  ['Wiedźmin. Ostatnie życzenie', 'Andrzej Sapkowski'],
  ['Morderstwo w Orient Expressie', 'Agatha Christie'],
  ['Imię róży', 'Umberto Eco'],
  ['Zbrodnia i kara', 'Fiodor Dostojewski'],
  ['Długi polski tytuł książki, który nie mieści się na małym grzbiecie', 'Autor testowy'],
];
const colors = ['#31596b', '#96754c', '#784b42', '#707951', '#736377', '#2e4b54', '#8c775f'];
for (let i = state.books.length; i < 100; i++) {
  const [title, author] = titles[i % titles.length];
  const draft = {
    title: i < 12 ? title : title + ' · ' + (i + 1),
    authors: [author],
    shelfId: ['fantasy', 'crime', 'other'][Math.floor(i / 34) % 3],
    status: ['to-read', 'reading', 'read'][i % 3],
    pageCount: 120 + i * 7,
    palette: [colors[i % colors.length]],
    spineStyle: i % 6,
  };
  const r = await fetch(origin + '/api/commands', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Bookshelf-Token': token },
    body: JSON.stringify({ expectedRevision: state.revision, command: { type: 'addBook', draft } }),
  });
  state = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(state));
}
console.log('Isolated test library:', state.books.length, 'books, revision', state.revision);
