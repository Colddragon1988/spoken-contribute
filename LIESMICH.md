# Spoken – Beiträge hochladen

Lädt hoch, was das WoW-Addon Spoken sammelt (`SpokenContributions.lua`) und die NPC-Texte aus
dem Spiel-Cache (`Cache/ADB/<Sprache>/DBCache.bin`) – dasselbe wie spoken.rusty.one/deDE/contribute.
Alles Gesendete wird archiviert und ist im Fenster unter „Verlauf …“ einsehbar.

Voraussetzung: Python 3.8 oder neuer mit tkinter. Empfohlen: das Paket `keyring`
(`pip install keyring`, Debian/Ubuntu: `sudo apt install python3-keyring`) – dann liegt das
Passwort im Schlüsselbund des Systems statt in einer Datei.

| System  | Starten                                   | tkinter                                   |
|---------|-------------------------------------------|-------------------------------------------|
| Windows | Doppelklick auf `Spoken-Upload.pyw`       | bei Python von python.org dabei           |
| macOS   | Doppelklick auf `Spoken-Upload.command`   | bei Python von python.org dabei           |
| Linux   | `python3 Spoken-Upload.pyw`               | `sudo apt install python3-tk` (Debian/Ubuntu) |

Im Terminal: `--test` zeigt nur, was gesendet würde; `--ohne-fenster` lädt ohne Fenster hoch.

Funktionen: Upload der gesammelten Zeilen (anonym) und der NPC-Texte (mit Anmeldung), Archiv
aller Uploads mit Verlauf, Suche, Filtern und Statistik, Beachtung der Upload-Grenze
(10 pro Stunde), helles und dunkles Design (folgt auf Wunsch dem System). Laufende
WoW-Versionen werden übersprungen, weil WoW ihre Dateien beim Beenden neu schreibt.

Tests: `python -m unittest discover -s tests` – sie arbeiten in Testordnern mit einem
vorgetäuschten Server und laufen bei jedem Push auf GitHub unter Windows, macOS und Linux.

Gespeichert wird (nicht im Programmordner):

| | Einstellungen und Anmeldung (E-Mail) | Archiv (`verlauf/`) |
|---|---|---|
| Windows | `%APPDATA%\spoken-contribute` | `%LOCALAPPDATA%\spoken-contribute` |
| macOS | `~/Library/Application Support/spoken-contribute` | ebenda |
| Linux | `~/.config/spoken-contribute` | `~/.local/share/spoken-contribute` |
