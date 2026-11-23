# Biblioteczka – Bookshelf Wallpaper

[English](README.md) · **Polski**

Interaktywna tapeta Windows z biblioteczką przeczytanych książek. Książki stoją na półkach w realistycznym pokoju, pod ikonami pulpitu. Po najechaniu grzbiet lekko się wysuwa, a kliknięcie otwiera kartę książki z okładką. Kolekcję prowadzisz w panelu: wyszukiwanie w Open Library i Bibliotece Narodowej, okładki, gatunki, daty przeczytania, import z Goodreads i własne rozmieszczenie na półkach.

Wszystko działa lokalnie i bez konta. Internet jest potrzebny tylko do wyszukiwania książek i okładek. Aplikacja nie wysyła żadnych danych o użyciu.

> Projekt jest w trakcie przejścia z wersji opartej na Lively Wallpaper na samodzielną aplikację Windows. Plan: [CLAUDE.md](CLAUDE.md).

## Jak to działa

- **`host/`** – aplikacja Windows w C#/.NET 10 (WinForms + WebView2). Wyświetla tapetę między tapetą systemu a ikonami pulpitu, przekazuje do niej mysz, wstrzymuje ją przy grach i filmach na pełnym ekranie, otwiera panel we własnym oknie i zarządza ikoną w zasobniku oraz autostartem.
- **`src/`** – lokalny serwer Node.js 24, uruchamiany przez aplikację jako proces pomocniczy. Przechowuje kolekcję i łączy się z katalogami.
- **`public/`** – panel (`manager`) i tapeta (`wallpaper`) jako strony WWW, wyświetlane w WebView2.

Kolekcja jest zapisywana w `Dokumenty\Biblioteczka` (`library.json`, okładki, grzbiety), więc przetrwa odinstalowanie aplikacji. Przy pierwszym uruchomieniu aplikacja proponuje skopiowanie kolekcji ze starszej wersji.

Interfejs jest dostępny po polsku i angielsku i dopasowuje się do języka Windows. Opis funkcji: [docs/funkcje.md](docs/funkcje.md).

## Wymagania

- Windows 11 (23H2 lub nowszy) z WebView2 Runtime (wbudowany w Windows 11).
- Do rozwoju: [.NET 10 SDK](https://dotnet.microsoft.com/) i [Node.js 24](https://nodejs.org/).

## Uruchomienie ze źródeł

```powershell
npm install
dotnet build host/Biblioteczka.slnx
host/Biblioteczka.Host/bin/Debug/net10.0-windows/Biblioteczka.exe
```

Uruchomiona z repozytorium aplikacja pracuje w trybie deweloperskim: port `47832`, dane w `output/host-prototype-data`, dziennik w `output/host-state/host.log`. Nie dotyka zainstalowanej Biblioteczki. Dodaj `--lang en` albo `--lang pl`, żeby sprawdzić język.

Sam serwer, bez tapety i bez funkcji Windows: `npm start` (panel pod `http://127.0.0.1:47831/manager`).

## Testy i formatowanie

```powershell
npm test
dotnet test host/Biblioteczka.slnx
npm run format:check
```

Testy nie korzystają z sieci. Pełny zestaw testów JS trwa około 10 minut.

## Licencja

GNU GPL 3.0 lub nowsza – zob. [LICENSE](LICENSE). Składniki zewnętrzne: [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
