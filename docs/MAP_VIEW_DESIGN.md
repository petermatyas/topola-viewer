# Térképnézet – terv

## Cél

Egy új nézetben a családfa mellett egy OpenStreetMap-alapú térkép mutassa meg,
hol születtek, éltek, házasodtak és haltak meg a családfán szereplő személyek. A
megjelenített helyeket lehessen szűrni, és opcionálisan időrendben összekötni,
hogy a költözések és a nemzedékek közötti vándorlás is látható legyen.

## Megvalósítás állapota

Mind a négy fázis elkészült. A nézet a Nézet menüben „Chart with map” néven,
illetve a `view=map` URL-paraméterrel érhető el. A kód a [src/map/](../src/map/)
mappában van.

Eltérések a tervtől:

- **A Leaflet közvetlenül van használva, react-leaflet nélkül.** A rétegeket
  (jelölők, vonalak) a komponens `useEffect`-ekben frissíti, így egyszerűbb, és
  eggyel kevesebb a függőség.
- **A `leaflet.markercluster` dinamikus importtal töltődik be**, miután a
  Leaflet a globális `L` objektumba került. A bővítmény ugyanis a globális
  `L`-re épül, és statikus importnál (a Prettier import-rendezése miatt is) a
  buildben a Leaflet előtt futhatna le.
- **A térkép kódja lustán töltődik be** (`React.lazy`), így a többi nézet
  betöltése nem lassul (a térképes rész tömörítve kb. 60 KB).
- **Az időbeli lejátszás az évszűrő felső határát lépteti**, nem külön
  csúszkával működik. A lejátszás alatt a dátum nélküli események és vonalak
  rejtve vannak.
- **A feliratok angolok**, ahogy az alkalmazás többi része. Magyar fordítás az
  alkalmazásban nincs; a többi nyelv a meglévő `src/translations/` fájlokba
  vehető fel (`map.*` és `menu.map` azonosítók).
- **Választható háttértérképek.** Az openstreetmap.org csempeszervere a fájlból
  (`file://`) megnyitott oldalt böngészőtől függően letilthatja („Access
  blocked”), mert ilyenkor a böngésző nem küld `Referer` fejlécet. A CARTO is
  elutasítja ezeket a kéréseket („API KEY REQUIRED”). Ezért a térkép jobb felső
  sarkában rétegválasztó van: OpenStreetMap, OpenStreetMap France, OpenStreetMap
  Deutschland és OpenTopoMap, mind OSM-adatokból. Fájlból megnyitva az
  OpenStreetMap France, webszerverről az OpenStreetMap az alapértelmezett. A
  választást a böngésző megjegyzi ([map_tiles.ts](../src/map/map_tiles.ts)).
  Saját csempe-URL a `VITE_MAP_TILE_URL` környezeti változóval adható meg.

## Döntések

| kérdés                           | döntés                                                                                          |
| -------------------------------- | ----------------------------------------------------------------------------------------------- |
| Hogyan jelenjen meg a térkép?    | **Külön nézet:** új „Térkép” diagramtípus, bal oldalon homokóra-diagram, jobb oldalon a térkép. |
| Lehet-e geokódolni Nominatimmal? | **Nem.** A helynevek nem hagyják el a gépet.                                                    |
| Honnan jönnek a koordináták?     | **Csak a GEDCOM-ból** (`PLAC` → `MAP` → `LATI`/`LONG`). A hiányzókat a Gramps-ban kell pótolni. |
| Alapértelmezett költözési mód    | **A felmenők vonalai:** a szülő születési helyétől a gyermekéig, nemzedékenként más színnel.    |

A döntések következménye, hogy a térkép a csempék letöltésén kívül teljesen a
gépen fut. Nincs geokódoló, nincs gyorsítótár, nincs kézi hozzárendelés és nincs
koordinátafájl-import. A program csak megmutatja, mely helyeknél hiányzik a
koordináta, hogy azokat a Gramps-ban lehessen pótolni.

## Kiindulási helyzet a kódban

- **Nincs koordináta a JSON adatokban.** A topola `JsonEvent`-je csak szöveges
  helyet (`place`) tartalmaz. Koordináta csak a nyers GEDCOM-ban lehet (`PLAC` →
  `MAP` → `LATI`/`LONG`), amely `TopolaData.gedcom` néven elérhető.
- **A topola nem minden eseményt alakít át.** A `JsonIndi`-ba csak a születés
  (`BIRT`), a halál (`DEAT`) és az egyéni események (`EVEN`) kerülnek át, a
  `JsonFam`-ba csak a házasság (`MARR`). A lakóhely (`RESI`), a keresztelés
  (`BAPM`), a temetés (`BURI`) stb. hiányzik. Ezért a helyeket a nyers
  GEDCOM-ból kell kigyűjteni.
- **A diagramtípusokat a `ChartType`**
  ([chart_types.ts](../src/chart/chart_types.ts)) és a `view` URL-paraméter
  ([url_args.ts](../src/util/url_args.ts)) határozza meg. A diagramot a
  [view_page.tsx](../src/pages/view_page.tsx) `renderChart` függvénye választja
  ki. A `Donatso` példája mutatja, hogyan lehet itt a topola diagramtól eltérő
  komponenst megjeleníteni.
- **A diagramon látható személyek halmaza kiszámolható.** Ehhez a
  [generation_filter.ts](../src/util/generation_filter.ts) és a
  `getAncestors`/`getDescendants` használható a
  [gedcom_util.ts](../src/util/gedcom_util.ts)-ből.

## Felülvizsgálat egy valós tesztfájllal

A tervet a `csaladfa_20261110.ged` fájllal ellenőriztem. A fájlt Gramps 6.0.8
exportálta, GEDCOM 5.5.1 formátumú, 723 személyt és 245 családot tartalmaz. Az
elemzés helyben futott, a fájlból semmi nem került ki a gépről.

### Események és helyek

| esemény | összesen |            van helye | van dátuma | hely + dátum | van koordinátája |
| ------- | -------: | -------------------: | ---------: | -----------: | ---------------: |
| BIRT    |      668 |                  256 |        356 |          247 |               13 |
| DEAT    |      174 |                  109 |        169 |          108 |                8 |
| MARR    |      150 |                   72 |         95 |           72 |                7 |
| RESI    |       51 | 27 (+23 csak `ADDR`) |         41 |           18 |                1 |
| BAPM    |       10 |                    8 |         10 |            8 |                0 |
| EVEN    |      218 |                    4 |          5 |            4 |                0 |
| FACT    |      437 |                    0 |          0 |            0 |                0 |

### Megállapítások és a tervre gyakorolt hatásuk

1. **Jelenleg alig van koordináta.** A 101 különböző helynévből csak 6-nál van
   legalább egyszer `MAP` koordináta. Ez a 476 helyhivatkozásnak csak kb. 6%-a.
   Mivel a koordináták csak a GEDCOM-ból jöhetnek, a tesztfájllal a térkép
   eleinte majdnem üres lesz. → A nézetben jól látható helyen kell lennie egy
   **„hiányzó koordináták” listának**, gyakoriság szerint rendezve. Így látszik,
   mely helyek pótlásával lehet a legtöbbet nyerni: a tesztfájlban a
   leggyakoribb hely 78 hivatkozással szerepel, az első 10 hely pótlása a
   hivatkozások több mint felét lefedi. → A lista kimásolható legyen, hogy a
   Gramps-ban könnyű legyen végigmenni rajta.
2. **Ugyanannál a helynévnél a koordináta hol megvan, hol nincs.** Például
   „Szombathely” 14-szer szerepel, de csak néhány előfordulásánál van `MAP`. → A
   koordinátákat **helynév szerint** kell nyilvántartani: ha egy helynév bárhol
   kapott koordinátát, az minden előfordulására érvényes. Ütköző koordináta a
   tesztfájlban nincs, de ilyenkor a leggyakoribbat kell használni, és a hiányzó
   koordináták listáján jelezni kell az ütközést.
3. **A Gramps exportálja a koordinátát.** A tesztfájl 6 koordinátás helye azt
   mutatja, hogy a Gramps helyszerkesztőjében megadott szélesség és hosszúság
   `PLAC` → `MAP` formában kerül a GEDCOM-ba, `N47.229722` / `E16.618611`
   alakban. → Az értelmezőnek kezelnie kell az `N/S/E/W` előtagot és az előjeles
   számot is.
4. **Szemét és utcaszintű helynevek.** Négyszer szerepel a „,,,” helynév, ötször
   utca és házszám (például „Fő utca 105.”, „33, Felsőszenterzsébet”). → A
   normalizálás eldobja az üres tagokat, és az üres helynevű eseményt kihagyja.
   Az utcaszintű helynév külön helyként jelenik meg, amíg a Gramps-ban nem kap
   koordinátát.
5. **A lakóhelynél gyakran csak cím van.** 23 `RESI` eseménynek nincs `PLAC`-ja,
   csak `ADDR`-je, sokszor `CITY` altaggal. Az `ADDR`-nek a GEDCOM-ban nincs
   koordinátája. → Hely hiányában az `ADDR`/`CITY` legyen a helynév, és ha
   ugyanez a név máshol koordinátát kapott, azt örökli. Ha így sincs koordináta,
   a hiányzó koordináták listájára kerül.
6. **Az `EVEN` és a `FACT` itt szinte csak technikai adat.** Az `EVEN` típusai
   főleg `RIN`, `Misc` vagy időbélyegek, a `FACT`-oké mind `RIN`. → Csak a
   helyet tartalmazó eseményeket kell figyelembe venni, a hely nélküli
   `EVEN`/`FACT` kimarad.
7. **Sokféle a dátumformátum.** A leggyakoribb a pontos dátum (442) és a csak
   évszám (196), de van `EST`, `CAL`, `ABT`, `BEF`, `AFT`, `BET … AND …` és
   `FROM … TO …` is. → Az időrendi sorba rendezés évszámmal dolgozik: időszaknál
   a kezdő évvel, becsült dátumnál ugyanúgy, de **bizonytalanként** jelölve, és
   az ilyen szakasz szaggatott vonallal jelenik meg.
8. **A személyek fele nem kerülne a térképre**, mert 377 személynek egyáltalán
   nincs helye, és a helyesek nagy részénél is hiányzik a koordináta. → A
   szűrősáv mutassa, hány személy nem jelenik meg, és miért (nincs hely, illetve
   van hely, de nincs koordinátája).
9. **A személyes útvonal ritka, a nemzedékek közötti vándorlás az érdekes.** A
   helyes személyek közül 251-nek csak egy helye van, és csak 92-nek van
   legalább két dátumozott, különböző helye (legfeljebb 5). Ez is a felmenők
   vonalait támasztja alá alapértelmezésként.
10. **Erősen koncentrált helyek.** A leggyakoribb hely 78 hivatkozással
    szerepel, a következők 15–23-mal. → Egy jelölő egy hely legyen,
    darabszám-jelzéssel és a darabszámmal arányos mérettel. Csoportosításra
    (`markercluster`) a közeli helyek miatt van szükség, nem az egy helyen lévő
    sok esemény miatt.
11. **Időtáv és méret.** A helyhez kötött események 1764 és 2026 közé esnek,
    ebből jön az időcsúszka tartománya. 101 helynév és kb. 500 esemény
    teljesítmény szempontjából nem gond.

## Kialakítás

### 1. Elrendezés: új „Térkép” nézet

- Új diagramtípus: `ChartType.Map`, URL-ben `view=map`. A Nézet menüben a többi
  diagramtípus mellett jelenik meg.
- Bal oldalon homokóra-diagram (a meglévő `Chart` komponens
  `ChartType.Hourglass`-szal, ugyanazokkal a beállításokkal: színezés,
  nemzedékkorlát stb.), jobb oldalon a térkép, köztük húzható elválasztóval.
- Az oldalpanel (adatlap, beállítások) a helyén marad.
- Mobilon a két rész egymás alá kerül, vagy fülekkel lehet váltani köztük.
- A nyomtatás és a PDF/PNG/SVG export ebben a nézetben a bal oldali diagramot
  menti, a térképet nem.

### 2. Könyvtárak

- **Leaflet 1.9** és **react-leaflet 4.x**. A 4-es illik a React 18-hoz, az 5-ös
  már React 19-et kér.
- **leaflet.markercluster** a közeli jelölők csoportosításához.
- Csempék: `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, kötelező
  forrásmegjelöléssel. Az URL konfigurálható, hogy nagy forgalomnál más
  szolgáltatóra lehessen váltani. A csempék letöltésekor csak a térképrészlet
  azonosítója kerül a szerverhez, a családfa adatai nem.

### 3. Helyadatok: `src/map/places.ts`

A nyers GEDCOM-ból (`TopolaData.gedcom`) dolgozik:

- **Egyéni események:** `BIRT`, `CHR`, `BAPM`, `RESI`, `OCCU`, `EDUC`, `EMIG`,
  `IMMI`, `NATU`, `CENS`, `EVEN`, `DEAT`, `BURI`, `CREM` és a többi, amelyiknek
  van helye.
- **Családi események:** `MARR`, `DIV` stb. Ezek mindkét házastárshoz
  hozzárendelődnek.
- **A hely forrása sorrendben:** `PLAC`; ha az nincs, az `ADDR`/`CITY`; ha az
  sincs, az `ADDR` szövege.
- **Helynév-normalizálás:** a tagok szélén lévő szóközöket levágja, az üres
  tagokat eldobja, és üres eredménynél az eseményt kihagyja. Az így kapott
  szöveg a hely kulcsa.
- **Koordináta:** a `PLAC` alatti `MAP` → `LATI`/`LONG`, az `N/S/E/W` előtagok
  és az előjel kezelésével, a helynév minden előfordulására kiterjesztve.
  Ütközés esetén a leggyakoribb érték nyer.
- **Kimenet:**
  - `PlacedEvent { indiId, famId?, tag, year?, approximate, placeKey }`;
  - `Place { key, lat?, lon?, refCount, conflict }`. A koordináta nélküli helyek
    is benne vannak, ezekből készül a hiányzó koordináták listája.

### 4. Hiányzó koordináták listája: `src/map/missing_places.tsx`

- A térkép sarkában egy jelvény mutatja, hány helynek nincs koordinátája
  (például „95 hely koordináta nélkül”). Rákattintva lenyílik a lista.
- A lista gyakoriság szerint rendezett: helynév, hivatkozások száma, és hogy
  milyen eseményekben szerepel.
- A helynévre kattintva látszik, kik kapcsolódnak hozzá. Egy névre kattintva a
  diagram arra a személyre ugrik.
- A „Másolás” gomb a teljes listát szövegként a vágólapra teszi, hogy a
  Gramps-ban végig lehessen menni rajta.
- Ütköző koordinátájú hely is ide kerül, figyelmeztetéssel.

### 5. Jelölők és összekapcsolás a diagrammal

- **Egy jelölő egy helyet jelent.** A mérete a darabszámmal arányos, a színe az
  ott lévő események fő típusát mutatja (születés, halál, házasság, lakóhely,
  egyéb). A felugró ablakban az ott történt események listája látszik, például
  „születés, 1923”.
- **A diagramról a térképre:** ha a diagramon kiválasztasz valakit, a térkép
  kiemeli az ő helyeit, és odanagyít.
- **A térképről a diagramra:** a felugró ablakban egy névre kattintva a diagram
  arra a személyre ugrik (`onSelection`), shift+kattintásra pedig megnyílik az
  adatlapja (`onDetailSelection`).

### 6. Szűrők

A szűrők a térkép fölötti sávban vannak, és az URL-ben is eltárolódnak.

- **Kik szerepeljenek:** a diagramon látható személyek (alapértelmezés) vagy a
  teljes fa.
- **Eseménytípusok:** jelölőnégyzetek.
- **Időszak:** évtartomány-csúszka, a tartomány az adatokból jön. A dátum
  nélküli események egy külön kapcsolóval rejthetők el vagy mutathatók.
- **Személy vagy család:** csak a kiválasztott személy; a közvetlen családja; az
  ősei; a leszármazottai; vagy egy vezetéknév.
- **Tájékoztatás:** „N személy nem jelenik meg: X-nek nincs helye, Y helyének
  nincs koordinátája”.

### 7. Költözések: `src/map/movements.ts`

- **Megjelenítési módok** (a szűrősávban választható):
  1. **a felmenők vonalai** (alapértelmezés);
  2. a kiválasztott család: a szülők és a gyerekek személyes útvonala, tagonként
     más színnel;
  3. a kiválasztott személy útvonala;
  4. kikapcsolva.
- **Felmenők vonalai:**
  - A kiválasztott személytől felfelé, minden szülő–gyermek kapcsolatnál egy
    vonal a szülő születési helyétől a gyermek születési helyéig. Ha a szülő
    születési helyének nincs koordinátája, a szülők házasságának helyétől indul.
    Ha az sincs, a kapcsolat kimarad, de a feljebb lévő nemzedékek vonalai
    megmaradnak.
  - A szín nemzedékenként változik, és ugyanazt a színskálát használja, mint a
    diagram nemzedék szerinti színezése.
  - Ha a szülő és a gyermek ugyanott született, nincs vonal, csak a jelölő.
- **Személyes útvonal:**
  - A személy koordinátás eseményei időrendben, nyíllal ellátott vonallal
    összekötve.
  - A dátum nélküli események a típusuk alapján sorolódnak be: a születés és a
    keresztelés az elejére, a halál és a temetés a végére kerül, a többi
    kimarad.
  - Az egymást követő azonos helyek összevonódnak.
- **Bizonytalan szakaszok:** a becsült (`EST`, `CAL`, `ABT`) vagy dátum nélküli
  szakasz szaggatott vonallal jelenik meg.
- **Időbeli lejátszás (opcionális):** egy időcsúszkával vagy „lejátszás” gombbal
  a vonalak évről évre rajzolódnak ki, a jelölők pedig csak a csúszka éve előtti
  eseményeket mutatják.

## Fázisok

| fázis | tartalom                                                                                            | eredmény a tesztfájlon                                         |
| ----- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 1     | `ChartType.Map`, kétoszlopos elrendezés, Leaflet, `places.ts`, jelölők, hiányzó koordináták listája | most 6 hely (29 hivatkozás); a lista mutatja, mit kell pótolni |
| 2     | kétirányú összekapcsolás a diagrammal, szűrők                                                       |                                                                |
| 3     | felmenők vonalai, családi és személyes útvonal                                                      | a Gramps-ban pótolt koordináták arányában                      |
| 4     | időbeli lejátszás                                                                                   |                                                                |

## Érintett fájlok

- **Új mappa:** `src/map/`, benne a `map_view.tsx`, `places.ts`,
  `missing_places.tsx`, `movements.ts` és `map_filters.tsx` fájlokkal.
- [chart_types.ts](../src/chart/chart_types.ts): `ChartType.Map`.
- [view_page.tsx](../src/pages/view_page.tsx): a `renderChart`-ban a kétoszlopos
  elrendezés.
- [url_args.ts](../src/util/url_args.ts),
  [use_url_state.ts](../src/hooks/use_url_state.ts): `view=map` és a szűrők
  URL-paraméterei.
- [top_bar.tsx](../src/menu/top_bar.tsx): menüpont.
- Fordítások: `src/translations/`.

## Tesztelés

- **Egységtesztek:**
  - a `MAP`/`LATI`/`LONG` értelmezése (`N/S/E/W`, előjel, hibás érték);
  - a koordináták kiterjesztése helynév szerint, ütközés esetén is;
  - a helynév-normalizálás („,,,”, `ADDR`/`CITY` helynévként);
  - az események kigyűjtése, beleértve a JSON-ból hiányzó típusokat (`RESI`,
    `BAPM`, `BURI`);
  - a hiányzó koordináták listájának sorrendje;
  - a dátumok évszámmá alakítása a minősítőkkel (`EST`, `BET … AND …`,
    `FROM … TO …`);
  - a felmenők vonalai: hiányzó szülői hely, visszalépés a házasság helyére,
    azonos hely;
  - a személyes útvonal sorrendje, a dátum nélküli események besorolása.
- **Tesztadatok:** egy kis, anonimizált GEDCOM a `src/datasource/testdata/`
  mappában, amely a tesztfájl jellegzetes eseteit utánozza (részleges `MAP`,
  egytagú helynevek, csak `ADDR`-es `RESI`, szemét-helynév). A valódi családfa
  nem kerülhet a repóba.
- **E2E (Playwright):** a meglévő hermetikus környezettel, a csempéket
  `page.route`-tal helyettesítve.

## Korlátok

- **A térkép háttere internetet igényel.** Az egyfájlos, offline buildben a
  csempék nem töltődnek be, de a jelölők, a vonalak és a hiányzó koordináták
  listája működik, üres háttéren.
- **Az OSM csempeszerverének használati szabályai** forrásmegjelölést írnak elő,
  és tiltják a nagy forgalmat. Nyilvános, sokak által használt telepítésnél más
  csempeszolgáltató kell (konfigurálható URL).
- **A térkép nem kerül bele a nyomtatásba és a PDF/PNG/SVG exportba** az első
  körben.
- **A térkép csak annyit mutat, amennyi koordináta a GEDCOM-ban van.** A
  tesztfájlnál ez most a hivatkozások kb. 6%-a. A térkép hasznossága azon múlik,
  hogy a Gramps-ban mennyi helyhez kerül koordináta.
