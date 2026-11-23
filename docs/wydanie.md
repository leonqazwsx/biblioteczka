# Wydanie Biblioteczki

Instrukcja dla autora: jak zbudować wydanie, sprawdzić paczkę MSIX i opublikować aplikację w Microsoft Store oraz na GitHubie.

## 1. Zbudowanie paczek

Potrzebne: .NET 10 SDK, Node.js 24 (do testów) i folder z oficjalnym `node.exe` dla Windows x64 razem z plikiem `LICENSE` (np. wypakowany `node-v24.x.x-win-x64.zip` z nodejs.org). Skrypt sprawdza podpis OpenJS Foundation.

```powershell
npm test
dotnet test host/Biblioteczka.slnx
powershell -NoProfile -ExecutionPolicy Bypass -File tools\build-release.ps1 -NodeRuntimeDir C:\ścieżka\do\node -Version 1.0.0
dotnet restore tools\sdk-tools
powershell -NoProfile -ExecutionPolicy Bypass -File tools\build-msix.ps1 -Version 1.0.0 -IdentityName "<z Partner Center>" -Publisher "CN=<z Partner Center>" -PublisherDisplayName "<z Partner Center>"
```

Wynik w `dist\`:

- `Biblioteczka-<wersja>-win-x64.zip` – wersja przenośna (GitHub Releases). Rozpakowujesz i uruchamiasz `Biblioteczka.exe`. Nie jest podpisana, więc Windows pokaże ostrzeżenie SmartScreen.
- `Biblioteczka-<wersja>-x64.msix` – paczka do Microsoft Store, niepodpisana (Sklep podpisuje ją po certyfikacji).

Bez parametrów `-IdentityName`/`-Publisher` paczka dostaje lokalną tożsamość `Biblioteczka.Local` – nadaje się tylko do testu na własnym komputerze.

Szybki test wersji przenośnej bez zmian w systemie (osobny port, dane i stan w `output\`, bez okna importu i bez autostartu):

```powershell
dist\release\Biblioteczka\Biblioteczka.exe --smoke-test --port 47833 --data-dir C:\dev\biblioteczka\output\release-test-data --state-dir C:\dev\biblioteczka\output\release-state
```

## 2. Test paczki MSIX na własnym komputerze

Windows instaluje niepodpisane paczki tylko w trybie dewelopera. To ustawienie systemu – włączasz je sam:

1. **Ustawienia → System → Dla deweloperów → Tryb dewelopera: włączony.**
2. Zamknij inne kopie Biblioteczki (starą z Lively i wersję deweloperską).
3. Zarejestruj rozpakowaną paczkę:

   ```powershell
   Add-AppxPackage -Register C:\dev\biblioteczka\dist\msix\layout\AppxManifest.xml
   ```

4. Uruchom „Biblioteczka” z menu Start. Sprawdź: tapetę, panel, autostart (Ustawienia → Aplikacje → Uruchamianie), restart komputera.
5. Usunięcie: `Get-AppxPackage *Biblioteczka* | Remove-AppxPackage`. Kolekcja w `Dokumenty\Biblioteczka` zostaje.
6. Tryb dewelopera możesz potem wyłączyć.

## 3. Microsoft Store (Partner Center)

Te kroki wykonujesz sam – wymagają Twojego konta i akceptacji regulaminów Microsoftu.

1. **Konto dewelopera.** Zarejestruj się jako osoba prywatna w [Partner Center](https://partner.microsoft.com/dashboard/registration) (aktualne warunki i ewentualną opłatę sprawdź na stronie rejestracji). Weryfikacja tożsamości może potrwać kilka dni.
2. **Rezerwacja nazwy.** Apps and games → New product → MSIX or PWA app → nazwa **Biblioteczka – Bookshelf Wallpaper**. Jeśli zajęta: „Biblioteczka – Reading Shelf Wallpaper”.
3. **Tożsamość paczki.** Product management → Product identity: skopiuj `Package/Identity/Name`, `Package/Identity/Publisher` i `Package/Properties/PublisherDisplayName` do parametrów `build-msix.ps1` i zbuduj paczkę ponownie.
4. **Zgłoszenie (submission):**
   - Pricing and availability: bezpłatna, wszystkie rynki.
   - Properties: kategoria **Personalization**; adres polityki prywatności: link do `PRIVACY.md` w publicznym repozytorium.
   - Age ratings: wypełnij kwestionariusz (brak treści dla dorosłych, brak interakcji między użytkownikami, brak zakupów).
   - Packages: prześlij `.msix`.
   - Store listings: polski i angielski opis, co najmniej jeden zrzut ekranu 1920×1080 (tapeta z książkami, panel).
   - Uzasadnienie `runFullTrust` (Submission options → Restricted capabilities): „Desktop wallpaper app: the window must be placed behind the desktop icons (Win32 desktop window hierarchy), and the app starts its bundled local Node.js server, which listens on 127.0.0.1 only.”
5. Wyślij do certyfikacji. Zwykle trwa od kilku godzin do kilku dni; uwagi przyjdą e-mailem.

## 4. GitHub Releases

Po upublicznieniu repozytorium:

```powershell
gh release create v1.0.0 dist\Biblioteczka-1.0.0-win-x64.zip --title "Biblioteczka 1.0.0" --notes-file docs\release-notes-1.0.0.md
```
