# Biblioteczka 0.21.1

Kliknij grzbiet, aby wysunąć książkę i obejrzeć okładkę w powiększeniu do 2×. Widoczne krawędzie okładki, blok kartek i światło podkreślają jej bryłę. Bezpośrednio pod książką pojawia się karta z tytułem, autorem, aktualnym gatunkiem i datą przeczytania. Pozostaje widoczna do odłożenia; dłuższe dane można przewinąć. Podgląd przesuwa się wyżej, kiedy potrzebuje miejsca na kartę. Kliknij książkę, tło, znak zamknięcia lub naciśnij Esc, aby odłożyć ją na półkę. Sąsiednie książki pozostają na miejscu.

Okładka jest dekodowana przed pokazaniem, a model przygotowywany w rozmiarze docelowym, aby ograniczyć rozmycie podczas obrotu. Skalowanie obejmuje wszystkie trzy wymiary. Powrót zaczyna się szybko i łagodnie wyhamowuje przy półce; chwilowa utrata aktywności okna go nie przerywa. Program respektuje ograniczenie ruchu. „Lista książek” oraz wybór książki bez działającej okładki nadal otwierają dotychczasowe informacje.

Zbliż kursor do prawego dolnego rogu tapety, aby ujawnić zębatkę „Ustawienia”. Kliknięcie otwiera panel w domyślnej przeglądarce Windows i pozostawia tapetę na pulpicie. Przycisk jest dostępny również klawiszem Tab; znika po odsunięciu kursora.

W pokoju **6 · Niska biblioteka z widokiem** książki zaczynają się przy wewnętrznej lewej ściance każdej z dwunastu wnęk. Pomiar uwzględnia metalowe przegrody; linia oparcia i przednia krawędź półek pozostają bez zmian.

Po wybraniu książki program próbuje pobrać okładkę wskazanego wydania. „Wybierz inną okładkę” lub „Znajdź okładkę” otwiera do dwunastu propozycji z Open Library i Inventaire, w tym potwierdzone inne wydania tej samej powieści. Karty pokazują język, wydawcę, rok i źródło, jeśli katalog je zna. Wybór grafiki nie zmienia ISBN, tytułu ani autora. Okładka i podgląd grzbietu zmieniają się w szkicu; zatwierdzasz je razem z książką. Plik i link nadal są dostępne.

Pobieranie ponawia chwilowy błąd najwyżej raz, respektuje limity źródeł i korzysta z pamięci pobranych obrazów. Brak rekordu wydania nie wyklucza sprawdzenia samej grafiki po ISBN. Awaria jednego źródła nie usuwa pozostałych propozycji. Samo szukanie okładek nie blokuje zapisu książki; zapis lub zamknięcie formularza kończy oczekujące wyszukiwanie. Grafika innego wydania wymaga świadomego wyboru. Wyszukiwanie i podglądy nie uruchamiają AI.

Wszystkie dziesięć pokoi ma osobno zmierzoną linię oparcia książek i przednią krawędź półki. Maski nie odcinają dołu grzbietów ani cienia przy podstawie; ustawienie zachowuje proporcje po zmianie rozmiaru i podczas wysuwania książki.

Nowe pokoje zachowują numery z galerii: **1 · Nisze w tynku**, **4 · Regał jako przegroda**, **5 · Zawieszone linie**, **6 · Niska biblioteka z widokiem**. Wybierz je w **Ustawienia → Wygląd → Pokój**. Każdy ma dwanaście półek oraz wariant dzienny i wieczorny. Tła są puste; wyświetlane książki pochodzą z kolekcji.

Zmiana pokoju zachowuje wybrany widok książek. **Ustawienia → Tapeta → Widok książek** pozwala włączyć miesiące wybranego roku albo gatunki; starsze pokoje pokazują gatunki i zachowują roczny wybór na powrót do pokoju z dwunastoma półkami. Miesiące zajmują stałe półki wierszami od lewej do prawej, bez tabliczek na zdjęciu. Decyduje zapisana data przeczytania; książki bez daty pozostają w kolekcji i są widoczne w panelu oraz układzie gatunków. Aplikacja nie dopisuje dat. Pełny miesiąc korzysta z kolejnych stron tej samej półki, bez zmniejszania książek. Ręczne rozmieszczenie jest dostępne w widoku gatunków i pozostaje zapamiętane po przełączeniu na miesiące.

Nowe pokoje zachowują wszystkie dwanaście pól także na szerszym ekranie. Poza proporcjami fotografii aplikacja przedłuża jej spokojny lewy brzeg lub podłogę; najlepiej zachowany oryginalny kadr ma proporcje 16:9.

Grzbiety pokazują grafikę bez tytułów dodawanych przez aplikację. Pełny tytuł, autor i zapisana data przeczytania są dostępne po najechaniu, przy fokusie klawiatury i w szczegółach książki. Zapisana okładka od razu tworzy lokalną kompozycję na całej wysokości grzbietu, również w podglądzie nowej książki. Obraz zachowuje proporcje i jest przycinany centralnie; napisy będące częścią samej okładki pozostają na grafice. Gotowa ilustracja AI lub własny obraz ma pierwszeństwo i zachowuje swój kadr. Uszkodzony obraz grzbietu ustępuje grafice okładki; bez dostępnego obrazu pozostaje kolorowa oprawa. Ten podgląd korzysta z lokalnych plików i nie uruchamia generowania AI.

Wyszukiwanie internetowe łączy Open Library z Biblioteką Narodową: wpisz tytuł, autora lub ISBN. Źródło i rok wydania są widoczne przy wyniku; „Pokaż więcej wyników” pobiera kolejne strony. Awaria jednego źródła nie blokuje drugiego i jest oznaczona komunikatem o niepełnych wynikach. BN uzupełnia polskie tytuły, autorów, ISBN i gatunki, ale nie dostarcza w tej integracji okładek. Po wybraniu wyniku bez grafiki aplikacja sprawdza ISBN w [Open Library Covers](https://openlibrary.org/dev/docs/api/covers); gdy obrazu brakuje lub źródło nie odpowiada, próbuje [Inventaire](https://wiki.inventaire.io/wiki/Entities_data). Robi to również po awarii podstawowej okładki katalogowej. ISBN-10 i ISBN-13 są równoważne; drugie źródło musi potwierdzić ten sam ISBN w rekordzie wydania. Grafika trafia do lokalnego magazynu i od razu tworzy grzbiet. Przy otwarciu edycji zapisanej książki bez okładki i bez własnej ilustracji aplikacja ponawia wyszukiwanie po ISBN; znaleziony obraz pozostaje szkicem do zatwierdzenia przez „Zapisz zmiany”. Plik, link i już zapisane obrazy zachowują pierwszeństwo. Brak grafiki lub awaria źródeł nie blokuje zapisu. Mechanizm nie dopasowuje innego wydania po podobnym tytule, nie wymaga klucza API i nie uruchamia AI. Dane BN są udostępniane na CC0 ([dokumentacja API](https://data.bn.org.pl/docs/bibs)); żaden katalog nie gwarantuje kompletności wszystkich tytułów, okładek ani korekty literówek.

Okładkę i własną ilustrację grzbietu można dodać z pliku albo przez „Wklej link” → „Pobierz obraz”. Wklej bezpośredni adres HTTPS obrazu JPEG, PNG lub WebP do 5 MiB. Link do strony księgarni lub wyszukiwarki nie jest linkiem do obrazu. Pobrana grafika trafia do istniejącego lokalnego importu i działa offline; adres nie jest zapisywany w kolekcji. Okładkę zatwierdzasz razem z formularzem książki; własna ilustracja grzbietu zapisuje się od razu, tak samo jak przy wyborze pliku. Błędny link zachowuje dotychczasowy obraz.

Biblioteczka służy do kolekcjonowania przeczytanych książek. Dodanie książki nie wymaga wyboru statusu; data przeczytania jest opcjonalna. Gatunki obejmują osobno Fantasy i Science fiction, Kryminał i Thriller, a także Literaturę obyczajową, Klasykę i Reportaż. Puste gatunki pozostają dostępne w zarządzaniu półkami, lecz nie zajmują miejsca w nawigacji ani w automatycznym układzie tapety. Dodatkowe rośliny i wazony zostały usunięte z układu.

Starsze kopie są nadal obsługiwane: wszystkie zachowane książki stają się przeczytane, bez dopisywania dat. Dawne grupowanie i przypisania według statusu oraz dekoracje są pomijane. Daty, obrazy, kadry, własne gatunki i ręczne przypisania książek do wnęk pozostają zachowane. Format JSON nadal ma wersję 2; wewnętrzne pole status jest zachowane dla zgodności i ma wartość read.

Edytor kadru grzbietu pozwala przesuwać ilustrację poziomo i pionowo oraz przybliżać ją do 300%. Podgląd zachowuje oprawę i sposób wyświetlania grafiki z tapety. Kadr jest szkicem zapisywanym razem ze zmianami książki; anulowanie go odrzuca. Ta regulacja korzysta z zapisanego obrazu i nie uruchamia generowania AI.

Grzbiety mają gładkie powierzchnie, płytko zaokrąglone krawędzie i wąski refleks przy zagięciu oprawy. Cieniowanie jest nakładane na obraz, dzięki czemu również jasne okładki zachowują bryłę. Dotychczasowe warianty opraw różnią się delikatnie obrysem, bez faktury płótna i sztucznego postarzania. Na tapecie cień przy podstawie osadza książki na półce; światło zmienia się razem z pokojem. Wcześniej zapisane wzory opraw pozostają w danych książek; zmiana daty ich nie zmienia. Podgląd panelu i tapeta używają tego samego renderera.

Galeria i opcjonalna Lista mają wyszukiwanie we własnej kolekcji (tytuł, autor, ISBN), globalne sortowanie widoku Wszystkie oraz strony po 60 książek. Kliknięcie okładki otwiera lekki podgląd z datą przeczytania; Edytuj otwiera pełny formularz ze stale dostępnym zapisem. Przełącznik Jasny / Ciemny zapamiętuje wybór. Wybierz książki pozwala zmienić gatunek lub datę wielu książek jednym zapisem. Rzadsze akcje są w menu Więcej.

Interaktywna tapeta na Windows: dziesięć realistycznych pomieszczeń oraz lokalny panel kolekcji. Książka delikatnie wysuwa się po najechaniu lub fokusie klawiatury. Kliknięcie otwiera jej kartę. Duża kolekcja ma kolejne strony.

Ustawienia → Wygląd → Pokój: Orzechowy pokój, Jasny dąb, Zielona biblioteka, Czytelnia przy oknie, Orzechowa biblioteka i Granatowy gabinet. Każdy ma dopasowane pozycje książek, z miejscem pozostawionym dla lamp i roślin. Zmiana pomieszczenia zachowuje kolekcję. Wszystkie sześć wnętrz ma warianty Dzień i Wieczór.

Ustawienia → Wygląd → Światło w pokoju: wybierz Dzień, Wieczór, Zgodnie z motywem lub Automatycznie. Tryb automatyczny używa lokalnego zegara komputera: dzień od 07:00 do 19:00, poza tym wieczór. Motyw panelu jest osobny. Domyślnie światło jest zgodne z motywem: jasny/dzień, ciemny/wieczór. Tła i przysłaniające podstawę książek fronty półek korzystają z tej samej fotografii; pora dnia nie zmienia geometrii wnętrza.

Pokój wypełnia cały ekran bez jednolitych pasów, zachowując proporcje. Przy innych proporcjach monitora przycinany jest lewy brzeg lub dół pokoju. Ustawienie miejsca na ikony rezerwuje obszar bez książek, zamiast zmniejszać zdjęcie. Książki trafiają tylko do widocznych części półek; na bardzo szerokim ekranie kolekcja korzysta z mniejszej liczby wnęk i kolejnych stron.

## Uruchomienie i Lively

Uruchom ten sam `Start-Bookshelf.cmd` w głównym folderze projektu. Otwiera stałą instalację `Biblioteczka`, która zawiera dołączony runtime Node i ikonę w zasobniku Windows. Kolejne aktualizacje trafiają do tego folderu; nie trzeba rozpakowywać nowych paczek. Panel: `http://127.0.0.1:47831/manager`. Dwuklik ikony otwiera panel; menu zawiera podgląd tapety, autostart i zamknięcie programu. Wersja źródłowa wymaga Node.js24+.

Nowa instalacja lub aktualizacja: uruchom jeden plik `dist/Biblioteczka-Setup.exe` i wybierz dotychczasowy folder Biblioteczka (albo jego folder nadrzędny). Zachowuje kolekcję; przy nieudanym uruchomieniu nowej wersji przywraca poprzednią. Zawiera runtime, nie zawiera danych użytkownika ani kluczy. Instalator nie jest jeszcze podpisany cyfrowo; reakcje SmartScreen nie zostały przetestowane. Lively instalujesz osobno.

Ustawienia → Zaawansowane → Windows: autostart po zalogowaniu jest domyślnie wyłączony. Dotyczy tej instalacji; zmieniasz go również z menu ikony. Włączenie tworzy skrót w folderze Autostart bieżącego użytkownika. Starszy własny wpis rejestru jest rozpoznawany i zastępowany skrótem po ponownym włączeniu tej opcji. Wyłączenie usuwa oba własne wpisy. Zbyt długa ścieżka lub obcy wpis/skrót powodują czytelny błąd zamiast nadpisania. Do uruchomień bez interfejsu: `scripts/start.ps1 -NoBrowser -NoTray`.

Ikona w zasobniku przywraca Biblioteczkę po awarii serwera. Gdy działa Lively i na danym ekranie jest wybrana tapeta Biblioteczki, program próbuje przywrócić także ten widok. Po trzech nieudanych uruchomieniach w ciągu dziesięciu minut możesz wybrać **Spróbuj ponownie** z menu ikony. **Zamknij Biblioteczkę** zatrzymuje również automatyczne odzyskiwanie. W razie potrzeby kod zdarzenia można sprawdzić w `Biblioteczka/data/runtime-events.log`.

Od0.7 otwarte strony wykrywają zmianę wersji po aktualizacji i wczytują nowy kod. Otwarty formularz książki lub niezapisany szkic rozmieszczenia odracza odświeżenie do zapisania albo cofnięcia wszystkich zmian. Starszy panel/tapetę0.6 odśwież jednorazowo ręcznie.

W osobno zainstalowanym [Lively Wallpaper](https://www.livelywallpaper.net/) wybierz Dodaj tapetę, wklej `http://127.0.0.1:47831/wallpaper`, kliknij małą strzałkę po prawej stronie pola URL i Zatwierdź w oknie podglądu. Wybierz tapetę w bibliotece. Lively może wymagać włączenia interakcji myszy. Panel → Tapeta zawiera adres i podgląd. Ustawienia pozwalają zostawić miejsce na ikony.

### Próba na pulpicie 0.12

Przed próbą zachowaj kopię JSON w Ustawienia → Kolekcja. Zanotuj wersje Windows/Lively, rozdzielczość, skalowanie i liczbę ekranów. Dodaj książkę, zmień datę i sprawdź aktualizację tapety. Następnie sprawdź sąsiednie książki, sześć pokojów w dzień i wieczorem, rozmiary 60–140%, miejsce na ikony, uśpienie/wybudzenie, restart oraz kolekcję bez internetu. Przy dwóch ekranach sprawdź ponowne podłączenie monitora.

W Menedżerze zadań obserwuj Biblioteczkę, Lively i proces tapety osobno przez dwie minuty: przy spokojnym pulpicie, wybieraniu książek, zasłoniętej tapecie i aplikacji pełnoekranowej. Na laptopie sprawdź także baterię i ustawienia pauzowania. Zasady opisuje [dokumentacja Lively](https://github.com/lively-community/lively/wiki/Performance). Testy przeglądarki nie zastępują tej próby na fizycznym sprzęcie.

Beta zakłada 3–5 osób i tydzień używania. Zapisuj kroki problemu, konfigurację, oczekiwany i rzeczywisty wynik; do zgłoszenia nie dołączaj klucza API ani całej prywatnej kolekcji. Próba pulpitu nie uruchamia płatnej generacji AI. Oddzielny odbiór rzeczywistych ilustracji wymaga ustalenia okładek, liczby prób i budżetu.

## Książki i grzbiety

Wpisz tytuł, autora lub ISBN. Podpowiedzi Open Library pojawiają się po krótkiej przerwie; Szukaj albo Enter uruchamia wyszukiwanie od razu. Wybierz wynik, sprawdź dane, wybierz półkę i zapisz. Możesz też wpisać książkę ręcznie. Autor i tytuł są obowiązkowe. Własna okładka: JPEG/PNG/WebP do 10 MB, zmniejszana w panelu do 1600 px.

Podgląd formularza i tapeta korzystają z tego samego grzbietu. Bez ilustracji aplikacja tworzy lokalną oprawę z kolorów okładki i danych książki. W zapisanej książce możesz wgrać ilustrację JPEG/PNG/WebP do 5 MiB. Najlepiej sprawdza się wąska pionowa grafika, z głównym motywem pośrodku. Napisy nakłada aplikacja, więc grafika nie potrzebuje tytułu ani autora.

Katalog proponuje kategorię na podstawie tematów książki. Możesz wybrać inną półkę przed zapisem lub później w edytorze. Jeśli proponowanego gatunku jeszcze nie ma, opcja „nowa półka” utworzy go razem z książką. Brak albo sprzeczne metadane dają propozycję Pozostałe. Zapisane książki zachowują dotychczasowe kategorie; program nie przenosi ich w tle. Przemianowane półki są dopasowywane po obecnej nazwie.

W pasku kolekcji wybierz kolejność ręczną, tytuł A–Z/Z–A lub datę przeczytania od najnowszej/najstarszej. Ten sam tryb obowiązuje na tapecie. Wszystkie książki w panelu sortowane są wspólnie; filtrowanie półki ogranicza widok do niej. Tapeta zachowuje wybrane grupowanie. Brak daty zawsze trafia na koniec. Powrót do ręcznej kolejności przywraca poprzedni układ; wtedy przeciąganie i akcje Przesuń w menu Więcej zmieniają kolejność. Zarządzanie półkami: Zarządzaj półkami nad Galerią. Usuwając półkę z książkami, wybierz półkę docelową.

Ustawienia → Tapeta → Rozmiar książek: proporcje są dobrane do mebli w każdym wnętrzu. Wyższa wnęka zostawia więcej miejsca nad książką. Suwak 60–140% zapamiętuje regulację osobno dla każdego pokoju; Przywróć 100% wraca do dobranej wartości. Długie tytuły mogą być skrócone na grzbiecie, pełną nazwę odczytasz po najechaniu albo kliknięciu.

W edytorze możesz podać opcjonalną datę ostatniego przeczytania. Panel i tapeta pokazują „Przeczytano: DD.MM.RRRR”. Starsze książki pozostają bez daty, dopóki jej nie uzupełnisz. Zmiana gatunku zachowuje datę; można ją poprawić albo usunąć w formularzu. Eksport i import przenoszą datę bez zmiany dnia przez strefę czasową.

## Kadr ilustracji grzbietu

Otwórz książkę → Edytuj wszystkie dane → Dane wydania i grzbiet → Dopasuj kadr. Opcja pojawia się przy książce z zapisaną ilustracją grzbietu, wgraną ręcznie lub wygenerowaną przez AI. Sam lokalny grzbiet z koloru okładki nie potrzebuje kadrowania.

Trzy suwaki ustawiają położenie poziome, położenie pionowe i przybliżenie 100–300%. Suwaki obsługują też klawisze strzałek. Przesuwanie w pionie widać, gdy obraz jest wyższy od widocznej części, np. po przybliżeniu. Napisy i rozmiar książki pozostają stałe. Przywróć domyślny ustawia środek i 100%; zmiana również czeka na Zapisz zmiany.

Kadr jest zapamiętany osobno dla ilustracji danej książki i przenoszony w kopii JSON. Nowa okładka usuwa poprzednią ilustrację; wgranie lub wygenerowanie nowej ilustracji zaczyna od domyślnego kadru. Gdy drugie okno zmieni ilustrację lub jej kadr podczas edycji, szkic pozostaje widoczny, a zapis wymaga otwarcia aktualnej wersji książki. Starsze wersje aplikacji nie zachowują nowych ustawień kadru przy ponownym zapisie kolekcji.

## Własne rozmieszczenie

Tapeta → Rozmieszczenie: włącz własny układ dla wybranego pokoju. Wybierz numer wnęki na mapie lub z listy, ustaw gatunek, dodaj pojedyncze książki i ich kolejność. Ręczne przypisanie ma pierwszeństwo przed kategorią. Nadmiar książek korzysta z kolejnych stron.

Podgląd pokazuje lokalny szkic. „Zapisz rozmieszczenie” aktualizuje tapetę, „Cofnij zmiany” przywraca zapisany stan, „Przywróć automatyczny układ” usuwa przypisania tego pokoju dopiero po zapisie. Samo wyłączenie własnego układu zachowuje jego wybory. Zmiana zakładki zachowuje szkic; jeśli inne okno zmieni kolekcję, panel zachowuje szkic i wymaga cofnięcia zmian przed edycją aktualnej wersji. Układy innych pokojów pozostają zapisane. Niewidoczne wnęki w innym rozmiarze monitora korzystają z dostępnych półek bez zmiany zapisanych przypisań. Kopia JSON obejmuje rozmieszczenie.

## Automatyczne ilustracje grzbietów

W źródłach przygotowano integrację Cloudflare Workers Free do pilotażu 0.16. Instrukcja konta, lokalnego wprowadzenia tokenu i osobnej kolekcji próbnej: [prywatna usługa](services/spine-service/README.md). Obecna instalacja 0.15 pozostaje nieskonfigurowana do czasu odbioru 3–5 prawdziwych ilustracji. Pula dostawcy i lokalny limit prób są oddzielne; po odmowie darmowego limitu kolejka czeka na reset.

Po podłączeniu prywatnej usługi dodanie lub import książki uruchamia przygotowanie nowej ilustracji inspirowanej motywem okładki. Nie wymaga przycisku generowania, promptu ani klucza użytkownika. Zapis jest lokalny i kończy się przed pracą sieciową. Do czasu wyniku pozostaje dotychczasowy grzbiet; gotowy obraz zapisuje się lokalnie i działa offline. Ręczne ilustracje zachowują pierwszeństwo.

Brakującą okładkę program próbuje odnaleźć po zgodnym ISBN-10/ISBN-13 albo jednoznacznie zgodnym tytule i głównym autorze. Nie zgaduje spośród kilku wydań i nie nadpisuje danych książki. Jednoznaczny brak dopasowania jest zapamiętany; zmiana tożsamości lub dodanie okładki pozwala rozpatrzyć książkę ponownie. Błąd sieci jest ponawiany z rosnącym odstępem. Istniejące książki bez ilustracji są uzupełniane stopniowo, nowe mają pierwszeństwo.

Zmiany tytułu, daty, gatunku, motywu i kadru nie uruchamiają nowej płatnej pracy. Zmiana okładki unieważnia stary bilet i przygotowuje ilustrację dla nowej. Wgranie własnego obrazu, usunięcie książki i przywrócenie kolekcji blokują dołączenie starych wyników. Identyczne obrazy i ustawienia modelu współdzielą cache usługi.

Klucz dostawcy, trwała kolejka i licznik prób znajdują się wyłącznie w osobnym procesie operatora. Biblioteczka otrzymuje adres i indywidualne poświadczenie instalacji przez środowisko procesu; przeglądarka i kopia JSON ich nie otrzymują. Bez konfiguracji program zachowuje lokalne grzbiety i nie wysyła okładek. Stare pole aiEnabled pozostaje dla zgodności kopii, lecz nie steruje automatyzacją. Dawny ręczny endpoint generowania zwraca 410, bez zadania i opłaty.

Prywatna usługa ma jeden worker, limit 10 rozpoczętych prób na dobę UTC, idempotencję, kontrolę obrazów i ochronę przed ponownym wywołaniem po niepewnej odpowiedzi. Próba jest zapisana atomowo przed wywołaniem dostawcy. Timeout i przerwane generating stają się uncertain, bez automatycznej kolejnej płatnej próby. Szczegóły uruchomienia i odzyskiwania opisuje [instrukcja operatora](services/spine-service/README.md) w źródłach projektu. Ta usługa i jej sekrety nie wchodzą do instalatora.

Wersja 0.15 ma zweryfikowany przepływ z generatorem kontrolnym na osobnych danych. Działająca kolekcja pozostaje nieskonfigurowana do czasu osobnego uruchomienia prywatnej usługi: hostingu/HTTPS, poświadczeń, klucza dostawcy i finansowania. Rzeczywiste AI oraz jakość kilku ilustracji wymagają osobnego odbioru; testy tej wersji nie wykonują płatnych wywołań.

## Dane, kopie i aktualizacja

W stałej instalacji dane są w `Biblioteczka/data`: kolekcja `library.json`, poprzedni stan `library.backup.json`, obrazy `covers` i `spines`. Dziennik lokalnych powiązań: `automatic-spines.json`; aktualizacja zachowuje również dawne pliki cache i liczników. Niepewne lub uszkodzone powiązanie nie powoduje nowej płatnej próby. Nie edytuj danych podczas pracy programu. Jeśli główny plik biblioteki jest uszkodzony, program odczytuje kopię; jeśli oba są uszkodzone, zachowuje pliki i wymaga importu.

Eksport JSON w Ustawieniach zawiera książki, półki, ustawienia, okładki i przypięte ilustracje. Import do 64 MiB pokazuje podgląd i wymaga potwierdzenia zastąpienia. Eksport nie przenosi historii rozliczeń ani klucza. Dla dużych bibliotek lub pełnego przeniesienia wyłącz program i skopiuj cały folder `data`, zachowując oryginał. Eksport ponad 64 MiB zgłasza błąd.

Aktualizacja lokalna: po sprawdzeniu kodu skrypt wydania przygotowuje nową wersję, zatrzymuje właściwą instancję, przenosi cały folder danych i uruchamia aplikację pod tym samym adresem. Sprawdza zachowanie kolekcji oraz plików obrazów i AI. Dopiero wtedy usuwa stare katalogi i archiwa wydań z `dist`. Po nieudanym starcie przywraca poprzednią wersję. Obce kolekcje w innych katalogach wydań pozostają chronione. Nie zapisuj zmian w panelu w czasie aktualizacji. Jeśli Lively nadal pokazuje poprzedni wygląd, odśwież wybraną tapetę; adres pozostaje ten sam.

Schemat biblioteki 1 przechodzi automatycznie na 2; przed zapisem powstaje niezmienna `library.schema1.backup.json`. Stare pliki eksportu są obsługiwane. **Nowy schemat 2 nie jest zgodny ze starszym programem.** Powrót do starszej wersji wymaga zachowanej kopii starego folderu danych. Launcher sprawdza folder uruchomionej instancji i nie otwiera omyłkowo innej kolekcji na tym samym porcie.

Wersja 0.4.3 odczytuje kolekcje 0.4.0–0.4.2. Starsza kolekcja otwiera się z dotychczasowym Orzechowym pokojem. Program 0.4.0 nie zachowuje nowego pola daty przy zapisie, a 0.4.2 nie zachowuje wyboru pokoju, więc przed powrotem do starszego programu zachowaj kopię folderu danych.

Wersja 0.5.0 odczytuje dotychczasowy schemat 2, dodając domyślną kolejność ręczną, brak indywidualnych regulacji i puste tematy dla starszych książek. Powrót do 0.4.3 nie zachowa nowych ustawień i tematów, dlatego zachowaj kopię przed zmianą wersji.

Wersja 0.6.0 dodaje domyślne oświetlenie zgodne z motywem do starszych kolekcji. Poprzednie wersje nie zachowają wyboru oświetlenia.

Kolekcja, import CSV, gotowe ilustracje i własne okładki działają offline. Wyszukiwanie oraz nowa generacja AI wymagają internetu. Serwer słucha wyłącznie na 127.0.0.1; nie udostępniaj go przez proxy lub przekierowanie portów. Autostart jest domyślnie wyłączony; możesz włączyć go w ustawieniach Windows aplikacji. Program nie zmienia systemowej polityki PowerShell. Błędy startu: `data/server-error.log`.

## Dołączenie książek z Goodreads

Ustawienia → **Dołącz z Goodreads (CSV)**. Wybierz lokalny eksport CSV, sprawdź podgląd i zaznacz książki. Import dołącza wyłącznie pozycje oznaczone jako przeczytane w Goodreads. Pozostałe są pokazane jako pominięte i nie można ich zaznaczyć. Możesz poprawić proponowany gatunek. Przycisk „Dołącz” dodaje cały wybrany zestaw jednym zapisem, zachowując dotychczasowe książki, poprawki, obrazy, ustawienia i układy. Ten import **dołącza** książki; przywracanie JSON nadal **zastępuje** kolekcję.

Duplikaty rozpoznawane są po identyfikatorze Goodreads, ISBN (także para ISBN10/ISBN13) lub tytule i głównym autorze, gdy brakuje wspólnych silnych identyfikatorów. Różne zidentyfikowane wydania pozostają osobnymi książkami. Import nie zmienia daty ani innych danych istniejącej książki. Półki z CSV proponują kategorię; osobiste nieznane tagi nie tworzą automatycznie nowych półek. Dodatkowych autorów zachowujemy jako jeden wpis ze wskazówką, aby sprawdzić podział w zwykłym edytorze.

Format UTF8 (BOM opcjonalny), do10MiB i10000 niepustych pozycji. Wymagane kolumny `Title`, `Author`; obsługiwane także `Additional Authors`, `Book Id`, `ISBN`, `ISBN13`, `Publisher`, `Year Published`, `Number of Pages`, `Date Read`, `Bookshelves`, `Exclusive Shelf`. Wielkość liter w nagłówkach nie ma znaczenia. Opinie, prywatne notatki, oceny i data dodania są pomijane. Formuły pozostają tekstem. Błąd cytowania/struktury odrzuca cały plik; błędne dane jednej książki wyłączają tę pozycję z wyboru.

Puste daty pozostają puste. `Date Read` przyjmuje rzeczywisty dzień `YYYY/MM/DD` lub `YYYY-MM-DD`; import obejmuje jedną datę, bez historii ponownego czytania. Podgląd ma50wierszy na stronę; wybór wszystkich dotyczy całego pliku. Wybory pozostają w pamięci przy zmianie zakładki. Podgląd jest ważny10minut. Zmiana kolekcji lub restart serwera wymaga ponownego wczytania pliku. Jeśli po zapisie zabraknie odpowiedzi, sprawdź kolekcję i wczytaj CSV ponownie — już dołączone książki zostaną rozpoznane jako duplikaty.

Nie jest to synchronizacja konta Goodreads. Zapis CSV działa offline; po skonfigurowaniu prywatnej usługi brakujące okładki i ilustracje są uzupełniane w tle. Pole `goodreadsId` zachowuje się w pełnej kopii JSON. Starsze programy mogą pominąć je przy zapisie, dlatego przed powrotem do starej wersji zachowaj folder danych. Odbiór korzysta z jawnie syntetycznych CSV; nie otrzymano autentycznego eksportu użytkownika z2026.

## Rozwój i paczka

`npm test` — testy bez sieci i płatnych wywołań. `npm start` — serwer. Osobna instancja: `node src/main.mjs --port 47832 --data-dir output/test-data`.

`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package.ps1` aktualizuje stały folder `Biblioteczka`, restartuje aplikację i usuwa poprzednie wydania po sprawdzeniu nowej instancji. Korzysta z runtime dotychczasowej instalacji. Pierwsze wydanie wymaga `-NodeRuntimePath C:\ścieżka\do\runtime`: oficjalnego Windows x64 `node.exe` >=24 i pasującego `LICENSE`. Jednorazowa migracja kolekcji z dawnego katalogu wymaga `-PreviousAppPath C:\ścieżka\do\starej\wersji`; dla działającej wersji sprzed 0.4.2 również `-LegacyProcessId` ustalonego dla tej instancji. Skrypt nie pobiera aktualizacji z internetu.

Opcja `-CreateZip` dodatkowo zastępuje `dist/Biblioteczka-current-win-x64.zip` paczką do dystrybucji. Archiwum zawiera kod, tła oraz runtime; nie zawiera kolekcji użytkownika, klucza, testowych obrazów ani Lively. Licencje opisuje `THIRD-PARTY-NOTICES.md`.

Wydając aplikację z narzędzi Codex, uruchom skrypt aktualizacji poza ograniczonym środowiskiem wykonania, z autoryzowanym dostępem do sieci. Proces aplikacji dziedziczy jego ograniczenia; uruchomiony wewnątrz niego może zwracać `CATALOG_UNAVAILABLE` z powodu `EACCES`, mimo działającego katalogu. Zwykły start przez Windows nie ma tego ograniczenia. Po aktualizacji sprawdź prawdziwe wyszukiwanie przez lokalne `/api/search`.

## Kategorie i bezpieczne utrzymanie

Dostępnych jest 29 proponowanych gatunków, m.in. Horror, Poezja, Psychologia, Filozofia, Technologia, Podróże, Kulinaria, Sport, Sztuka i Religia i duchowość. Wybierz nową kategorię w edytorze albo w Zarządzaj półkami. Tworzone są tylko wybrane półki; ręczne przypisania istniejących książek pozostają zachowane. Równoważne ISBN-10/ISBN-13 nie tworzą nowego duplikatu.

Ustawienia → Kolekcja zawierają import, kopię JSON i raport obrazów na dysku. Porządkowanie chroni aktualną kolekcję, poprzedni stan, cache i zadania AI oraz obrazy z ostatnich siedmiu dni. Nieużywane pliki najpierw trafiają do odwracalnej kwarantanny. Dopiero po 30 dniach, ponownej kontroli odniesień i wyraźnym potwierdzeniu można usunąć je trwale. Kwarantanna sama nie zwalnia miejsca. Niespójne dane blokują sprzątanie.

Jedna instancja ma prawo zapisu do danego folderu danych. Podgląd przywracania jest związany z wersją kolekcji; zmiana w innym oknie wymaga ponownego podglądu. Aktualizacja używa dziennika transakcji i manifestu plików. Instrukcja odzyskiwania starszych blokad i ponowienia sprzątania znajduje się poniżej.

Na tapecie przycisk Lista książek pozwala wygodnie wybrać książkę z bieżącej strony, również klawiaturą. Zmiana strony i samego oświetlenia korzysta z zapamiętanego planu rozmieszczenia. Adresy ekranów panelu oraz Wstecz zachowują nawigację. Niezapisane szkice książki, podglądu, importu i rozmieszczenia odraczają aktualizację otwartej strony.

## Odzyskiwanie przerwanej aktualizacji

Aktualny instalator zapisuje `.bookshelf-update.lock` z właścicielem i `.bookshelf-update.json` z etapem transakcji w folderze nadrzędnym Biblioteczki. Ponowienie instalatora na tym samym porcie automatycznie odzyskuje transakcję po potwierdzeniu, że lokalny właściciel nie żyje. Żywy PID, inny komputer i nieczytelne metadane blokują odzyskanie. Nie przejmuje się blokady na podstawie wieku.

Dziennik po potwierdzonym uruchomieniu nowej wersji ma etap `committed`. Nieudane porządkowanie nie cofa aktualizacji: wynik zawiera `installed: true`, `cleanupWarning` i `preserved`. Instalator uruchamia aktualną ikonę zasobnika. Ponowienie samego porządkowania:

```powershell
& '<Biblioteczka>/runtime/node.exe' '<Biblioteczka>/scripts/publish.mjs' --retry-cleanup --target '<pełna ścieżka/Biblioteczka>'
```

Ta operacja sprawdza manifest i działający serwer tej instalacji. Usuwa wyłącznie poprzedni folder wskazany przez zatwierdzony dziennik. Nie usuwa historycznych etapów ani osobnych kolekcji.

## Stara pusta lub uszkodzona blokada

Wersje sprzed dziennika pozostawiały pusty `.bookshelf-update.lock`. Taki plik nie dowodzi, że jego właściciel zakończył pracę. Instalator pokazuje dokładną ścieżkę blokady i zachowanych folderów `.bookshelf-stage-*` / `.bookshelf-previous-*`.

1. Zamknij wszystkie instalatory i procesy aktualizacji Biblioteczki. W Menedżerze zadań sprawdź procesy instalatora oraz procesy Node/PowerShell uruchamiające `publish.mjs`, `install.mjs` lub `install.ps1`. Jeżeli nie potrafisz potwierdzić, że żadna aktualizacja nie pracuje, zachowaj blokadę i foldery.
2. Zachowaj pełną kopię wszystkich wymienionych folderów, dziennika i blokady. Dopiero po potwierdzeniu zatrzymania aktualizacji przenieś dokładnie wskazany plik blokady do nowej nazwy `.bookshelf-update.lock.legacy-<data>`, bez nadpisywania istniejącej kopii. Użyj `Move-Item -LiteralPath '<dokładna blokada>' -Destination '<nowa nazwa>'`.
3. Jeżeli istnieje dziennik nowego instalatora, pozostaw go i ponów instalator na zapisanym w nim porcie. Dziennik rozstrzyga, co przywrócić.
4. Jeżeli dziennika nie ma, a stały folder Biblioteczka istnieje i zawiera zachowaną kolekcję, ponów instalator, wskazując ten sam folder. Jeżeli Biblioteczka nie istnieje, ustal poprzednią kopię `.bookshelf-previous-*` na podstawie jej `package.json`, `data/library.json` lub `data/library.backup.json` oraz zachowanych obrazów. Przy zatrzymanej aplikacji przenieś potwierdzoną poprzednią kopię do pustej ścieżki Biblioteczka. Nie nadpisuj żadnego istniejącego folderu. Przy więcej niż jednej niejednoznacznej kolekcji potrzebne jest ręczne porównanie kopii; nie wybieraj na podstawie daty folderu.
5. Zachowaj wszystkie pozostałe etapy do sprawdzenia kolekcji, obrazów i ustawień. Instalator nie skanuje ich w celu automatycznego usuwania.

Po nieudanym przywracaniu bieżący instalator pokazuje dokładne ścieżki poprzedniego folderu i nowego etapu, zachowuje oba wraz z dziennikiem, a następne uruchomienie instalatora ponawia odzyskanie. Po udanym rollbacku zachowuje nowy etap: mógł otrzymać zapis w krótkim czasie pomiędzy startem a weryfikacją.

Po restarcie i odzyskaniu kopii otwarte szkice książek i rozmieszczenia pozostają zachowane. Jeżeli ich zapisany punkt wyjścia się zmienił, zapis jest wstrzymany do wczytania aktualnej wersji. Spóźnione odpowiedzi importu z poprzedniej sesji nie zastępują bieżącej kolekcji.

