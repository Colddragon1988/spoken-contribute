# Spoken-Upload – Spezifikation für die Electron/TypeScript-Neuentwicklung

Stand: Bestandsaufnahme der Python-Fassung `spoken_contribute` Version **2.1** (Commit `e14d775`, Branch `electron` = `main`).
Dieses Dokument beschreibt das Verhalten so, dass es sich ohne Zugriff auf den Python-Code nachbauen lässt. Texte in `„…“` oder in Codeblöcken sind **wörtlich** zu übernehmen. `{x}` steht für eingesetzte Werte. „…“ (U+2026) und „–“ (U+2013) sind echte Unicode-Zeichen.

> **Unverrückbare Regeln (gelten für alle, auch für Subagents):**
> 1. Echte Daten nicht anfassen, solange nicht Phase 6 erreicht ist: nicht die WoW-Installation, nicht ~/.config/spoken-contribute, nicht ~/.local/share/spoken-contribute, nicht KWallet. Tests und Probeläufe arbeiten ausschließlich in temporären Ordnern mit vorgetäuschtem Server und vorgetäuschtem Schlüsselbund.
> 2. Keine echten Uploads an spoken.rusty.one – weder in Tests noch beim Ausprobieren.
> 3. Das Passwort niemals ausgeben, loggen, in Dateien schreiben oder in Commits bringen.
> 4. Git: nur in ~/src/spoken-contribute und nur auf dem Branch „electron“ arbeiten; nie direkt auf main committen. Commits nur mit der repo-lokal eingestellten Adresse 48044372+Colddragon1988@users.noreply.github.com (Name „Chenmo“) – vor dem ersten Commit mit `git config user.email` prüfen. Niemals die private oder die Arbeits-E-Mail. Kein Force-Push, kein Löschen von Branches oder History, kein Push ohne Zustimmung.
> 5. Die Python-Fassung bleibt bis zum Schluss lauffähig erhalten; nichts davon löschen, bevor die Electron-App freigegeben ist.
> 6. Nichts mit sensiblen Daten einchecken (node_modules, Build-Ausgaben, Logs, echte Spieldaten) – .gitignore entsprechend erweitern.

---

## 1. Überblick und Module

Das Programm lädt zwei Arten von Daten aus einer lokalen World-of-Warcraft-Installation zu `https://spoken.rusty.one` hoch:

1. **Gesammelte Zeilen**: Das WoW-Addon „Spoken“ sammelt Quest-/Gesprächs- und Buchtexte ohne Vertonung in `SpokenContributions.lua`. Darin stehen „Umschläge“ (Envelopes), also Strings, die mit `!SPOKEN` beginnen. Sie werden **anonym** gesendet. Danach wird die Liste in der Datei geleert.
2. **NPC-Texte**: BroadcastText-Einträge aus dem Spiel-Cache `Cache/ADB/<Sprache>/DBCache.bin`. Sie werden **mit Anmeldung** gesendet. Danach wird der Cache gelöscht; WoW legt ihn neu an.

Alles Gesendete wird archiviert (Verlauf) und erst danach in der WoW-Installation aufgeräumt. Die beiden Teile sind unabhängig: Was fehlschlägt, bleibt liegen und geht beim nächsten Mal mit.

| Python-Datei | Aufgabe |
|---|---|
| `__init__.py` | `VERSION = "2.1"`, Modulübersicht |
| `system.py` | Betriebssystem-Spezifisches: Konfig-/Datenordner, atomares Schreiben, Ordner öffnen, WoW suchen, laufende WoW-Clients erkennen, Dunkelmodus erkennen |
| `settings.py` | `settings.json` (WoW-Ordner, Auto-Upload, Design), Anmeldung (`login.json` und Schlüsselbund) |
| `limits.py` | Lokale Zählung der Upload-Grenze (10/Stunde) in `upload-zeiten.json` |
| `theme.py` | Farbpaletten hell/dunkel und deren Anwendung auf Tk |
| `wowdata.py` | Versionsordner mit Spoken finden, `SpokenContributions.lua` lesen, decodieren, auswerten und leeren, `DBCache.bin` parsen |
| `api.py` | HTTP-Anfragen an die Website, Anmeldung, Fehlermeldungen |
| `upload.py` | Ein Upload-Durchgang (Planung, Senden, Archivieren, Leeren, Bericht); Übersicht für das Fenster |
| `history.py` | Archiv/Verlauf schreiben und lesen, Migration des alten Archivs, Detailtext, Suche, Statistik, Tageswerte |
| `gui.py` | Hauptfenster, Anmeldedialog, Verlaufsfenster (tkinter) |
| `main.py` | Startpunkt: Argumente, Aufräumen von Altlasten, Fenster oder Terminal |
| `Spoken-Upload.pyw` | Startskript (setzt `sys.path`, ruft `main(sys.argv[1:])`, Exit-Code = Rückgabe) |
| `Spoken-Upload.command` | macOS-Doppelklick: `cd "$(dirname "$0")" && exec python3 Spoken-Upload.pyw "$@"` |
| `.github/workflows/tests.yml` | CI: ubuntu/windows/macos-latest mit Python 3.13, zusätzlich ubuntu-22.04 mit Python 3.8; compileall, `unittest discover -s tests -v`; unter Linux mit `xvfb-run -a`; `PYTHONIOENCODING=utf-8`; bei Fehlern `::error`-Annotation mit dem Testprotokoll (ab der Zeile `"="*70`, max. 12000 Zeichen) |
| `.gitattributes` | `* text=auto eol=lf` (Startskripte dürfen kein CRLF bekommen) |
| `.gitignore` | `__pycache__/`, `*.pyc`, `*.tmp` |

Nebenläufigkeit in der GUI: Netzwerk, Schlüsselbund, Dateiarbeit und die Suche laufen in Hintergrund-Threads. Ergebnisse kommen über eine Warteschlange zurück (Abfrage alle 50 ms). Für Electron heißt das: Die Arbeit läuft im Main-Prozess (oder in Workern), der Renderer hängt nur über IPC daran.

---

## 2. Funktionen und Randfälle

### 2.1 Begriffe

- **WoW-Hauptordner** (`wow`): der Ordner `World of Warcraft`, der Versionsordner enthält.
- **Versionsordner** („flavor“): direkte Unterordner nach dem Muster `_*_` (z. B. `_classic_era_`, `_classic_`, `_forever_`, `_anniversary_`, `_ptr_`, `_classic_ptr_`, `_retail_`).
- **Anzeigename** (`flavor_name`): Nachschlagen des **kleingeschriebenen** Ordnernamens in

  ```
  _classic_era_  → Classic Era
  _forever_      → WoW Forever
  _classic_      → Classic
  _anniversary_  → Anniversary
  _ptr_          → PTR
  _classic_ptr_  → Classic PTR
  ```
  Unbekannte Ordner zeigen den Namen ohne führende und abschließende `_` (z. B. `_retail_` → `retail`).
- **Version mit Spoken** (`spoken_flavors(wow)`): alle `wow/_*_` (sortiert nach Pfad), für die `<flavor>/Interface/AddOns/Spoken` ein Verzeichnis ist. Versionen ohne Spoken werden ignoriert. Die Code-Begründung: Retail würde sonst mit seinen neueren Build-Nummern auf dem Server die Classic-Texte verdrängen.

### 2.2 Upload-Durchgang `run(wow, credentials, test, log)` – Reihenfolge

1. `flavors = spoken_flavors(wow)`. Ist die Liste leer, ergibt sich der Bericht
   Kopf `Keine WoW-Version mit Spoken gefunden.`, Abschnitt `Gesucht in: {wow}`, `failed=true`. Ende.
2. Laufende Clients ermitteln (§6.4). Das geschieht **auch im Testlauf**.
   - Ergebnis „unbekannt“ (`null`): Kopf `WoW läuft noch.`, Abschnitt `Welche Version, ist nicht zu erkennen – bitte das Spiel erst komplett beenden.`, failed. Ende.
   - `skipped` = Versionen, deren kleingeschriebener Ordnername in der Menge der laufenden Clients liegt. `flavors` = die übrigen.
   - Bleibt nichts übrig: Kopf `WoW läuft noch.`, Abschnitt `Bitte das Spiel erst komplett beenden: WoW schreibt die Dateien erst beim Ausloggen und würde die geleerte Liste sonst wieder überschreiben.`, failed. Ende.
3. Abschnitte des Berichts:
   - `Geprüft: {Anzeigenamen der verbleibenden Versionen, mit ", " getrennt}`
   - je übersprungener Version: `{Name}: übersprungen, läuft gerade – beim nächsten Mal nach dem Beenden dabei.`
4. Es wird **eine** Website-Sitzung (Cookie-Jar) für den ganzen Durchgang angelegt.
5. Die Teile laufen nacheinander: erst **„Gesammelte Zeilen“** (Art `zeilen`), dann **„NPC-Texte“** (Art `npc-texte`). Jeder Teil liefert `Outcome{text, sent, failed}`.
   - Wirft ein Teil eine Ausnahme, wird sie abgefangen. Die Meldung ist dann der Text der `UploadError` oder, bei anderen Ausnahmen, `{Label}: unerwarteter Fehler ({repr der Ausnahme}).`. Daraus wird das Outcome `"{Meldung}\n  Nichts gelöscht, beim nächsten Mal wird es erneut versucht."` mit failed. Außer im Testlauf wird zusätzlich ein Fehler-Eintrag in den Verlauf geschrieben: Art des Teils, `{"status":"fehler","versionen":[Anzeigenamen aller nicht übersprungenen Versionen],"fehler":Meldung}`. Scheitert auch das Schreiben, wird das ignoriert.
   - Ein Fehler in einem Teil verhindert den anderen Teil nicht.
6. Kopfzeile des Berichts:
   - Testlauf: `Testlauf – nichts gesendet, gelöscht oder archiviert.`
   - sonst bei einem Fehler: `Nicht alles hat geklappt.`
   - sonst, wenn etwas gesendet wurde: `Erfolgreich hochgeladen – danke!`
   - sonst: `Nichts Neues zum Hochladen.`
7. Gesamttext des Berichts: Kopf und alle Abschnitte, getrennt durch eine Leerzeile (`"\n\n"`). Das Feld `failed` des Berichts steuert den Exit-Code und die rote Kopfzeile.

### 2.3 Teil 1: Gesammelte Zeilen

**Einlesen** (`collect_contributions(flavors)`): Je Version, sortiert, und je Datei aus `contribution_files(flavor)`:
- Glob `<flavor>/WTF/Account/*/SavedVariables/SpokenContributions.lua*`. Gefiltert werden die Namen genau `SpokenContributions.lua` oder `SpokenContributions.lua.bak`, abgebildet auf den `.lua`-Pfad, ohne Doppelte, sortiert. **Auch eine `.bak` ohne `.lua` zählt.**
- Umschläge der Datei = `envelopes_in(lua) + envelopes_in(lua.bak)` (eine fehlende Datei liefert keine). Doppelte werden entfernt, die Reihenfolge des ersten Auftretens bleibt erhalten.
- Ergebnis: Liste von Tripeln `(flavor, lua, envelopes)`. Auch Dateien mit 0 Umschlägen sind enthalten.

**Planung** (`plan_batch`), Konstante `MAX_ENVELOPES = 2000`:
- Die Tripel werden in Reihenfolge durchlaufen. `new` = die Umschläge der Datei, die noch nicht in `seen` (global über alle Dateien) stehen.
- Enthält der Batch schon Umschläge und würde `len(batch) + len(new) > 2000` gelten, wird die Datei **zurückgestellt**: `deferred += len(new)`, weiter mit der nächsten Datei (kein Abbruch; eine spätere, kleinere Datei kann noch passen).
- Sonst kommen die Umschläge in den Batch, die Datei kommt in `files` (auch wenn `new` leer ist), und für `new ≠ []` gilt `per_flavor[Anzeigename] += len(new)`.
- Eine Datei geht **ganz oder gar nicht** mit, weil sie danach geleert wird. Die **erste** Datei mit Umschlägen geht immer mit, auch wenn sie allein über 2000 liegt; sie wird dann auf mehrere Uploads verteilt.

**Ablauf** (`upload_contributions`):
1. Ist der Batch leer: Outcome `Gesammelte Zeilen: keine neuen seit dem letzten Upload.` (weder sent noch failed). In dem Fall wird **nichts** geleert, auch keine Dateien ohne Umschläge.
2. `origin` = `"{n} aus {Name}"` je Eintrag von `per_flavor`, mit `", "` verbunden. `(kinds, titles) = summarize(batch.envelopes)` (§5.1.4).
3. `uploads = ceil(len(envelopes) / 2000)`.
4. `notes` (Hinweise, in dieser Reihenfolge):
   - wenn Titel vorhanden: `short_titles(titles)` = die ersten 10 Titel mit `", "`, bei mehr als 10 zusätzlich ` und {Rest} weitere`
   - wenn `uploads > 1`: `Mehr als 2000 Zeilen in einer Datei – sie gehen in {uploads} Uploads.`
   - wenn `deferred > 0`: `{deferred} weitere passen nicht mehr in diesen Upload (höchstens 2000) und gehen beim nächsten Mal mit.`
5. Bei **`uploads > 10`** (vor der Testlauf-Prüfung, gilt also auch im Testlauf): Outcome mit failed. Die Zeilen werden mit `"\n  "` verbunden:
   - `Gesammelte Zeilen: {kinds} bleiben liegen ({origin}).`
   - die Hinweise
   - `Das wären {uploads} Uploads, der Server nimmt aber höchstens 10 pro Stunde an – so lässt sich die Datei nicht hochladen. Sie bleibt unverändert.`
   Es gibt keinen Serverkontakt, und nichts wird verändert.
6. `free_at = limits.free_at(uploads)` (§4). Ist ein Wert gesetzt, kommt der Hinweis `Upload-Grenze erreicht (10 pro Stunde) – wieder möglich ab {HH:MM} Uhr.` hinzu.
7. **Testlauf**: Outcome `Gesammelte Zeilen: würde {kinds} senden ({origin}).` + Hinweise (mit `"\n  "` verbunden), nicht failed.
8. Ist `free_at` gesetzt (kein Testlauf): Outcome `Gesammelte Zeilen: {kinds} bleiben vorerst liegen ({origin}).` + Hinweise, failed. Der Server wird **nicht** gefragt.
9. Fortschrittsmeldung: `Gesammelte Zeilen: sende {anzahl} …`
10. **Senden** (`send_envelopes`): in Stücken zu je 2000 nacheinander `POST /api/contributions/batch` (§3.2).
    - Ein HTTP-429 ruft `limits.note_refused()` auf, dann wird der Fehler weitergeworfen.
    - Nach jeder erfolgreichen HTTP-Antwort folgt `limits.note_upload()`, **noch vor** der Prüfung von `ok`.
    - Ist `ok` falsch oder fehlt: `UploadError("Gesammelte Zeilen: unerwartete Antwort {str(result)[:200]}.")`. In Python ist das die `repr` des Dicts, z. B. `{'ok': False}`.
    - Ein Fehler in irgendeinem Stück bricht ab, und **nichts** wird archiviert oder geleert, auch wenn frühere Stücke schon angenommen wurden.
11. **Summieren** (`summed_result`), über alle Antworten:
    - `neu += accepted − known`
    - `bekannt += known`
    - `abgelehnt += refused_count(refused)`; `refused` ist eine Zahl oder ein Objekt `{Grund: Anzahl}`, dann wird die Summe der Werte genommen
    - Werte, die keine Ganzzahl sind, zählen als 0. In Python zählt `bool` als `int`; in TS nur echte Zahlen (`Number.isInteger`) zählen lassen.
12. **Archivieren** (`archive_contributions`): Eintrag der Art `zeilen` (§5.5). Scheitert das mit einem Dateifehler, folgt `UploadError("Gesammelte Zeilen: gesendet, aber nicht archiviert ({err}).")`, und **nichts wird geleert**. Der Teil gilt als failed, und `run` schreibt einen Fehler-Eintrag.
13. **Leeren** (`clear_sent`, erst jetzt: Server und Archiv haben alles), siehe 2.4. Ergebnis-Hinweis:
    - Dateifehler: `SpokenContributions.lua ließ sich nicht leeren ({err}). Die Zeilen gehen beim nächsten Mal erneut mit; der Server erkennt sie wieder.` → failed
    - einige Dateien behalten: `{k} Datei(en) haben sich während des Uploads verändert und bleiben unberührt; sie gehen beim nächsten Mal mit.` (nicht failed)
    - sonst: `Liste in SpokenContributions.lua geleert.`
14. Outcome, mit `"\n  "` verbunden, sent=true, failed nur bei Leer-Fehler:
    - `Gesammelte Zeilen: {kinds} gesendet ({origin}).`
    - `result_line`: `{neu} neu für das Projekt`, ergänzt um `, {bekannt} kannte es schon` (falls > 0) und `, {abgelehnt} nicht verwendbar` (falls > 0)
    - die Hinweise
    - der Hinweis aus dem Leeren

### 2.4 „Während des Uploads verändert“ und Leeren

`clear_contributions(files, sent)` mit `sent` = Menge **aller** Umschläge des Batches:
- Für jede `.lua` in `files` werden **`.lua` und `.lua.bak` erneut gelesen**. Ist die Menge ihrer Umschläge **keine Teilmenge** von `sent` (weil WoW inzwischen etwas hinzugeschrieben hat), bleiben beide Dateien **unberührt**, und die `.lua` kommt in die Rückgabeliste `kept`. Die Haltung dahinter: lieber einmal doppelt senden als etwas verlieren.
- Sonst:
  - Existiert die `.lua`, wird ihr Inhalt (UTF-8, fehlerhafte Bytes ersetzt) mit `cleared(text)` umgeschrieben. Geschrieben wird zuerst nach `SpokenContributions.lua.spoken-tmp`, dann ersetzt diese Datei die `.lua` atomar (rename).
  - `SpokenContributions.lua.bak` wird gelöscht (fehlt sie, ist das kein Fehler).
- Ein Dateifehler (OSError) bricht die Schleife ab und wird oben als Fehler gemeldet. Dateien, die bis dahin geleert wurden, bleiben geleert.

`cleared(text)`, der neue Dateiinhalt:
```
"\nSpokenContributionsDB = {\n" + <erhaltene Schalterzeilen je + "\n"> + "[\"Lines\"] = {\n},\n}\n"
```
Erhaltene Schalterzeilen sind alle Zeilen, die (Multiline-Modus) genau dem Muster `^(\["(?:Enabled|Introduced)"\] = (?:true|false),)\r?$` entsprechen, in Dateireihenfolge. Die geschriebene Datei hat **LF**-Zeilenenden und ist UTF-8 ohne BOM. Alle anderen Schlüssel von `SpokenContributionsDB` gehen verloren (siehe §10).

### 2.5 Teil 2: NPC-Texte

**Jobs** (`cache_jobs(flavors)`):
- Cache-Ordner: je Version `<flavor>/Cache/ADB/*` (sortiert), deren Name **genau** in dieser Liste steht: `enUS, enGB, deDE, esES, esMX, frFR, koKR, ptBR, ruRU, zhCN, zhTW`.
- Dateien: Glob `DBCache.bin*` im Ordner, sortiert. Das sind `DBCache.bin` und Zwischenstände wie `DBCache.bin1652.tmp`.
- `by_build = newest_texts(files)` (§5.2). Ist das Ergebnis leer, gibt es keinen Job.
- Texte mit `utf16len(text) > 4000` **oder** `utf16len(text1) > 4000` (`MAX_TEXT_LENGTH`) kommen in `too_long` und werden aus `by_build` entfernt. Ein Build mit dann leerer Liste bleibt als Schlüssel erhalten. Die UTF-16-Länge entspricht `string.length` in JS.
- `label` = `NPC-Texte ({Anzeigename der Version}, {Sprache})`; `count` = Summe der sendbaren Zeilen.

**Ablauf** (`upload_caches`):
1. Gibt es keine Jobs: Outcome `NPC-Texte: keine neuen im Spiel-Cache.`
2. Außer im Testlauf:
   - keine Anmeldung: `NPC-Texte: nicht angemeldet – bitte im Fenster unter „Konto“ anmelden.\n  Die Texte bleiben bis dahin im Spiel-Cache.` → failed
   - kein Passwort, weil der Schlüsselbund nichts herausgibt: `NPC-Texte: das Passwort war nicht aus dem Schlüsselbund zu holen (gesperrt oder abgelehnt?).\n  Bitte entsperren oder im Fenster ab- und neu anmelden; die Texte bleiben bis dahin im Spiel-Cache.` → failed
   - Anmeldung beim Server (§3.4). Bei 401 folgt `UploadError("NPC-Texte: Anmeldung abgelehnt – E-Mail oder Passwort stimmen nicht mehr. Bitte im Fenster ab- und neu anmelden.")`; andere Fehler werden weitergeworfen. `run` fängt sie ab (§2.2, Schritt 5).
3. Je Job (die Zeilen werden am Ende mit `"\n"` verbunden):
   - `note` (falls zu lange Texte vorhanden): `\n  {n} zu lang (über 4000 Zeichen), vom Server nicht annehmbar – sie stehen im Archiv.`
   - **Testlauf**: `{label}: würde {count} Texte senden.{login}{note}`. Dabei ist `login` = ` Anmeldung fehlt noch.`, wenn keine Anmeldung vorliegt, sonst leer. Keine Anmeldung, kein Senden.
   - Fortschrittsmeldung: `{label}: sende {count} …`
   - `info = {"versionen":[Anzeigename], "sprache":lang, "builds":[aufsteigend sortierte Builds], "anzahl":count, "zu_lang":len(too_long)}`
   - `send_cache`: Je Build (in der Reihenfolge von `by_build`) und in Paketen zu **5000** (`BROADCAST_BATCH`) wird `POST /api/broadcast-text` mit `{"lang", "build", "texts":[{id,text,text1},…]}` geschickt. Danach werden Summen über alle Antworten gebildet: `texts`, `added`, `changed` (Nicht-Ganzzahlen zählen als 0). Danach wird ein Verlaufseintrag `npc-texte` mit `{...info, "status":"ok", "ergebnis":{"neu":added,"aktualisiert":changed}}` geschrieben, Payload siehe §5.5. **Erst danach** werden alle Dateien des Jobs gelöscht (fehlende ignoriert).
   - `UploadError` (Netz/Server): Nichts wird gelöscht. Fehler-Eintrag `{"status":"fehler", ...info, "fehler":str(err)}`, Zeile `{err}\n  Der Cache bleibt liegen und geht beim nächsten Mal erneut mit.`, failed. **Die übrigen Jobs laufen weiter.**
   - Dateifehler (beim Archivieren oder Löschen; gesendet ist schon): Meldung `{label}: Dateifehler ({err}).`, Fehler-Eintrag mit dieser Meldung, Zeile `{Meldung}\n  Was vom Cache noch da ist, geht beim nächsten Mal erneut mit.`, failed, weiter.
   - Erfolg: `{label}: {texts} gesendet, {added} neu, {changed} aktualisiert. Cache gelöscht.{note}`, sent.
4. NPC-Text-Uploads werden **nicht** in der lokalen Upload-Grenze gezählt, und ein 429 hier markiert die Stunde nicht als voll.

### 2.6 Testlauf (`test=true`)

Er liest alles und prüft die laufenden Clients. Er sendet nicht, meldet sich nicht an, archiviert nicht, leert nicht und löscht nicht. Er schreibt weder Fehler-Einträge noch `upload-zeiten.json`. Über die Kommandozeile entfällt zusätzlich das Aufräumen von Altlasten (§8). Ausnahmen siehe §10.

### 2.7 Backup-Datei

Damit ist WoWs eigene Sicherung `SpokenContributions.lua.bak` (vom vorletzten Speichern) gemeint. Das Programm legt **keine eigene Sicherung** in der WoW-Installation an:
- Die `.bak` wird **mitgelesen** (Umschläge, die nur dort stehen, gehen mit).
- Sie wird **mitarchiviert** (unter `originale/`).
- Sie wird **beim Leeren gelöscht**.
- Die eigentliche Sicherung ist das Archiv `verlauf/…/originale/`, das die Dateien vor dem Leeren enthält.

### 2.8 Leere Daten

- Keine Umschläge: `Gesammelte Zeilen: keine neuen seit dem letzten Upload.`, nichts wird verändert.
- Keine NPC-Texte: `NPC-Texte: keine neuen im Spiel-Cache.`
- Beides leer: Kopf `Nichts Neues zum Hochladen.`, Exit-Code 0.
- Ein Cache, in dem alle Texte zu lang sind: Der Job existiert mit `count 0`. Es werden keine Requests geschickt, aber ein ok-Eintrag mit `anzahl 0` und `nicht_gesendet` wird angelegt, und der Cache wird gelöscht.

### 2.9 Übersicht für das Fenster (`overview(wow)`, nur lesend)

- `flavors` = alle Versionen mit Spoken; `running` = Ergebnis der Prozesserkennung.
- `idle` = leer, wenn `running == null`, sonst die Versionen, die nicht laufen.
- `lines` = Anzahl der **verschiedenen** Umschläge über alle Dateien von `idle`, ohne die 2000er-Grenze.
- `texts` = Summe von `count` aller Cache-Jobs von `idle`.
- `uploads_left = limits.remaining()` und `free_at = limits.free_at()` (needed=1).

---

## 3. Server-Protokoll

### 3.1 Allgemein

- Basis-URL: `https://spoken.rusty.one`; Registrierung: `https://spoken.rusty.one/deDE/register`.
- Alle Anfragen sind `POST` mit JSON-Body (UTF-8).
- Header jeder Anfrage:
  - `content-type: application/json`
  - `origin: https://spoken.rusty.one`
  - `user-agent: spoken-contribute/2.1 ({System})`, wobei `{System}` = `Linux` | `Windows` | `Darwin` ist (Python `platform.system()`)
- Cookies: Ein Cookie-Jar je Durchgang. Nach der Anmeldung wird das Sitzungs-Cookie bei allen weiteren Anfragen mitgeschickt. Die Sitzung lebt nur einen Durchgang und wird nicht gespeichert.
- Timeout: **120 Sekunden** je Anfrage.
- Antwortauswertung (`post(path, payload, what)`):
  - HTTP-Fehlerstatus:
    - 429: `{what}: zu viele Uploads in der letzten Stunde, bitte später erneut.`
    - 401: `{what}: nicht angemeldet (Server-Fehler 401) – bitte im Fenster ab- und neu anmelden.`
    - andere mit Detail: `{what}: Server-Fehler {code} – {detail}.`, wobei `detail` = Feld `error` oder (falls leer) `message` des JSON-Fehlerkörpers als String, höchstens 200 Zeichen
    - andere ohne Detail: `{what}: Server-Fehler {code}.`
    - Der Statuscode wird am Fehler mitgeführt (`status`).
  - Netzwerk-/Protokollfehler: `{what}: keine Verbindung zu spoken.rusty.one ({reason}).` Unter macOS wird bei `CERTIFICATE_VERIFY_FAILED` angehängt: ` – unter macOS einmal „Install Certificates.command“ im Python-Programmordner ausführen` (Python-spezifisch, in Electron entfällt das).
  - Ein Body, der kein JSON-**Objekt** ist: `{what}: unerwartete Antwort vom Server.`
- `what`-Bezeichner: `Anmeldung`, `Gesammelte Zeilen`, `NPC-Texte ({Version}, {Sprache})`.

### 3.2 `POST /api/contributions/batch` – gesammelte Zeilen (anonym)

Payload, wie ihn das Website-Formular schickt:
```json
{"envelopes": ["!SPOKEN1 quests\n…", "…"], "name": null, "email": null, "website": ""}
```
- Höchstens **2000** Envelopes je Anfrage. Envelopes sind die decodierten Strings (§5.1).
- Erwartete Antwort: `{"ok": true, "accepted": n, "known": k, "counted": n, "refused": {} | Zahl}`. `counted` wird nicht ausgewertet.
- Der Server erlaubt 10 Uploads pro Stunde je IP (laut Code-Kommentar in `saved-variables.ts` der Website).

### 3.3 `POST /api/broadcast-text` – NPC-Texte (Anmeldung nötig)

Payload:
```json
{"lang": "deDE", "build": 70003, "texts": [{"id": 1, "text": "Hallo", "text1": ""}]}
```
- Eine Anfrage je Build und je höchstens **5000** Texte. Laut Kommentar lehnt der Server mehr als 20 000 Texte als Ganzes ab und verwirft Texte über 4000 UTF-16-Einheiten stillschweigend.
- Texte mit `text` oder `text1` über 4000 UTF-16-Einheiten werden **nicht gesendet**, aber im Archiv unter `nicht_gesendet` gespeichert.
- Erwartete Antwort: `{"texts": n, "added": a, "changed": c}`.

### 3.4 `POST /api/auth/sign-in/email` – Anmeldung

- Payload `{"email": "...", "password": "..."}`. Der `origin`-Header ist nötig (CSRF-Schutz des Auth-Systems).
- Antwort `{"user": {...}}`; der Server setzt das Sitzungs-Cookie über `Set-Cookie`. Ist `user` kein Objekt, gilt `{}` (kein Fehler).
- Fehler 401 im Anmeldedialog: `Anmeldung abgelehnt – E-Mail oder Passwort stimmen nicht.`
- Fehler 401 beim Upload: `NPC-Texte: Anmeldung abgelehnt – E-Mail oder Passwort stimmen nicht mehr. Bitte im Fenster ab- und neu anmelden.`
- Andere Fehler: die allgemeinen Meldungen mit `what = "Anmeldung"`.
- Das Passwort darf nie geloggt werden, auch nicht in Fehlermeldungen oder Debug-Ausgaben des HTTP-Clients.

---

## 4. Upload-Limit (nur gesammelte Zeilen)

- Konstanten: `PER_HOUR = 10`, `WINDOW = 1 Stunde`.
- Datei: `<Datenordner>/upload-zeiten.json`, ein JSON-Array von ISO-8601-Zeitpunkten mit Zeitzonen-Offset, Sekundengenauigkeit, z. B. `["2026-10-25T14:03:12+01:00", …]`. Geschrieben wird mit `json.dumps` ohne Einrückung, also `["…", "…"]`, atomar.
- **Laden**: Unlesbare Datei, kein Array, Elemente, die keine gültigen Zeitstrings sind, und Zeitpunkte **ohne** Zeitzone werden übergangen. Alle Zeitpunkte werden in Ortszeit umgerechnet.
- **`recent()`**: Zeitpunkte mit `jetzt − 1h < t ≤ jetzt`, aufsteigend sortiert. **Zeitpunkte in der Zukunft zählen nicht**, damit eine zurückgestellte Uhr nicht weit länger als eine Stunde sperrt.
- **`remaining()`** = `max(10 − len(recent), 0)`.
- **`free_at(needed=1)`**: `must_expire = len(recent) + min(needed, 10) − 10`. Ist der Wert ≤ 0, gibt es kein Ergebnis (`null`, sofort möglich). Sonst gilt `recent[must_expire − 1] + 1h` in Ortszeit.
- **Gezählt** (`note_upload`): nach **jeder** erfolgreichen HTTP-Antwort auf `/api/contributions/batch`, also je 2000er-Paket. Gespeichert wird `recent() + [jetzt]`; abgelaufene und zukünftige Einträge fallen dabei weg (Bereinigung).
- **429** (`note_refused`): `recent()` wird auf 10 Einträge mit `jetzt` aufgefüllt; die Stunde gilt ab jetzt als voll.
- Schreibfehler werden still ignoriert (der Server prüft die Grenze ohnehin selbst).
- Uploads über die Website kennt das Programm nicht. Ein 429 holt das nach.
- Anzeige im Fenster (§7.2): `Upload-Grenze erreicht (10 pro Stunde) – gesammelte Zeilen wieder ab {HH:MM} Uhr.` oder `Noch {n} von 10 Uploads in dieser Stunde frei.` (nur wenn n < 10).
- Im Bericht: `Upload-Grenze erreicht (10 pro Stunde) – wieder möglich ab {HH:MM} Uhr.`

---

## 5. Dateiformate

### 5.1 `SpokenContributions.lua` (SavedVariables)

Pfad: `<WoW>/<flavor>/WTF/Account/<Account>/SavedVariables/SpokenContributions.lua` und `.lua.bak` daneben.

Typischer Aufbau (wie die Tests ihn erzeugen; WoW schreibt unter Windows/Wine mit CRLF):
```
<leer>
SpokenContributionsDB = {
["Enabled"] = true,
["Lines"] = {
{
["key"] = "k0",
["envelope"] = "!SPOKEN1 quests\nquest=1\n…",
},
},
["Introduced"] = false,
}
```

#### 5.1.1 Parser-Regeln (kein echter Lua-Parser)

- Die Datei wird als **Bytes** gelesen; eine fehlende Datei ergibt keine Umschläge.
- Alle String-Literale werden mit dem Byte-Regex `"((?:[^"\\]|\\[\s\S])*)"` gefunden (von links, ohne Überlappung).
- Ein Literal ist ein Umschlag, wenn sein **roher** (noch escapter) Inhalt mit den Bytes `!SPOKEN` beginnt.
- Der Inhalt wird mit `decode_lua` entschlüsselt. Reihenfolge wie in der Datei, Doppelte bleiben (Deduplizierung erst später).
- Lua-Kommentare und Langstrings `[[…]]` werden nicht beachtet.

#### 5.1.2 `decode_lua(bytes) → string` (wie `decodeLuaString` der Website)

Byteweise:
- Kein Backslash: Byte übernehmen.
- Backslash + 1–3 Dezimalziffern: ein Byte mit Wert `zahl & 0xFF` (so ergibt `\999` den Wert 231).
- Backslash + CR LF: LF (10).
- Backslash + einfache Escapes: `n`→10, `r`→13, `t`→9, `a`→7, `b`→8, `f`→12, `v`→11, `\`→92, `"`→34, `'`→39, LF→10.
- Sonst (z. B. `\x`, `\z`, `\u`, ein einzelnes CR, Backslash am Ende): Der Backslash bleibt stehen, das folgende Zeichen wird normal weiterverarbeitet.
- Am Ende werden die Bytes als **UTF-8** decodiert; ungültige Folgen werden durch U+FFFD ersetzt. In Node `TextDecoder('utf-8', {fatal:false})`; die Anzahl der Ersatzzeichen kann zwischen Python und WHATWG abweichen, siehe §10.
- Beispiele (Tests):
  - `a\nb\"c\\d\065\228` → `a⏎b"c\dA�`
  - `x\⏎(CRLF)y` → `x⏎y`
  - `\195\164` → `ä`

#### 5.1.3 Umschlag-Format (`parse_envelope`)

- Zeilen werden an `\n` getrennt.
- Die erste Zeile ist der Kopf `!SPOKEN1 <source>`. `source` = Text nach dem ersten Leerzeichen, sonst `?`.
- Die übrigen Zeilen:
  - Endet eine Zeile auf `<<`, ist sie ein Blockfeld: Schlüssel = Zeile ohne `<<`, Wert = die folgenden Zeilen bis zu einer Zeile, die genau `>>` lautet, mit `\n` verbunden.
  - Enthält eine Zeile ein `=`, ist sie ein einfaches Feld; geteilt wird am **ersten** `=`.
  - Bei doppelten Schlüsseln gewinnt der **erste** Eintrag.
- Typische Felder: `quest`, `event` (`detail|progress|complete|greeting|gossip`), `npc` („276 Name“), `title` (Quests) oder `book` (Bücher), `text` (Block), `sum`.
- Beispiel aus den Tests:
  ```
  !SPOKEN1 quests\nquest=5\nevent=progress\nnpc=5 Händler 5\ntitle=Quest 5\ntext<<\nText 5 …\n>>\nsum=5\n
  ```

#### 5.1.4 `summarize(envelopes) → (kinds, titles)`

- Zählung je `source` in der Reihenfolge des ersten Auftretens.
- Bezeichnungen: `quests` → `Quest- und Gesprächszeilen`, `books` → `Buchseiten`, `readables` → `Buchseiten`, sonst der Rohname.
- `kinds` = `"{n} {Bezeichnung}"` mit `", "` verbunden, z. B. `1 Quest- und Gesprächszeilen, 1 Buchseiten`.
- `titles` = `title` oder (falls leer) `book` jedes Umschlags, ohne Doppelte, in Reihenfolge.

#### 5.1.5 Leeren

Siehe §2.4.

### 5.2 `DBCache.bin` (ADB-Cache der NPC-Texte)

Pfad: `<WoW>/<flavor>/Cache/ADB/<Sprache>/DBCache.bin`, dazu Zwischenstände `DBCache.bin*` (z. B. `DBCache.bin1652.tmp`). Alle Ganzzahlen sind uint32 little-endian.

- **Dateikopf**, 44 Byte:
  - Offset 0: `MAGIC = 0x48544658` (Bytes `XFTH`)
  - Offset 8: Build-Nummer
  - Rest wird ignoriert
- **Einträge** ab Offset 44, je 32 Byte Kopf + `size` Byte Daten:
  - +0: MAGIC
  - +4 … +15: ignoriert
  - +16: Tabellen-Hash
  - +20: Zeilen-ID
  - +24: `size`
  - +28: Status
- Parser:
  - Datei fehlt, ist kürzer als 44 Byte oder der Kopf-MAGIC fehlt: `(0, {})`.
  - Schleife, solange `pos + 32 ≤ Länge`:
    - MAGIC am Eintrag fehlt: **Abbruch** (abgebrochenes Schreiben; alles davor gilt).
    - Datenende `> Länge`: Abbruch.
    - Tabelle `≠ 0x021826BB` (BroadcastText) oder Status `≠ 1`: Eintrag überspringen.
    - Daten: zwei nullterminierte UTF-8-Texte (`text` = männlich, `text1` = weiblich; Ersatzzeichen bei Fehlern). Fehlt einer der beiden Nullterminatoren innerhalb der Daten: überspringen.
    - Sind beide Texte leer: überspringen.
    - Sonst `texts[id] = {id, text, text1}`. Spätere Einträge derselben ID überschreiben frühere; die Position in der Einfügereihenfolge bleibt.
- **`newest_texts(files)`**: Dateien in sortierter Reihenfolge. Je ID gewinnt der Eintrag mit **Build ≥** dem bisherigen (bei Gleichstand die spätere Datei). Ergebnis `{build: [rows]}`; die Zeilen behalten die Reihenfolge des ersten Auftretens ihrer ID, die Builds die Reihenfolge ihres ersten Auftretens. (JS-`Map` verhält sich genauso.)
- Behandlung: Nach erfolgreichem Senden und Archivieren werden **alle** `DBCache.bin*`-Dateien des Sprachordners gelöscht.

### 5.3 `settings.json` (Konfig-Ordner)

```json
{
  "wow_dir": "/home/x/Games/…/World of Warcraft",
  "auto_upload": false,
  "theme": "system"
}
```
- Geschrieben wird mit 2 Leerzeichen Einrückung, `ensure_ascii=false` (UTF-8 direkt), atomar.
- Laden:
  - `wow_dir` = String des Werts oder `""`.
  - `auto_upload` ist nur bei exakt `true` wahr.
  - `theme` muss einer von `system|hell|dunkel` sein, sonst `system`.
  - Eine kaputte oder fehlende Datei oder ein Inhalt, der kein Objekt ist, ergibt die Standardwerte.
- Ist `wow_dir` leer, wird **WoW gesucht** (§6.2). Bei einem Fund wird **sofort gespeichert**; ein Schreibfehler wird ignoriert.
- Designbezeichnungen: `system` → `Wie System`, `hell` → `Hell`, `dunkel` → `Dunkel`.

### 5.4 `login.json` (Konfig-Ordner, privat)

- `{"email": "a@b.c"}`, oder zusätzlich `"password"`, wenn kein Schlüsselbund verfügbar ist.
- Kompaktes JSON mit Python-Trennzeichen `", "` und `": "`, UTF-8.
- Unter POSIX: Datei `0600`, Ordner beim Anlegen `0700`.
- Siehe §6.6.

### 5.5 Verlauf (Daten-Ordner `verlauf/`)

**Ordnername**: `verlauf/<YYYY-MM-DD_HH-MM-SS>_<art>`, wobei `art` ∈ {`zeilen`, `npc-texte`} und die Zeit lokal ist. Gibt es den Ordner schon (gleiche Sekunde), folgen `…_<art>-2`, `-3` … Angelegt wird mit exklusivem `mkdir`.

**Schreibreihenfolge**:
1. Ordner anlegen.
2. `daten.json.gz` (falls Payload).
3. `originale/` (Kopien mit erhaltenem Zeitstempel).
4. **Zuletzt** `eintrag.json` (atomar über `eintrag.json.tmp`).

Ein Ordner ohne `eintrag.json` gilt als abgebrochen und erscheint nicht. Nichts wird automatisch gelöscht.

**`eintrag.json`**:
- 2 Leerzeichen Einrückung, UTF-8 ohne `\u`-Escapes.
- Schlüsselreihenfolge: `zeit`, `art`, dann die übrigen.
- `zeit`: ISO-8601 mit Offset, Sekunden (z. B. `2026-10-25T14:03:12+01:00`).

| Fall | Felder nach `zeit`, `art` |
|---|---|
| Zeilen, ok | `status:"ok"`, `versionen:[Anzeigenamen aus per_flavor]`, `anzahl`, `zusammenfassung` (kinds), `titel:[…]`, `ergebnis:{neu,bekannt,abgelehnt}` |
| NPC-Texte, ok | `versionen:[Name]`, `sprache`, `builds:[int…]`, `anzahl`, `zu_lang`, `status:"ok"`, `ergebnis:{neu,aktualisiert}` |
| NPC-Texte, Fehler im Job | `status:"fehler"`, `versionen`, `sprache`, `builds`, `anzahl`, `zu_lang`, `fehler` |
| Teil-Fehler aus `run` | `status:"fehler"`, `versionen:[alle geprüften Versionen]`, `fehler` |
| Migriert | `status:"ok"`, `versionen`, `anzahl`, `zusammenfassung`, `titel`, `hinweis:"Aus dem Archiv des früheren Skripts übernommen; die Antwort des Servers wurde damals nicht gespeichert."` (kein `ergebnis`) |

**`daten.json.gz`**: gzip, UTF-8-JSON, Einrückung 1, `ensure_ascii=false`.
- Zeilen: `{"gesendet": {"envelopes":[…], "name":null, "email":null, "website":""}, "antwort": <Objekt bei 1 Upload | Liste bei mehreren>}`
- NPC-Texte: `{"gesendet": [ {lang, build, texts}, … ], "antwort": [ … ], "nicht_gesendet": [ {id,text,text1}, … ]}`
- Migriert: `{"gesendet": {"envelopes": […]}}`
- Fehler-Einträge haben keine `daten.json.gz`.

**`originale/`** (nur bei Zeilen): `originale/<flavor ohne _>/<Account>/SpokenContributions.lua` und `.lua.bak`, soweit vorhanden. Beispiel: `originale/classic_era/ACC/SpokenContributions.lua`. Der Account ist der Ordner zwei Ebenen über der Datei, der Flavor der Ordner vier Ebenen darüber.

**Lesen** (`entries()`):
- Alle `verlauf/*/eintrag.json`. Übersprungen werden unlesbare Dateien, Inhalte, die kein Objekt sind, Einträge ohne `zeit` und nicht parsebare Zeiten.
- Eine Zeit **ohne** Zeitzone gilt als Ortszeit.
- Sortierung absteigend nach (Zeit, Ordnername); bei gleicher Sekunde steht also `…-2` vor `…`.
- `failed` ⇔ `status != "ok"`.
- Payload: gzip-JSON lesen; ein Fehler ergibt „keine Payload“.

**Migration des alten Archivs** (`migrate_old_archive`, beim Start außer bei `--test`):
- Dateien im Datenordner, deren Name ganz auf `(\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d)_(.+)_(SpokenContributions\.lua(?:\.bak)?)` passt.
- Gruppiert nach Zeitstempel, aufsteigend. Ein unmöglicher Zeitpunkt (z. B. Monat 13) lässt die Gruppe liegen.
- Je Gruppe:
  - Gruppe 2 wird am **letzten** `_` geteilt in Version und Account. Ist die Version leer, gilt `classic_era`.
  - Anzeigename über `_{version}_`.
  - Umschläge aller Dateien werden zusammengeführt und dedupliziert.
  - Ein `zeilen`-Eintrag mit `when` = Zeitstempel (lokal); Originale unter `{version}/{account}/{dateiname}`.
  - **Danach** werden die alten Dateien gelöscht.

### 5.6 Detailtext, Tabelle, Summen, Suche, Statistik

**Ergebniskurztext** (`result_text`):
- nicht ok: `Fehlgeschlagen`
- kein `ergebnis`: `gesendet (Antwort nicht gespeichert)`
- sonst `{neu} neu`, ergänzt um `, {bekannt} schon bekannt`, `, {aktualisiert} aktualisiert`, `, {abgelehnt} nicht verwendbar` (jeweils nur wenn > 0)

**Tabellenzeile**:
- Zeit `dd.mm.YYYY  HH:MM` (zwei Leerzeichen)
- Art (`Gesammelte Zeilen` | `NPC-Texte` | `?`)
- Version (`versionen` mit `", "`, plus ` ({sprache})` falls vorhanden)
- Anzahl (oder leer)
- Ergebnis

**Summenzeile** (`totals`):
- `{ok} Uploads: {Zeilen-Anzahl} gesammelte Zeilen und {Text-Anzahl} NPC-Texte`
- wenn irgendein ok-Eintrag ein `ergebnis` hat: `, davon {Σneu} neu für das Projekt`
- wenn es Fehlschläge gibt: ` · {n} fehlgeschlagen`

**Details** (`details`), Zeilen mit `\n`:
1. `{Art} – {dd.mm.YYYY um HH:MM:SS}` (Überschrift)
2. `Version: {Versionstext oder ?}`
3. falls vorhanden: `Inhalt: {zusammenfassung}`
4. bei Fehler: `Fehlgeschlagen: {fehler oder ?}` und `Gelöscht wurde dabei nichts; die Daten gingen beim nächsten Upload erneut mit.`; sonst `Ergebnis: {result_text}`
5. falls `zu_lang`: `{n} Texte waren länger als der Server annimmt; sie stehen unten unter „Nicht gesendet“.`
6. falls vorhanden: `hinweis`
7. falls Payload vorhanden: Leerzeile, `Gesendet:`, dann:
   - **Zeilen**: je Umschlag
     - `\n• {title|book|(ohne Titel)}   ({meta})`. `meta` = mit ` · ` verbunden und ohne leere Teile: Quellname (`quests`→`Quest`, `books`/`readables`→`Buch`, sonst roh), Ereignis (`detail`→`Annahme`, `progress`→`Fortschritt`, `complete`→`Abschluss`, `greeting`→`Begrüßung`, `gossip`→`Gespräch`, sonst roh), NPC ohne führende Zahl und Leerraum (`^\d+\s+`).
     - Darunter der Text: Feld `text`, sonst der längste Feldwert mit Zeilenumbruch. HTML-Tags `<[^>]*>` werden entfernt. Jede nicht leere Zeile wird getrimmt und mit 4 Leerzeichen eingerückt.
   - **NPC-Texte**: je Paket
     - `\nSprache {lang}, Build {build} – {n} Texte:`
     - je Text `#{id}  {text oder text1}`; sind beide gesetzt und verschieden, zusätzlich `        weiblich: {text1}`. Zeilenumbrüche in Texten werden mit 8 Leerzeichen eingerückt.
     - Am Ende, falls vorhanden: `\nNicht gesendet (zu lang für den Server) – {n} Texte:` und die Einträge `#{id}  {text oder text1}`.

**Suche**:
- Suchtext je Eintrag = `details(entry)` in Kleinschreibung (Python `casefold`, siehe §10).
- Treffer, wenn die getrimmte, kleingeschriebene Anfrage als Teilstring enthalten ist.
- Gesucht wird in allem, was die Details zeigen, einschließlich Payload.

**Statistik** (`statistics`, nur aus `eintrag.json`):
- Fehlgeschlagene Einträge erhöhen nur `failed`.
- ok-Einträge zählen in `uploads`, `first` und `last`.
- Bei `zeilen`: `lines += anzahl`, `lines_new += neu`, `lines_known += bekannt`.
- Bei anderen Arten: `texts += anzahl`, `texts_new += neu`, `texts_changed += aktualisiert`.
- `per_version[v] = [Zeilen, Texte]` je Version (ohne Versionen: `?`).

**Tageswerte** (`daily(found, 30)`): die letzten 30 Kalendertage bis heute (lokal), aufsteigend. Je Tag `(Tag, Zeilen-Anzahl, Text-Anzahl)` aus ok-Einträgen.

---

## 6. Plattformlogik

### 6.1 Konfig- und Datenordner (App-Name `spoken-contribute`)

| OS | Konfig (`settings.json`, `login.json`) | Daten (`upload-zeiten.json`, `verlauf/`, Alt-Archiv) |
|---|---|---|
| Windows | `%APPDATA%\spoken-contribute` (Fallback `~/AppData/Roaming`) | `%LOCALAPPDATA%\spoken-contribute` (Fallback `~/AppData/Local`) |
| macOS | `~/Library/Application Support/spoken-contribute` | **derselbe Ordner** |
| Linux | `$XDG_CONFIG_HOME/spoken-contribute` (Fallback `~/.config`) | `$XDG_DATA_HOME/spoken-contribute` (Fallback `~/.local/share`) |

Die Electron-App muss dieselben Pfade benutzen, damit Einstellungen und Verlauf übernommen werden. Electrons eigenes `userData` darf **nicht** auf diesen Ordner zeigen (siehe §10).

**Atomares Schreiben** (`write_file`):
- Elternordner anlegen (privat mit `0700`).
- Nach `<datei>.tmp` schreiben (privat mit `0600`), flush, **fsync**.
- Bei privaten Dateien unter POSIX explizit `chmod 0600`.
- Dann `rename` über die Zieldatei.

**Ordner öffnen**: Windows `startfile`, macOS `open`, Linux `xdg-open`. In Electron `shell.openPath`.

### 6.2 WoW-Suche (`find_wow`)

- **Kandidaten**:
  - **Windows**: zuerst Registry `HKLM\SOFTWARE\WOW6432Node\Blizzard Entertainment\World of Warcraft`, Wert `InstallPath` (meist ein Versionsordner wie `…\_retail_\`). Dann für die vorhandenen Laufwerke `C:` … `J:` jeweils `<LW>\{Program Files (x86) | Program Files | Games | Spiele | (Wurzel)}\World of Warcraft`.
  - **macOS**: `/Applications/World of Warcraft`, `~/Applications/World of Warcraft`.
  - **Linux**: für jedes Wine-Präfix `<präfix>/drive_c/{Program Files (x86) | Program Files}/World of Warcraft`. Präfixe (ohne Doppelte, Reihenfolge erhalten):
    1. `$WINEPREFIX` (falls gesetzt), dann je Muster unter `~` sortierte Glob-Treffer:
    2. `Games/*`
    3. `.wine`
    4. `.local/share/wineprefixes/*`
    5. `.local/share/lutris/prefixes/*`
    6. `.local/share/bottles/bottles/*`
    7. `.var/app/com.usebottles.bottles/data/bottles/bottles/*`
    8. `.steam/steam/steamapps/compatdata/*/pfx`
    9. `.local/share/Steam/steamapps/compatdata/*/pfx`
    10. `.var/app/com.valvesoftware.Steam/.local/share/Steam/steamapps/compatdata/*/pfx`
- Je Kandidat werden **er selbst und sein Elternordner** geprüft (`is_wow_root`, ohne Doppelte).
- Rückgabe: der erste Fund, in dem ein `_*_/Interface/AddOns/Spoken` existiert, sonst der erste Fund überhaupt, sonst nichts.
- **`is_wow_root(path)`**: Es gibt einen Unterordner `_*_`, der ein Verzeichnis ist und `WTF`, `Interface` oder `.flavor.info` enthält. Dateisystemfehler ergeben `false`.
- **`wow_root(path)`** (nach manueller Wahl): Geprüft werden der Pfad selbst, `path/World of Warcraft`, dann alle Elternordner aufwärts; der erste WoW-Hauptordner gewinnt, sonst nichts. Das Fenster speichert dann die Eingabe unverändert.

### 6.3 WoW-Versionen

Siehe §2.1. Es gibt keine fest verdrahtete Liste erlaubter Versionen: Jeder `_*_`-Ordner mit Spoken wird verarbeitet, auch `_retail_`, falls Spoken dort installiert ist (siehe §10).

### 6.4 Laufende Clients (`running_flavors() → Set | null`)

- **Prozessliste**, nur die Programmpfade ohne Argumente:
  - Windows: `powershell -NoProfile -NonInteractive -Command "Get-CimInstance Win32_Process | ForEach-Object { if ($_.ExecutablePath) { $_.ExecutablePath } else { $_.Name } }"` (ohne Konsolenfenster, Timeout 30 s)
  - macOS: `ps -axo comm=`
  - Linux: je `/proc/<pid>/cmdline` das erste NUL-getrennte Argument. Unter Wine steht dort der Windows-Pfad, z. B. `Z:\home\…\_forever_\Wow.exe`.
  - Ausgabezeilen werden getrimmt, leere verworfen. Fehler oder ein fehlendes Programm ergeben eine leere Liste.
- **Spiel-Erkennung** (Regex, ohne Groß/Klein-Unterscheidung): `(?:^|[\\/])(wow[a-z0-9-]*\.exe|World of Warcraft[^/]*\.app/Contents/MacOS/[^/]+)$`. Ein Treffer, dessen Gruppe 1 `voiceproxy` oder `launcher` enthält, ist **nicht** das Spiel.
- **Versionsordner**: alle Treffer von `[\\/](_[a-z0-9_]+_)(?=[\\/])` (ohne Groß/Klein-Unterscheidung); der **letzte** zählt, kleingeschrieben.
- Ist ein Spielprozess ohne Versionsordner im Pfad dabei, ergibt sich **sofort `null`** („WoW läuft, Version unbekannt“).
- Erwartete Ergebnisse (Test):

| Programm | Ergebnis |
|---|---|
| `C:\Program Files (x86)\World of Warcraft\_classic_era_\WoWClassic.exe` | `{_classic_era_}` |
| `Z:\home\x\Games\World of Warcraft\_forever_\Wow.exe` | `{_forever_}` |
| `/Applications/World of Warcraft/_classic_era_/World of Warcraft Classic.app/Contents/MacOS/World of Warcraft Classic` | `{_classic_era_}` |
| `…\_retail_\WowVoiceProxy.exe` | `{}` |
| `…/World of Warcraft Launcher.app/Contents/MacOS/World of Warcraft Launcher` | `{}` |
| `/usr/bin/kate` | `{}` |
| `Wow.exe` | `null` |

### 6.5 Dunkelmodus-Erkennung

- Windows: `HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize\AppsUseLightTheme == 0` bedeutet dunkel.
- macOS: Die Ausgabe von `defaults read -g AppleInterfaceStyle` ist genau `Dark` (Timeout 3 s).
- Linux: zuerst `gdbus call --session --dest org.freedesktop.portal.Desktop --object-path /org/freedesktop/portal/desktop --method org.freedesktop.portal.Settings.Read org.freedesktop.appearance color-scheme`; enthält die erste Zeile `uint32 1`, ist das dunkel. Gibt es keine Antwort: `gsettings get org.gnome.desktop.interface color-scheme` enthält `dark`. Timeout jeweils 3 s.
- Die GUI prüft bei `Wie System` **alle 10 s** im Hintergrund nach. In Electron ersetzbar durch `nativeTheme.shouldUseDarkColors` und das Ereignis `updated` (siehe §10).

### 6.6 Schlüsselbund und Anmeldung

- Python-Paket `keyring`, Dienstname **`spoken-contribute`**, Konto = **E-Mail-Adresse**. Benutzbar nur, wenn das Backend eine `priority > 0` hat; sonst wird der Fallback benutzt. Mögliche Backends: Windows Credential Manager, macOS Keychain, KWallet, Secret Service (GNOME).
- **Grundsatz**: Das Passwort steht immer an mindestens einer Stelle. Aus `login.json` verschwindet es erst, wenn es nachweislich im Schlüsselbund steht (geschrieben, wieder gelesen und verglichen).
- `account()` = `email` aus `login.json`, wenn es ein nicht leerer String ist. Der Schlüsselbund wird dafür **nicht** geöffnet.
- `password_in_keyring()` = angemeldet **und** kein Passwort in `login.json`. Es wird nur aus der Datei abgeleitet.
- `credentials()`:
  - nicht angemeldet: `null`
  - sonst `{email, password}`, wobei `password` = Passwort aus der Datei, sonst aus dem Schlüsselbund, sonst `null` (gesperrt, abgelehnt, Eintrag fehlt)
  - Kann eine Entsperr-Abfrage auslösen, darf also nicht den UI-Thread blockieren.
- `save_login(email, pw)`:
  - Gelingt das verifizierte Schreiben in den Schlüsselbund: `login.json = {"email"}`, sonst `{"email","password"}`.
  - War vorher ein **anderes** Konto angemeldet, wird dessen Schlüsselbund-Eintrag gelöscht.
- `move_password_to_keyring()` (beim Start außer bei `--test`): Steht ein Passwort in `login.json` und gelingt das verifizierte Schreiben, wird `login.json = {"email"}`. Ein Schreibfehler von `login.json` wird weitergeworfen; das Passwort steht dann an beiden Stellen.
- `delete_login() → bool`:
  - Nicht angemeldet: `login.json` löschen, `true`.
  - Sonst wird der Schlüsselbund-Eintrag immer zu löschen versucht (auch wenn das Passwort in der Datei steht) und `login.json` gelöscht.
  - Ergebnis `false` nur, wenn das Passwort im Schlüsselbund lag **und** nicht nachweislich entfernt ist (Probe: `get` liefert nichts; jeder Fehler gilt als nicht entfernt). Abgemeldet ist man trotzdem.
- **Anzeige der Schutzart**:
  - `Das Passwort liegt im Schlüsselbund des Systems. …`
  - `Das Passwort liegt in einer Datei, die nur du lesen kannst (kein Schlüsselbund gefunden). …`

---

## 7. Oberfläche

### 7.1 Themes

| Rolle | Hell | Dunkel |
|---|---|---|
| background | `#f2f2f2` | `#1e1f22` |
| field | `#ffffff` | `#2b2d31` |
| text | `#1f1f1f` | `#e3e3e3` |
| muted | `#666666` | `#9a9a9a` |
| border | `#c3c3c3` | `#45474d` |
| button | `#e4e4e4` | `#35373c` |
| button_active | `#d6d6d6` | `#43454b` |
| selection | `#3d6fb4` | `#3f5f8f` |
| selection_text | `#ffffff` | `#ffffff` |
| error | `#b3261e` | `#ff8a80` |
| link | `#1a5fb4` | `#8ab4f8` |
| match (Suchtreffer) | `#ffe28a` | `#6b5a1e` |
| chart_lines | `#3d6fb4` | `#6f9fe0` |
| chart_texts | `#d9822b` | `#f0a050` |

- Einstellung `system` → je nach Systemerkennung Dunkel oder Hell; `dunkel` → Dunkel; sonst Hell.
- Alle Fenster, Klapplisten (Test!), Textfelder, Tabellen und das Diagramm folgen einem Wechsel sofort.
- Unter Windows wird die Titelleiste mit eingefärbt (DWM-Attribut 20); in Electron über `nativeTheme.themeSource`.
- Eine verspätete Antwort zu einer inzwischen geänderten Einstellung wird verworfen (Test).

### 7.2 Hauptfenster

- Titel `Spoken – Beiträge hochladen`, 700×600, Minimum 580×480. Schließen ist gesperrt, solange ein Upload läuft.
- Unerwartete Fehler zeigen einen Dialog `Unerwarteter Fehler:\n\n{repr}`.

Aufbau von oben nach unten:

1. **Rahmen „World of Warcraft“**
   - Eingabefeld mit dem WoW-Pfad. Die Eingabetaste übernimmt den Pfad (`set_wow`).
   - Knopf `Ändern …`: Ordnerdialog mit Titel `Ordner „World of Warcraft“ wählen`. Startordner ist der aktuelle Pfad, falls er existiert, sonst das Home-Verzeichnis.
   - Knopf `Suchen`: Status `Suche …`, Suche im Hintergrund. Wurde das Feld inzwischen geändert, wird das Ergebnis ignoriert. Bei einem Fund folgt `set_wow`, sonst (rot) `Kein World of Warcraft gefunden – bitte über „Ändern …“ auswählen.`
   - `set_wow(text)`: Text trimmen, `~` auflösen, `wow_root(...)` oder die Eingabe selbst ins Feld und in `settings.json` schreiben, dann Statusaktualisierung.
   - **Statuszeile** (mehrzeilig, umbrechend):
     - Der Pfad ist kein WoW-Hauptordner (rot): `Hier liegt kein World of Warcraft – bitte über „Ändern …“ oder „Suchen“ den Ordner „World of Warcraft“ wählen.`
     - sonst `Prüfe …`, dann die Übersicht im Hintergrund (veraltete Ergebnisse für einen anderen Pfad werden verworfen)
     - Fehler (rot): `Fehler beim Prüfen: {error}`
     - keine Version mit Spoken (rot): `Spoken ist in keiner WoW-Version in diesem Ordner installiert.`
     - sonst Zeile 1: `Spoken in: {Namen, ", "}`; laufende Versionen (oder alle, wenn `running == null`) mit dem Zusatz ` (läuft gerade)`
     - Zeile 2 bei `running == null`: `Ein WoW läuft, aber welche Version, ist nicht zu erkennen – bitte erst beenden.`
     - sonst Zeile 2: `Bereit: {X}`, wobei X = `{n} gesammelte Zeilen` und/oder `{m} NPC-Texte` (mit ` und ` verbunden), sonst `nichts Neues`. Laufen Versionen, wird angehängt: ` (ohne {laufende Namen} – wird beim Upload übersprungen)`
     - Zeile 3 (§4): `Upload-Grenze erreicht (10 pro Stunde) – gesammelte Zeilen wieder ab {HH:MM} Uhr.` oder `Noch {n} von 10 Uploads in dieser Stunde frei.`
2. **Rahmen „Konto bei spoken.rusty.one“**
   - Text links, Knopf rechts, darunter ein kleiner, gedämpfter Hinweis.
   - Angemeldet:
     - Text `Angemeldet als {email}`, Knopf `Abmelden`
     - Hinweis `Das Passwort liegt {im Schlüsselbund des Systems | in einer Datei, die nur du lesen kannst (kein Schlüsselbund gefunden)}. Die Anmeldung ist nur für die NPC-Texte nötig – die gesammelten Zeilen gehen anonym hoch.`
   - Nicht angemeldet:
     - Text `Nicht angemeldet`, Knopf `Anmelden …`
     - Hinweis `Nur für die NPC-Texte aus dem Spiel-Cache nötig – die gesammelten Zeilen gehen anonym hoch.`
   - Abmelden:
     - Ja/Nein-Dialog mit Titel `Abmelden` und Text `Die Anmeldung von diesem Rechner löschen (auch aus dem Schlüsselbund)?\n\nOhne Anmeldung bleiben die NPC-Texte im Spiel-Cache liegen, bis du dich wieder anmeldest.`
     - Bei Ja im Hintergrund `delete_login`, danach die Anzeige auffrischen.
     - Fehler: `Abmelden ist fehlgeschlagen ({error}).`
     - Ergebnis `false` (Warnung): `Abgemeldet – aber der Schlüsselbund war gesperrt oder nicht erreichbar, das Passwort steht womöglich noch darin (Eintrag „spoken-contribute“). Es lässt sich dort von Hand löschen.`
3. **Optionszeile**
   - Kästchen `Beim Start automatisch hochladen` (wird sofort gespeichert).
   - Rechts `Design:` und eine Auswahl `Wie System | Hell | Dunkel` (wird sofort gespeichert und angewendet).
4. **Rahmen „Ergebnis“**
   - Schreibgeschütztes Textfeld mit Bildlauf.
   - Anfangstext (gedämpft): `„Jetzt hochladen“ sendet alles, was bereitliegt; „Testlauf“ zeigt nur, was gesendet würde.`
5. **Knopfleiste**
   - `Verlauf …` öffnet das Verlaufsfenster (nur eine Instanz; ist es offen, wird es nach vorn geholt).
   - `Testlauf`
   - unbestimmter Fortschrittsbalken (120 px, nur während eines Uploads sichtbar)
   - `Jetzt hochladen` (Standardknopf)
   - `Schließen`

**Upload im Fenster**:
- Läuft schon einer, passiert nichts. Sonst werden beide Upload-Knöpfe gesperrt und der Fortschritt gezeigt.
- Text gedämpft: `Testlauf …` bzw. `Lade hoch …`. Die Fortschrittsmeldungen werden gedämpft angehängt.
- Die Zugangsdaten werden **erst im Hintergrund** geholt.
- Am Ende wird der Text ersetzt: Kopfzeile fett (rot bei failed), dann `\n` + Abschnitte mit `\n\n` + `\n`. Ansicht an den Anfang, Übersicht und Verlauf auffrischen.
- Unerwarteter Fehler: Kopf `Unerwarteter Fehler.`, Abschnitte `{repr}` und `Was nicht hochgeladen wurde, bleibt liegen und geht beim nächsten Mal mit.`, failed.
- Schließen während eines Uploads: Info `Der Upload läuft noch – bitte kurz warten.`
- `save_settings`-Fehler: `Die Einstellungen ließen sich nicht speichern ({err}). Sie gelten nur bis zum Schließen.`
- **Automatischer Upload**: Ist `auto_upload` gesetzt, startet 300 ms nach dem Öffnen des Fensters ein echter Upload (nur im Fenstermodus).

### 7.3 Anmeldedialog

- Titel `Bei spoken.rusty.one anmelden`, modal, feste Größe, mittig über dem Hauptfenster.
- Intro: `Die Anmeldung bleibt auf diesem Rechner: das Passwort im Schlüsselbund des Systems (ohne Schlüsselbund in einer Datei, die nur du lesen kannst), die E-Mail-Adresse in den Einstellungen.`
- Felder: `E-Mail` und `Passwort` (maskiert mit `•`), Kästchen `Passwort anzeigen`, Meldungszeile.
- Link `Noch kein Konto? Auf spoken.rusty.one registrieren` öffnet die Registrierungs-URL im Browser.
- Knöpfe `Abbrechen` und `Anmelden` (Standard). Die Eingabetaste meldet an, Escape schließt.
- Absenden:
  - Ist die Prüfung bereits im Gang, wird ignoriert.
  - E-Mail (getrimmt) oder Passwort leer: rot `Bitte E-Mail und Passwort eingeben.`
  - Sonst wird gesperrt und `Prüfe die Anmeldung …` angezeigt. Im Hintergrund: Anmeldung beim Server, **dann** `save_login`.
  - Fehler: Text der `UploadError` oder `Unerwarteter Fehler: {repr}`, rot; der Knopf wird wieder freigegeben.
  - Erfolg: Konto-Anzeige auffrischen, Dialog schließen.
  - Wurde der Dialog inzwischen geschlossen, wird nur die Konto-Anzeige aufgefrischt.

### 7.4 Verlaufsfenster

- Titel `Spoken – Verlauf der Uploads`, 900×640, Minimum 640×440, nicht modal. Escape schließt; beim Schließen wird eine laufende Suche abgebrochen.
- **Filterzeile**:
  - `Suchen:` Eingabefeld; 250 ms nach dem letzten Tastendruck wird gefiltert.
  - `Art:` Auswahl `Alle | Gesammelte Zeilen | NPC-Texte | Fehlgeschlagen`.
  - `Version:` Auswahl `Alle` + sortierte, eindeutige Werte aller `versionen`. Ist der gewählte Wert nach dem Neuladen weg, wird auf `Alle` zurückgesetzt.
  - Darunter die gedämpfte Summenzeile.
- **Filterlogik**:
  - `Fehlgeschlagen` zeigt nur fehlgeschlagene Einträge.
  - `Gesammelte Zeilen`/`NPC-Texte` zeigen die passende `art` **und** nur ok-Einträge.
  - Version muss in `versionen` enthalten sein.
  - Art und Version filtern sofort. Ist eine Suchanfrage gesetzt, läuft die Suche im Hintergrund; eine überholte Suche bricht ab bzw. wird verworfen.
  - Summenzeile während der Suche `Suche …`, bei Fehler `Suche fehlgeschlagen: {error}`.
  - Sonst: `Noch keine Uploads archiviert.` bzw. `Keine Uploads passen zu Suche und Filter.` bzw. `totals(...)`, beim Filtern ergänzt um `   (gefiltert: {x} von {y})`.
  - Für die Suche gibt es einen Cache der Suchtexte mit höchstens 30 000 000 Zeichen insgesamt; was nicht hineinpasst, wird bei jeder Suche neu gelesen.
- **Seite „Uploads“**:
  - Tabelle mit den Spalten Zeitpunkt (150), Art (150), Version (170), Anzahl (70, rechtsbündig), Ergebnis (220, dehnbar). Fehlgeschlagene Zeilen in der Fehlerfarbe; Einzelauswahl.
  - Darunter, in einem vertikal teilbaren Bereich (Gewichtung 1:2), der Detailtext: Überschrift fett, Rest normal.
  - Nach dem Filtern wird der **erste Eintrag automatisch gewählt**. Ist nichts zu sehen, ist der Detailtext leer und `Ordner dieses Uploads öffnen` gesperrt.
  - Suchtreffer im Detailtext werden ohne Groß/Klein-Unterscheidung hervorgehoben, **höchstens 1000** (Test). Die Ansicht springt zum ersten Treffer.
- **Seite „Statistik“**:
  - Textfeld mit der Überschrift `Statistik`, beim Filtern ` (gefiltert)`, und den Zeilen:
    - `{uploads} Uploads`, bei Fehlschlägen ergänzt um `, {failed} fehlgeschlagen`, dann ` – vom {dd.mm.YYYY} bis {dd.mm.YYYY}` (falls es Uploads gibt)
    - `Gesammelte Zeilen: {lines} gesendet, {lines_new} neu für das Projekt, {lines_known} schon bekannt`
    - `NPC-Texte: {texts} gesendet, {texts_new} neu, {texts_changed} aktualisiert`
    - je Version, alphabetisch: `    {Version}: {Zeilen} Zeilen, {Texte} NPC-Texte`
  - **Diagramm** (220 px hoch), gestapelte Balken je Tag für die letzten 30 Tage:
    - Titel `Gesendet pro Tag, letzte 30 Tage`
    - Legende rechts: `Gesammelte Zeilen` (chart_lines), `NPC-Texte` (chart_texts)
    - Grundlinie in der Rahmenfarbe; Skala `0` und, falls Maximum > 0, der Maximalwert oben
    - Balkenbreite 70 % des Tagesabstands; Zeilen unten, Texte darüber
    - Datumsbeschriftung `dd.mm.` an jedem 5. Tag und am letzten Tag
    - Neu gezeichnet bei Größen- und Designwechsel; nichts zeichnen, wenn die Fläche kleiner als 100×80 ist
  - Statistik und Diagramm gelten für die **gefilterten** Einträge.
- **Knöpfe**:
  - `Ordner dieses Uploads öffnen`
  - `Archiv öffnen` (legt `verlauf/` bei Bedarf an)
  - `Schließen`
  - Fehler beim Öffnen: `Der Ordner ließ sich nicht öffnen ({err}):\n\n{path}`
- Nach jedem Upload wird ein offenes Verlaufsfenster neu geladen. Der Suchcache bleibt dabei erhalten, weil Einträge sich nach dem Schreiben nicht mehr ändern.

---

## 8. Kommandozeile

Aufruf: `Spoken-Upload.pyw [--test | --ohne-fenster]`. Hilfetext (`USAGE`, auf stdout):
```
Aufruf: Spoken-Upload.pyw [--test | --ohne-fenster]
  (ohne)          Fenster öffnen
  --test          im Terminal zeigen, was gesendet würde – nichts wird gesendet oder gelöscht
  --ohne-fenster  im Terminal hochladen, z. B. für einen Zeitplan
```

1. Ist ein Argument nicht `--test` oder `--ohne-fenster`, wird USAGE ausgegeben. Exit **0**, wenn `-h` oder `--help` unter den Argumenten ist, sonst **2**. Kombinationen wie `--test --help` ergeben ebenfalls 0.
2. `test = "--test" in args`; mit beiden Schaltern gewinnt also der Testlauf.
3. Ohne `--test` werden die Altlasten aufgeräumt (§5.5 Migration, §6.6 Passwort-Umzug). Fehler gehen auf stderr:
   - `Altes Archiv nicht übernommen: {err}`
   - `Passwort nicht in den Schlüsselbund umgezogen: {err}`
4. Mit Argumenten läuft es im Terminal:
   - Die Ausgabe ersetzt nicht darstellbare Zeichen (Windows-Codepages).
   - Einstellungen laden; das kann eine WoW-Suche mit anschließendem Speichern auslösen.
   - Kein `wow_dir`: `Kein WoW-Ordner gefunden – bitte einmal im Fenster auswählen.`, Exit **1**.
   - Sonst läuft der Durchgang mit `credentials()`; die Fortschrittsmeldungen gehen zeilenweise auf stdout, danach der Berichtstext. Exit **1**, wenn failed, sonst **0**.
5. Ohne Argumente öffnet sich das Fenster (Exit 0 nach dem Schließen). Fehlt tkinter, steht auf stderr:
   ```
   Für das Fenster fehlt tkinter ({err}).
   Debian/Ubuntu: sudo apt install python3-tk · Fedora: sudo dnf install python3-tkinter
   Ohne Fenster geht es mit --ohne-fenster.
   ```
   Exit 1 (Python-spezifisch).
6. Ein automatischer Upload beim Start passiert **nur im Fenster** und nur bei `auto_upload: true` (§7.2).

---

## 9. Testkatalog (57 Tests)

Gemeinsame Testumgebung `tests/helpers.py`:
- **`Sandbox`**: Temp-Ordner für Konfig und Daten; Schlüsselbund aus; `running_flavors` steuerbar; `find_wow` liefert nichts; `Site.post` → `FakeServer`.
- **`FakeServer`**:
  - Für Login: `{"user":{"email"}}`.
  - Für Batch: `{"ok":true,"accepted":n,"known":1,"counted":n,"refused":{}}`.
  - Für Texte: `{"texts":n,"added":n,"changed":0}`.
  - `fail` legt Fehler je Aufruf fest; `on_post` ist ein Haken vor jeder Antwort.
- **`FakeKeyring`**: `priority 1`; `locked` lässt jeden Zugriff scheitern; `delete` eines fehlenden Eintrags wirft einen Fehler.
- Erzeuger:
  - `envelope(n, source, text)`
  - `contributions_lua(envs, crlf=True, flags=True)`
  - `dbcache(build, rows, status=1, table=BroadcastText)`; der Kopf besteht aus `XFTH`, `1`, Build und 32 Null-Bytes, jeder Eintrag aus `XFTH` + 7 uint32 + Daten (mit 8 Füll-Bytes).

| Test | Sichert |
|---|---|
| test_upload::Contributions::test_success_sends_archives_and_clears | Ein Upload sendet genau die Envelopes, leert die .lua, archiviert Payload, Ergebnis `{neu:2,bekannt:1,abgelehnt:0}` und die Originaldatei unter `originale/classic_era/ACC/`; ein zweiter Lauf meldet „Nichts Neues zum Hochladen.“ |
| test_upload::Contributions::test_server_error_keeps_everything | Bei einem Serverfehler bleibt die Datei unverändert, und im Verlauf steht ein Fehler-Eintrag. |
| test_upload::Contributions::test_more_than_2000_lines_go_in_several_uploads | Eine Datei mit 2500 eindeutigen Envelopes (aus .lua und .bak zusammengeführt) geht in zwei Uploads [2000, 500] und wird danach geleert. |
| test_upload::Contributions::test_failure_in_second_upload_clears_nothing | Scheitert das zweite Paket, wird nichts geleert (alle 2500 bleiben). |
| test_upload::Contributions::test_lines_added_during_upload_are_kept | Schreibt das Spiel während des Uploads einen neuen Umschlag, bleibt die Datei unberührt, und der Bericht enthält „verändert“. |
| test_upload::Contributions::test_file_needing_more_uploads_than_an_hour_allows_stays_untouched | Bräuchte eine Datei mehr als 10 Uploads, gibt es keinen Serverkontakt, failed, „nicht hochladen“ im Bericht und die Datei bleibt unverändert. |
| test_upload::Contributions::test_archive_failure_clears_nothing | Scheitert das Archivieren, gilt failed mit „nicht archiviert“, und die Datei wird nicht geleert. |
| test_upload::Contributions::test_dry_run_changes_nothing | Der Testlauf sagt „würde“, ruft den Server nicht, schreibt keinen Verlauf und lässt die Datei unverändert. |
| test_upload::RateLimit::test_uploads_are_counted | Ein gelungener Zeilen-Upload senkt `remaining()` um 1. |
| test_upload::RateLimit::test_full_hour_blocks_without_asking_the_server | Bei voller Stunde wird nicht gesendet; der Bericht enthält „Upload-Grenze erreicht“, die Datei bleibt, `free_at()` ist gesetzt. |
| test_upload::RateLimit::test_429_marks_the_hour_as_full | Ein 429 setzt `remaining()` auf 0. |
| test_upload::RateLimit::test_old_uploads_expire | Zeitpunkte, die älter als 1 h sind, zählen nicht. |
| test_upload::UploadTimes::test_broken_entries_are_skipped | Kaputte Datei, Objekt statt Liste, Zahlen/null, Zeitpunkte ohne Zeitzone und ungültige Strings werden übergangen; gültige zählen. |
| test_upload::UploadTimes::test_times_in_the_future_do_not_block | Zeitpunkte in der Zukunft sperren nicht. |
| test_upload::UploadTimes::test_free_at_counts_from_the_oldest_uploads | `free_at(1)` = ältester + 1 h, `free_at(3)` = drittältester + 1 h (Sekundengenauigkeit). |
| test_upload::UploadTimes::test_free_at_with_more_than_an_hour_of_uploads | Bei `needed > 10` gibt es keinen Absturz; mit Einträgen ist das Ergebnis gesetzt, ohne Einträge `null`. |
| test_upload::UploadTimes::test_free_at_is_in_local_time | Zeitpunkte aus einer anderen Zeitzone werden in Ortszeit geliefert. |
| test_upload::NpcTexts::test_success_archives_and_deletes_cache | Reihenfolge Login → Texte → Texte; Caches werden gelöscht; der zu lange Text wird nicht gesendet, steht aber als `zu_lang: 1` und in `nicht_gesendet` im Archiv. |
| test_upload::NpcTexts::test_failure_in_one_version_keeps_its_cache | Ein Fehler bei einer Version lässt nur deren Cache liegen; der andere wird gelöscht. |
| test_upload::NpcTexts::test_not_logged_in_keeps_cache | Ohne Anmeldung „nicht angemeldet“, der Cache bleibt. |
| test_upload::NpcTexts::test_password_missing_from_keyring_keeps_cache | Ohne Passwort Hinweis auf den „Schlüsselbund“, der Cache bleibt. |
| test_upload::NpcTexts::test_rejected_login | Ein Login-401 führt zu „ab- und neu anmelden“, der Cache bleibt. |
| test_upload::RunningGame::test_running_version_is_skipped | Eine laufende Version wird übersprungen (Text „Classic Era: übersprungen“); nur die andere wird gesendet, die Datei der laufenden bleibt. |
| test_upload::RunningGame::test_unknown_running_version_stops | Ist die laufende Version unbekannt, gilt failed und es gibt keinen Serverkontakt. |
| test_upload::RunningGame::test_overview_leaves_out_running_versions | Die Übersicht zählt nur Zeilen nicht laufender Versionen, listet aber alle Versionen. |
| test_wowdata::DecodeLua::test_escapes | Escapes, `\ddd`, ungültiges UTF-8 als U+FFFD, Backslash vor CRLF. |
| test_wowdata::DecodeLua::test_utf8_bytes_as_decimal_escapes | `\195\164` ergibt „ä“. |
| test_wowdata::Contributions::test_envelopes_survive_the_lua_file_bit_exact | Envelopes (auch Bücher, mit Zeilenumbrüchen und literalem `\n`) kommen bitgenau zurück. |
| test_wowdata::Contributions::test_lua_and_bak_are_merged_without_duplicates | .lua und .bak werden ohne Doppelte in Reihenfolge zusammengeführt. |
| test_wowdata::Contributions::test_bak_without_lua_counts | Eine .bak ohne .lua wird gelesen. |
| test_wowdata::Contributions::test_clearing_keeps_flags_with_crlf | Das Leeren erhält `["Enabled"] = true,` und `["Introduced"] = false,` auch bei CRLF, die Liste ist leer, die .bak gelöscht. |
| test_wowdata::Contributions::test_file_with_unsent_lines_is_not_cleared | Eine Datei mit nicht gesendetem Umschlag bleibt unverändert und wird zurückgemeldet. |
| test_wowdata::Contributions::test_parse_envelope_and_summary | Feldzerlegung sowie `summarize`-Text und Titel. |
| test_wowdata::Cache::test_reads_only_live_broadcast_texts | Nur BroadcastText mit Status 1; Build aus dem Kopf; text/text1. |
| test_wowdata::Cache::test_broken_files_do_not_crash | Leere, kaputte, abgeschnittene Dateien und Kopf ohne Einträge führen zu keinem Absturz. |
| test_wowdata::Cache::test_newest_build_wins | Über Hauptdatei und .tmp gewinnt je ID der neueste Build; Gruppierung je Build. |
| test_history_settings_system::History::test_entries_newest_first_with_search_and_statistics | Sortierung neueste zuerst, Suche in der Payload (Zeilen und NPC-Texte), Statistik und Tageswerte. |
| test_history_settings_system::History::test_entry_without_time_zone_or_broken_is_still_sortable | Eine Zeit ohne Zeitzone wird als Ortszeit sortiert; Liste statt Objekt und fehlende Zeit werden ignoriert. |
| test_history_settings_system::History::test_old_archive_is_migrated | Eine alte Sicherung wird zum Verlaufseintrag, die alte Datei gelöscht. |
| test_history_settings_system::History::test_old_archive_with_impossible_time_stays_put | Ein unmöglicher Zeitstempel bleibt liegen; der gültige wird migriert. |
| test_history_settings_system::Login::test_without_keyring_the_password_is_in_a_private_file | Ohne Schlüsselbund steht das Passwort in `login.json` mit Modus 0600. |
| test_history_settings_system::Login::test_with_keyring_the_file_has_no_password | Mit Schlüsselbund ist die Datei ohne Passwort; Abmelden räumt beides. |
| test_history_settings_system::Login::test_old_password_moves_into_keyring | Ein Passwort aus der Datei zieht in den Schlüsselbund um. |
| test_history_settings_system::Login::test_password_stays_in_file_while_keyring_is_locked | Ist der Schlüsselbund gesperrt, bleibt das Passwort in der Datei. |
| test_history_settings_system::Login::test_password_stays_in_file_when_keyring_loses_it | Meldet der Schlüsselbund Erfolg ohne zu speichern, bleibt das Passwort in der Datei (Verifikation). |
| test_history_settings_system::Login::test_password_survives_when_login_file_cannot_be_rewritten | Ist `login.json` nicht schreibbar, wird der Fehler geworfen und das Passwort bleibt in der Datei. |
| test_history_settings_system::Login::test_logout_with_locked_keyring_reports_the_leftover | Bei gesperrtem Schlüsselbund liefert Abmelden `false`, abgemeldet ist man trotzdem. |
| test_history_settings_system::Login::test_logout_without_keyring_entry_is_clean | Abmelden mit Passwort in der Datei: `true`, Datei weg. |
| test_history_settings_system::Login::test_new_account_replaces_the_old_keyring_entry | Bei Kontowechsel wird der alte Schlüsselbund-Eintrag gelöscht. |
| test_history_settings_system::Login::test_locked_keyring_gives_no_password | Fehlt der Eintrag, ist `password` gleich `null`. |
| test_history_settings_system::CommandLine::test_test_run_changes_nothing | `--test` migriert nicht und zieht kein Passwort um; ohne WoW-Ordner Exit 1. |
| test_history_settings_system::CommandLine::test_unknown_argument | Unbekanntes Argument → 2, `--help` → 0. |
| test_history_settings_system::RunningGame::test_paths_of_all_systems | Prozesspfade aller Systeme → Versionsmenge, leere Menge oder `null` (Tabelle §6.4). |
| test_history_settings_system::WowFolder::test_wow_root_from_inside_and_above | `wow_root` von innen und von oben; ein leerer Ordner liefert nichts. |
| test_gui::Window::test_late_answer_for_an_old_theme_setting_is_ignored | Eine verspätete Theme-Antwort zu einer alten Einstellung wird verworfen. |
| test_gui::Window::test_dropdown_list_follows_the_theme | Klapplisten im Verlaufsfenster folgen dem Designwechsel. |
| test_gui::Window::test_search_finds_text_in_the_sent_data | Die Suche im Hintergrund findet Text in 3000 NPC-Texten; Hervorhebung ist auf 1000 Treffer begrenzt. |

---

## 10. Auffälligkeiten, Widersprüche, Unklarheiten (vor der Neuentwicklung klären)

**Abweichungen zwischen Auftrag und Code**
1. **Reihenfolge**: Der Auftrag nennt „Lesen → Archivieren → Senden → Leeren“. Der Code macht **Lesen → Senden → Archivieren → Leeren** (bei NPC-Texten: Senden → Archivieren → Löschen). Archiviert wird erst nach dem Senden, weil die Serverantwort mit ins Archiv kommt. Welche Reihenfolge soll gelten?
2. **„WDB-Cache“**: Der Code liest den **ADB**-Cache `Cache/ADB/<Sprache>/DBCache.bin`, nicht `Cache/WDB`.
3. **„Backup-Datei“**: Es gibt keine eigene Sicherung im WoW-Ordner. Gemeint ist WoWs `.bak`; sie wird gelesen, archiviert und gelöscht. Die Sicherung ist `verlauf/…/originale/`.
4. **`_retail_`**: Der Name ist nicht in der Namenstabelle (Anzeige „retail“) und wird **nicht** ausdrücklich ausgeschlossen, nur indirekt, solange dort kein Spoken installiert ist. Soll Retail ausdrücklich gesperrt werden?
5. **„10 Uploads pro Stunde“**: Das gilt nur für `/api/contributions/batch` und wird je 2000er-Paket gezählt. NPC-Text-Uploads und Logins werden nicht gezählt; ein 429 bei NPC-Texten markiert nichts.

**Mögliche Fehler oder Datenrisiken im Python-Code (nicht 1:1 übernehmen, erst entscheiden)**
6. **Schalter-Regex ohne Einrückung**: `cleared()` erhält `["Enabled"]`/`["Introduced"]` nur bei Zeilen **ohne führende Leerzeichen oder Tabs**. Schreibt WoW verschachtelte Schlüssel eingerückt (oft mit Tabs), gehen die Schalter beim Leeren verloren. Die Testdaten sind ohne Einrückung. Das sollte in Phase 6 lesend an einer Kopie einer echten Datei geprüft werden. Zudem gehen **alle anderen** Schlüssel von `SpokenContributionsDB` verloren.
7. **Teil-Upload nicht archiviert**: Werden mehrere Pakete gesendet (Zeilen > 2000 oder NPC-Texte > 5000 bzw. mehrere Builds) und scheitert ein späteres Paket, sind die früheren angenommen, aber **nicht archiviert**. Der Fehler-Eintrag hat keine Payload, und sie gehen beim nächsten Mal erneut mit.
8. `note_upload()` zählt einen Upload auch dann, wenn die Antwort `ok:false` ist. Das ist vermutlich gewollt, weil der Server ihn trotzdem zählt.
9. **`--test` nicht völlig ohne Schreiben**: `settings.load()` schreibt `settings.json`, wenn `wow_dir` leer ist und WoW gefunden wird. Der Test patcht `find_wow` weg und deckt das deshalb nicht ab. Außerdem endet `--test` mit Exit 1, wenn eine Datei mehr als 10 Uploads bräuchte (failed vor der Testlauf-Prüfung).
10. Bei einem Dateifehler beim Löschen des Caches nach erfolgreichem Archivieren entstehen **zwei** Einträge (ok und fehler) für denselben Cache.
11. In `summarize` werden `books` und `readables` getrennt gezählt, aber gleich beschriftet. Das kann „2 Buchseiten, 1 Buchseiten“ ergeben.
12. `password_in_keyring()` prüft den Schlüsselbund nicht. Die Anzeige sagt „im Schlüsselbund“, auch wenn der Eintrag dort fehlt (das zeigt sich erst beim Upload).
13. Fehlermeldungen enthalten Python-`repr`s (`{err!r}`, `str(dict)`) und Python-OSError-Texte („[Errno 28] …“). In TS entsprechend `String(err)`/`JSON.stringify` verwenden. Sie wörtlich nachzubilden ist weder möglich noch nötig.
14. Bei der Alt-Migration wird am **letzten** `_` geteilt. Ein Account-Name mit `_` würde falsch aufgeteilt (Altlast, geringe Relevanz).

**Plattform- und Electron-Fragen**
15. **Kompatibilität des Schlüsselbunds**: Python-`keyring` legt je OS anders ab:
    - Secret Service: Attribute `service`/`username`, Label/Anwendung „Python keyring library“
    - KWallet: Ordner = Dienst, Schlüssel = Konto
    - Windows: Target = Dienst oder `konto@dienst`
    - macOS: generic password `service`/`account`

    `keytar` (veraltet) und Electron `safeStorage` (verschlüsselt nur, speichert nicht) sind nicht deckungsgleich. Zu entscheiden: (a) Bestehende Einträge lesen können (z. B. `secret-tool`/`kwallet-query` bzw. ein Modul mit gleichem Schema) oder (b) eine neue Anmeldung verlangen und den alten Eintrag zum Löschen anbieten. Der Fallback „Passwort in `login.json` (0600)“ samt Anzeige muss erhalten bleiben. Den Schlüsselbund nur in Tests mit Fake ansprechen (Regel 1).
16. **Electron-`userData`**: Unter Linux wäre der Standard `~/.config/<appName>`. Heißt die App `spoken-contribute`, legt Electron Cache, GPUCache, Local Storage usw. **in den Konfig-Ordner** der Python-Fassung. Daher `app.setPath('userData', …)` auf einen eigenen Ordner setzen (z. B. `spoken-upload-electron`) und die Fachdateien über eigene Pfadlogik (§6.1) ansprechen.
17. **Dunkelmodus**: `nativeTheme.shouldUseDarkColors` erkennt unter Linux/KDE das Portal je nach Electron-Version nicht zuverlässig. Die Portal/gsettings-Abfrage als Fallback beibehalten oder testen.
18. **Kleinschreibung bei der Suche**: Python `casefold` bildet `ß`→`ss` ab; JS `toLowerCase` tut das nicht. Für gleiches Verhalten Anfrage und Text gleich normalisieren (z. B. `toLowerCase()` + `ß`→`ss`). Beide Seiten müssen dieselbe Funktion nutzen.
19. **UTF-8-Ersatzzeichen**: Python (`errors="replace"`) und WHATWG-`TextDecoder` können bei kaputten Folgen eine unterschiedliche Anzahl U+FFFD erzeugen. Für die Envelopes ist das egal, solange **dieselbe** Funktion beim Lesen und beim Vergleich (`clear_contributions`) benutzt wird.
20. **JSON-Ausgabe**: Python sendet Nicht-ASCII als `\uXXXX` und mit `", "`-Trennern, Node schreibt UTF-8 kompakt. Für den Server ist das gleichwertig. Für Archivdateien (`eintrag.json` mit Einrückung 2, `daten.json.gz` mit Einrückung 1) muss die Lesbarkeit beider Fassungen gegenseitig gewährleistet sein (gleiches Schema, Reihenfolge egal).
21. **Zeitstempel**: ISO mit Offset und **Sekunden** schreiben (`2026-10-25T14:03:12+01:00`, nicht `…Z` mit Millisekunden), damit die Python-Fassung (3.8 `fromisoformat` ist strikt) die Dateien weiter lesen kann, solange beide parallel laufen (Regel 5).
22. **Gleichzeitiger Betrieb**: Laufen Python- und Electron-Fassung parallel auf denselben Dateien, gibt es keine Sperre. Wie soll das in Phase 6 gehandhabt werden?
23. **Testbarkeit**: Die Python-Module berechnen Pfade beim Import (`ROOT`, `FILE`, `SETTINGS`), die Tests patchen sie. In TS alle Pfade, die Prozessliste, den Schlüsselbund, den HTTP-Client und die Uhr per Dependency Injection übergeben, damit Tests nie echte Pfade berühren können.
24. **`.gitignore`**: für Electron ergänzen um `node_modules/`, `dist/`, `out/`, `release/`, `coverage/`, `*.log`, `.vite/`, `*.tsbuildinfo` sowie Testartefakte.
25. **CI**: Der Workflow kennt nur Python. Für Electron einen eigenen Job ergänzen (Node, Windows/macOS/Linux, xvfb für UI-Tests); den Python-Job unverändert lassen (Regel 5).

---

## 11. Entscheidungen zu Abschnitt 10 (verbindlich für die Electron-Fassung)

Grundsatz: Verhalten 1:1 wie die Python-Fassung. Abweichungen nur, wo sonst Daten verloren gehen
könnten oder der Testlauf etwas verändern würde. Jede Abweichung ist hier aufgeführt und in der
Gegenprobe (Phase 4) als begründeter Unterschied dokumentiert.

| Nr. | Entscheidung |
|----|----|
| 1 | Reihenfolge wie im Code: Lesen → Senden → Archivieren → Leeren/Löschen. Unverrückbar: Es wird nie etwas geleert oder gelöscht, bevor der Server bestätigt **und** das Archiv vollständig geschrieben ist. |
| 2 | NPC-Cache wie im Code: `Cache/ADB/<Sprache>/DBCache.bin`. Der Begriff „WDB“ im Auftrag ist damit gemeint. |
| 3 | `.bak` wie im Code (lesen, archivieren, löschen); Sicherung ist `verlauf/…/originale/`. |
| 4 | `_retail_` wie im Code (keine zusätzliche Sperre). |
| 5 | Limit wie im Code: nur Zeilen-Uploads, je 2000er-Paket gezählt. |
| 6 | **Abweichung:** Die Erkennung von `["Enabled"]`/`["Introduced"]` beim Leeren erlaubt führende Leerzeichen/Tabs. Grund: sonst möglicher Verlust der Schalter. Bei nicht eingerückten Dateien ist das Ergebnis identisch. |
| 7 | Wie im Code (früher angenommene Pakete eines teilweise gescheiterten Uploads werden beim nächsten Mal erneut gesendet). Kein Datenverlust; als bekannte Eigenheit dokumentiert. |
| 8 | Wie im Code. |
| 9 | **Abweichung:** `--test` schreibt nichts, auch nicht `settings.json` (gefundener WoW-Ordner wird nur im Speicher benutzt). Exit-Code wie im Code. |
| 10, 11 | Wie im Code. |
| 12 | Electron prüft tatsächlich, ob das gespeicherte, verschlüsselte Passwort vorhanden und entschlüsselbar ist, bevor „im Schlüsselbund“ angezeigt wird. |
| 13 | Fehlertexte sinngemäß gleich, Fehlerdetails mit `String(err)`. |
| 14 | Wie im Code. |
| 15 | Passwort neu: Electron `safeStorage`, verschlüsselter Wert base64 in eigener Datei `passwort.safestorage` (Rechte 0600) im Konfig-Ordner; `login.json` behält Schema (E-Mail, ggf. Fallback-Passwort). Unter Linux bei Backend `basic_text` ehrliche Anzeige „nur durch Dateirechte geschützt“. Übernahme aus KWallet/`login.json` einmalig in Phase 6; der alte Eintrag bleibt bestehen, damit die Python-Fassung lauffähig bleibt. |
| 16 | `app.setPath('userData', …)` auf eigenen Ordner `spoken-upload-electron` (Linux `~/.config/spoken-upload-electron`, sonst analog), nie in den Konfig-Ordner der Python-Fassung. |
| 17 | `nativeTheme` plus Portal/gsettings-Fallback unter Linux. |
| 18 | Suche: eine gemeinsame Normalisierungsfunktion (`toLowerCase()` + `ß`→`ss` + weitere casefold-Fälle für Deutsch), auf Anfrage und Text angewandt. |
| 19 | Eine einzige UTF-8-Dekodierfunktion für Lesen und Vergleich. |
| 20 | JSON: gleiches Schema, Einrückung wie Python (eintrag.json 2, daten.json.gz 1). Payloads inhaltlich gleich; Byte-Gleichheit nicht verlangt. |
| 21 | Zeitstempel ISO mit lokalem Offset und Sekunden (`2026-10-25T14:03:12+01:00`). |
| 22 | Kein Parallelbetrieb vorgesehen: In Phase 6 werden die Starter umgestellt. Electron erzwingt Einzelinstanz (`requestSingleInstanceLock`). |
| 23 | Alle Pfade, Prozessliste, Schlüsselbund, HTTP-Client und Uhr per Dependency Injection. |
| 24, 25 | Wie vorgeschlagen; Python-CI-Job bleibt unverändert. |
