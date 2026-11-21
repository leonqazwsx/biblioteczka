# Prywatna usługa ilustracji — Cloudflare Free

Node.js >=24, sharp **0.35.5** wyłącznie w tej usłudze. Usługa Node działa na tym komputerze, ilustrację oblicza Cloudflare. Instalator i klient nie zawierają usługi, sharp ani poświadczeń dostawcy. Uruchomienie rzeczywistego pilotażu jest oddzielne od testów z fixture.

## Przygotowanie konta i zależności

Sprawdź w panelu **plan Workers Free** na wybranym koncie. Plan domeny Free nie potwierdza planu Workers. Program opiera się na potwierdzeniu operatora; minimalny token Workers AI nie sprawdza planu rozliczeniowego. Nie włączamy Workers Paid, płatności, AI Gateway ani płatnego dostawcy awaryjnego.

Workers AI → Use REST API → Create a Workers AI API Token. Uprawnienia: Workers AI **Read i Edit**, ograniczone do jednego konta, bez zarządzania płatnościami. ID konta ma 32 znaki hex. Token wprowadź lokalnie, nigdy do czatu ani pliku OneDrive.

Z katalogu projektu, przy Node >=24:

```powershell
npm --prefix services/spine-service ci
```

Prywatny package-lock przypina sharp 0.35.5. Nie instaluj go w root ani w Biblioteczka/. Pierwsza próba obejmuje 3–5 wybranych okładek w osobnej kolekcji, bez backfill aktywnej biblioteki. Odbiór: motyw okładki, brak przypadkowych napisów AI, kadr 1:5 i czytelność w obu motywach. Dopiero po odbiorze i kopii danych podłączamy istniejącą kolekcję.

## Środowisko procesów

Usługa odczytuje:

- `BOOKSHELF_SPINE_PROVIDER=cloudflare`.
- `BOOKSHELF_SPINE_FREE_CONFIRMED=1`, po sprawdzeniu planu konta.
- `CLOUDFLARE_ACCOUNT_ID` i `CLOUDFLARE_API_TOKEN`.
- `BOOKSHELF_SPINE_DATA_DIR`: bezwzględny katalog poza instalacją i kolekcją, np. `%LOCALAPPDATA%/BiblioteczkaSpineService`.
- `BOOKSHELF_SPINE_CREDENTIALS`: JSON mapujący osobny losowy token połączenia każdej instalacji na jej stały identyfikator. Token połączenia ma 24–512 znaków ASCII liter/cyfr/`._~-`; zalecane 32 losowe bajty w hex. Nie jest to token Cloudflare.
- Opcjonalnie `BOOKSHELF_SPINE_PORT=47842`, `BOOKSHELF_SPINE_HOST=127.0.0.1`.

Klient Biblioteczki otrzymuje tylko `BOOKSHELF_SPINE_SERVICE_URL` i `BOOKSHELF_SPINE_SERVICE_TOKEN` w swoim procesie Node. Bez CLOUDFLARE_API_TOKEN i bez BOOKSHELF_SPINE_CREDENTIALS. Poza loopback wymagane HTTPS. Klucze nie trafiają do przeglądarki, JSON kolekcji, dziennika, logów, eksportu ani EXE.

Samo OPENAI_API_KEY już nie uruchamia generatora. Niepełna konfiguracja kończy start kodem SERVICE_CONFIG, bez drukowania sekretów.

## Lokalny start operatora

### Prostszy start tej proby w Windows

Po potwierdzeniu Workers Free na wybranym koncie uruchom z katalogu projektu:

```powershell
.\Uruchom-probe-Free.cmd
```

Ten plik dotyczy obecnej proby z juz potwierdzonym planem Free. Program odczytuje dane zapamiętane przez opisany poniżej mechanizm Windows, a jeśli ich nie ma, pyta lokalnie o Account ID i token Workers AI. Oba pola sa ukryte, a bledny format mozna poprawic od razu; nie dopisuj `Bearer` ani cudzyslowow. Nie wklejaj danych przed pojawieniem sie odpowiedniego pytania. Nie trafiają do historii polecen. Bez opcji zapamiętywania nowe dane pozostają tylko w pamięci procesu. Uzywaj zwyklego terminala bez nagrywania/transkrypcji.

Program sam tworzy losowy kod polaczenia w pamieci i uruchamia prywatny generator oraz osobny proces klienta. Klient otrzymuje tylko lokalny URL i kod polaczenia, bez tokenow dostawcy i prywatnej konfiguracji uslugi. Dane proby pozostaja w `%LOCALAPPDATA%/BiblioteczkaSpinePilot/service` i `collection`. Nie wprowadza autostartu. Opcjonalny zapis poświadczeń dostawcy opisano poniżej; kod połączenia klienta pozostaje tymczasowy.

Jesli poprzedni panel proby na porcie 47843 nadal dziala, program potwierdza ID instalacji, sciezke kolekcji oraz PID i zamyka go przez jego API przed ponownym uruchomieniem. Ksiazki i dzienniki pozostaja. Obca instalacja lub zajety port generatora blokuje start. Program nie resetuje kolejek, dziennych limitow ani pauzy autoryzacji; nie powtarza niepewnych zadan. Wczesniejszy czas odroczenia ksiazki moze opoznic pierwsza probe o kilka minut.

Otworz wyswietlony adres `http://127.0.0.1:47843/manager`. Pozostaw okno operatora otwarte; Ctrl+C konczy klienta, a nastepnie usluge. Jeśli dane zostały zapamiętane, następny start odczyta je bez pytań. Nie jest to instalator ani wydanie 0.16. Ponizsza reczna metoda pozostaje dostepna.

Jesli dostawca odmowi autoryzacji, do odczytowego sprawdzenia uzyj w osobnym oknie `Sprawdz-polaczenie.cmd`. Korzysta z zapamiętanych danych, jeśli istnieją; do ich wymiany użyj `Zmien-dane-Cloudflare.cmd`. Program wykonuje tylko dwa GET-y do oficjalnego API Cloudflare: `/user/tokens/verify` i wyszukanie modelu na wskazanym koncie. Pokazuje wylacznie HTTP, ustalony status, numery bledow i obecnosc modelu; nie drukuje tresci odpowiedzi, tokenu ani ID konta. Nie generuje obrazu, nie sprawdza uprawnienia Workers AI Edit ani faktycznego dostepu do uruchomienia modelu, nie wznawia pauzy i nie dotyka kolekcji. Odpowiedz ma limit 64 KiB, czas do 10 s, bez przekierowan i ponawiania. Token konta moze nie dac potwierdzenia na endpointcie tokenow uzytkownika; wynik odczytu Workers AI jest wtedy osobnym sygnalem.

### Zapamiętanie danych Cloudflare w Windows

`Sprawdz-Diune-9B.cmd` ma opcję `--remember-credentials`. Gdy nie ma zapisu, po sprawdzeniu dziennika i referencji pobiera ukryte dane lokalnie i zapisuje je w `%LOCALAPPDATA%/BiblioteczkaSpinePilot/credentials/cloudflare-v1.dpapi`. Kolejne starty pilota, porównań i diagnostyki odczytują ten zapis automatycznie. Nie potrzeba dodatkowego hasła. Dane są walidowane pod względem formatu przed zapisem; dostęp do Cloudflare jest sprawdzany podczas zwykłej próby.

Account ID i token są razem szyfrowane przez Windows DPAPI z zakresem `CurrentUser`, zgodnie z [dokumentacją Microsoft](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.protecteddata?view=windowsdesktop-9.0). Ochrona wiąże je z kontem użytkownika Windows; inne programy działające jako ten sam użytkownik również mogą korzystać z DPAPI. Plik leży poza projektem i OneDrive. Do pliku tymczasowego i docelowego trafia tylko szyfrogram. Dane są przekazywane do lokalnego procesu PowerShell przez potoki, bez umieszczania ich w argumentach, zmiennych środowiskowych lub logach. Nie zmieniamy zasad wykonywania PowerShell ani ustawień zabezpieczeń. Awaria szyfrowania blokuje zapis, bez awaryjnego zapisu jawnym tekstem.

- `Zmien-dane-Cloudflare.cmd`: wpisanie i zaszyfrowany zapis nowych danych, także gdy poprzedni plik jest uszkodzony. Nie uruchamia sieci ani generatora.
- `Usun-dane-Cloudflare.cmd`: usuwa wyłącznie zapis danych Cloudflare. Nie unieważnia tokenu u dostawcy i nie zmienia dziennika, kolekcji ani limitu.
- Uszkodzony lub niedostępny zapis zatrzymuje zwykły start z instrukcją wymiany. Zmiana lub usunięcie poświadczeń nie usuwa pauzy autoryzacji i nie ponawia uncertain.

Bez `--remember-credentials` świeżo wpisane dane pozostają tylko do końca procesu. Ręczny start usługi przez zmienne środowiskowe nadal działa niezależnie od tego schowka. Testy zapisu, odczytu, pomijania pytań, wymiany, usunięcia, anulowania i uszkodzenia używają wyłącznie sztucznych danych.

### Jednorazowa próba jakości Diuny

`Sprawdz-jakosc-Diuny.cmd` sprawdza zaakceptowany nowy opis tylko na zapisanej okładce Diuny. Zatrzymaj poprzedni generator przez Ctrl+C, a następnie uruchom ten plik w PowerShell. Aktywna blokada katalogu zatrzymuje próbę przed odczytem zapamiętanych danych lub pytaniem o nie. Konto Workers Free zostało już potwierdzone w tym pilotażu.

Próba używa profilu `quality-v2`, z osobną wersją cache `cover-motif-cf-quality-v2`. Zwykły generator nadal używa dotychczasowego profilu. Program wymaga istniejącego dziennika `%LOCALAPPDATA%/BiblioteczkaSpinePilot/service/jobs.json`, robi jego kopię pod blokadą i rezerwuje próbę w tym samym liczniku dziesięciu wywołań UTC. Nie tworzy nowego budżetu. Wykonuje najwyżej jedno wywołanie dostawcy podczas uruchomienia, respektuje pauzy oraz odroczenia, nie ponawia uncertain i ponownie eksportuje gotowy wynik z cache.

Kolekcja i dotychczasowe grzbiety nie są modyfikowane. Wynik oraz `cloudflare-quality-result.json` trafiają do `output/execution/spine-quality-20261017`; bez poświadczeń, treści wyjątków ani pełnych odpowiedzi dostawcy. Błąd może zawierać tylko HTTP i numery kodów. Nie uruchamiaj zwykłego generatora, zanim nie sprawdzimy wyniku tej próby: po odroczeniu v2 mogłoby zostać uznane przez stary worker za inną konfigurację. Samo polecenie nie uruchamia serwera ani panelu. Plansza porównania działa niezależnie i zostaje dostępna.

Okno jednorazowego polecenia czeka na naciśnięcie klawisza także po sukcesie, aby wynik pozostał widoczny przy uruchomieniu dwuklikiem. Próba wymaga oceny rzeczywistego obrazu; testy syntetyczne nie dowodzą uzyskania jakości wzorca imagegen.

### Ręczny start dwóch procesów

Używaj osobnych konsol usługi i klienta, bez włączonej transkrypcji. Nie używaj .env, setx ani sekretu w argumentach polecenia. Poniższa funkcja pobiera ukryte wejście, a tymczasowy bufor zwalnia w finally; użyj jej osobno w każdej konsoli:

```powershell
function Read-BookshelfSecret([string]$Label) {
  $taskSecure = Read-Host $Label -AsSecureString
  $taskBuffer = [IntPtr]::Zero
  try {
    $taskBuffer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskSecure)
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskBuffer)
  } finally {
    if ($taskBuffer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskBuffer) }
    $taskSecure.Dispose()
  }
}
```

Przygotuj osobny losowy token połączenia, np. w lokalnym menedżerze haseł, i użyj tego samego tokenu w obu konsolach. Nie przesyłaj go do rozmowy. W konsoli usługi, z katalogu projektu:

```powershell
$env:BOOKSHELF_SPINE_PROVIDER = 'cloudflare'
$env:BOOKSHELF_SPINE_FREE_CONFIRMED = '1' # dopiero po sprawdzeniu Workers Free
$env:CLOUDFLARE_ACCOUNT_ID = Read-Host 'ID konta Cloudflare'
$env:BOOKSHELF_SPINE_DATA_DIR = Join-Path $env:LOCALAPPDATA 'BiblioteczkaSpinePilot/service'
$env:BOOKSHELF_SPINE_HOST = '127.0.0.1'
$env:BOOKSHELF_SPINE_PORT = '47842'
$taskCredentials = @{}
try {
  $env:CLOUDFLARE_API_TOKEN = Read-BookshelfSecret 'Token Workers AI'
  $taskPairToken = Read-BookshelfSecret 'Token połączenia Biblioteczki'
  $taskCredentials[$taskPairToken] = 'pilot-local'
  $env:BOOKSHELF_SPINE_CREDENTIALS = ConvertTo-Json -Compress $taskCredentials
  node services/spine-service/main.mjs
} finally {
  Remove-Item Env:CLOUDFLARE_API_TOKEN,Env:CLOUDFLARE_ACCOUNT_ID,Env:BOOKSHELF_SPINE_CREDENTIALS -ErrorAction SilentlyContinue
  $taskCredentials.Clear(); $taskPairToken = $null
}
```

W **oddzielnej konsoli klienta**, w której nie ustawiano tokenu Cloudflare, zdefiniuj powyższą Read-BookshelfSecret i uruchom izolowaną kolekcję na innym porcie niż działająca Biblioteczka:

```powershell
$env:BOOKSHELF_SPINE_SERVICE_URL = 'http://127.0.0.1:47842'
$env:BOOKSHELF_PILOT_DATA_DIR = Join-Path $env:LOCALAPPDATA 'BiblioteczkaSpinePilot/collection'
try {
  $env:BOOKSHELF_SPINE_SERVICE_TOKEN = Read-BookshelfSecret 'Ten sam token połączenia Biblioteczki'
  node --input-type=module -e "import {run} from './src/main.mjs'; const app=await run({appRoot:process.cwd(),port:47843,dataDir:process.env.BOOKSHELF_PILOT_DATA_DIR}); console.log(app.origin+'/manager'); for(const s of ['SIGINT','SIGTERM'])process.once(s,()=>app.close());"
} finally {
  Remove-Item Env:BOOKSHELF_SPINE_SERVICE_TOKEN,Env:BOOKSHELF_SPINE_SERVICE_URL,Env:BOOKSHELF_PILOT_DATA_DIR -ErrorAction SilentlyContinue
}
```

Otwórz wyświetlony adres i dodaj 3–5 książek. Po zakończeniu użyj Ctrl+C w obu konsolach. Ta ręczna konfiguracja jest na czas sesji; prostszy operator CMD obsługuje opisany wcześniej schowek Windows. Stały ID instalacji (`pilot-local`) i zachowane katalogi pozwalają odczytać poprzednie powiązania. Autostart prywatnej usługi jest poza zakresem. Nie uruchamiaj dwóch procesów z tym samym katalogiem.

## Model, limity i odzyskiwanie

Model: @cf/black-forest-labs/flux-2-klein-4b, jeden wynik 512×1536. Referencja to JPEG z dłuższym bokiem do 480 px, z poprawną orientacją, bez powiększania i metadanych. Stały prompt nie zawiera tytułu/autora. Napisy dodaje renderer. Do Cloudflare nie trafiają daty, gatunki, UUID książek ani kolekcja. Wynik JPEG/PNG/WebP do 5 MiB jest sprawdzany według struktury, rozmiaru i SHA-256; brak przekierowań i dowolnych URL.

Workers Free ma obecnie 10000 neurons/konto/dobę, reset 00:00 UTC; pula jest współdzielona z innymi aplikacjami konta. Nie oznacza to stałej liczby obrazów. Biblioteczka ma dodatkowy limit 10 rozpoczętych prób/dobę UTC i jednego workera. Cache nie rozpoczyna próby; odmowy liczą się do limitu lokalnego.

- HTTP 429 + 3036 lub 4006: cała kolejka czeka do następnego resetu UTC +60 s, zachowując zadanie, requestId i bilet książki. Odmowa wymaga `success:false`, braku wyniku i spójnych kodów błędu; sprzeczna odpowiedź pozostaje uncertain. Kod 4006 zaobserwowano w tym pilotażu, a użytkownik potwierdził wyczerpanie puli; obecna oficjalna tabela błędów podaje dla limitu 3036.
- HTTP 429 + 3040: globalny backoff 1, 2, 4…300 s, z uwzględnieniem dłuższego poprawnego Retry-After.
- 401/403, w tym 5035: trwała pauza do interwencji operatora. Gdy body zawiera wynik, sprzeczny sukces lub nie pozwala potwierdzić odmowy, sama próba zostaje uncertain; odblokowanie połączenia jej nie powtarza. Nie kupuj planu ani nie podmieniaj modelu.
- Jawne nieprawidłowe dane: failed; pozostaje lokalny grzbiet.
- Timeout, przerwanie, nieznane 429/5xx i awaria zapisu po odpowiedzi: uncertain, bez automatycznego ponowienia.

Każda próba ma osobny UUID i zapis przed siecią. Odmowa i odroczenie zapisują się atomowo. Restart/cofnięty zegar nie odnawia limitu. Nowa książka nie omija pauzy konta.

Dziennik jobs.json v1 migruje do v2 z dokładną kopią jobs.v1.backup.json. Zachowane są stare wyniki, UUID i liczniki. Przerwane/niepewne prace nie przechodzą w nową generację. Obca konfiguracja kończy queued kodem CONFIG_CHANGED; ready pozostaje dostępne. Uszkodzony/nieznany dziennik lub inna istniejąca kopia blokuje start — nie usuwaj plików ani nie zeruj liczników.

Po naprawie tokenu/uprawnień zatrzymaj usługę, zrób kopię jej danych i odblokuj wyłącznie pauzę autoryzacji:

```powershell
node services/spine-service/admin.mjs C:\private-spine-data resume-authorization
```

Nie resetuje to liczników ani uncertain. Niepewne zadanie po sprawdzeniu dostawcy można tylko zakończyć:

```powershell
node services/spine-service/admin.mjs C:\private-spine-data UUID failed
```

Admin wymaga zatrzymanej usługi i blokady katalogu. Jedyny zatwierdzony wyjątek dla obecnej próby Diuny z potwierdzoną odmową limitu 4006 jest opisany poniżej; nie dotyczy ogólnych niepewnych prac. Okładki wejściowe są usuwane po zakończeniu pracy, uncertain po siedmiu dniach; queued po odmowie pozostają. Niezależna konserwacja działa co minutę. Wyniki/cache oraz tombstone idempotencji są trwałe, uwzględnij katalog usługi w backupie.

HTTP: 60 żądań/min na instalację; kolejka 10000 prac; JSON do 7 MiB; statyczne JPEG/PNG/WebP do 5 MiB. Istniejące limity: 16 MP, bok do 16384 px, rozpakowany PNG do 64 MiB. Klient nadal obsługuje ręczny obraz/kadr, eksport, offline i ochronę spóźnionych wyników.

Testy automatyczne używają jawnych fixture i kontrolowanego transportu. Zielone testy nie potwierdzają jakości ani dostępności prawdziwego modelu na koncie Free — robi to oddzielny pilotaż.

Źródła: [model](https://developers.cloudflare.com/workers-ai/models/flux-2-klein-4b/), [multipart](https://developers.cloudflare.com/changelog/post/2026-01-15-flux-2-klein-4b-workers-ai/), [pula Free](https://developers.cloudflare.com/workers-ai/platform/pricing/), [błędy](https://developers.cloudflare.com/workers-ai/platform/errors/), [token REST](https://developers.cloudflare.com/workers-ai/get-started/rest-api/).

### Osobna próba porównawcza 9B

Aktualny plik `Sprawdz-Diune-9B.cmd` wybiera `--remember-credentials --quality-diuna-9b-framed`. Pierwszy start zapamiętuje wpisane dane szyfrowane przez Windows; kolejne pomijają oba pytania. Profil `framed-v5-9b` zmienia opis kompozycji: pełniejszy centralny motyw, bez zbliżenia, spokojna górna część pod tytuł i bardziej szczegółowe malarskie cieniowanie. Model 9B, istniejąca automatycznie oczyszczona referencja, transport i 320 × 1600 px pozostają takie jak w poprzedniej próbie automatycznej referencji. Czyszczenie nie jest powtarzane. Najwyżej jedno nowe wywołanie i osobny cache, plik oraz raport w `output/execution/spine-framed-9b-20261019/`; wspólny dziennik, kopie, limit dziesięciu prób UTC, pauzy i ochrona uncertain pozostają zachowane. Pierwsza próba 19 października zakończyła się HTTP 429 + 4006 i stanem uncertain; użytkownik potwierdził wyczerpanie darmowej puli. Kontrolowane wznowienie 21 października uzyskało `ready`, JPEG 320 × 1600 px, jedno nowe wywołanie, bez ponownego wpisywania danych. Pełniejszy kadr działa, ale ilustracja straciła detale i nie została przyjęta jako zamiennik w kolekcji. Dowody i odbiór: `output/execution/spine-framed-review-20261021/README.md`. Podgląd trzech wariantów: http://127.0.0.1:61936/framed-check.html.

#### Kontrolowane wznowienie tej jednej odmowy limitu

Użytkownik zatwierdził `Wznow-probe-Diuny.cmd` (`--resume-confirmed-framed-quota`). To jednorazowa operacja operatora dla dokładnie przypiętej okładki, profilu framed-v5 i deterministycznego requestId Diuny. Wymaga sanitowanego raportu uncertain z HTTP 429 + wyłącznie 4006, braku wyniku oraz dokładnie jednej odpowiadającej niepewnej próby w poprawnym dzienniku v2. Inne błędy, zadania i profile są odrzucane. Dla tej próby wznowienie już wykonano 21 października; dalszy odczyt gotowego wyniku odbywa się przez `Sprawdz-Diune-9B.cmd`, bez ponownego uruchamiania helpera naprawy.

Warunkiem czasowym jest następny dzień UTC względem zapisanej próby, plus minuta. Przed tym czasem polecenie kończy się bez odczytu poświadczeń, zapisu kopii, zmiany dziennika i sieci. Potem, pod wyłączną blokadą, zachowuje dokładną kopię `jobs.json` w `%LOCALAPPDATA%/BiblioteczkaSpinePilot/backups/framed-quota-<requestId>.before.json` i pokwitowanie `.recovery.json` z identyfikatorami, czasem i hashami przed/po. Dopiero po potwierdzeniu kopii i zapisaniu pokwitowania zmienia tę jedną próbę na odmowę limitu i zadanie na queued. Liczniki, UUID, inne zadania i pauzy dostawcy pozostają zachowane. W razie przerwania publikacji wolno dokończyć wyłącznie dokładną transakcję z pokwitowania; inny dziennik lub sprzeczne kopie blokują wznowienie.

Po tym kroku ten sam plik przechodzi do zwykłej pojedynczej generacji z zapisanymi danymi. Nie oczekuje w tle i nie tworzy automatyzacji. Po rozpoczęciu kolejnej próby lub zmianie raportu dalsza obsługa odbywa się przez zwykły `Sprawdz-Diune-9B.cmd`, zgodnie ze stanem zadania. Ponowna prawidłowa odmowa 4006 jest już odraczana automatycznie; nowy timeout lub inny niepewny wynik pozostaje zablokowany. Sam upływ czasu ani zwykły start nie odblokowuje uncertain.

Surowy raport sukcesu z pierwszego rzeczywistego wznowienia zachował historyczną diagnozę 429/4006 przez błąd raportowania. Oryginał i konsolę zachowano jako dowód. Obecny kod nie przenosi wcześniejszej diagnozy do raportu `ready`, również przy odczycie cache; nadal zachowuje ją dla prac nierozstrzygniętych. Test regresji oraz pełny przebieg 590/590 są w `output/execution/spine-framed-review-20261021/`.

Poprzednia próba `--quality-diuna-9b-auto-reference` utworzyła grzbiet z gotowej okładki automatycznie oczyszczonej przez 9B. Operator uzyskał `ready`, JPEG 320 × 1600 px, jedno wywołanie. W surowej grafice nie zauważono napisów, motyw jest rozpoznawalny, ale kadr mocniej przybliża i przycina postać, a detale są bardziej uproszczone niż w starszym grzbiecie. Wynik nie zastąpił grafiki w kolekcji. Porównanie: http://127.0.0.1:61936/auto-reference-check.html. Szczegóły i dowody: `output/execution/spine-auto-reference-9b-20261019/README.md`.

Poprzedni etap `--quality-diuna-9b-cleanup` usunął napisy z oryginalnej okładki Diuny: operator uzyskał raport `ready`, JPEG 512 × 768 px. Oględziny nie wykazały widocznych napisów; zachowano główny motyw i ogólną paletę, choć część szczegółów została uproszczona. Wynik nadaje się do tej pojedynczej próby grzbietu; nie potwierdza skuteczności dla innych okładek. Dowody: `output/execution/spine-cover-cleanup-9b-20261019/README.md`. Porównanie okładek: http://127.0.0.1:61936/cleanup-check.html.

Odbiór serii różnych źródeł: operator wykonał dwie próby, raport `ready`. Rok 1984 zachował architekturę i jest obiecujący; Quo vadis wymyśliło postać oraz krajobraz z samego papierowego tła, więc wynik odrzucono. To wskazuje potrzebę prostej lokalnej oprawy dla źródeł bez ilustracji; reguła nie została jeszcze wdrożona. Aktualne wyniki i dowody: `output/execution/spine-variety-9b-20261019/README.md`.

Poprzednia seria pod flagą `--quality-covers-9b` obejmowała maksymalnie dwie nowe próbki (Rok 1984 i Quo vadis), ze wspólnym dziennikiem/limitem i jednym lokalnym wpisaniem poświadczeń. Diuna pozostaje gotową kontrolą, bez ponownej generacji. Referencje są przypięte hashem, seria zatrzymuje się po każdym nie-ready, a gotowe prace korzystają z cache. To nadal izolowany test; odbiór gotowych wyników opisano powyżej. Szczegóły: `output/execution/spine-variety-9b-20261019/README.md`.

Poniższe akapity zachowują historię pojedynczej Diuny; jej wcześniejsze flagi CLI nadal są dostępne.

Odbiór referencji bez napisów: operator wykonał pojedynczy wynik smooth-v4 z oczyszczonej ilustracji. Raport `ready`, 320 × 1600 px; podczas oględzin nie zauważono przypadkowych liter. To obiecujący wynik jednej książki, nie gwarancja niezawodności ani gotowy automatyczny etap produktu. Aktualne porównanie i dowody: `output/execution/spine-textless-9b-20261019/README.md`.

Wcześniejszy eksperyment `--quality-diuna-9b-textless` zmienił tylko referencję na przypiętą hashem ilustrację bez napisów; zachował dokładny profil smooth-v4, prompt, 320 × 1600 px i wspólny dziennik/limit. Wynik jest w `output/execution/spine-textless-9b-20261019/`. Referencję oczyszczono jednorazowo imagegen — to jeszcze nie automatyczny etap produktu. Operator wykonał tę próbę; jej odbiór opisano powyżej. Szczegóły i dowody: README oraz `probe-inputs.json` w tym katalogu.

Odbiór gładkiej próby: operator wykonał jeden wynik smooth-v4, zgodny z żądanym 320 × 1600 px. Powierzchnia jest gładka, jednak model umieścił błędne napisy w bitmapie, dlatego wynik nie jest zaakceptowany do kolekcji. Raport jest `ready` technicznie; nie oznacza to odbioru jakości. Szczegóły: `output/execution/spine-smooth-9b-20261019/README.md`. Nie wykonano dalszych generacji.

Wcześniejsza próba gładkiego grzbietu jest dostępna pod flagą `--quality-diuna-9b-smooth`: profil `smooth-v4-9b`, jedna referencja oryginalnej okładki bez płótna i żądane 320 × 1600 px. Wynik i raport są w `output/execution/spine-smooth-9b-20261019/`. Wspólny dziennik, limit oraz ochrona uncertain pozostają zachowane. Operator wykonał tę próbę; wynik wymaga poprawy przez niechciane napisy opisane powyżej. Szczegóły: README i `probe-inputs.json` w tym katalogu.

Poniższe akapity opisują historyczne próby. Ich flagi CLI nadal są dostępne.

Wcześniejsza próba `--quality-diuna-9b-style` używała tego samego modelu 9B, okładki i osobnej, neutralnej referencji płótna, z opisem określającym role motywu/palety oraz materiału. Materiał jest przypięty pełnym SHA256 i kontrolowany przed poświadczeniami oraz przed rezerwacją. Wyniki mają odrębny cache, nazwę i raport w `output/execution/spine-style-9b-20261019/`. Szczegóły i dokładny prompt: `output/execution/spine-style-9b-20261019/README.md` i `probe-inputs.json`.

Poniższy akapit dokumentuje wcześniejszy, nadal dostępny profil porównania modeli bez drugiej referencji:

Pierwszy eksperyment jednej Diuny jest dostępny pod flagą `--quality-diuna-9b`. Domyślny generator pozostaje 4B. Operator korzysta z zapamiętanych danych Windows, jeśli istnieją; bez zapisu pyta lokalnie, a nowe dane zachowuje wyłącznie z opcją `--remember-credentials`. Najpierw sprawdzana jest aktywność tokenu i obecność dokładnego 9B w katalogu konta. Brak potwierdzenia zatrzymuje próbę bez generacji. Odczyt katalogu nie sprawdza uprawnienia Edit ani tego, czy konto przyjmie wywołanie modelu.

Profil 9B zachowuje prompt quality-v2, okładkę i rozmiary z porównania 4B. Wynik trafia wyłącznie do `output/execution/spine-quality-9b-20261019/`, z odrębną nazwą pliku i raportu. Korzysta z tego samego dziennika i limitu 10 prób UTC; nie czyści pauz, liczników ani prac niepewnych i nie ma pętli ponowień. Szczegóły odbioru i dowody: `output/execution/spine-quality-9b-20261019/README.md`. Przed zmianą stałego modelu potrzebna jest osobna ocena jakości i zasad użycia wybranego modelu.
