# Design system

Scena: czytelnik układa książki przy biurku w dzień albo wieczorem; wybiera światło tapety pasujące do pokoju.

## Color and themes
Light: lniana ściana, jesionowe drewno, grafitowy tekst, szałwiowy akcent. Dark: ściana w ciepłym głębokim odcieniu, orzech, złamany jasny tekst, oliwkowy akcent. Panel stosuje barwione neutralne kolory OKLCH i jeden akcent dla aktywnego wyboru. Grzbiety zachowują kolor okładki.

## Typography
Panel: Segoe UI/system-ui, skala 12/14/16/20/28 px. Grzbiety: Georgia dla klasycznych wzorów, Segoe UI dla prostych. Polskie litery pozostają tekstem. Podpisy i tooltips nie wychodzą poza ekran.

## Layout
Panel: pasek boczny z półkami, czytelna lista książek, osobny wysuwany formularz. Tapeta: 3 drewniane poziomy, 20% miejsca na ikony po lewej, margines na pasek zadań. Przewijanie kolekcji stronami, bez skalowania książek do drobnych miniaturek.

## Components and motion
Wspólne przyciski i pola, etykiety, focus, błędy przy formularzu oraz krótkie komunikaty zapisu. Animacje transform/opacity 180 ms; prefers-reduced-motion wyłącza przesuwanie. Brak animacji w spoczynku.

Aktualizacja 0.3: scenę opisuje public/shared/room-scene.mjs; tło i książki skalują się razem. Siedem wnęk 2–3–2, osobna ruchoma warstwa grzbietu, przednie krawędzie odtwarzane z tła. Motywy: Dzień i Wieczór.

0.4: ilustracja jest osobną warstwą pod tekstem aplikacji, centralnie kadrowaną bez deformacji. Napisy mają ciemny półprzezroczysty podkład. AI domyślnie wyłączone, osobne potwierdzenie w dialogu HTML; ręczny import grzbietu niezależny od API.
