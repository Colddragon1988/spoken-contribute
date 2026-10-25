# Spoken – Beiträge hochladen

Lädt hoch, was das WoW-Addon Spoken sammelt (`SpokenContributions.lua`) und die NPC-Texte aus
dem Spiel-Cache (`Cache/ADB/<Sprache>/DBCache.bin`) – dasselbe wie spoken.rusty.one/deDE/contribute.
Alles Gesendete wird archiviert und ist im Fenster unter „Verlauf …“ einsehbar.

Voraussetzung: Python 3.8 oder neuer mit tkinter.

| System  | Starten                                   | tkinter                                   |
|---------|-------------------------------------------|-------------------------------------------|
| Windows | Doppelklick auf `Spoken-Upload.pyw`       | bei Python von python.org dabei           |
| macOS   | Doppelklick auf `Spoken-Upload.command`   | bei Python von python.org dabei           |
| Linux   | `python3 Spoken-Upload.pyw`               | `sudo apt install python3-tk` (Debian/Ubuntu) |

Im Terminal: `--test` zeigt nur, was gesendet würde; `--ohne-fenster` lädt ohne Fenster hoch.

Gespeichert wird (nicht im Programmordner):

| | Einstellungen und Zugangsdaten | Archiv (`verlauf/`) |
|---|---|---|
| Windows | `%APPDATA%\spoken-contribute` | `%LOCALAPPDATA%\spoken-contribute` |
| macOS | `~/Library/Application Support/spoken-contribute` | ebenda |
| Linux | `~/.config/spoken-contribute` | `~/.local/share/spoken-contribute` |
