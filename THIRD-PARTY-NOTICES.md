# Składniki i źródła

- Node.js: runtime w paczce pochodzi z oficjalnej instalacji Node.js, wersja w runtime/VERSION.txt. Pełna licencja Node i dołączonych bibliotek w runtime/LICENSE. Źródło: https://nodejs.org/ oraz https://github.com/nodejs/node.
- Lively Wallpaper: osobna aplikacja użytkownika. Nie dołączamy jej kodu ani plików do paczki. Źródło: https://www.livelywallpaper.net/.
- Open Library: zewnętrzne metadane i okładki na żądanie użytkownika. https://openlibrary.org/developers/api. Okładki mogą podlegać prawom wydawców; nie są sprzedawane jako część motywów.
- Inventaire: zapasowe źródło okładek dopasowanych do ISBN, https://inventaire.io/ i https://api.inventaire.io/. Metadane katalogu są udostępniane jako CC0; licencja metadanych nie oznacza przeniesienia praw do grafik okładek. Pochodzenie danych: https://wiki.inventaire.io/wiki/Entities_data.
- Tekstury drewna: wygenerowane dla projektu narzędziem imagegen, prompty w public/assets/README.md.
- Literata: lokalna czcionka grzbietów, niezmieniony plik zmienny z oficjalnego repozytorium Google Fonts. Źródło: https://github.com/google/fonts/tree/main/ofl/literata. Licencja SIL Open Font License 1.1 i informacje o autorach: public/assets/fonts/Literata-OFL.txt. Pochodzenie i suma SHA-256: public/assets/fonts/Literata-source.json. Pozostałe kroje: systemowe Segoe UI i Georgia.

Kod aplikacji nie ma zależności npm ani kodu z Lively. Przed komercyjnym wydaniem należy ustalić własną licencję produktu i zasady korzystania z zewnętrznych materiałów.
