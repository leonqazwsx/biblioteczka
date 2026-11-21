# Biblioteczka – Bookshelf Wallpaper

Interaktywna tapeta Windows z biblioteczką przeczytanych książek oraz panel do zarządzania kolekcją. Open source, GPL-3.0.

## Kierunek (ustalony 2026-11-21)

Projekt przechodzi z „serwer Node + Lively” na własną aplikację Windows. Kolejność prac:

1. Porządek w repozytorium: git, Prettier, wycięcie AI i integracji z Lively.
2. Prototyp hosta .NET: okno WebView2 za ikonami pulpitu (WorkerW) na głównym monitorze, przekazywanie myszy, pauza przy pełnym ekranie, przetrwanie restartu Eksploratora.
3. Pełny host: zasobnik, okno panelu, autostart, dane w `Dokumenty\Biblioteczka`, import ze starej instalacji, ostrzeżenie o działającym Lively, lokalny dziennik + „Skopiuj raport”.
4. Tłumaczenia pl + en (`pl.json` / `en.json`), język według Windows.
5. Wydanie: MSIX w Microsoft Store + ZIP na GitHub Releases.

Stałe decyzje:
- Host: C#/.NET 10, WinForms/Win32 + WebView2. Node zostaje jako proces pomocniczy uruchamiany i pilnowany przez hosta.
- Tylko Windows 11 23H2+. Bez telemetrii. Wersja 1.0 = obecne funkcje, bez nowych.
- Kodu z Lively (GPL-3.0) można używać zgodnie z licencją; zachowaj informację o autorach w przeniesionych fragmentach.

## Struktura

- `src/` – serwer Node 24 (bez zależności npm): magazyn kolekcji, katalogi (Open Library, BN, Inventaire), okładki, import Goodreads, kopie JSON.
- `public/manager/` – panel kolekcji; `public/wallpaper/` – tapeta; `public/shared/` – wspólna logika (układ pokojów, oświetlenie, grzbiety).
- `scripts/` – obecny launcher, zasobnik (z obsługą Lively) i instalator w PowerShell/C#. Zostaną zastąpione przez host .NET w kroku 3; do tego czasu nie rozbudowuj ich.
- Działająca instalacja użytkownika jest w OneDrive (`Bookshelf Wallpaper\Biblioteczka`). Nie uruchamiaj `scripts/package.ps1` ani instalatora z tego repozytorium bez wyraźnej prośby — mogłoby to podmienić jego codzienną wersję.
- `tests/` – `node --test`, bez sieci i płatnych wywołań.

## Polecenia

- `npm test` – pełny zestaw testów.
- `npm start` – serwer na `http://127.0.0.1:47831` (`/manager`, `/wallpaper`).
- Osobna instancja: `node src/main.mjs --port 47832 --data-dir output/test-data`.
- `npm run format` / `npm run format:check` – Prettier.

## Zasady

- Kod formatuje Prettier (`.prettierrc`); nie pisz ręcznie zbitych jednolinijkowców.
- Interfejs po polsku, prostymi zdaniami (do czasu etapu tłumaczeń). Kod, nazwy i commity po angielsku.
- Format danych `library.json` (schemat 2) jest kontraktem: zmiany tylko z migracją i testem.
- Prywatna kolekcja użytkownika nigdy nie trafia do repozytorium (`data/`, `output/` są ignorowane).
- Zmiany zachowania wymagają testu; uruchom `npm test` przed commitem.
