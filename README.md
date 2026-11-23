# Biblioteczka – Bookshelf Wallpaper

**English** · [Polski](README.pl.md)

An interactive Windows wallpaper that shows the books you have read on a bookshelf. The books stand on the shelves of a realistic room, right under your desktop icons. Hover over a spine and the book slides out a little; click it to see its cover and details. You manage the collection in a panel: search Open Library and the National Library of Poland, pick covers, sort books into genres, record when you read them, import from Goodreads and arrange the shelves yourself.

Everything runs locally, with no account. The internet is only needed to search for books and covers. The app sends no usage data.

> The project is moving from a Lively Wallpaper add-on to a standalone Windows app. Plan: [CLAUDE.md](CLAUDE.md) (in Polish).

## How it works

- **`host/`** – the Windows app in C#/.NET 10 (WinForms + WebView2). It places the wallpaper between the Windows wallpaper and the desktop icons, forwards the mouse to it, pauses it under fullscreen games and videos, opens the panel in its own window and owns the tray icon and start-with-Windows.
- **`src/`** – a local Node.js 24 server, started by the app as a helper process. It stores the collection and talks to the book catalogs.
- **`public/`** – the panel (`manager`) and the wallpaper (`wallpaper`) as web pages shown in WebView2.

The collection is saved in `Documents\Biblioteczka` (`library.json`, covers, spines), so it survives uninstalling the app. On first start the app offers to copy the collection from an older version.

The interface is available in English and Polish and follows the Windows display language. Detailed feature notes (in Polish): [docs/funkcje.md](docs/funkcje.md).

## Requirements

- Windows 11 (23H2 or later) with the WebView2 Runtime (built into Windows 11).
- For development: the [.NET 10 SDK](https://dotnet.microsoft.com/) and [Node.js 24](https://nodejs.org/).

## Running from source

```powershell
npm install
dotnet build host/Biblioteczka.slnx
host/Biblioteczka.Host/bin/Debug/net10.0-windows/Biblioteczka.exe
```

Started from the repository, the app runs in development mode: port `47832`, data in `output/host-prototype-data`, log in `output/host-state/host.log`. It does not touch an installed Biblioteczka. Add `--lang en` or `--lang pl` to try a language.

The server alone, without the wallpaper and Windows features: `npm start` (panel at `http://127.0.0.1:47831/manager`).

## Tests and formatting

```powershell
npm test
dotnet test host/Biblioteczka.slnx
npm run format:check
```

The tests do not use the network. The full JavaScript suite takes about 30 seconds.

## Translations

Interface text is written in Polish inside `t('…')` (JavaScript) or `L.T("…")` (C#); the Polish text is the key and `public/locales/en.json` holds the English text. `node tools/i18n-keys.mjs` lists missing keys, and `tests/i18n.test.mjs` fails when a translation is missing or unused.

## License

GNU GPL 3.0 or later – see [LICENSE](LICENSE). Third-party components: [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
