# Spoken – Beiträge hochladen

Lädt hoch, was das WoW-Addon Spoken sammelt (`SpokenContributions.lua`) und die NPC-Texte aus
dem Spiel-Cache (`Cache/ADB/<Sprache>/DBCache.bin`) – dasselbe wie spoken.rusty.one/deDE/contribute.
Alles Gesendete wird archiviert und ist im Fenster unter „Verlauf …“ einsehbar.

Funktionen: Upload der gesammelten Zeilen (anonym) und der NPC-Texte (mit Anmeldung), Archiv
aller Uploads mit Verlauf, Suche, Filtern und Statistik, Beachtung der Upload-Grenze
(10 pro Stunde), helles und dunkles Design (folgt auf Wunsch dem System). Laufende
WoW-Versionen werden übersprungen, weil WoW ihre Dateien beim Beenden neu schreibt.

Die App (Electron, ab 3.0) liegt im Ordner `app/`. Sie ersetzt die frühere Python-Fassung 2.1 mit
gleichem Verhalten und denselben Daten; deren Quellen sind aus dem Repo entfernt (zuletzt enthalten in
Commit `e14d775`).

## Installation (Electron-Fassung)

Fertige Pakete entstehen mit `cd app && npm ci && npm run dist` im Ordner `app/release/`.

| System  | Paket                                  | Starten                                    |
|---------|----------------------------------------|--------------------------------------------|
| Linux   | `Spoken-Upload-<Version>.AppImage` oder `spoken-upload_<Version>_amd64.deb` | AppImage ausführbar machen und starten, bzw. `sudo apt install ./spoken-upload_…deb` |
| Windows | `Spoken-Upload Setup <Version>.exe` (NSIS) | Startmenü „Spoken-Upload“             |
| macOS   | `Spoken-Upload-<Version>.dmg`          | in „Programme“ ziehen und starten          |

Windows- und macOS-Pakete lassen sich nur auf dem jeweiligen System bauen (bzw. in der CI).

Im Terminal:

```
Spoken-Upload --test          zeigt nur, was gesendet würde – nichts wird gesendet oder gelöscht
Spoken-Upload --ohne-fenster  lädt ohne Fenster hoch, z. B. für einen Zeitplan
```

Unter Linux ohne Bildschirm startet `--ohne-fenster` von selbst ohne Grafik. Unter Windows ist die
Ausgabe nur bei Umleitung sichtbar (`"Spoken-Upload.exe" --ohne-fenster > upload.txt`); der
Exit-Code stimmt immer (0 = alles geklappt, 1 = nicht alles, 2 = falscher Aufruf).

## Daten

Gespeichert wird (nicht im Programmordner) – dieselben Ordner und Formate wie bei der Python-Fassung:

| | Einstellungen und Anmeldung | Archiv (`verlauf/`) und Upload-Grenze |
|---|---|---|
| Windows | `%APPDATA%\spoken-contribute` | `%LOCALAPPDATA%\spoken-contribute` |
| macOS | `~/Library/Application Support/spoken-contribute` | ebenda |
| Linux | `~/.config/spoken-contribute` | `~/.local/share/spoken-contribute` |

- `settings.json` – WoW-Ordner, automatischer Upload beim Start, Design.
- `login.json` – E-Mail-Adresse; das Passwort nur, wenn es keinen Schlüsselbund gibt (Datei nur für dich lesbar).
- `passwort.safestorage` – (nur Electron) das Passwort, verschlüsselt mit dem Schlüssel aus dem
  Schlüsselbund des Systems (KWallet, GNOME-Schlüsselbund, Windows, macOS-Schlüsselbund). Findet
  Electron unter Linux keinen Schlüsselbund, sagt das Fenster das ehrlich, und das Passwort liegt wie
  bei der Python-Fassung in `login.json`.
- `upload-zeiten.json` – Zeitpunkte der letzten Uploads (Grenze 10 pro Stunde).
- `verlauf/<Zeit>_<zeilen|npc-texte>/` – `eintrag.json`, `daten.json.gz` (das Gesendete) und `originale/`.

Electrons eigene Ablage (Cache usw.) liegt getrennt in `spoken-upload-electron` neben dem
Einstellungsordner.

## Umstieg von der Python-Fassung 2.1

1. App installieren (siehe oben). Einstellungen, Verlauf und Upload-Grenze werden ohne Umwandlung
   weiterbenutzt.
2. Beim ersten normalen Start (nicht bei `--test`) holt die App das Passwort einmal aus dem
   Schlüsselbund der Python-Fassung (Dienst `spoken-contribute`, Konto = E-Mail) – über `python3` mit
   dem Paket `keyring`, unter Linux ersatzweise `kwallet-query` oder `secret-tool` –, speichert es
   verschlüsselt neu und prüft es durch erneutes Entschlüsseln. Klappt das nicht, startet die App
   trotzdem und bittet im Fenster um eine neue Anmeldung.
3. Der alte Schlüsselbund-Eintrag wird nicht angerührt; wer ihn nicht mehr braucht, löscht ihn selbst
   (z. B. in KWallet den Ordner `spoken-contribute`).
4. Starter bzw. Verknüpfungen auf die neue App zeigen lassen. Die alte Fassung nicht gleichzeitig laufen lassen.

## Entwicklung und Tests

Voraussetzung: Node.js 22.12 oder neuer. Im Ordner `app/`:

```
npm ci
npm run build            # bündeln (esbuild)
npm run lint             # ESLint
npm run typecheck        # TypeScript strict
npm test                 # Unit- und Integrationstests (vitest), alle 57 Tests der Python-Fassung nachgebaut
npx playwright test      # Oberfläche (Electron, Linux in der CI mit xvfb)
npm run start:sandbox    # Probelauf mit Test-WoW-Ordner und vorgetäuschtem Server
```

Alle Tests arbeiten in temporären Ordnern mit vorgetäuschtem Server und Schlüsselbund; sie senden
nichts an spoken.rusty.one. Aus dem Quellbaum (`npx electron .`) startet die App ohne Sandbox nur mit
`SPOKEN_UPLOAD_ECHTE_DATEN=1`. Die Tests laufen bei jedem Push auf GitHub unter Windows, macOS und Linux. Hintergründe: `docs/electron-spezifikation.md`, `docs/electron-architektur.md`,
`docs/electron-gegenprobe.md`, `docs/electron-testzuordnung.md`.
