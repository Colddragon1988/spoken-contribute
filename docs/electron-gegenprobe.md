# Spoken-Upload – Gegenprobe Python ↔ TS (Phase 4)

> **Stand nach der Ablösung:** Die Python-Fassung ist aus dem Repo entfernt (zuletzt enthalten in
> Commit `e14d775`). Die Gegenprobe-Skripte (`app/tests/gegenprobe/`) und der CI-Job `gegenprobe`
> sind mit ihr entfallen. Dieses Dokument hält das Ergebnis fest, das vor der Ablösung galt.

Die Gegenprobe lässt dieselben Szenarien von der Python-Fassung und vom TS-Kern ausführen und
vergleicht alles, was danach sichtbar ist (Architektur §7.6). Unterschiede sind Fehler, außer sie
stehen mit Begründung in `app/tests/gegenprobe/erlaubte-abweichungen.ts`.

**Ergebnis:** 57 von 57 Gegenprobe-Tests sind grün (`cd app && npm run test:gegenprobe`).
- Echte Fehler in der TS-Fassung hat die Gegenprobe **keine** gefunden.
- Übrig bleiben genau **4 erlaubte Abweichungen** (siehe unten), alle aus Entscheidungen der
  Spezifikation (E. 6, 9, 13) oder angenommenen Vorschlägen (V3, V10).
- Eine Probe mit absichtlich verfälschten Python-Ergebnissen hat gezeigt, dass der Vergleich
  greift: Ein geänderter Berichtskopf und eine geänderte Summenzeile im Kreuzlesen fielen sofort auf.

## Aufbau

| Datei | Aufgabe |
|---|---|
| `app/tests/gegenprobe/python_lauf.py` | Python-Treiber. Liest einen Auftrag (JSON auf stdin), schreibt das Ergebnis (JSON auf stdout). |
| `app/tests/gegenprobe/szenarien.ts` | Szenarien als Daten: Eingabedateien, Serverfehler, laufende Spiele, Schritte. |
| `app/tests/gegenprobe/normalize.ts` | Dateibaum lesen, Temp-Wurzel → `<TMP>`, semantischer Vergleich, Zufallsgenerator. |
| `app/tests/gegenprobe/erlaubte-abweichungen.ts` | Erlaubte Unterschiede mit Verweis, Begründung und genauer Prüfung. |
| `app/tests/gegenprobe/gegenprobe.test.ts` | Führt beide Seiten aus und vergleicht. Läuft im vitest-Projekt `gegenprobe`. |

**Abschottung (Regeln 1–3)**
- Beide Seiten arbeiten nur in eigenen Temp-Ordnern; die Eingaben sind byte-gleich.
- Python läuft mit `python3 -I -B`, `TZ=Europe/Berlin` und einem Temp-HOME bzw. Temp-XDG.
- Python ist abgeschottet wie `tests/helpers.py` `Sandbox.setUp`:
  - Pfade für `settings`, `history`, `limits` und `system.data_dir` zeigen auf den Temp-Ordner.
  - `settings._keyring` → `None`, also kein Schlüsselbund.
  - `running_flavors` kommt aus dem Szenario.
  - `find_wow` liefert nichts bzw. den Sandbox-WoW-Ordner.
- Als Server dient `helpers.FakeServer`. Er ist eine Ebene tiefer als in den Tests eingehängt (statt
  `urllib.request.build_opener`), damit die Fehlertexte aus `api.py` selbst stammen – wie beim
  TS-`FakeServer`, der auf Transportebene sitzt.
- Kein Netz, kein echter Schlüsselbund. Die Python-Fassung bleibt unverändert.
- Feste Uhr auf beiden Seiten: `2026-10-25T14:03:12+01:00`, der Tag der Zeitumstellung.
  - Python: `datetime` in `history` und `limits` ersetzt. TS: `FakeClock`.
  - Dadurch sind Verlaufsordner, Zeitstempel, `upload-zeiten.json` und Uhrzeiten in Berichten auf
    beiden Seiten gleich und werden ohne Platzhalter verglichen.

## Was verglichen wird

- **Bericht** jedes Schritts: Kopf, Abschnitte, `failed`, Fortschrittszeilen.
- **Serveraufrufe**: Pfad, Payload (JSON semantisch) und Kopfzeilen (`content-type`, `origin`, `user-agent`).
  - Das Sitzungs-Cookie bleibt außen vor: Der Python-Treiber umgeht den `CookieJar`.
  - Das Cookie selbst prüfen die Transporttests von Paket (c).
- **Alle Dateien danach** unter der Temp-Wurzel: Spielordner, `config/`, `data/verlauf/…`,
  `upload-zeiten.json` und leere Ordner.
  - JSON wird semantisch verglichen (E. 20), `.gz` entpackt.
  - Text wird als Text verglichen, Binäres als base64.
- **Upload-Grenze**: `remaining()` und `free_at(n)` für mehrere n (Schritt `grenze`).
- **Übersicht** (`overview`):
  - Python wird in die Form der TS-Übersicht gebracht: Versionsnamen, laufende Versionen als Namen, Uhrzeit `HH:MM`.
  - Das ist die Darstellung für die IPC; der Inhalt bleibt gleich.
- **Kreuzlesen** nach jedem Szenario. Beide Fassungen lesen den Python-Verlauf **und** den TS-Verlauf. Verglichen werden:
  - `entries()` mit Ordner, Zeit und `failed`;
  - `row()` und `details()`;
  - `totals()`;
  - `statistics()` und `daily()`;
  - die Suche (`casefold` von `details`) mit 8 Anfragen, darunter `STRASSE`↔`Straße`, Umlaute und Backslash.
- **Parser**: 500 Zufalls-`.lua` und 500 Zufalls-`.bin`, fester Seed `20261025`.
  - Verglichen werden `envelopes_in`, `cleared(read_text)` und `parse_cache`.
  - Inhalt der `.lua`-Dateien: Escapes, `\ddd`, kaputtes UTF-8, BOM, CRLF/LF, eingerückte Schalter, abgeschnittene Dateien.
  - Inhalt der `.bin`-Dateien: fremde Tabellen, Status ≠ 1, falsche Kennung, abgeschnitten, kaputtes UTF-8.
  - Eine Kontrolldatei aus den Fixtures muss bitgenau zurückkommen.
  - Damit nicht nur Leeres verglichen wird, gilt: mehr als 500 Umschläge und mehr als 150 Caches mit Texten.
- **Kommandozeile**:
  - das echte `python3 -I Spoken-Upload.pyw --help | -h | --x | --test --gibts-nicht` gegen `runCli` (Exit-Code, stdout, stderr);
  - dazu `main.main(...)` in der Sandbox für `--test` und `--ohne-fenster` (Szenarien „CLI: …“).

## Szenarien (51 Upload-/CLI-Szenarien, 1 Parser-Lauf, 4 Skript-Aufrufe)

**Katalog `tests/test_upload.py`** – alle 25 Tests als Daten nachgestellt:

| Szenario | Python-Test |
|---|---|
| Zeilen: Erfolg sendet, archiviert, leert (+ zweiter Lauf, Übersicht) | Contributions::test_success_sends_archives_and_clears |
| Zeilen: Serverfehler 500 behält alles | Contributions::test_server_error_keeps_everything |
| Zeilen: mehr als 2000 in mehreren Uploads (.lua + .bak) | Contributions::test_more_than_2000_lines_go_in_several_uploads |
| Zeilen: Fehler im zweiten Upload leert nichts | Contributions::test_failure_in_second_upload_clears_nothing |
| Zeilen: während des Uploads hinzugekommene bleiben | Contributions::test_lines_added_during_upload_are_kept |
| Zeilen: mehr Uploads als eine Stunde erlaubt | Contributions::test_file_needing_more_uploads_than_an_hour_allows_stays_untouched |
| Zeilen: Archivfehler leert nichts | Contributions::test_archive_failure_clears_nothing |
| Zeilen: Testlauf ändert nichts | Contributions::test_dry_run_changes_nothing |
| Grenze: Uploads werden gezählt | RateLimit::test_uploads_are_counted |
| Grenze: volle Stunde sperrt ohne Serverkontakt | RateLimit::test_full_hour_blocks_without_asking_the_server |
| Grenze: 429 markiert die Stunde als voll | RateLimit::test_429_marks_the_hour_as_full |
| Grenze: alte Uploads verfallen | RateLimit::test_old_uploads_expire |
| Grenze: kaputte Einträge werden übergangen (1–5) | UploadTimes::test_broken_entries_are_skipped |
| Grenze: Zeiten in der Zukunft sperren nicht | UploadTimes::test_times_in_the_future_do_not_block |
| Grenze: frei ab zählt von den ältesten | UploadTimes::test_free_at_counts_from_the_oldest_uploads |
| Grenze: frei ab bei mehr als einer Stunde Uploads / ohne Einträge | UploadTimes::test_free_at_with_more_than_an_hour_of_uploads |
| Grenze: frei ab in Ortszeit | UploadTimes::test_free_at_is_in_local_time |
| NPC: Erfolg archiviert und löscht den Cache (inkl. zu langer Text) | NpcTexts::test_success_archives_and_deletes_cache |
| NPC: Fehler in einer Version behält deren Cache | NpcTexts::test_failure_in_one_version_keeps_its_cache |
| NPC: nicht angemeldet | NpcTexts::test_not_logged_in_keeps_cache |
| NPC: Passwort fehlt im Schlüsselbund | NpcTexts::test_password_missing_from_keyring_keeps_cache |
| NPC: Anmeldung abgelehnt (401) | NpcTexts::test_rejected_login |
| Laufend: laufende Version wird übersprungen | RunningGame::test_running_version_is_skipped |
| Laufend: unbekannte laufende Version stoppt | RunningGame::test_unknown_running_version_stops |
| Laufend: Übersicht lässt laufende aus | RunningGame::test_overview_leaves_out_running_versions |

**Ergänzungen**
- Zeilen: LF ohne Schalter; eingerückte Schalter (Tab+CRLF, Leerzeichen+LF).
- Zeilen: kaputtes UTF-8 und `\ddd`-Escapes, z. B. `\195\164`, `\226\130`, `\999`, `\q`, Backslash vor CRLF; mit zweitem Lauf.
- Zeilen: mehrere Versionen und Accounts.
  - Dabei: `_retail_`, `_classic_` mit leerer Datei, `_ptr_` ohne Spoken, `.bak` ohne `.lua`.
  - Aufschub über 2000. Ablauf: Übersicht, Testlauf, zwei Uploads.
- Zeilen: Serverfehler mit Text (`{"error": …}`, 503) und mit Objekt als Text (E. 13).
- Zeilen: keine Verbindung (Netzfehler); 401 beim Senden.
- Testlauf: Zeilen und NPC-Texte ohne Anmeldung bei voller Stunde („wieder möglich ab … Uhr“).
- NPC: 5002 Texte im Cache; Build 70003 geht in zwei Paketen (5000 + 1). Dazu mehrere Builds über
  `.tmp`-Zwischenstände (je ID gewinnt der neueste) und mehrere Sprachen.
  - Ungültige Sprache und Status ≠ 1 sind dabei.
  - Ein 429 bei NPC-Texten (enUS) lässt nur diesen Cache liegen und zählt nicht zur Grenze.
- Leer: keine Version mit Spoken; alle Versionen laufen; nichts Neues (auch Testlauf).
- Verlauf: vorhandener Verlauf plus neuer Upload. Der vorhandene Verlauf enthält:
  - Zeit ohne Zone, `ergebnis: null`, Hinweis, fehlende Versionen und Anzahl, Fehler-Eintrag;
  - `zu_lang` und NPC-Texte mit weiblicher Form;
  - Bücher mit HTML;
  - kaputte Einträge: Liste, ohne Zeit, kaputtes JSON, unlesbare Zeit, Ordner ohne `eintrag.json`.
- Alt-Archiv wird übernommen (zweimal migriert). Die Sicherungen umfassen:
  - `.lua` und `.bak` zum selben Zeitpunkt;
  - Versionspräfixe `classic`/`forever`, LF-Datei;
  - unmöglicher Zeitpunkt `2026-02-30`, nicht passender Name.
- CLI in der Sandbox:
  - `--help`/`-h`/unbekannt;
  - `--test` ohne WoW-Ordner, mit Alt-Archiv und Passwort in `login.json` (nichts darf sich ändern);
  - `--test` mit eingetragenem WoW-Ordner; `--test` mit gefundenem WoW-Ordner (E. 9);
  - `--ohne-fenster`: räumt auf (Migration) und lädt Zeilen und NPC-Texte hoch.

## Erlaubte Abweichungen

| Id | Verweis | Wo | Begründung und Prüfung |
|---|---|---|---|
| `eingerueckte-schalter` | E. 6, V10 | geleerte `SpokenContributions.lua` (Szenarien „eingerückte Schalter“), `cleared()` im Parser-Vergleich (154 von 501 Dateien) | TS erkennt `["Enabled"]`/`["Introduced"]` auch eingerückt und schreibt sie ohne Einrückung zurück; Python verliert sie. Geprüft wird, dass sich beide Texte **nur** durch zusätzliche Schalterzeilen auf der TS-Seite unterscheiden. Die Python-Schalter stehen in derselben Reihenfolge auch bei TS. |
| `fehlerdetail-als-json` | E. 13 | Bericht, `eintrag.json` (`fehler`), Detailtext im Kreuzlesen | Ist die Fehlerbeschreibung des Servers ein Objekt, zeigt Python `repr` (`{'code': 7, 'grund': 'x'}`), TS `JSON.stringify` (`{"code":7,"grund":"x"}`). Der Rest der Meldung ist gleich. Geprüft durch genaues Ersetzen. |
| `testlauf-schreibt-nichts` | E. 9 | `config/` und `config/settings.json` | `--test` speichert einen gefundenen WoW-Ordner nicht; Python legt `settings.json` an. Bericht und Exit-Code sind gleich. Geprüft: Die Datei fehlt nur auf der TS-Seite. |
| `usage-programmname` | V3 | stdout von `--help`/`-h`/unbekanntem Argument | Hilfe mit „Spoken-Upload“ statt „Spoken-Upload.pyw“. Geprüft: Bis auf diesen Namen ist der Text gleich, Exit-Codes und stderr sind gleich. |

Die Gegenprobe schlägt fehl, wenn eine erlaubte Abweichung in keinem Szenario mehr vorkommt. Die
Liste bleibt so genau so lang wie nötig.

**Nicht beobachtet, obwohl vorgesehen**
- Unterschiedliche U+FFFD-Anzahl bei kaputtem UTF-8 (E. 19) trat in keinem der Szenarien und
  keiner der 1000 Zufallsdateien auf. TS liefert dieselben Ersatzzeichen wie Python 3.13.
- `casefold` (E. 18): Alle Suchanfragen, auch `STRASSE` gegen „Straße“, fanden auf beiden Seiten dieselben Einträge.

**Bewusst nicht Teil der Gegenprobe**
- Oberfläche: Die Fenster sind in Playwright-Tests abgedeckt, Screenshots liegen in `docs/screenshots/`.
- Schlüsselbund und safeStorage (E. 12, E. 15): Das Speicherverfahren ist ein anderes; abgedeckt durch die portierten `Login`-Tests.
- `user-agent` ist gleich (V4 abgelehnt). Er wird bei jedem Aufruf mit verglichen.

## Weitere bewusste Abweichungen (außerhalb der Gegenprobe, aus dem Review)

Diese betreffen den Fensterablauf bzw. die Passwortspeicherung und lassen sich mit dem Kern-Vergleich
nicht erfassen:

- **Upload im Fenster nimmt den gespeicherten WoW-Ordner** (zuletzt per Enter, „Ändern …“ oder „Suchen“
  übernommen), nicht ungespeicherten Text im Feld wie Pythons `wow_path()`. Grund: `upload:start`
  übergibt bewusst keinen Pfad aus dem Renderer; ein halb getippter Pfad wird so nie benutzt.
- **Kontowechsel mit `passwort.safestorage`** (nur ein Platz, V5): Scheitert nach dem Speichern des neuen
  Passworts das Schreiben von `login.json`, wird das Passwort des alten Kontos zurückgeschrieben – das
  alte Konto bleibt benutzbar (Python hat mit dem echten Schlüsselbund ohnehin zwei Einträge).
- **Zeitgrenze 120 s** gilt für die ganze Anfrage (`AbortSignal.timeout`), in Python je Netzwerkschritt.
  Bei sehr langsamer Leitung kann ein großes Paket früher abbrechen; es geht nichts verloren, weil dann
  nichts geleert wird und es beim nächsten Mal erneut mitgeht.
- **Anmeldedialog** leert das Passwortfeld nach dem Absenden (Architektur §5.5); nach einer Ablehnung
  muss es neu eingetippt werden.

## Ausführen

```sh
cd app
npm run test:gegenprobe            # braucht python3 im PATH; SPOKEN_PYTHON=… für einen anderen
```

In der CI läuft die Gegenprobe als eigener Job `gegenprobe` in `.github/workflows/electron.yml`
(ubuntu-latest, Python 3.13, Node 22). Der Python-Workflow `tests.yml` läuft unverändert parallel.
