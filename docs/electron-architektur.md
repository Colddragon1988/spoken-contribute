# Spoken-Upload – Architektur der Electron/TypeScript-Fassung (Phase 2)

Grundlage: `docs/electron-spezifikation.md`. Deren Abschnitt 11 („Entscheidungen“) ist verbindlich. Texte in `„…“` und Codeblöcken der Spezifikation werden wörtlich übernommen. Wo diese Architektur neue Texte braucht, sind sie in Abschnitt 13 als **Vorschlag zur Freigabe** markiert.

> **Unverrückbare Regeln (gelten für alle, auch für Subagents – wörtlich weitergeben):**
> 1. Echte Daten nicht anfassen, solange nicht Phase 6 erreicht ist: nicht die WoW-Installation, nicht ~/.config/spoken-contribute, nicht ~/.local/share/spoken-contribute, nicht KWallet. Tests und Probeläufe arbeiten ausschließlich in temporären Ordnern mit vorgetäuschtem Server und vorgetäuschtem Schlüsselbund.
> 2. Keine echten Uploads an spoken.rusty.one – weder in Tests noch beim Ausprobieren.
> 3. Das Passwort niemals ausgeben, loggen, in Dateien schreiben oder in Commits bringen.
> 4. Git: nur in ~/src/spoken-contribute und nur auf dem Branch „electron“ arbeiten; nie direkt auf main committen. Commits nur mit der repo-lokal eingestellten Adresse 48044372+Colddragon1988@users.noreply.github.com (Name „Chenmo“) – vor dem ersten Commit mit `git config user.email` prüfen. Niemals die private oder die Arbeits-E-Mail. Kein Force-Push, kein Löschen von Branches oder History, kein Push ohne Zustimmung.
> 5. Die Python-Fassung bleibt bis zum Schluss lauffähig erhalten; nichts davon löschen, bevor die Electron-App freigegeben ist.
> 6. Nichts mit sensiblen Daten einchecken (node_modules, Build-Ausgaben, Logs, echte Spieldaten) – .gitignore entsprechend erweitern.
>
> **Zusatz für parallel arbeitende Subagents:** Jedes Paket ändert nur die Dateien, die ihm in Abschnitt 8 zugeordnet sind. Subagents committen nicht und installieren keine Pakete. Abhängigkeiten, gemeinsame Typen (`src/shared/*`), Konfigurationen und Commits liegen beim Koordinator.

---

## 1. Technologieentscheidungen

Die Versionen wurden am 2026-10-27 per `npm view` geprüft.

| Baustein | Version | Begründung |
|---|---|---|
| Node (Entwicklung) | 22.20 (`engines: >=22.12`) | Vorhanden. vitest 5 verlangt `^22.12`, eslint 10 verlangt `^22.13`. |
| Electron | **45.0.0** (exakt gepinnt) | Aktuelle stabile Version. Sie wird exakt gepinnt, weil sich Electron-Major-Versionen in Sicherheitsvoreinstellungen, `safeStorage` und Linux-Backends unterscheiden. |
| TypeScript | **~6.0.3** | Nicht 7.x, weil typescript-eslint 8.72.1 `typescript <6.1` verlangt. `strict` und zusätzliche Prüfungen sind an (siehe tsconfig). |
| Bündeln | **esbuild ^0.28.2** + Skript `scripts/build.mjs` | Ein sandboxed preload muss eine einzige CommonJS-Datei sein (er darf nur `electron` laden). Der Renderer braucht ein Browser-Bündel. esbuild erledigt main, preload und renderer in etwa 30 Zeilen Skript, ohne Plugin-Ökosystem und ohne Dev-Server. **Typprüfung getrennt** mit `tsc --noEmit`. electron-vite 6 wäre bequemer (HMR), bringt aber mehr Konfiguration und Abhängigkeiten mit. HMR braucht die App nicht (zwei kleine Fenster). |
| Paketierung | **electron-builder ^26.18.0** | Linux: AppImage + .deb, Windows: NSIS, macOS: dmg. Electron-Fuses lassen sich in der Konfiguration setzen. |
| Unit-/Integrationstests | **vitest ^5.0.5** | Führt TypeScript direkt aus. Projekte `unit` und `gegenprobe`. |
| UI-Tests | **@playwright/test ^1.64.1** (`_electron`) | Startet die gebaute App mit einer Sandbox-Umgebung. Es ist kein Browser-Download nötig. |
| Lint | **eslint ^10.13.0**, **typescript-eslint ^8.72.1**, **@eslint/js ^10.0.1**, **globals ^17.13.0** | Flat config, `strictTypeChecked`. Importgrenzen zwischen den Schichten werden per Regel erzwungen. |
| UI-Framework | **keines** | Zwei Fenster mit einfachen Formularen, Tabelle, Textfeld und SVG-Diagramm. Ein kleiner DOM-Helfer reicht. Ohne Framework ist die CSP ohne `unsafe-inline`/`unsafe-eval` trivial einzuhalten. |
| HTTP | Node-`fetch` (undici) im Main-Prozess, eigener Cookie-Jar | Kein Electron-`net`: Der Kern bleibt ohne Electron testbar, und Sitzungscookies landen nie im Chromium-Cookie-Speicher (Spezifikation §3.1: ein Jar je Durchgang, nichts gespeichert). |
| Passwort | Electron `safeStorage` hinter der Schnittstelle `SecretStore` | Entscheidung 15. Der Kern kennt nur die Schnittstelle. Tests verwenden `FakeKeyring`. |
| Laufzeit-Abhängigkeiten | **keine** | Alles wird gebündelt. `dependencies` bleibt leer. Das verkleinert die Angriffsfläche und das Paket. |

## 2. Ordnerstruktur

Die Electron-App lebt in `app/` mit eigener `package.json`. Die Python-Fassung (`spoken_contribute/`, `tests/`, Startskripte, Python-CI) bleibt unberührt (Regel 5). Alternativen wie ein Monorepo mit Workspaces wurden verworfen: mehr Werkzeug, kein Nutzen.

```
spoken-contribute/
├─ .gitignore                         + dist-dev/, .eslintcache (Rest schon vorhanden)
├─ .github/workflows/tests.yml        Python-CI, UNVERÄNDERT
├─ .github/workflows/electron.yml     NEU (f): Node-CI ubuntu/windows/macos, lint/typecheck/test/test:ui
├─ docs/electron-spezifikation.md
├─ docs/electron-architektur.md       dieses Dokument
└─ app/
   ├─ package.json                    (0) Skripte, devDependencies, Metadaten
   ├─ package-lock.json               (0) per npm install erzeugt
   ├─ tsconfig.base.json              (0) gemeinsame Compiler-Optionen
   ├─ tsconfig.json                   (0) Node-Seite: shared, core, main, preload, tests, Konfigs
   ├─ eslint.config.js                (0) Flat config inkl. Importgrenzen
   ├─ vitest.config.ts                (0) Projekte unit/gegenprobe, Zeitzone, Setup
   ├─ playwright.config.ts            (0) UI-Tests gegen die gebaute App
   ├─ electron-builder.yml            (0) Ziele, Fuses, Dateien
   ├─ scripts/build.mjs               (0) esbuild: main, preload, renderer, Dev-Starter; HTML/CSS kopieren
   ├─ src/
   │  ├─ shared/                      ohne Node/Electron/DOM – vom Renderer importierbar
   │  │  ├─ types.ts                  (0) alle gemeinsamen Typen, Schnittstellen, Konstanten
   │  │  ├─ ipc.ts                    (0) Kanalnamen, Nachrichtentypen, SpokenApi (preload-Vertrag)
   │  │  └─ casefold.ts               (0) gemeinsame Kleinschreibung für Suche und Hervorhebung (E. 18)
   │  ├─ core/                        reines Node, kein electron-Import (Lint-Regel)
   │  │  ├─ index.ts                  (0) createCore(env): verdrahtet alle Fabriken
   │  │  ├─ errors.ts                 (0) UploadError, NetworkError, errText/errRepr
   │  │  ├─ time.ts                   (0) ISO mit Offset lesen/schreiben, Datumsformate
   │  │  ├─ fsutil.ts                 (0) writeFileAtomic, readJsonObject
   │  │  ├─ platform/                 Paket (a)
   │  │  │  ├─ index.ts               Fabriken/Exporte des Pakets
   │  │  │  ├─ paths.ts               Konfig-/Datenordner (§6.1), userData-Ordner (E. 16)
   │  │  │  ├─ processes.ts           ProcessRunner (execFile, ohne Shell), ProcessSource je OS
   │  │  │  ├─ running.ts             runningFlavors(programs) – Regex §6.4
   │  │  │  ├─ wowfind.ts             isWowRoot, wowRoot, findWow, Kandidaten, Wine-Präfixe, Registry
   │  │  │  └─ darkmode.ts            Linux-Fallback Portal/gsettings (E. 17)
   │  │  ├─ wowdata/                  Paket (b)
   │  │  │  ├─ index.ts               createWowData()
   │  │  │  ├─ utf8.ts                EINE UTF-8-Dekodierfunktion (E. 19)
   │  │  │  ├─ lua.ts                 Literal-Scanner, decodeLua, envelopesIn(bytes), cleared(text)
   │  │  │  ├─ envelope.ts            parseEnvelope, summarize
   │  │  │  ├─ flavors.ts             flavorName, spokenFlavors
   │  │  │  ├─ contributions.ts       contributionFiles, collectContributions, clearContributions
   │  │  │  ├─ adb.ts                 parseCache(bytes), newestTexts
   │  │  │  └─ caches.ts              cacheFolders, cacheFiles
   │  │  ├─ upload/                   Paket (c)
   │  │  │  ├─ index.ts               createUploader, createSiteFactory, createFetchTransport
   │  │  │  ├─ fetchTransport.ts      HttpTransport über fetch, Timeout 120 s
   │  │  │  ├─ site.ts                SiteSession: Header, Cookie-Jar, Fehlertexte §3.1, signIn
   │  │  │  ├─ limits.ts              upload-zeiten.json, recent/remaining/freeAt/note* (§4)
   │  │  │  ├─ plan.ts                planBatch, shortTitles, batchNotes, summedResult, resultLine
   │  │  │  ├─ contributions.ts       Teil 1 „Gesammelte Zeilen“ (§2.3, §2.4)
   │  │  │  ├─ caches.ts              cacheJobs, Teil 2 „NPC-Texte“ (§2.5)
   │  │  │  ├─ run.ts                 run(): Durchgang, Bericht (§2.2), reportText
   │  │  │  └─ overview.ts            overview() (§2.9)
   │  │  ├─ history/                  Paket (d)
   │  │  │  ├─ index.ts               createHistoryStore, createHistoryViews
   │  │  │  ├─ archive.ts             record, Ordnername, entries, payload (§5.5)
   │  │  │  ├─ migrate.ts             migrateOldArchive
   │  │  │  ├─ format.ts              resultText, row, totals, details (§5.6)
   │  │  │  ├─ search.ts              Suchtext, Cache ≤ 30 000 000 Zeichen, abbrechbar
   │  │  │  ├─ stats.ts               statistics, daily(30), Statistik-Text
   │  │  │  └─ views.ts               Filter, Summenzeile, query/details/folderOf für IPC
   │  │  └─ settings/                 Paket (e)
   │  │     ├─ index.ts               createSettingsStore, createLoginStore, createSafeStorageSecretStore
   │  │     ├─ settings.ts            settings.json (§5.3)
   │  │     ├─ login.ts               login.json + SecretStore (§6.6, E. 12)
   │  │     └─ secretStore.ts         SecretStore über SafeStorageLike, Datei passwort.safestorage
   │  ├─ main/                        Paket (f) – Electron-Hauptprozess
   │  │  ├─ main.ts                   Einstieg: Argumente, userData, Einzelinstanz, CLI oder Fenster
   │  │  ├─ argv.ts                   parseArgv (rein): Chromium-/Playwright-Schalter ausfiltern
   │  │  ├─ cli.ts                    runCli (rein, ohne Electron): USAGE, tidyUp, runInTerminal
   │  │  ├─ env.ts                    CoreEnv: Produktion oder Sandbox (nur unverpackt)
   │  │  ├─ protocol.ts               app://-Protokoll: liefert nur dist/renderer, setzt CSP-Header
   │  │  ├─ security.ts               Session härten: Berechtigungen, Navigation, Fensteröffnen, Netzsperre
   │  │  ├─ windows.ts                Haupt- und Verlaufsfenster (Optionen, Größen, Schließsperre)
   │  │  ├─ ipc.ts                    alle ipcMain.handle-Registrierungen, Absenderprüfung
   │  │  ├─ validate.ts               Argumentprüfer (rein, getestet)
   │  │  ├─ uploadController.ts       Upload-Sperre, Ereignisse, Auto-Upload (rein, getestet)
   │  │  ├─ themeLogic.ts             Design-Entscheidung + verspätete Antworten verwerfen (rein)
   │  │  └─ theme.ts                  nativeTheme-Anbindung, 10-s-Abfrage unter Linux
   │  ├─ preload/preload.ts           (f) contextBridge → window.spoken (SpokenApi)
   │  └─ renderer/                    Paket (g) – nur DOM, nur window.spoken
   │     ├─ tsconfig.json             (0) DOM-Lib, eigener Editor-Kontext
   │     ├─ global.d.ts               (0) interface Window { spoken: SpokenApi }
   │     ├─ common/dom.ts             h()-Helfer (nur textContent), Fokus, Tastatur
   │     ├─ common/base.css           Layout, Rahmen, Knöpfe, Tabelle
   │     ├─ common/theme.css          Farbvariablen hell/dunkel (§7.1), color-scheme
   │     ├─ common/theme.ts           data-theme setzen, onTheme abonnieren
   │     ├─ main/index.html           Hauptfenster (CSP-Meta)
   │     ├─ main/main.ts              Hauptfenster-Logik
   │     ├─ main/login.ts             Anmeldedialog (<dialog>, modal)
   │     ├─ main/format.ts            Statuszeilen, Konto-Hinweis, Berichtsdarstellung (rein, getestet)
   │     ├─ history/index.html        Verlaufsfenster (CSP-Meta)
   │     ├─ history/history.ts        Filter, Tabelle, Details, Tabs, Knöpfe
   │     ├─ history/highlight.ts      Trefferbereiche über casefold, ≤ 1000 (rein, getestet)
   │     ├─ history/chartGeometry.ts  Balken/Skala/Beschriftung (rein, getestet)
   │     └─ history/chart.ts          SVG-Zeichnen via createElementNS
   └─ tests/
      ├─ helpers/setup.ts             (0) HOME/XDG/APPDATA → Temp, Netzsperre, Zeitzonenprüfung
      ├─ helpers/fixtures.ts          (0) envelope, luaString, contributionsLua, dbcache
      ├─ helpers/fakeKeyring.ts       (0) FakeKeyring (SecretStore)
      ├─ helpers/fakeServer.ts        (0) FakeServer (HttpTransport)
      ├─ helpers/sandbox.ts           (0) createSandbox/useSandbox: Temp-Ordner, Fakes, createCore
      ├─ helpers/httpFakeServer.ts    (c) echter lokaler HTTP-Server 127.0.0.1:0 mit FakeServer-Logik
      ├─ helpers/sandbox-start.ts     (f) „npm run start:sandbox“: Probelauf mit Temp-WoW + Fake-Server
      ├─ unit/platform/*.test.ts      (a)
      ├─ unit/wowdata/*.test.ts       (b)
      ├─ unit/upload/*.test.ts        (c)
      ├─ unit/history/*.test.ts       (d)
      ├─ unit/settings/*.test.ts      (e)
      ├─ unit/main/*.test.ts          (f) argv, cli, validate, uploadController, themeLogic
      ├─ unit/renderer/*.test.ts      (g) format, highlight, chartGeometry
      ├─ ui/launch.ts                 (f) App mit Sandbox starten (Playwright-Helfer)
      ├─ ui/security.spec.ts          (f) Sicherheitsprüfungen im laufenden Fenster
      ├─ ui/cli.spec.ts               (f) gebaute App mit --test / --help / unbekanntem Argument
      ├─ ui/main-window.spec.ts       (g)
      ├─ ui/history-window.spec.ts    (g)
      └─ gegenprobe/                  Phase 4 (siehe 7.6)
         ├─ python_lauf.py            Python-Treiber (importiert spoken_contribute, gepatcht wie tests/helpers.py)
         ├─ szenarien.ts              Szenarien (aus dem Testkatalog + Zufallsdateien mit festem Seed)
         ├─ normalize.ts              Pfade/Zeiten/Ordnernamen normalisieren
         ├─ erlaubte-abweichungen.ts  begründete Unterschiede (E. 6, 9, 12, 13, 18, 19; V3, V4)
         └─ gegenprobe.test.ts        Vergleich Python ↔ TS
```

Ausgaben (gitignored): `dist/` (Bündel), `dist-dev/` (Dev-Starter, nie paketiert), `release/` (Installer), `test-results/`, `playwright-report/`.

## 3. Module und öffentliche Signaturen

### 3.1 Schichten und Abhängigkeitsregeln

```
renderer ──(nur window.spoken)──▶ preload ──IPC──▶ main ──▶ core ──▶ shared
   └──────────────────────────────────────── shared (Typen, ipc, casefold) ◀┘
```

- `shared/*`: keine Imports außer untereinander. Kein `node:*`, kein `electron`, kein DOM-Zugriff.
- `core/*`: Node erlaubt, `electron` verboten, kein `console` (alles über `Logger`/`ProgressLog`). Nur `upload/fetchTransport.ts` darf `fetch` benutzen.
- `renderer/*`: kein `node:*`, `electron`, `core`, `main`, `preload`. Kein `innerHTML`/`outerHTML`/`insertAdjacentHTML`.
- Die Pakete (a)–(e) hängen nur über die Schnittstellen in `shared/types.ts` voneinander ab. Verdrahtet wird ausschließlich in `core/index.ts` (`createCore`).
- Fabriken liefern **Objektliterale**, keine Klasseninstanzen. Dann bleiben Methoden beim Durchreichen oder Spreizen erhalten.

### 3.2 Fabriken je Paket

Paket 0 legt diese Funktionen als Stubs an (Rumpf: `throw new Error('nicht implementiert')`). Die Signaturen ändert nur der Koordinator.

```ts
// (a) src/core/platform/index.ts
export function defaultPaths(platform: Platform, env: EnvVars, home: string): AppPaths;
export function userDataDir(platform: Platform, env: EnvVars, home: string): string; // …/spoken-upload-electron
export function createProcessRunner(): ProcessRunner;
export function createProcessSource(platform: Platform, runner: ProcessRunner): ProcessSource;
export function runningFlavors(programs: readonly string[]): RunningFlavors;
export function createWowLocator(deps: { platform: Platform; env: EnvVars; home: string; runner: ProcessRunner }): WowLocator;
export function createDarkModeProbe(platform: Platform, runner: ProcessRunner): DarkModeProbe;

// (b) src/core/wowdata/index.ts
export function createWowData(): WowData;
// zusätzlich rein exportiert, für Tests und Gegenprobe:
export function decodeLua(body: Uint8Array): string;
export function envelopesInBytes(body: Uint8Array): string[];
export function cleared(text: string): string;
export function parseCache(body: Uint8Array): ParsedCache;

// (c) src/core/upload/index.ts
export function createFetchTransport(fetchImpl: typeof fetch): HttpTransport;
export function createSiteFactory(transport: HttpTransport, options: { baseUrl: string; platform: Platform; version: string }): SiteFactory;
export function createUploader(deps: { env: CoreEnv; wowData: WowData; history: HistoryStore }): Uploader;
export function reportText(report: Report): string; // Kopf + Abschnitte, "\n\n"

// (d) src/core/history/index.ts
export function createHistoryStore(deps: { dataDir: string; clock: Clock; wowData: WowData }): HistoryStore;
export function createHistoryViews(deps: { store: HistoryStore; wowData: WowData; clock: Clock }): HistoryViews;

// (e) src/core/settings/index.ts
export function createSettingsStore(deps: { configDir: string; findWow: () => Promise<string | null> }): SettingsStore;
export function createLoginStore(deps: { configDir: string; secrets: SecretStore }): LoginStore;
export function createSafeStorageSecretStore(deps: { configDir: string; safeStorage: SafeStorageLike; platform: Platform }): SecretStore;
```

### 3.3 Fehlerbehandlung

- **`UploadError(message, status|null)`**: erwarteter Fehler mit fertigem Nutzertext (§3.1). `SiteSession.post` wandelt jeden HTTP-, Netz- und JSON-Fehler darin um. `run()` fängt sie je Teil ab (§2.2, Schritt 5).
- **`NetworkError`**: nur zwischen `HttpTransport` und `SiteSession`. Wird zu `{what}: keine Verbindung zu spoken.rusty.one ({reason}).`, mit `reason` = `err.cause.code` oder `err.message`. Der macOS-Zertifikatshinweis entfällt (§3.1).
- **Dateifehler** (Node-`ErrnoException`): wie Pythons `OSError`. Texte über `errText(err)` (= `err.message`, für Pythons `{err}`) bzw. `errRepr(err)` (= `String(err)`, für `{err!r}`), Entscheidung 13.
- **Unerwartete Fehler** im Main: Jeder IPC-Handler fängt alles ab und liefert definierte Ergebnisse. Er wirft keine rohen Fehler, damit Electron keine Argumente protokolliert. Upload: Bericht `Unerwarteter Fehler.` (§7.2). Renderer: `window.onerror`/`unhandledrejection` → `showMessage` mit `Unerwarteter Fehler:\n\n{String(err)}`.
- **Passwort-Hygiene**: Das Passwort steht nur in `signIn`-Argumenten, im Request-Body und in `SecretStore.set`. Fehlermeldungen enthalten nie den Request-Body. Der Logger loggt keine Payloads. Test: Ein Sign-in-Fehler und ein Netzfehler enthalten das Test-Passwort weder in der Meldung noch im Logger-Puffer.
- **Nebenläufigkeit**: Alles ist `async`. Lange Schleifen (Suche, Statistik) geben alle 50 Einträge mit `await setImmediate()` ab, damit der Main-Prozess reagiert. Worker-Threads nur, wenn Messungen > 100 ms Blockade zeigen.

### 3.4 Wichtige Implementierungsdetails, die leicht falsch werden

- **Lua-Literal-Scanner (b)**: Er muss sich wie die Regex `"((?:[^"\\]|\\[\s\S])*)"` verhalten. Fehlt zu einem `"` das schließende `"`, wird **ab dem nächsten Byte** neu gesucht. Ein `\` am Dateiende beendet das Literal nicht. Die Gegenprobe mit Zufallsdateien sichert das ab.
- **`cleared` (b)** (E. 6): Muster `/^[ \t]*(\["(?:Enabled|Introduced)"\] = (?:true|false),)\r?$/gm`. Geschrieben wird Gruppe 1, also **ohne** Einrückung (V10). Ausgabe LF, UTF-8 ohne BOM.
- **Zahlen aus Serverantworten (c)**: nur `Number.isInteger(v)` zählt, sonst 0 (§2.3, Schritt 11).
- **`utf16len` (c)** = `string.length`.
- **Reihenfolgen (b/d)**: `Map` statt Objekt für IDs, Builds und Felder. Kein `__proto__`-Risiko, Einfügereihenfolge garantiert.
- **JSON-Formate (d/e)**: `eintrag.json` = `JSON.stringify(info, null, 2)` mit Schlüsselreihenfolge `zeit`, `art`, Rest. `daten.json.gz` = `JSON.stringify(x, null, 1)` per `zlib.gzip`. `settings.json` = Einrückung 2. `login.json` im Python-Kompaktstil `{"email": "a@b.c"}`: `'{' + Paare.map(([k,v]) => JSON.stringify(k) + ': ' + JSON.stringify(v)).join(', ') + '}'`. `upload-zeiten.json` = `JSON.stringify(array)`.
- **Zeit (0)**: immer `formatIsoLocal` (E. 21). Gelesen wird über `parseIso`. `limits` verwirft Werte ohne Offset, `history` nimmt sie als Ortszeit.
- **Originale (c)**: `originale/<flavor ohne _>/<Account>/SpokenContributions.lua[.bak]` per `fs.copyFile` + `fs.utimes` (Zeitstempel erhalten).
- **Ordnername Verlauf (d)**: `mkdir(…, {recursive:false})` exklusiv, bei `EEXIST` `-2`, `-3` … Der Elternordner `verlauf/` wird vorher mit `recursive:true` angelegt.

## 4. IPC-Schnittstelle

### 4.1 Grundsätze

- Nur `ipcRenderer.invoke` ↔ `ipcMain.handle` (Anfrage/Antwort) und `webContents.send` (Ereignisse Main → Renderer). Kein `sendSync`, kein `remote`, keine Rohweitergabe von `ipcRenderer`.
- **Absenderprüfung** in jedem Handler: `event.senderFrame` existiert, ist der Hauptframe (`=== event.sender.mainFrame`), seine URL beginnt mit `app://spoken/`, und `event.sender` gehört zu einem unserer Fenster. Jeder Kanal ist einem Fenster zugeordnet (Spalte „Fenster“). Ein falscher Absender wird verworfen (Handler liefert `undefined`, Warnung im Logger ohne Argumente).
- **Validierung** (`main/validate.ts`, rein):
  - Strings: `typeof === 'string'`, Länge ≤ Grenze aus `LIMITS`, kein `\0`.
  - Booleans: strikt.
  - Enums: Mitgliedschaft.
  - Objekte: einfache Objekte mit **genau** den erwarteten Schlüsseln.
  - Ganzzahlen: `Number.isSafeInteger` und ≥ 0.
  - Ungültig → definierte Ablehnung, kein Wurf.

### 4.2 Kanäle (Renderer → Main, `invoke`)

| Kanal | Fenster | Argumente / Validierung | Rückgabe | Wirkung |
|---|---|---|---|---|
| `app:get-state` | beide | – | `AppState` | Version, Plattform, Einstellungen, Upload läuft?, Design |
| `wow:set-dir` | Haupt | `text: string` ≤ 4096 | `SetWowDirResult` | `set_wow` (§7.2): trimmen, `~` auflösen, `wowRoot()` oder Eingabe, speichern |
| `wow:choose-dir` | Haupt | – | `string \| null` | nativer Ordnerdialog `Ordner „World of Warcraft“ wählen`, Start = aktueller Pfad, falls vorhanden, sonst Home |
| `wow:find` | Haupt | – | `string \| null` | `findWow()` im Hintergrund |
| `wow:overview` | Haupt | `wowDir: string` ≤ 4096 | `OverviewResult` (mit `wowDir` zum Verwerfen veralteter Antworten) | `isWowRoot`, dann `overview()` |
| `settings:set-auto-upload` | Haupt | `boolean` | `SaveResult` | sofort speichern |
| `settings:set-theme` | Haupt | `'system'\|'hell'\|'dunkel'` | `SaveResult` | speichern, Design anwenden, `event:theme` an alle Fenster |
| `account:get` | Haupt | – | `AccountView` | prüft tatsächlich (E. 12); kann eine Entsperrabfrage auslösen |
| `account:sign-in` | Haupt | `{email: string 1..320 (getrimmt), password: string 1..1024}` | `SignInResult` | neue `SiteSession`, `signIn`, dann `saveLogin`. Das Passwort geht nie zurück. |
| `account:sign-out` | Haupt | – | `AccountView` | Ja/Nein-Dialog `Abmelden` (§7.2) im Main, `deleteLogin`, Warn-/Fehlerdialog im Main |
| `upload:start` | Haupt | `{test: boolean}` | `Report \| null` (`null` = lief schon) | Upload-Sperre, Zugangsdaten erst im Main holen, Ereignisse senden |
| `history:open` | Haupt | – | `void` | Verlaufsfenster öffnen oder nach vorn holen (nur eine Instanz) |
| `history:query` | Verlauf | `{seq: int ≥ 0, search: string ≤ 1000, art: ArtFilter, version: string ≤ 200}` | `HistoryQueryAnswer` | bricht die vorige Abfrage dieses Fensters ab (`AbortController`) |
| `history:details` | Verlauf | `id: string` ≤ 200, ohne `/`, `\`, `..`, und in `entries()` vorhanden | `DetailsView \| null` | Detailtext §5.6 |
| `history:open-folder` | Verlauf | `id` wie oben | `void` | `shell.openPath(folder)`; Fehlerdialog `Der Ordner ließ sich nicht öffnen ({err}):\n\n{path}` im Main |
| `history:open-archive` | Verlauf | – | `void` | `verlauf/` anlegen, öffnen |
| `app:open-register` | Haupt | – | `void` | `shell.openExternal(REGISTER_URL)`, URL fest im Main, **nie** aus dem Renderer |
| `window:close` | beide | – | `void` | Absenderfenster schließen. Das Hauptfenster prüft die Upload-Sperre (`Der Upload läuft noch – bitte kurz warten.`). |
| `dialog:message` | beide | `{kind: 'info'\|'warnung'\|'fehler', title ≤ 200, text ≤ 20000}` | `void` | nativer Hinweisdialog über dem Absenderfenster |

### 4.3 Ereignisse (Main → Renderer, `send`)

| Kanal | Empfänger | Nutzlast | Zweck |
|---|---|---|---|
| `event:upload` | Hauptfenster | `UploadEvent` (`gestartet` / `fortschritt` / `fertig`) | auch für den Auto-Upload, den der Renderer nicht selbst ausgelöst hat |
| `event:theme` | alle Fenster | `ThemeView` | sofortiger Designwechsel (§7.1) |
| `event:history-changed` | Verlaufsfenster | – | nach jedem Upload neu laden; der Suchcache bleibt |

### 4.4 preload-API

`window.spoken` implementiert `SpokenApi` aus `src/shared/ipc.ts` (Code in 8.0). Der preload ist ein einziges CJS-Bündel. Er importiert nur `contextBridge` und `ipcRenderer`. `on…`-Methoden geben eine Abmeldefunktion zurück und reichen nur die Nutzlast weiter (nie das `IpcRendererEvent`).

## 5. Sicherheitskonzept

### 5.1 Protokoll statt `file://`

- Vor `ready`: `protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true } }])`.
- Fenster laden `app://spoken/main/index.html` und `app://spoken/history/index.html`.
- `protocol.handle('app', …)` auf der Fenster-Session liefert nur Dateien unter `dist/renderer/`:
  - Host muss `spoken` sein, Methode `GET`.
  - `decodeURIComponent`, `path.normalize`, Ergebnis muss mit `rendererRoot + path.sep` beginnen.
  - Endungen nur `.html .js .css .svg`.
  - Sonst 404.
  - Antwort mit `Content-Type`, `X-Content-Type-Options: nosniff` und dem CSP-Header.
- Die Fenster-Session ist eine **nicht persistente Partition** `spoken-ui` (ohne `persist:`). Es werden keine Cookies, Local Storage oder IndexedDB auf die Platte geschrieben.

### 5.2 Content-Security-Policy (wörtlich)

Als HTTP-Header aus dem Protokoll-Handler:

```
default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
```

Zusätzlich als `<meta http-equiv="Content-Security-Policy">` in beiden HTML-Dateien, ohne `frame-ancestors` (in Meta nicht erlaubt):

```
default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'none'
```

Folgen für (g): keine Inline-Skripte oder -Styles, kein `style="…"` im HTML, kein `setAttribute('style', …)`. Dynamische Werte setzt man über `element.style.x = …` (CSSOM, erlaubt) oder SVG-Attribute.

### 5.3 BrowserWindow-Optionen (beide Fenster)

```ts
{
  show: false, title, width, height, minWidth, minHeight,
  backgroundColor: dark ? '#1e1f22' : '#f2f2f2', autoHideMenuBar: true,
  webPreferences: {
    preload: path.join(__dirname, '../preload/preload.cjs'),
    partition: 'spoken-ui',
    contextIsolation: true, nodeIntegration: false, nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false, sandbox: true, webSecurity: true,
    allowRunningInsecureContent: false, experimentalFeatures: false, webviewTag: false,
    navigateOnDragDrop: false, spellcheck: false, safeDialogs: true,
    devTools: !app.isPackaged,
  },
}
```

- Hauptfenster: `Spoken – Beiträge hochladen`, 700×600, min. 580×480.
- Verlauf: `Spoken – Verlauf der Uploads`, 900×640, min. 640×440, `parent` nicht gesetzt (nicht modal).
- `show` erst bei `ready-to-show`.
- Menü: unter Linux/Windows `Menu.setApplicationMenu(null)`. Unter macOS ein Minimalmenü mit App- und Bearbeiten-Rollen, damit Cmd+C/V/X/A in Feldern funktioniert.

### 5.4 Navigation, Fenster, Berechtigungen, Netz (`main/security.ts`)

- `app.on('web-contents-created')`:
  - `will-navigate` und `will-redirect` → `preventDefault()`, außer dieselbe URL (Reload im Dev).
  - `setWindowOpenHandler(() => ({ action: 'deny' }))`.
  - `will-attach-webview` → `preventDefault()`.
- Session `spoken-ui`:
  - `setPermissionRequestHandler((_, __, cb) => cb(false))` und `setPermissionCheckHandler(() => false)`.
  - `webRequest.onBeforeRequest`: alles außer `app://spoken/…` und `devtools://…` abbrechen.
  - Damit gibt es **keine Remote-Inhalte**, und der Renderer hat kein Netzwerk.
- Das **Netzwerk läuft nur im Main** über Node-`fetch`, mit Cookie-Jar im Speicher je Durchgang (`SiteSession`). Cookies gelangen weder in den Renderer noch in eine Chromium-Session.
- Links: Der einzige externe Link (Registrierung) läuft über `app:open-register` mit fester URL. Archivordner öffnet `shell.openPath` nur für Pfade, die der Main selbst aus `entries()` bzw. `verlauf/` ermittelt hat.
- **Electron-Fuses** (electron-builder):

  | Fuse | Wert |
  |---|---|
  | `runAsNode` | `false` |
  | `enableNodeOptionsEnvironmentVariable` | `false` |
  | `enableNodeCliInspectArguments` | `false` |
  | `enableEmbeddedAsarIntegrityValidation` | `true` |
  | `onlyLoadAppFromAsar` | `true` |
  | `enableCookieEncryption` | `false` (keine Cookies in Chromium; vermeidet Schlüsselbund-Zugriff beim Start) |
  | `grantFileProtocolExtraPrivileges` | `false` |

- **Sandbox-Umgebungsvariablen** (`SPOKEN_UPLOAD_SANDBOX`, `SPOKEN_UPLOAD_SERVER`) werden nur ausgewertet, wenn `!app.isPackaged`. Zusätzlich muss der Sandbox-Ordner unter `os.tmpdir()` liegen und die Server-URL `http://127.0.0.1:<port>` sein. Sonst bricht der Start mit Meldung ab.

### 5.5 Passwortfluss

1. **Anmelden**: Der Renderer sendet `{email, password}` **einmal** per `account:sign-in` und leert danach sein Feld. Im Main laufen `createSite().signIn()` (Session nur für diese Prüfung) und danach `login.saveLogin()`. Zurück kommt nur `AccountView`.
2. **`saveLogin`** (e):
   - `secrets.available()` → `set`, dann `get` und vergleichen (Verifikation wie Python). Bei Erfolg wird `login.json = {"email"}` geschrieben, sonst `{"email","password"}` (0600, Ordner 0700).
   - Bei Kontowechsel wird der alte Eintrag gelöscht. Der `SecretStore` ist kontogebunden, deshalb löscht das den neuen nicht.
3. **`SafeStorageSecretStore`** (e): Datei `passwort.safestorage` im Konfig-Ordner, 0600, atomar. Inhalt `{"email": "…", "verschluesselt": "<base64>"}` (V5).
   - `available()`: `safeStorage.isEncryptionAvailable()` **und** (nicht Linux **oder** `getSelectedStorageBackend()` ∈ {`gnome_libsecret`, `kwallet`, `kwallet5`, `kwallet6`}).
   - Bei `basic_text` gilt `available() = false`, `backend() = 'basic_text'`. Das Passwort liegt dann wie in Python in `login.json` (0600), und die Anzeige sagt ehrlich, dass es nur durch Dateirechte geschützt ist (V1).
   - `get`: Datei fehlt oder anderes Konto → `null`. Entschlüsselungsfehler → Wurf (wie „gesperrt“).
   - `delete`: fehlt oder anderes Konto → Wurf (wie FakeKeyring), sonst Datei löschen.
4. **`accountView()`** (E. 12): angemeldet ohne Datei-Passwort → `get(email)`. Ein Wert ergibt `schluesselbund`, `null` oder ein Fehler ergibt `unlesbar` (Anzeige V2).
5. **Upload**: `credentials()` wird erst im Main während des Uploads geholt (§7.2). Das Passwort verlässt den Main nie.
6. `safeStorage` darf erst nach `app.whenReady()` benutzt werden. Unter Linux wird `getSelectedStorageBackend()` ebenfalls erst danach abgefragt.
7. **Tests und Sandbox**: nie echtes `safeStorage` (Regel 1). In der Sandbox setzt der Main vor `ready` zusätzlich `app.commandLine.appendSwitch('password-store', 'basic')`, damit Chromium selbst KWallet nicht anspricht.

## 6. CLI-Konzept und Start-Ablauf

### 6.1 Entscheidung: Kommandozeile über das Electron-Programm, Logik rein in Node

- Der **Aufruf** für Nutzer ist immer das App-Programm: `Spoken-Upload --ohne-fenster`, `spoken-upload --test` bzw. `npx electron . --test` in der Entwicklung. Grund: Nur dort gibt es `safeStorage`, um das Passwort zu entschlüsseln.
- Die **Logik** `runCli(args, deps, io)` in `main/cli.ts` ist rein (kein Electron-Import) und wird in vitest mit Sandbox-Abhängigkeiten vollständig getestet (Exit-Codes, USAGE, kein Schreiben bei `--test`).
- Ein separates Programm für plain `node` wird **nicht** ausgeliefert. Der Fuse `runAsNode=false` sperrt das ohnehin. Die Gegenprobe ruft den Kern direkt in vitest auf.

### 6.2 Argumente (`main/argv.ts`)

- Roh: `process.argv.slice(1)`. Unverpackt wird das erste Nicht-Schalter-Argument (der App-Pfad, z. B. `.`) entfernt.
- Danach werden Schalter von Chromium, Node und Playwright **ignoriert**: `--inspect…`, `--remote-debugging-port=…`, `--no-sandbox`, `--enable-logging…`, `--password-store=…`, `--ozone-platform…=…`, `--enable-features=…`, `--disable-gpu`, `--disable-dev-shm-usage` sowie macOS-`-psn_…`.
- Der Rest wird wie §8 behandelt: unbekannt → USAGE auf stdout, Exit 0 bei `-h`/`--help`, sonst 2. `--test` gewinnt.
- USAGE mit Programmname `Spoken-Upload` statt `Spoken-Upload.pyw` (V3):

  ```
  Aufruf: Spoken-Upload [--test | --ohne-fenster]
    (ohne)          Fenster öffnen
    --test          im Terminal zeigen, was gesendet würde – nichts wird gesendet oder gelöscht
    --ohne-fenster  im Terminal hochladen, z. B. für einen Zeitplan
  ```

### 6.3 Start-Ablauf (`main/main.ts`)

1. `parseArgv`. USAGE/Fehler → `process.stdout.write`, abwarten, `app.exit(code)`. Es wird nichts angelegt.
2. Umgebung bestimmen (`env.ts`): Produktion oder Sandbox (nur unverpackt, siehe 5.4).
3. **Vor `ready`**:
   - `app.setPath('userData', userDataDir(...))` (E. 16; Sandbox: `<sandbox>/userdata`).
   - `registerSchemesAsPrivileged`.
   - In der Sandbox `password-store=basic`.
   - Unter Linux im CLI-Modus ohne `DISPLAY`/`WAYLAND_DISPLAY`: `appendSwitch('ozone-platform', 'headless')` (V8, in Phase 5 prüfen).
4. **Einzelinstanz** (E. 22): `app.requestSingleInstanceLock()`.
   - Ohne Lock im Fenstermodus: Exit 0. Die erste Instanz holt im `second-instance`-Ereignis ihr Fenster nach vorn, aber nur, wenn das zweite argv keine CLI-Schalter hat.
   - Ohne Lock im CLI-Modus: stderr `Spoken-Upload läuft bereits – bitte erst das andere Fenster schließen.` (V7), Exit 1. Damit laufen nie zwei Uploads auf denselben Dateien.
5. `await app.whenReady()`, `CoreEnv` bauen (inkl. `SafeStorageSecretStore`), `createCore(env)`.
6. **Altlasten** (nicht bei `--test`): `history.migrateOldArchive()`, dann `login.movePasswordToKeyring()`. Fehler auf stderr: `Altes Archiv nicht übernommen: {err}` / `Passwort nicht in den Schlüsselbund umgezogen: {err}`.
7. **CLI** (`--test`/`--ohne-fenster`):
   - Kein Fenster, macOS `app.dock?.hide()`.
   - `settings.load({persistFound: !test})` (E. 9).
   - Ohne `wowDir`: `Kein WoW-Ordner gefunden – bitte einmal im Fenster auswählen.` → Exit 1.
   - Sonst `uploader.run(wow, await login.credentials(), {test, log: zeilenweise stdout})`, danach `reportText`. Exit 1 bei `failed`, sonst 0.
   - Ausgabe per `process.stdout.write` und abwarten, dann `app.exit(code)`.
8. **Fenster**:
   - Session härten, Protokoll registrieren, Design ermitteln, Hauptfenster erzeugen.
   - Bei `autoUpload` startet der Main 300 ms nach `ready-to-show` einen echten Upload (§7.2) über den `uploadController` und meldet ihn per `event:upload`.
   - `window-all-closed` → `app.quit()` (auch macOS; kleines Werkzeug).
   - Das Schließen des Hauptfensters schließt das Verlaufsfenster mit.
9. Unter Windows sind NSIS-Apps GUI-Programme. stdout ist nur bei Umleitung sichtbar (`Spoken-Upload.exe --ohne-fenster > upload.txt`), Exit-Codes funktionieren (V9).

### 6.4 Design (Hell/Dunkel)

- `themeLogic.ts` (rein): `effectiveDark(setting, nativeDark, probeDark|null)`.
  - `hell` → false, `dunkel` → true.
  - `system` → unter Linux `probeDark ?? nativeDark`, sonst `nativeDark`.
- Generationszähler: Antworten zu einer älteren Einstellung werden verworfen (Test §9 „late answer“).
- `theme.ts`:
  - `nativeTheme.themeSource` = `'light'`/`'dark'` bei hell/dunkel.
  - Bei `system`: unter Windows/macOS `'system'` plus Ereignis `nativeTheme.on('updated')`. Unter Linux fragt der Main Portal/gsettings (`DarkModeProbe`) beim Start und alle 10 s ab und setzt `themeSource` passend. Titelleiste, native Dialoge und Scrollbalken folgen dadurch.
  - Dann `event:theme` an alle Fenster.
- Renderer: `document.documentElement.dataset.theme = 'hell'|'dunkel'`. CSS-Variablen aus §7.1 plus `color-scheme: light|dark`, damit native Klapplisten folgen.

## 7. Teststrategie

### 7.1 Schutznetz (Regeln 1–3)

- `tests/helpers/setup.ts` (jede vitest-Datei):
  - `HOME`, `USERPROFILE`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `APPDATA`, `LOCALAPPDATA` zeigen auf einen Temp-Ordner. `WINEPREFIX` wird gelöscht.
  - `globalThis.fetch` lässt nur `127.0.0.1`/`localhost` zu.
  - Zeitzone `Europe/Berlin` wird geprüft.
- Kern-Tests bauen `CoreEnv` nur über `createSandbox()`. `defaultPaths` wird nur rein mit erfundenen `env`-Objekten getestet.
- Die App wertet Sandbox-Variablen nur unverpackt und nur unter `os.tmpdir()` aus.
- Probeläufe nur über `npm run start:sandbox` (Temp-WoW aus Fixtures + lokaler Fake-Server). Es gibt bewusst **kein** `npm start` gegen echte Daten bis Phase 6.

### 7.2 Helfer

- **Sandbox** (`createSandbox`/`useSandbox`): Temp-Ordner `config/`, `data/`, `World of Warcraft/`.
  - `FakeServer` als `HttpTransport` (prüft dadurch auch Fehlertexte, Header und Cookies der echten `SiteSession`).
  - `FakeKeyring` (Standard `'none'` wie Python-Sandbox mit `_keyring → None`).
  - `running` steuerbar, `findWow → null`, `FakeClock`.
  - Methoden `flavor()`, `lua()`, `cache()`. Aufräumen per `onTestFinished`.
- **FakeServer**: Antworten wie `tests/helpers.py`. `fail` je Pfad als Liste geplanter Fehler (`{status, body}` oder `{network}`), Haken `onPost`. Zeichnet `cookie`-Header auf.
- **FakeKeyring**: `kind` (`system|basic_text|none`), `locked`, `forgetful` (meldet Erfolg, speichert nichts). `delete` eines fehlenden Eintrags wirft.
- **Vorgetäuschte Prozesse**: Der Kern bekommt `running()` direkt. Paket (a) testet `runningFlavors(programs)` rein mit der Tabelle §6.4 und `createProcessSource` mit einem `ProcessRunner`-Fake (gespeicherte stdout-Beispiele je OS).
- **`httpFakeServer`** (c): `node:http` auf `127.0.0.1:0` mit derselben Antwortlogik. Für Tests von `createFetchTransport` (Timeout, Set-Cookie, Fehlerkörper) und für UI/CLI-E2E.
- **UI-Sandbox** (`tests/ui/launch.ts`):
  - Temp-Ordner, Fixtures, `httpFakeServer`.
  - `_electron.launch({ args: ['.'], cwd: app/, env: { SPOKEN_UPLOAD_SANDBOX, SPOKEN_UPLOAD_SERVER } })`.
  - Der Main liest in der Sandbox `<sandbox>/system.json` bei jedem Zugriff: `{ "prozesse": [...], "dunkel": true|false|null, "schluesselbund": {"art": "system|basic_text|none", "gesperrt": false, "eintraege": {...}} }`. Tests ändern so laufende Spiele, Systemdesign und Schlüsselbund zur Laufzeit.

### 7.3 Ebenen

| Ebene | Werkzeug | Inhalt |
|---|---|---|
| Unit | vitest `unit` | reine Funktionen (Parser, Planung, Formate, casefold, Zeit, Validierung, argv, Design-Logik, Chart-Geometrie, Hervorhebung) |
| Integration | vitest `unit` + Sandbox | Portierung **aller 57 Python-Tests** (Zuordnung in Abschnitt 8) plus neue Tests je Paket |
| Transport | vitest + `httpFakeServer` | echte `fetch`-Strecke, Cookies, 120-s-Timeout (mit kurzem Test-Timeout injiziert), Statuscodes |
| E2E | Playwright `_electron` | Fenster, Dialoge, Design, Verlauf, Sicherheit, CLI der gebauten App; Linux-CI mit `xvfb-run -a` |
| Gegenprobe | vitest `gegenprobe` + Python 3 | Phase 4, siehe 7.6 |

### 7.4 Sicherheitstests (f, `ui/security.spec.ts`)

- `typeof require`, `process` und `module` im Renderer sind `undefined`.
- `window.spoken` hat genau die Schlüssel von `SpokenApi`.
- `location.href = 'https://example.org'` bleibt auf `app://`.
- `window.open` liefert `null`.
- `fetch('https://example.org')` im Renderer scheitert.
- Der CSP-Header ist vorhanden.
- Ein ungültiges IPC-Argument (über `evaluate` mit falschem Typ) wird abgelehnt.
- Das Test-Passwort taucht nach einem Anmeldefehler weder in stdout noch in stderr der App auf.

### 7.5 UI-Abnahme (g)

Hauptfenster:
- Statuszeilen für alle Fälle aus §7.2.
- Suchen/Ändern.
- Anmelden: Erfolg, 401, leere Felder.
- Abmelden (Dialog im Test per `dialog.showMessageBox`-Stub im Main, nur in der Sandbox).
- Testlauf und Upload mit Fortschritt und roter Kopfzeile.
- Schließen gesperrt während des Uploads (Fake-Server verzögert).
- Auto-Upload nach 300 ms.
- Designwechsel sofort, auch in Klapplisten (Test §9 „dropdown“). Verspätete Theme-Antwort wird ignoriert.

Verlaufsfenster:
- Nur eine Instanz, Escape schließt.
- Filter, Suche mit 250 ms Entprellung.
- Suche in 3000 NPC-Texten findet einen Treffer, Hervorhebung ≤ 1000 (Test §9).
- Erster Eintrag automatisch gewählt.
- Statistik/Diagramm gefiltert, kein Zeichnen unter 100×80.
- Neu laden nach Upload.

### 7.6 Gegenprobe Python ↔ TS (Phase 4)

- **Treiber** `tests/gegenprobe/python_lauf.py`:
  - Liest ein Szenario (JSON auf stdin) und den Temp-Pfad.
  - Setzt `sys.path` auf das Repo, importiert `spoken_contribute` und **`tests/helpers.py`** (`FakeServer`, `FakeKeyring`).
  - Patcht wie `Sandbox.setUp`: Pfade, `_keyring`, `running_flavors`, `find_wow`, `Site.post`.
  - Ruft `upload.run` / `overview` / `history.*` / `wowdata.*` auf.
  - Gibt JSON aus: Bericht, Serveraufrufe, Dateibaum mit SHA-256 nach dem Lauf, normalisierte `eintrag.json` und entpackte `daten.json.gz`, `remaining()`.
  - Er läuft mit `python3 -I`, `TZ=Europe/Berlin` und in einem Temp-HOME. Die Python-Fassung selbst bleibt unverändert.
- **TS-Seite**: dasselbe Szenario in einer zweiten, byte-gleichen Temp-Kopie über `createSandbox`. Der `FakeServer` wird gleich konfiguriert.
- **Normalisierung**: Temp-Wurzel → `<TMP>`, Zeitstempel → `<ZEIT>`, Verlaufsordner → `<ORDNER-n>` (in Sortierreihenfolge). JSON wird semantisch verglichen (E. 20).
- **Szenarien**:
  - alle 25 Upload-Tests des Katalogs als Daten;
  - Parser-Vergleich mit 500 Zufalls-`.lua`- und `.bin`-Dateien (fester Seed: Escapes, kaputtes UTF-8, abgeschnittene Einträge);
  - Kreuzlesen: TS-Verlauf → Python `entries()/details()/statistics()/daily()` und umgekehrt;
  - CLI: `python3 Spoken-Upload.pyw --test`/`--help`/`--x` vs. `runCli` (Exit-Codes, Text mit V3-Ausnahme), jeweils mit Temp-HOME/XDG.
- **Erlaubte Abweichungen** stehen als Daten mit Begründung in `erlaubte-abweichungen.ts`. Jeder Eintrag verweist auf E. 6, 9, 12, 13, 18, 19 oder V3/V4. Daraus entsteht in Phase 4 der Bericht.

## 8. Arbeitspakete

Ablauf: **(0)** zuerst vom Koordinator. Danach laufen **(a) (b) (d) (e) (f) (g)** parallel. **(c)** startet ebenfalls sofort: Die Logik wird gegen kleine In-Memory-Fakes von `WowData`/`HistoryStore` entwickelt, die Integrationstests (Katalog `test_upload`) laufen, sobald (b) und (d) zusammengeführt sind. Zusammenführung: a → b → d → e → c → f → g.

Subagents committen nicht. Der Koordinator prüft und committt je Paket nur dessen Dateien (`git add <Dateien>`), mit der geprüften Adresse.

### (a) Plattform, Pfade, WoW-Suche, laufende Clients

- **Dateien**: `src/core/platform/{index,paths,processes,running,wowfind,darkmode}.ts`, `tests/unit/platform/*.test.ts`.
- **Abhängig von**: `shared/types.ts`, `core/fsutil.ts`.
- **Tests**:
  - §6.1-Tabelle für alle drei OS mit erfundenen `env`/`home` (inkl. Fallbacks), `userDataDir` (E. 16).
  - Kandidatenliste §6.2 in Reihenfolge (Temp-Home mit Wine-, Lutris-, Bottles- und Steam-Präfixen).
  - Registry-Ausgabe von `reg query` als Fake-stdout.
  - `isWowRoot`, `wowRoot` von innen und oben, leerer Ordner → `null` (Py: WowFolder).
  - `runningFlavors` gemäß §6.4-Tabelle (Py: RunningGame::test_paths_of_all_systems).
  - Linux `/proc`-Leser gegen einen Fake-`/proc`-Ordner (Wurzel injizierbar).
  - `ProcessRunner`-Timeout und Fehler liefern `{ok:false}`.
  - `DarkModeProbe`: Portal `uint32 1`, gsettings `dark`, keine Antwort → `null`.
- **Abnahme**: alle Tests grün, kein Zugriff auf das echte Home, kein Wurf aus Dateisystemfehlern, Windows-Aufrufe ohne Shell und mit `windowsHide`.

### (b) Lua- und ADB-Parser

- **Dateien**: `src/core/wowdata/*.ts`, `tests/unit/wowdata/*.test.ts`.
- **Abhängig von**: `shared/types.ts` (Konstanten `FLAVOR_NAMES`, `CACHE_LANGUAGES`, `BROADCAST_TEXT_TABLE`, `ADB_MAGIC`), `core/fsutil.ts`.
- **Tests**:
  - alle 11 `test_wowdata`-Fälle;
  - neu: eingerückte Schalter mit Tabs/Leerzeichen (E. 6);
  - Literal-Scanner-Randfälle (offenes `"`, `\` am Ende);
  - `.bak` ohne `.lua`;
  - `spokenFlavors` ignoriert Ordner ohne Spoken;
  - Anzeigenamen inkl. `_retail_` → `retail`;
  - `newestTexts` bei Gleichstand: spätere Datei gewinnt;
  - ein Zufalls-Robustheitstest (1000 zufällige Byte-Puffer, kein Wurf).
- **Abnahme**:
  - Envelopes bitgenau (Roundtrip mit `fixtures.contributionsLua`).
  - `clearContributions` gibt `kept` zurück, schreibt über `.spoken-tmp` + rename, löscht `.bak`, liest vor dem Leeren neu.
  - Eine einzige `decodeUtf8`-Funktion wird überall verwendet.

### (c) Server-Client, Upload-Ablauf, Limits

- **Dateien**: `src/core/upload/*.ts`, `tests/helpers/httpFakeServer.ts`, `tests/unit/upload/*.test.ts`.
- **Abhängig von**:
  - Typen `WowData`, `HistoryStore`, `CoreEnv`, `SiteSession`, `HttpTransport`;
  - `core/errors.ts`, `core/time.ts`, `core/fsutil.ts`;
  - (b)/(d) nur zur Laufzeit über `createCore`.
- **Tests**:
  - alle 25 `test_upload`-Fälle (Contributions 8, RateLimit 4, UploadTimes 5, NpcTexts 5, RunningGame 3);
  - neu: Header (`content-type`, `origin`, `user-agent: spoken-contribute/<V4> (Linux|Windows|Darwin)`);
  - Sitzungs-Cookie nach Login wird bei Texten gesendet, nicht über Durchgänge hinweg;
  - Fehlertexte 429/401/5xx mit `error`/`message` (≤ 200 Zeichen)/ohne Detail;
  - Body kein Objekt → „unerwartete Antwort“;
  - Netzfehler, Timeout;
  - kein Passwort in Fehlern oder Logs;
  - `refused` als Zahl oder Objekt;
  - Nicht-Ganzzahlen zählen als 0;
  - Cache, in dem alle Texte zu lang sind (Eintrag `anzahl 0`, Cache gelöscht);
  - Testlauf schreibt nichts (Dateibaum-Hash vorher = nachher, auch `upload-zeiten.json`).
- **Abnahme**:
  - Reihenfolge Lesen → Senden → Archivieren → Leeren/Löschen (E. 1), nachgewiesen durch `onPost`-Haken und Archivfehler-Tests.
  - Alle Berichtstexte wörtlich nach §2.
  - NPC-Uploads zählen nicht in die Upload-Grenze.

### (d) Verlauf, Archiv, Statistik, Suche

- **Dateien**: `src/core/history/*.ts`, `tests/unit/history/*.test.ts`.
- **Abhängig von**: Typen `HistoryStore`, `HistoryViews`, `WowData` (`parseEnvelope`, `summarize`, `envelopesIn`, `flavorName`), `shared/casefold.ts`, `core/time.ts`, `core/fsutil.ts`.
- **Tests**:
  - 4 Python-History-Tests;
  - neu: Schreibreihenfolge (Abbruch vor `eintrag.json` → Eintrag unsichtbar);
  - `-2`-Ordner bei gleicher Sekunde, Sortierung `…-2` vor `…`;
  - Formate byte-nah zu Python (Einrückung 2/1, Schlüsselreihenfolge);
  - `details` für Zeilen/NPC/Fehler/Migriert wörtlich §5.6;
  - Summenzeile und „(gefiltert: x von y)“;
  - Filterlogik §7.4;
  - casefold (`Straße` findet `STRASSE`);
  - Suchcache-Grenze (mit injiziertem kleinem Limit);
  - Abbruch per `AbortSignal`;
  - `daily(30)` über eine Zeitumstellung;
  - Statistik-Text §7.4.
- **Abnahme**: Python-geschriebene Fixture-Einträge (im Test erzeugt im Python-Format) werden korrekt gelesen, Dateien aus TS sind von Python lesbar (endgültig in Phase 4).

### (e) Einstellungen, Anmeldung, safeStorage

- **Dateien**: `src/core/settings/*.ts`, `tests/unit/settings/*.test.ts` (inkl. `FakeSafeStorage` im Testordner des Pakets).
- **Abhängig von**: Typen `SettingsStore`, `LoginStore`, `SecretStore`, `SafeStorageLike`, `core/fsutil.ts`.
- **Tests**:
  - 10 Login-Tests;
  - Einstellungen laden (kaputt/kein Objekt/ungültiges Theme/`auto_upload` nur bei `true`);
  - Suche + Speichern;
  - `persistFound:false` schreibt nichts (E. 9);
  - Schreibfehler beim Speichern des Fundes wird ignoriert;
  - `SafeStorageSecretStore`: `basic_text` → `available()=false`, Kontobindung, beschädigte Datei → Wurf, Rechte 0600 (POSIX);
  - `accountView`: `schluesselbund` / `datei` / `unlesbar` (E. 12);
  - `login.json` exakt `{"email": "a@b.c"}`.
- **Abnahme**:
  - Grundsatz „Passwort immer an mindestens einer Stelle“ ist durch Tests mit `locked`, `forgetful` und nicht schreibbarer `login.json` belegt (Trick: Verzeichnis namens `login.json.tmp` anlegen).
  - Kein echtes `safeStorage` im Test.

### (f) Main-Prozess, preload, IPC, CLI

- **Dateien**: `src/main/*.ts`, `src/preload/preload.ts`, `tests/helpers/sandbox-start.ts`, `tests/unit/main/*.test.ts`, `tests/ui/{launch.ts,security.spec.ts,cli.spec.ts}`, `.github/workflows/electron.yml`.
- **Abhängig von**: `shared/types.ts`, `shared/ipc.ts`, `core/index.ts` (createCore) und die Fabriken aus (a)/(c)/(e) für `env.ts`.
- **Tests**:
  - `parseArgv` (verpackt, unverpackt, Playwright-Schalter, `-psn_`);
  - `runCli` (USAGE 0/2, `--test` migriert nicht und zieht kein Passwort um, ohne WoW Exit 1, failed → 1; Py: CommandLine 2 Tests);
  - Validatoren (Grenzwerte, Zusatzschlüssel, falsche Typen);
  - `uploadController` (zweiter Start → `null`, Ereignisfolge, Auto-Upload 300 ms mit Fake-Timer);
  - `themeLogic` (verspätete Antwort; Py: test_late_answer…);
  - E2E Sicherheit (7.4), CLI der gebauten App in der Sandbox.
- **Abnahme**:
  - Sicherheitsoptionen exakt wie Abschnitt 5;
  - Einzelinstanz;
  - userData nie im Konfig-Ordner der Python-Fassung;
  - `npm run start:sandbox` startet mit Temp-WoW und Fake-Server;
  - keine Log-Dateien.

### (g) Oberfläche beider Fenster inkl. Hell/Dunkel

- **Dateien**: `src/renderer/**` außer `tsconfig.json`/`global.d.ts`, `tests/unit/renderer/*.test.ts`, `tests/ui/{main-window,history-window}.spec.ts`.
- **Abhängig von**: `shared/types.ts`, `shared/ipc.ts` (`SpokenApi`), `shared/casefold.ts`. Bis (f) fertig ist, laufen nur die reinen Tests; die E2E-Tests danach.
- **Tests**:
  - `format.ts`: alle Statuszeilen §7.2, Konto-Hinweise inkl. V1/V2, Bericht;
  - `highlight.ts`: casefold-Zuordnung, ≤ 1000;
  - `chartGeometry.ts`: 70 % Balkenbreite, Beschriftung jeder 5. und letzter Tag, Skala, nichts unter 100×80;
  - E2E 7.5.
- **Abnahme**:
  - alle Texte wörtlich;
  - Farben §7.1 als CSS-Variablen;
  - Tastatur: Enter im WoW-Feld übernimmt, Enter im Login meldet an, Escape schließt Dialog bzw. Verlauf;
  - „Jetzt hochladen“ ist Standardknopf;
  - `<progress>` ohne Wert (120 px) nur während des Uploads;
  - Tabelle mit Spaltenbreiten §7.4, Einzelauswahl, Fehlerfarbe;
  - teilbarer Bereich 1:2;
  - kein `innerHTML`.

### (0) Gerüst und gemeinsame Typen (vom Koordinator vorab)

Schritte:
1. `app/` mit den folgenden Dateien anlegen, `cd app && npm install` (erzeugt `package-lock.json`).
2. Stubs aller `index.ts`-Fabriken (3.2) mit `throw new Error('nicht implementiert')`.
3. Leere Platzhalter `src/main/main.ts`, `src/preload/preload.ts`, `src/renderer/{main,history}/{index.html,*.ts}`, `src/renderer/common/{base,theme}.css`, damit `npm run build` läuft.
4. `.gitignore` ergänzen um `dist-dev/` und `.eslintcache`.
5. Prüfen: `npm run typecheck && npm run lint && npm test` (0 Tests → `--passWithNoTests` beim ersten Lauf).

#### `app/package.json`

```json
{
  "name": "spoken-upload",
  "productName": "Spoken-Upload",
  "version": "3.0.0",
  "private": true,
  "description": "Spoken – Beiträge hochladen (Electron-Fassung)",
  "author": { "name": "Chenmo", "email": "48044372+Colddragon1988@users.noreply.github.com" },
  "homepage": "https://github.com/Colddragon1988/spoken-contribute",
  "type": "module",
  "main": "dist/main/main.cjs",
  "engines": { "node": ">=22.12" },
  "scripts": {
    "build": "node scripts/build.mjs",
    "lint": "eslint .",
    "typecheck": "tsc -p tsconfig.json && tsc -p src/renderer/tsconfig.json",
    "test": "vitest run --project unit",
    "test:gegenprobe": "vitest run --project gegenprobe",
    "test:ui": "npm run build && playwright test",
    "start:sandbox": "npm run build && node dist-dev/sandbox-start.cjs",
    "dist": "npm run build && electron-builder --publish never"
  },
  "devDependencies": {
    "@eslint/js": "^10.0.1",
    "@playwright/test": "^1.64.1",
    "@types/node": "^22.18.0",
    "electron": "45.0.0",
    "electron-builder": "^26.18.0",
    "esbuild": "^0.28.2",
    "eslint": "^10.13.0",
    "globals": "^17.13.0",
    "typescript": "~6.0.3",
    "typescript-eslint": "^8.72.1",
    "vitest": "^5.0.5"
  }
}
```

`@types/node` auf 22 bleibt der gemeinsame Nenner für vitest unter Node 22. Der Main nutzt nur APIs, die in Node 22 vorhanden sind.

#### `app/tsconfig.base.json`

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "useUnknownInCatchVariables": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "noEmit": true
  }
}
```

#### `app/tsconfig.json` (Node-Seite, Standard für Editor und typecheck)

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023"],
    "types": ["node"]
  },
  "include": [
    "src/shared/**/*.ts",
    "src/core/**/*.ts",
    "src/main/**/*.ts",
    "src/preload/**/*.ts",
    "tests/**/*.ts",
    "vitest.config.ts",
    "playwright.config.ts"
  ],
  "exclude": ["src/renderer/**", "dist", "dist-dev", "release", "node_modules"]
}
```

Reine Renderer-Module (`format.ts`, `highlight.ts`, `chartGeometry.ts`) werden über Tests mit eingebunden. Sie dürfen deshalb keine DOM-Typen benutzen.

#### `app/src/renderer/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": []
  },
  "include": ["./**/*.ts", "../shared/**/*.ts"]
}
```

#### `app/src/renderer/global.d.ts`

```ts
import type { SpokenApi } from '../shared/ipc';

declare global {
  interface Window {
    readonly spoken: SpokenApi;
  }
}
export {};
```

#### `app/eslint.config.js`

```js
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const noHtmlInjection = [
  'error',
  { selector: "AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]", message: 'Nur textContent/DOM-API benutzen (CSP, XSS).' },
  { selector: "CallExpression[callee.property.name='insertAdjacentHTML']", message: 'Nur DOM-API benutzen.' },
  { selector: "CallExpression[callee.property.name='setAttribute'][arguments.0.value='style']", message: 'style-Attribut verstößt gegen die CSP; element.style benutzen.' },
];

export default defineConfig([
  globalIgnores(['dist/', 'dist-dev/', 'release/', 'coverage/', 'test-results/', 'playwright-report/', 'node_modules/']),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{ name: 'electron', message: 'shared bleibt ohne Electron.' }],
        patterns: [{ group: ['node:*', '../core/*', '../main/*', '../preload/*', '../renderer/*'], message: 'shared importiert nur shared.' }],
      }],
    },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-console': 'error',
      'no-restricted-imports': ['error', {
        paths: [{ name: 'electron', message: 'Der Kern läuft ohne Electron (testbar ohne Fenster).' }],
        patterns: [{ group: ['**/main/*', '**/preload/*', '**/renderer/*'], message: 'Der Kern kennt main/preload/renderer nicht.' }],
      }],
    },
  },
  {
    files: ['src/core/**/*.ts'],
    ignores: ['src/core/upload/fetchTransport.ts'],
    rules: { 'no-restricted-globals': ['error', { name: 'fetch', message: 'Netz nur über HttpTransport.' }] },
  },
  {
    files: ['src/renderer/**/*.ts'],
    languageOptions: { globals: globals.browser },
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{ name: 'electron', message: 'Der Renderer spricht nur über window.spoken.' }],
        patterns: [{ group: ['node:*', '**/core/*', '**/core/**', '**/main/*', '**/preload/*'], message: 'Der Renderer spricht nur über window.spoken.' }],
      }],
      'no-restricted-syntax': noHtmlInjection,
    },
  },
]);
```

#### `app/vitest.config.ts`

```ts
import { defineConfig } from 'vitest/config';

const shared = {
  environment: 'node' as const,
  setupFiles: ['tests/helpers/setup.ts'],
  env: { TZ: 'Europe/Berlin' },
  pool: 'forks' as const,
};

export default defineConfig({
  test: {
    projects: [
      { test: { ...shared, name: 'unit', include: ['tests/unit/**/*.test.ts'], testTimeout: 20_000 } },
      { test: { ...shared, name: 'gegenprobe', include: ['tests/gegenprobe/**/*.test.ts'], testTimeout: 300_000 } },
    ],
  },
});
```

#### `app/playwright.config.ts`

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/ui',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
});
```

#### `app/electron-builder.yml`

```yaml
appId: io.github.colddragon1988.spokenupload
productName: Spoken-Upload
directories:
  output: release
  buildResources: build
files:
  - dist/**/*
  - package.json
  - "!dist-dev/**"
asar: true
electronFuses:
  runAsNode: false
  enableCookieEncryption: false
  enableNodeOptionsEnvironmentVariable: false
  enableNodeCliInspectArguments: false
  enableEmbeddedAsarIntegrityValidation: true
  onlyLoadAppFromAsar: true
  grantFileProtocolExtraPrivileges: false
linux:
  target: [AppImage, deb]
  executableName: spoken-upload
  category: Utility
  maintainer: "Chenmo <48044372+Colddragon1988@users.noreply.github.com>"
win:
  target: nsis
nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
mac:
  target: dmg
  category: public.app-category.utilities
```

Das Icon (`build/icon.png`, 512×512) liefert (g) später nach. Ohne Icon nimmt electron-builder das Standard-Icon.

#### `app/scripts/build.mjs`

```js
import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

const common = { bundle: true, sourcemap: 'linked', legalComments: 'none', logLevel: 'info' };
const node = { ...common, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], outExtension: { '.js': '.cjs' } };

await rm('dist', { recursive: true, force: true });
await rm('dist-dev', { recursive: true, force: true });

await build({ ...node, entryPoints: { main: 'src/main/main.ts' }, outdir: 'dist/main' });
await build({ ...node, entryPoints: { preload: 'src/preload/preload.ts' }, outdir: 'dist/preload' });
await build({
  ...common, platform: 'browser', format: 'iife', target: 'es2023',
  entryPoints: { 'main/main': 'src/renderer/main/main.ts', 'history/history': 'src/renderer/history/history.ts' },
  outdir: 'dist/renderer',
});
for (const page of ['main', 'history']) {
  await mkdir(`dist/renderer/${page}`, { recursive: true });
  await cp(`src/renderer/${page}/index.html`, `dist/renderer/${page}/index.html`);
}
await cp('src/renderer/common', 'dist/renderer/common', { recursive: true, filter: (src) => !src.endsWith('.ts') });
await build({ ...node, entryPoints: { 'sandbox-start': 'tests/helpers/sandbox-start.ts' }, outdir: 'dist-dev' });
```

Die HTML-Dateien binden `../common/base.css`, `../common/theme.css` und `./main.js` bzw. `./history.js` mit `<script src="…" defer>` ein. Bis (f) `sandbox-start.ts` liefert, legt (0) dafür einen leeren Platzhalter an.

#### `app/src/shared/types.ts` (vollständig)

```ts
/**
 * Gemeinsame Typen, Schnittstellen und Konstanten der Electron-Fassung (Paket 0).
 * Keine Imports, keine Node-/Electron-/DOM-Abhängigkeiten – auch der Renderer importiert diese Datei.
 * Änderungen nur durch den Koordinator.
 */

// ------------------------------------------------------------------ JSON
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
export interface JsonObject {
  [key: string]: JsonValue;
}

// ------------------------------------------------------------------ Konstanten
/** Ordnername der Fachdaten – identisch mit der Python-Fassung (§6.1). */
export const APP_DIR_NAME = 'spoken-contribute';
/** Eigener Electron-userData-Ordner (Entscheidung 16). */
export const USER_DATA_DIR_NAME = 'spoken-upload-electron';
export const SITE_URL = 'https://spoken.rusty.one';
export const REGISTER_URL = 'https://spoken.rusty.one/deDE/register';
/** Version im user-agent `spoken-contribute/{CLIENT_VERSION} ({System})` – siehe V4. */
export const CLIENT_VERSION = '3.0';

export const FILES = {
  settings: 'settings.json',
  login: 'login.json',
  secret: 'passwort.safestorage',
  uploadTimes: 'upload-zeiten.json',
  history: 'verlauf',
} as const;

export const MAX_ENVELOPES = 2000;
export const BROADCAST_BATCH = 5000;
export const MAX_TEXT_LENGTH = 4000;
export const UPLOADS_PER_HOUR = 10;
export const REQUEST_TIMEOUT_MS = 120_000;
export const SEARCH_CACHE_CHARS = 30_000_000;
export const MAX_HIGHLIGHTS = 1000;
export const DAILY_DAYS = 30;
export const AUTO_UPLOAD_DELAY_MS = 300;
export const SEARCH_DEBOUNCE_MS = 250;
export const THEME_POLL_MS = 10_000;

export const ADB_MAGIC = 0x48544658;
export const BROADCAST_TEXT_TABLE = 0x021826bb;
export const CACHE_LANGUAGES: readonly string[] = [
  'enUS', 'enGB', 'deDE', 'esES', 'esMX', 'frFR', 'koKR', 'ptBR', 'ruRU', 'zhCN', 'zhTW',
];
export const FLAVOR_NAMES: Readonly<Record<string, string>> = {
  _classic_era_: 'Classic Era',
  _forever_: 'WoW Forever',
  _classic_: 'Classic',
  _anniversary_: 'Anniversary',
  _ptr_: 'PTR',
  _classic_ptr_: 'Classic PTR',
};

// ------------------------------------------------------------------ Plattform
export type Platform = 'linux' | 'win32' | 'darwin';
export type EnvVars = Readonly<Record<string, string | undefined>>;

export interface AppPaths {
  /** settings.json, login.json, passwort.safestorage */
  readonly configDir: string;
  /** upload-zeiten.json, verlauf/, Alt-Archiv */
  readonly dataDir: string;
  readonly home: string;
}

export interface Clock {
  now(): Date;
}

export interface ProcessResult {
  readonly ok: boolean;
  readonly stdout: string;
}

export interface ProcessRunner {
  /** Programm ohne Shell und ohne Konsolenfenster starten. Wirft nie: Fehler/Timeout → { ok: false, stdout: '' }. */
  run(command: string, args: readonly string[], options: { readonly timeoutMs: number }): Promise<ProcessResult>;
}

export interface ProcessSource {
  /** Programmpfade aller laufenden Prozesse, getrimmt, ohne leere. Fehler → []. */
  listPrograms(): Promise<string[]>;
}

/** Kleingeschriebene Versionsordner laufender Clients ("_classic_era_"); null = WoW läuft, Version unbekannt. */
export type RunningFlavors = ReadonlySet<string> | null;

export interface WowLocator {
  isWowRoot(path: string): Promise<boolean>;
  wowRoot(path: string): Promise<string | null>;
  findWow(): Promise<string | null>;
}

export interface DarkModeProbe {
  /** Systemeinstellung dunkel? null = keine Antwort. */
  prefersDark(): Promise<boolean | null>;
}

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/** Fortschrittsmeldung eines Upload-Durchgangs (eine Zeile). */
export type ProgressLog = (line: string) => void;

// ------------------------------------------------------------------ HTTP
export interface HttpRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly timeoutMs: number;
}

export interface HttpResponse {
  readonly status: number;
  readonly setCookies: readonly string[];
  readonly body: string;
}

export interface HttpTransport {
  /** POST senden. Wirft NetworkError bei Verbindungs-/Timeout-Fehlern, nie wegen eines HTTP-Status. */
  post(request: HttpRequest): Promise<HttpResponse>;
}

export type ApiPath = '/api/auth/sign-in/email' | '/api/contributions/batch' | '/api/broadcast-text';

/** Eine Website-Sitzung (Cookie-Jar) für genau einen Durchgang bzw. eine Anmeldeprüfung. */
export interface SiteSession {
  /** JSON senden; jede Störung wird zur UploadError mit Nutzertext (§3.1). */
  post(path: ApiPath, payload: JsonValue, what: string): Promise<JsonObject>;
  /** Anmelden; 401 → UploadError("Anmeldung abgelehnt – E-Mail oder Passwort stimmen nicht.", 401). Liefert user oder {}. */
  signIn(email: string, password: string): Promise<JsonObject>;
}

export type SiteFactory = () => SiteSession;

// ------------------------------------------------------------------ Schlüsselbund
export type SecretBackend = 'system' | 'basic_text' | 'none';

export interface SecretStore {
  /** Wie Python priority > 0: Nur dann zieht das Passwort aus login.json heraus. */
  available(): boolean;
  /** Für die Anzeige (basic_text → ehrlicher Hinweis). */
  backend(): SecretBackend;
  /** null = kein Eintrag; wirft bei gesperrt/abgelehnt/nicht entschlüsselbar. */
  get(account: string): Promise<string | null>;
  /** wirft bei Fehler; Erfolg wird vom Aufrufer per get() verifiziert. */
  set(account: string, password: string): Promise<void>;
  /** wirft, wenn kein Eintrag da ist oder der Zugriff scheitert. */
  delete(account: string): Promise<void>;
}

/** Struktureller Ausschnitt von Electrons safeStorage (der Main reicht einen Adapter herein). */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Uint8Array;
  decryptString(encrypted: Uint8Array): string;
  /** nur unter Linux vorhanden */
  getSelectedStorageBackend?: () => string;
}

// ------------------------------------------------------------------ WoW-Daten
export interface Flavor {
  /** absoluter Pfad des Versionsordners */
  readonly dir: string;
  /** Ordnername wie "_classic_era_" */
  readonly folder: string;
  /** Anzeigename wie "Classic Era" */
  readonly name: string;
}

export interface ContributionStore {
  readonly flavor: Flavor;
  /** Pfad der .lua (auch wenn nur die .bak existiert) */
  readonly lua: string;
  /** Umschläge aus .lua + .bak, ohne Doppelte, Reihenfolge des ersten Auftretens */
  readonly envelopes: readonly string[];
}

/** Felder eines Umschlags inkl. "source", Reihenfolge des ersten Auftretens, erster Wert gewinnt. */
export type EnvelopeFields = ReadonlyMap<string, string>;

export interface Summary {
  readonly kinds: string;
  readonly titles: readonly string[];
}

export interface BroadcastRow {
  readonly id: number;
  readonly text: string;
  readonly text1: string;
}

export type TextsByBuild = ReadonlyMap<number, readonly BroadcastRow[]>;

export interface ParsedCache {
  readonly build: number;
  readonly texts: ReadonlyMap<number, BroadcastRow>;
}

export interface WowData {
  flavorName(folder: string): string;
  spokenFlavors(wow: string): Promise<Flavor[]>;
  envelopesIn(path: string): Promise<string[]>;
  collectContributions(flavors: readonly Flavor[]): Promise<ContributionStore[]>;
  /** Leert gesendete Dateien (§2.4); liefert die unberührt gelassenen .lua-Pfade. Wirft Dateifehler. */
  clearContributions(files: readonly string[], sent: ReadonlySet<string>): Promise<string[]>;
  parseEnvelope(envelope: string): EnvelopeFields;
  summarize(envelopes: readonly string[]): Summary;
  cacheFolders(flavors: readonly Flavor[]): Promise<string[]>;
  cacheFiles(folder: string): Promise<string[]>;
  newestTexts(files: readonly string[]): Promise<TextsByBuild>;
}

// ------------------------------------------------------------------ Upload
export interface Outcome {
  readonly text: string;
  readonly sent: boolean;
  readonly failed: boolean;
}

export interface Report {
  readonly head: string;
  readonly sections: readonly string[];
  readonly failed: boolean;
}

export interface Overview {
  /** Anzeigenamen aller Versionen mit Spoken */
  readonly flavors: readonly string[];
  /** Anzeigenamen laufender Versionen; null = WoW läuft, Version unbekannt */
  readonly running: readonly string[] | null;
  readonly lines: number;
  readonly texts: number;
  readonly uploadsLeft: number;
  /** "HH:MM" Ortszeit, ab wann wieder ein Zeilen-Upload geht; null = sofort */
  readonly freeAt: string | null;
}

export interface Credentials {
  readonly email: string;
  /** null = Schlüsselbund gab nichts heraus */
  readonly password: string | null;
}

export interface RunOptions {
  readonly test: boolean;
  readonly log: ProgressLog;
}

export interface Uploader {
  run(wow: string, credentials: Credentials | null, options: RunOptions): Promise<Report>;
  overview(wow: string): Promise<Overview>;
}

// ------------------------------------------------------------------ Verlauf
export type HistoryKind = 'zeilen' | 'npc-texte';

export interface HistoryEntry {
  /** Ordnername unter verlauf/ */
  readonly id: string;
  readonly folder: string;
  /** Inhalt von eintrag.json */
  readonly info: JsonObject;
  /** Zeitpunkt (ohne Zeitzone gelesen = Ortszeit) */
  readonly time: Date;
  readonly failed: boolean;
}

export interface RecordInput {
  readonly kind: HistoryKind;
  readonly info: JsonObject;
  readonly payload?: JsonValue;
  /** Quelle → Name unter originale/ */
  readonly originals?: readonly { readonly source: string; readonly name: string }[];
  readonly when?: Date;
}

export interface HistoryStore {
  /** <dataDir>/verlauf */
  readonly root: string;
  record(input: RecordInput): Promise<HistoryEntry>;
  /** neueste zuerst (Zeit, dann Ordnername absteigend) */
  entries(): Promise<HistoryEntry[]>;
  payload(entry: HistoryEntry): Promise<JsonObject | null>;
  migrateOldArchive(): Promise<void>;
}

export type ArtFilter = 'alle' | 'zeilen' | 'npc-texte' | 'fehlgeschlagen';

export interface HistoryFilter {
  readonly search: string;
  readonly art: ArtFilter;
  /** '' = Alle */
  readonly version: string;
}

export interface HistoryRow {
  readonly id: string;
  readonly zeit: string;
  readonly art: string;
  readonly version: string;
  readonly anzahl: string;
  readonly ergebnis: string;
  readonly failed: boolean;
}

export interface DailyValue {
  /** "YYYY-MM-DD" Ortszeit */
  readonly day: string;
  readonly lines: number;
  readonly texts: number;
}

export interface StatisticsView {
  /** "Statistik" bzw. "Statistik (gefiltert)" */
  readonly heading: string;
  readonly lines: readonly string[];
}

export interface HistoryQueryResult {
  readonly rows: readonly HistoryRow[];
  /** sortierte, eindeutige Versionen aller Einträge (für die Auswahl) */
  readonly versions: readonly string[];
  /** Summenzeile bzw. Hinweis (§7.4) */
  readonly summary: string;
  readonly statistics: StatisticsView;
  readonly daily: readonly DailyValue[];
}

export interface DetailsView {
  readonly id: string;
  /** erste Zeile (fett) */
  readonly heading: string;
  /** übrige Zeilen */
  readonly body: string;
}

export interface HistoryViews {
  /** filtert und durchsucht; wirft AbortError bei Abbruch */
  query(filter: HistoryFilter, signal: AbortSignal): Promise<HistoryQueryResult>;
  details(id: string): Promise<DetailsView | null>;
  /** absoluter Ordner eines Eintrags, nur wenn die id in entries() vorkommt */
  folderOf(id: string): Promise<string | null>;
  /** Eintragsliste neu lesen (Suchcache bleibt) */
  reload(): void;
}

// ------------------------------------------------------------------ Einstellungen und Anmeldung
export type ThemeSetting = 'system' | 'hell' | 'dunkel';
export const THEME_LABELS: Readonly<Record<ThemeSetting, string>> = {
  system: 'Wie System',
  hell: 'Hell',
  dunkel: 'Dunkel',
};

export interface Settings {
  readonly wowDir: string;
  readonly autoUpload: boolean;
  readonly theme: ThemeSetting;
}

export interface SettingsStore {
  /** persistFound=false: ein gefundener WoW-Ordner wird nur im Speicher benutzt (Entscheidung 9). */
  load(options: { readonly persistFound: boolean }): Promise<Settings>;
  save(settings: Settings): Promise<void>;
}

export type PasswordPlace = 'schluesselbund' | 'datei' | 'unlesbar';

export interface AccountView {
  readonly email: string | null;
  /** null = nicht angemeldet */
  readonly place: PasswordPlace | null;
  readonly backend: SecretBackend;
}

export interface LoginStore {
  /** E-Mail aus login.json; öffnet den Schlüsselbund nicht. */
  account(): Promise<string | null>;
  /** nur aus login.json abgeleitet (wie Python) */
  passwordInKeyring(): Promise<boolean>;
  /** prüft tatsächlich (Entscheidung 12); kann eine Entsperrabfrage auslösen */
  accountView(): Promise<AccountView>;
  credentials(): Promise<Credentials | null>;
  saveLogin(email: string, password: string): Promise<void>;
  /** wirft, wenn login.json nicht geschrieben werden kann */
  movePasswordToKeyring(): Promise<void>;
  /** false = Passwort womöglich noch im Schlüsselbund; abgemeldet ist man trotzdem */
  deleteLogin(): Promise<boolean>;
}

// ------------------------------------------------------------------ Verdrahtung
export interface CoreEnv {
  readonly platform: Platform;
  readonly paths: AppPaths;
  readonly clock: Clock;
  readonly running: () => Promise<RunningFlavors>;
  readonly secrets: SecretStore;
  readonly openSite: SiteFactory;
  readonly wow: WowLocator;
  readonly logger: Logger;
}

export interface Core {
  readonly env: CoreEnv;
  readonly wowData: WowData;
  readonly history: HistoryStore;
  readonly historyViews: HistoryViews;
  readonly settings: SettingsStore;
  readonly login: LoginStore;
  readonly uploader: Uploader;
}
```

#### `app/src/shared/ipc.ts` (vollständig)

```ts
import type {
  AccountView, ArtFilter, DetailsView, HistoryFilter, HistoryQueryResult, Overview,
  Platform, Report, Settings, ThemeSetting,
} from './types';

export const CHANNELS = {
  getState: 'app:get-state',
  setWowDir: 'wow:set-dir',
  chooseWowDir: 'wow:choose-dir',
  findWow: 'wow:find',
  getOverview: 'wow:overview',
  setAutoUpload: 'settings:set-auto-upload',
  setTheme: 'settings:set-theme',
  getAccount: 'account:get',
  signIn: 'account:sign-in',
  signOut: 'account:sign-out',
  startUpload: 'upload:start',
  openHistory: 'history:open',
  queryHistory: 'history:query',
  historyDetails: 'history:details',
  openEntryFolder: 'history:open-folder',
  openArchive: 'history:open-archive',
  openRegister: 'app:open-register',
  closeWindow: 'window:close',
  showMessage: 'dialog:message',
} as const;

export const EVENTS = {
  upload: 'event:upload',
  theme: 'event:theme',
  historyChanged: 'event:history-changed',
} as const;

export const LIMITS = {
  path: 4096,
  email: 320,
  password: 1024,
  search: 1000,
  version: 200,
  entryId: 200,
  title: 200,
  messageText: 20_000,
} as const;

export const ART_FILTERS: readonly ArtFilter[] = ['alle', 'zeilen', 'npc-texte', 'fehlgeschlagen'];
export const THEME_SETTINGS: readonly ThemeSetting[] = ['system', 'hell', 'dunkel'];

export interface ThemeView {
  readonly setting: ThemeSetting;
  readonly dark: boolean;
}

export interface AppState {
  readonly version: string;
  readonly platform: Platform;
  readonly settings: Settings;
  readonly uploadRunning: boolean;
  readonly theme: ThemeView;
}

export interface SaveResult {
  /** null = gespeichert; sonst Fehlertext für „Die Einstellungen ließen sich nicht speichern ({err}). …“ */
  readonly saveError: string | null;
}

export interface SetWowDirResult extends SaveResult {
  readonly wowDir: string;
}

export type OverviewResult =
  | { readonly wowDir: string; readonly kind: 'keinWow' }
  | { readonly wowDir: string; readonly kind: 'fehler'; readonly message: string }
  | { readonly wowDir: string; readonly kind: 'ok'; readonly overview: Overview };

export type SignInResult =
  | { readonly ok: true; readonly account: AccountView }
  | { readonly ok: false; readonly message: string };

export type UploadEvent =
  | { readonly type: 'gestartet'; readonly test: boolean }
  | { readonly type: 'fortschritt'; readonly line: string }
  | { readonly type: 'fertig'; readonly report: Report };

export interface HistoryQuery extends HistoryFilter {
  readonly seq: number;
}

export type HistoryQueryAnswer =
  | { readonly seq: number; readonly status: 'ok'; readonly result: HistoryQueryResult }
  | { readonly seq: number; readonly status: 'abgebrochen' }
  | { readonly seq: number; readonly status: 'fehler'; readonly message: string };

export interface MessageRequest {
  readonly kind: 'info' | 'warnung' | 'fehler';
  readonly title: string;
  readonly text: string;
}

export type Unsubscribe = () => void;

/** Vertrag des preload-Skripts: window.spoken */
export interface SpokenApi {
  getState(): Promise<AppState>;
  setWowDir(text: string): Promise<SetWowDirResult>;
  chooseWowDir(): Promise<string | null>;
  findWow(): Promise<string | null>;
  getOverview(wowDir: string): Promise<OverviewResult>;
  setAutoUpload(value: boolean): Promise<SaveResult>;
  setTheme(theme: ThemeSetting): Promise<SaveResult>;
  getAccount(): Promise<AccountView>;
  signIn(email: string, password: string): Promise<SignInResult>;
  signOut(): Promise<AccountView>;
  /** null = es lief schon ein Upload */
  startUpload(test: boolean): Promise<Report | null>;
  openHistory(): Promise<void>;
  queryHistory(query: HistoryQuery): Promise<HistoryQueryAnswer>;
  historyDetails(id: string): Promise<DetailsView | null>;
  openEntryFolder(id: string): Promise<void>;
  openArchive(): Promise<void>;
  openRegister(): Promise<void>;
  closeWindow(): Promise<void>;
  showMessage(message: MessageRequest): Promise<void>;
  onUpload(listener: (event: UploadEvent) => void): Unsubscribe;
  onTheme(listener: (theme: ThemeView) => void): Unsubscribe;
  onHistoryChanged(listener: () => void): Unsubscribe;
}
```

#### `app/src/shared/casefold.ts`

```ts
/** Kleinschreibung wie Python casefold für die relevanten Fälle (Entscheidung 18). Für Suche UND Hervorhebung. */
const SPECIAL: Readonly<Record<string, string>> = {
  'ß': 'ss', 'ſ': 's', 'ς': 'σ', 'µ': 'μ',
  'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st',
};
const SPECIAL_PATTERN = /[ßſςµ\uFB00-\uFB06]/gu;

export function casefold(text: string): string {
  return text.toLowerCase().replace(SPECIAL_PATTERN, (ch) => SPECIAL[ch] ?? ch);
}

/** Gefalteter Text plus Rückabbildung: origin[i] = UTF-16-Index im Original für Zeichen i des gefalteten Texts. */
export function casefoldMapped(text: string): { folded: string; origin: number[] } {
  let folded = '';
  const origin: number[] = [];
  let index = 0;
  for (const ch of text) {
    const part = casefold(ch);
    folded += part;
    for (let k = 0; k < part.length; k++) origin.push(index);
    index += ch.length;
  }
  origin.push(index);
  return { folded, origin };
}
```

#### `app/src/core/errors.ts`

```ts
/** Erwarteter Fehler mit fertiger Meldung für den Nutzer; status = HTTP-Code, falls einer. */
export class UploadError extends Error {
  override readonly name = 'UploadError';
  constructor(message: string, readonly status: number | null = null) {
    super(message);
  }
}

/** Verbindungs-/Timeout-Fehler des HttpTransport (wird in SiteSession zur UploadError). */
export class NetworkError extends Error {
  override readonly name = 'NetworkError';
}

/** Entspricht Pythons str(err). */
export function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Entspricht Pythons repr(err) – Entscheidung 13: String(err). */
export function errRepr(err: unknown): string {
  return String(err);
}
```

#### `app/src/core/time.ts`

```ts
const p2 = (n: number): string => String(n).padStart(2, '0');

export function formatDayKey(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, '0')}-${p2(date.getMonth() + 1)}-${p2(date.getDate())}`;
}

/** "2026-10-25T14:03:12+01:00" – Ortszeit mit Offset, Sekunden (Entscheidung 21). */
export function formatIsoLocal(date: Date): string {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return `${formatDayKey(date)}T${p2(date.getHours())}:${p2(date.getMinutes())}:${p2(date.getSeconds())}` +
    `${sign}${p2(Math.floor(abs / 60))}:${p2(abs % 60)}`;
}

/** "2026-10-25_14-03-12" für Verlaufsordner. */
export function folderStamp(date: Date): string {
  return `${formatDayKey(date)}_${p2(date.getHours())}-${p2(date.getMinutes())}-${p2(date.getSeconds())}`;
}

export const formatClock = (date: Date): string => `${p2(date.getHours())}:${p2(date.getMinutes())}`;
export const formatDate = (date: Date): string =>
  `${p2(date.getDate())}.${p2(date.getMonth() + 1)}.${String(date.getFullYear()).padStart(4, '0')}`;
/** Tabellenspalte: "dd.mm.YYYY  HH:MM" (zwei Leerzeichen) */
export const formatTableTime = (date: Date): string => `${formatDate(date)}  ${formatClock(date)}`;
/** Detailüberschrift: "dd.mm.YYYY um HH:MM:SS" */
export const formatDetailsTime = (date: Date): string =>
  `${formatDate(date)} um ${formatClock(date)}:${p2(date.getSeconds())}`;
/** Diagramm: "dd.mm." */
export const formatShortDay = (date: Date): string => `${p2(date.getDate())}.${p2(date.getMonth() + 1)}.`;

export const addHours = (date: Date, hours: number): Date => new Date(date.getTime() + hours * 3_600_000);

export interface ParsedTime {
  readonly date: Date;
  readonly hasOffset: boolean;
}

const ISO_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,6}))?)?(Z|[+-]\d{2}(?::?\d{2})?)?$/;

function daysInMonth(year: number, month: number): number {
  const d = new Date(0);
  d.setUTCFullYear(year, month, 0);
  return d.getUTCDate();
}

/** ISO-8601 lesen (wie Pythons fromisoformat für die vorkommenden Formen). Ohne Offset = Ortszeit. */
export function parseIso(text: unknown): ParsedTime | null {
  if (typeof text !== 'string') return null;
  const m = ISO_PATTERN.exec(text);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6] ?? '0');
  const millis = m[7] === undefined ? 0 : Math.floor(Number(m[7].padEnd(6, '0')) / 1000);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month) ||
      hour > 23 || minute > 59 || second > 59) {
    return null;
  }
  const zone = m[8];
  if (zone === undefined) {
    const local = new Date(2000, 0, 1, hour, minute, second, millis);
    local.setFullYear(year, month - 1, day);
    return { date: local, hasOffset: false };
  }
  let offsetMinutes = 0;
  if (zone !== 'Z') {
    const digits = zone.slice(1).replace(':', '');
    const oh = Number(digits.slice(0, 2));
    const om = Number(digits.slice(2) || '0');
    if (oh > 23 || om > 59) return null;
    offsetMinutes = (zone.startsWith('-') ? -1 : 1) * (oh * 60 + om);
  }
  const utc = new Date(0);
  utc.setUTCFullYear(year, month - 1, day);
  utc.setUTCHours(hour, minute, second, millis);
  return { date: new Date(utc.getTime() - offsetMinutes * 60_000), hasOffset: true };
}
```

#### `app/src/core/fsutil.ts`

```ts
import { chmod, mkdir, open, readFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { JsonObject } from '../shared/types';

const POSIX = process.platform !== 'win32';

/** Atomar schreiben (§6.1): <datei>.tmp, fsync, rename. private: Datei 0600, neuer Ordner 0700. */
export async function writeFileAtomic(
  path: string, data: string | Uint8Array, options: { readonly private?: boolean } = {},
): Promise<void> {
  const isPrivate = options.private === true;
  await mkdir(dirname(path), { recursive: true, mode: isPrivate ? 0o700 : 0o777 });
  const tmp = `${path}.tmp`;
  const handle = await open(tmp, 'w', isPrivate ? 0o600 : 0o666);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  if (POSIX && isPrivate) await chmod(tmp, 0o600);
  await rename(tmp, path);
}

/** JSON-Objekt lesen; fehlt die Datei, ist sie kaputt oder kein Objekt: null. */
export async function readJsonObject(path: string): Promise<JsonObject | null> {
  try {
    const value: unknown = JSON.parse(await readFile(path, 'utf8'));
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as JsonObject) : null;
  } catch {
    return null;
  }
}
```

#### `app/src/core/index.ts`

```ts
import type { Core, CoreEnv } from '../shared/types';
import { createHistoryStore, createHistoryViews } from './history';
import { createLoginStore, createSettingsStore } from './settings';
import { createUploader } from './upload';
import { createWowData } from './wowdata';

/** Verdrahtet den Kern. Einziger Ort, an dem die Pakete (b)–(e) zusammenkommen. */
export function createCore(env: CoreEnv): Core {
  const wowData = createWowData();
  const history = createHistoryStore({ dataDir: env.paths.dataDir, clock: env.clock, wowData });
  const historyViews = createHistoryViews({ store: history, wowData, clock: env.clock });
  const settings = createSettingsStore({ configDir: env.paths.configDir, findWow: () => env.wow.findWow() });
  const login = createLoginStore({ configDir: env.paths.configDir, secrets: env.secrets });
  const uploader = createUploader({ env, wowData, history });
  return { env, wowData, history, historyViews, settings, login, uploader };
}
```

#### `app/tests/helpers/setup.ts`

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Regel 1: Selbst ein versehentlicher Zugriff auf Standardpfade landet in einem Temp-Ordner.
const home = mkdtempSync(join(tmpdir(), 'spoken-home-'));
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.XDG_CONFIG_HOME = join(home, '.config');
process.env.XDG_DATA_HOME = join(home, '.local', 'share');
process.env.APPDATA = join(home, 'AppData', 'Roaming');
process.env.LOCALAPPDATA = join(home, 'AppData', 'Local');
delete process.env.WINEPREFIX;

// Regel 2: Netz nur zu 127.0.0.1/localhost.
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
    return Promise.reject(new Error(`Test wollte ins Netz: ${url.host}`));
  }
  return realFetch(input, init);
}) as typeof fetch;

if (new Date(2026, 0, 15).getTimezoneOffset() !== -60) {
  throw new Error('Tests erwarten TZ=Europe/Berlin (vitest.config.ts).');
}
```

#### `app/tests/helpers/fixtures.ts`

```ts
import { Buffer } from 'node:buffer';
import { ADB_MAGIC, BROADCAST_TEXT_TABLE } from '../../src/shared/types';

/** Ein Umschlag wie vom Addon (wie tests/helpers.py envelope). */
export function envelope(n: number, source = 'quests', text?: string): string {
  const title = source === 'quests' ? `Quest ${n}` : `Buch ${n}`;
  const key = source === 'quests' ? 'title' : 'book';
  const body = text ?? `Text ${n} mit Ümläuten, "Zitat" und \\Backslash`;
  return `!SPOKEN1 ${source}\nquest=${n}\nevent=progress\nnpc=${n} Händler ${n}\n${key}=${title}\n` +
    `text<<\n${body}\n>>\nsum=${n}\n`;
}

export function luaString(text: string): string {
  return '"' + text.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n') + '"';
}

/** SpokenContributions.lua wie WoW sie schreibt (unter Windows/Wine mit CRLF). */
export function contributionsLua(envelopes: readonly string[], options: { crlf?: boolean; flags?: boolean; indent?: string } = {}): Buffer {
  const { crlf = true, flags = true, indent = '' } = options;
  const lines = ['', 'SpokenContributionsDB = {'];
  if (flags) lines.push(`${indent}["Enabled"] = true,`);
  lines.push(`${indent}["Lines"] = {`);
  envelopes.forEach((env, i) => {
    lines.push('{', `["key"] = "k${i}",`, `["envelope"] = ${luaString(env)},`, '},');
  });
  lines.push('},');
  if (flags) lines.push(`${indent}["Introduced"] = false,`);
  lines.push('}', '');
  return Buffer.from(lines.join(crlf ? '\r\n' : '\n'), 'utf8');
}

/** DBCache.bin mit BroadcastText-Einträgen (id, männlich, weiblich). */
export function dbcache(build: number, rows: readonly (readonly [number, string, string])[], status = 1, table = BROADCAST_TEXT_TABLE): Buffer {
  const head = Buffer.alloc(44);
  head.writeUInt32LE(ADB_MAGIC, 0);
  head.writeUInt32LE(1, 4);
  head.writeUInt32LE(build, 8);
  const parts: Buffer[] = [head];
  for (const [id, text, text1] of rows) {
    const data = Buffer.concat([Buffer.from(text, 'utf8'), Buffer.from([0]), Buffer.from(text1, 'utf8'), Buffer.from([0]), Buffer.alloc(8)]);
    const entry = Buffer.alloc(32);
    entry.writeUInt32LE(ADB_MAGIC, 0);
    entry.writeUInt32LE(table, 16);
    entry.writeUInt32LE(id, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt32LE(status, 28);
    parts.push(entry, data);
  }
  return Buffer.concat(parts);
}
```

#### `app/tests/helpers/fakeKeyring.ts`

```ts
import type { SecretBackend, SecretStore } from '../../src/shared/types';

/** Vorgetäuschter Schlüsselbund. kind 'none' = keiner vorhanden (Standard wie die Python-Sandbox). */
export class FakeKeyring implements SecretStore {
  readonly store = new Map<string, string>();
  locked = false;
  /** meldet Erfolg, speichert aber nichts (Verifikationstest) */
  forgetful = false;

  constructor(public kind: SecretBackend = 'none') {}

  available(): boolean {
    return this.kind === 'system';
  }

  backend(): SecretBackend {
    return this.kind;
  }

  private check(): void {
    if (this.locked) throw new Error('Schlüsselbund gesperrt');
  }

  async get(account: string): Promise<string | null> {
    this.check();
    return this.store.get(account) ?? null;
  }

  async set(account: string, password: string): Promise<void> {
    this.check();
    if (!this.forgetful) this.store.set(account, password);
  }

  async delete(account: string): Promise<void> {
    this.check();
    if (!this.store.delete(account)) throw new Error(`kein Eintrag für ${account}`);
  }
}
```

#### `app/tests/helpers/fakeServer.ts`

```ts
import { NetworkError } from '../../src/core/errors';
import type { HttpRequest, HttpResponse, HttpTransport, JsonObject, JsonValue } from '../../src/shared/types';

export type PlannedFailure = { readonly status: number; readonly body?: JsonValue } | { readonly network: string } | null;

export interface RecordedCall {
  readonly path: string;
  readonly payload: JsonObject;
  readonly headers: Readonly<Record<string, string>>;
}

const respond = (body: JsonValue, setCookies: string[] = []): HttpResponse =>
  ({ status: 200, setCookies, body: JSON.stringify(body) });

/** Antwortet wie spoken.rusty.one (wie tests/helpers.py FakeServer), aber auf Transportebene. */
export class FakeServer implements HttpTransport {
  readonly calls: RecordedCall[] = [];
  /** je Pfad geplante Fehler, einer je Aufruf; null = dieser Aufruf gelingt */
  readonly fail = new Map<string, PlannedFailure[]>();
  onPost: ((path: string, payload: JsonObject) => void | Promise<void>) | undefined;

  async post(request: HttpRequest): Promise<HttpResponse> {
    const path = new URL(request.url).pathname;
    const payload = JSON.parse(request.body) as JsonObject;
    this.calls.push({ path, payload, headers: request.headers });
    await this.onPost?.(path, payload);
    const planned = this.fail.get(path)?.shift();
    if (planned) {
      if ('network' in planned) throw new NetworkError(planned.network);
      return { status: planned.status, setCookies: [], body: JSON.stringify(planned.body ?? {}) };
    }
    if (path === '/api/auth/sign-in/email') {
      return respond({ user: { email: payload.email ?? null } }, ['session=test-sitzung; Path=/; HttpOnly']);
    }
    if (path === '/api/contributions/batch') {
      const n = Array.isArray(payload.envelopes) ? payload.envelopes.length : 0;
      return respond({ ok: true, accepted: n, known: 1, counted: n, refused: {} });
    }
    const n = Array.isArray(payload.texts) ? payload.texts.length : 0;
    return respond({ texts: n, added: n, changed: 0 });
  }

  paths(): string[] {
    return this.calls.map((call) => call.path);
  }
}
```

#### `app/tests/helpers/sandbox.ts`

```ts
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished } from 'vitest';
import { createCore } from '../../src/core';
import { createWowLocator } from '../../src/core/platform';
import { createSiteFactory } from '../../src/core/upload';
import type { Core, CoreEnv, Credentials, Logger, Platform, ProcessRunner, RunningFlavors } from '../../src/shared/types';
import { CLIENT_VERSION } from '../../src/shared/types';
import { FakeKeyring } from './fakeKeyring';
import { FakeServer } from './fakeServer';

export class FakeClock {
  fixed: Date | null = null;
  now(): Date {
    return this.fixed ? new Date(this.fixed) : new Date();
  }
}

export const currentPlatform = (): Platform =>
  process.platform === 'win32' || process.platform === 'darwin' ? process.platform : 'linux';

const noRunner: ProcessRunner = { run: () => Promise.resolve({ ok: false, stdout: '' }) };

export interface Sandbox {
  readonly root: string;
  readonly wow: string;
  readonly configDir: string;
  readonly dataDir: string;
  readonly server: FakeServer;
  readonly keyring: FakeKeyring;
  readonly clock: FakeClock;
  readonly logs: string[];
  readonly credentials: Credentials;
  running: RunningFlavors;
  readonly env: CoreEnv;
  readonly core: Core;
  flavor(name?: string, spoken?: boolean): Promise<string>;
  lua(flavorDir: string, account?: string): Promise<string>;
  cache(flavorDir: string, lang?: string): Promise<string>;
  cleanup(): Promise<void>;
}

export async function createSandbox(): Promise<Sandbox> {
  const root = await mkdtemp(join(tmpdir(), 'spoken-test-'));
  const configDir = join(root, 'config');
  const dataDir = join(root, 'data');
  const wow = join(root, 'World of Warcraft');
  const server = new FakeServer();
  const keyring = new FakeKeyring('none');
  const clock = new FakeClock();
  const logs: string[] = [];
  const logger: Logger = {
    info: (m) => logs.push(`info: ${m}`),
    warn: (m) => logs.push(`warn: ${m}`),
    error: (m) => logs.push(`error: ${m}`),
  };
  const platform = currentPlatform();
  const locator = createWowLocator({ platform, env: {}, home: root, runner: noRunner });
  const state: { running: RunningFlavors } = { running: new Set<string>() };
  const env: CoreEnv = {
    platform,
    paths: { configDir, dataDir, home: root },
    clock,
    running: () => Promise.resolve(state.running),
    secrets: keyring,
    openSite: createSiteFactory(server, { baseUrl: 'http://127.0.0.1:9', platform, version: CLIENT_VERSION }),
    wow: {
      isWowRoot: (p) => locator.isWowRoot(p),
      wowRoot: (p) => locator.wowRoot(p),
      findWow: () => Promise.resolve(null), // nie die echte Installation
    },
    logger,
  };
  const core = createCore(env);
  return {
    root, wow, configDir, dataDir, server, keyring, clock, logs, env, core,
    credentials: { email: 'test@example.org', password: 'geheim' },
    get running() { return state.running; },
    set running(value: RunningFlavors) { state.running = value; },
    async flavor(name = '_classic_era_', spoken = true) {
      const dir = join(wow, name);
      await mkdir(join(dir, 'WTF'), { recursive: true });
      if (spoken) await mkdir(join(dir, 'Interface', 'AddOns', 'Spoken'), { recursive: true });
      return dir;
    },
    async lua(flavorDir, account = 'ACC') {
      const dir = join(flavorDir, 'WTF', 'Account', account, 'SavedVariables');
      await mkdir(dir, { recursive: true });
      return join(dir, 'SpokenContributions.lua');
    },
    async cache(flavorDir, lang = 'deDE') {
      const dir = join(flavorDir, 'Cache', 'ADB', lang);
      await mkdir(dir, { recursive: true });
      return join(dir, 'DBCache.bin');
    },
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

/** Sandbox für einen vitest-Test, wird danach automatisch gelöscht. */
export async function useSandbox(): Promise<Sandbox> {
  const sandbox = await createSandbox();
  onTestFinished(() => sandbox.cleanup());
  return sandbox;
}
```

### 8.1 Zuordnung des Python-Testkatalogs (57 Tests)

| Python | TS-Paket | TS-Datei |
|---|---|---|
| test_upload (25) | (c) | `tests/unit/upload/{contributions,ratelimit,uploadtimes,npctexts,running}.test.ts` |
| test_wowdata (11) | (b) | `tests/unit/wowdata/{decodeLua,contributions,cache}.test.ts` |
| History (4) | (d) | `tests/unit/history/history.test.ts` |
| Login (10) | (e) | `tests/unit/settings/login.test.ts` |
| CommandLine (2) | (f) | `tests/unit/main/cli.test.ts` |
| RunningGame::paths, WowFolder (2) | (a) | `tests/unit/platform/{running,wowfind}.test.ts` |
| test_gui (3) | (f) themeLogic + (g) E2E | `tests/unit/main/themeLogic.test.ts`, `tests/ui/history-window.spec.ts` |

Jeder TS-Test trägt im Namen den Python-Testnamen (z. B. `it('test_success_sends_archives_and_clears', …)`), damit die Zuordnung in Phase 4 maschinell prüfbar ist.

## 9. Bekannte Risiken

- **safeStorage unter KDE**: Backend-Erkennung `kwallet6` hängt von `XDG_CURRENT_DESKTOP` ab. Falls `basic_text` erkannt wird, greift V1 (Datei-Fallback mit ehrlichem Hinweis). Prüfung erst in Phase 6 mit echten Daten.
- **Headless-CLI unter Linux** (V8) und **stdout unter Windows** (V9): in Phase 5 in einer VM/CI prüfen.
- **Proxy**: Node-`fetch` beachtet `HTTPS_PROXY` nicht automatisch, Python-`urllib` tut es. Bei Bedarf später `EnvHttpProxyAgent`.
- **`movePasswordToKeyring`** entfernt das Passwort aus `login.json`, wie die Python-Fassung. Wer danach zur Python-Fassung zurückkehrt, findet es dort nicht (sie kennt `passwort.safestorage` nicht). In Phase 6 beim Umstieg bewusst entscheiden (E. 15: alter Eintrag bleibt).
- **Windows `rename`** über eine Zieldatei kann bei Virenscannern `EPERM` liefern. Dann wird wie ein Dateifehler gemeldet; nichts geht verloren, weil die Reihenfolge stimmt.

## 10. CI (Paket f)

`.github/workflows/electron.yml`:
- Matrix `ubuntu-latest`, `windows-latest`, `macos-latest`, Node 22, `working-directory: app`.
- Schritte: `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:ui` (Linux mit `xvfb-run -a`).
- Bei Fehlern `::error`-Annotation wie im Python-Job.
- `dist` erst später als manueller Job.
- Der Python-Job bleibt unverändert (E. 25).
- Push nur mit Zustimmung (Regel 4).

## 11. .gitignore

Schon vorhanden: `node_modules/ dist/ out/ release/ coverage/ .vite/ *.tsbuildinfo *.log test-results/ playwright-report/ .tmp-*/`.

Zu ergänzen: `dist-dev/`, `.eslintcache`.

Gegenprobe-Ausgaben schreiben nur in Temp-Ordner.

## 12. Offene Punkte aus der Spezifikation, die hier gelöst sind

- E. 9 (`--test` schreibt nichts): `settings.load({persistFound:false})`, keine Altlasten, keine Limits-, Verlaufs- oder Schlüsselbund-Schreibzugriffe; abgesichert durch Dateibaum-Hash-Test.
- E. 16 (userData): `setPath` vor `ready`, Sandbox eigener Ordner.
- E. 17 (Dunkelmodus): `nativeTheme` + Portal/gsettings unter Linux.
- E. 18/19 (Suche/UTF-8): je eine gemeinsame Funktion.
- E. 22 (Einzelinstanz): auch für die CLI (V7).
- E. 23 (DI): `CoreEnv`.

## 13. Vorschläge zur Freigabe (neue oder geänderte Texte und Formate)

| Nr. | Vorschlag |
|---|---|
| V1 | Linux-Backend `basic_text`: kein safeStorage, Passwort wie Python in `login.json` (0600). Konto-Hinweis: `Das Passwort liegt in einer Datei, die nur du lesen kannst (kein Schlüsselbund gefunden – nur durch die Dateirechte geschützt). Die Anmeldung ist nur für die NPC-Texte nötig – die gesammelten Zeilen gehen anonym hoch.` |
| V2 | Angemeldet, aber Passwort nicht lesbar (E. 12): `Das Passwort ist auf diesem Rechner nicht mehr lesbar – bitte ab- und neu anmelden. Die Anmeldung ist nur für die NPC-Texte nötig – die gesammelten Zeilen gehen anonym hoch.` |
| V3 | USAGE mit `Spoken-Upload` statt `Spoken-Upload.pyw`. |
| V4 | user-agent `spoken-contribute/3.0 ({System})` statt `2.1`, damit Server-Logs die Fassungen unterscheiden. Alternativ `2.1` beibehalten. |
| V5 | `passwort.safestorage` als `{"email": "…", "verschluesselt": "<base64>"}`. Die Kontobindung ist nötig, damit „alten Eintrag beim Kontowechsel löschen“ den neuen nicht trifft. |
| V6 | Der Anmeldedialog ist ein modales `<dialog>` im Hauptfenster statt eines eigenen Fensters (gleiches Verhalten, kein zweiter preload-Kontext). |
| V7 | CLI bei laufender Instanz: stderr `Spoken-Upload läuft bereits – bitte erst das andere Fenster schließen.`, Exit 1. |
| V8 | Linux-CLI ohne Bildschirm: automatisch `--ozone-platform=headless`; in Phase 5 prüfen, sonst Hinweis in LIESMICH. |
| V9 | Windows-CLI: Ausgabe nur bei Umleitung sichtbar; in LIESMICH dokumentieren. |
| V10 | Beim Leeren werden eingerückt gefundene Schalterzeilen **ohne** Einrückung zurückgeschrieben. |

### 13.1 Entscheidungen des Koordinators zu V1–V10

- V1, V2, V3, V5, V6, V7, V8, V9, V10: angenommen wie vorgeschlagen.
- V4: **abgelehnt** – der user-agent bleibt `spoken-contribute/2.1 ({System})` wie in der Python-Fassung
  (Server sieht keinen Unterschied; „Verhalten bleibt gleich“). `CLIENT_VERSION = '2.1'`. Die App-Version
  (package.json) ist davon unabhängig 3.0.0.

## 14. Abweichungen der Umsetzung

Was die Umsetzung (Phasen 3–4) bewusst anders macht als oben beschrieben. Das Verhalten gegenüber der Python-Fassung ändert sich dadurch nicht.

- **Zusätzliche Dateien in `src/main/`** (zu §2):
  - `windowOptions.ts`: Fenstertitel, Größen, Hintergrundfarbe und die `BrowserWindow`-Optionen aus §5.3 als reine Funktion (nur Typ-Import aus Electron, daher in vitest prüfbar).
  - `nativeUi.ts`: Schnittstelle `NativeUi` für Hinweis-/Ja-Nein-/Ordnerdialoge und `shell.openPath`/`openExternal`. In der Sandbox ersetzt sie `sandbox.ts`, sonst Electrons `dialog`/`shell`.
  - `sandbox.ts`: die vorgetäuschte Umgebung der UI-Sandbox (`system.json` lesen, Schlüsselbund, Design, Dialoge). Aktiv nur, wenn `env.ts` die Sandbox zugelassen hat.
- **`system.json` erweitert** (zu §7.2): neben `prozesse`, `dunkel` und `schluesselbund` auch
  - `wowSuche`: Ergebnis von „Suchen“ (`findWow`) – die Sandbox sucht nie an echten Orten;
  - `ordnerwahl`: Ergebnis des Ordnerdialogs „Ändern …“;
  - `dialogAntwort`: `"ja"`/`"nein"` für Ja/Nein-Fragen (Standard: nein).
  Pfade aus `wowSuche`/`ordnerwahl` gelten nur, wenn sie im Sandbox-Ordner liegen (Regel 1).
- **Protokolldateien der Sandbox**: Gezeigte Dialoge landen in `<sandbox>/dialoge.json`, „geöffnete“ Ordner und Adressen in `<sandbox>/geoeffnet.json`. Geöffnet wird in der Sandbox nichts.
- **Sandbox-Netz doppelt abgesichert**: In der Sandbox geht `fetch` zusätzlich durch `localOnlyFetch` (nur `127.0.0.1`), `sandbox-start.ts` setzt `HOME`, `XDG_*`, `APPDATA`/`LOCALAPPDATA` des App-Prozesses auf den Temp-Ordner und schaltet den Sitzungsbus ab (`DBUS_SESSION_BUS_ADDRESS=disabled:`).
- **Schutzvariable bis Phase 6**: Unverpackt startet die App ohne Sandbox nur mit `SPOKEN_UPLOAD_ECHTE_DATEN=1` (sonst Hinweis auf stderr, Exit 1). Die verpackte App prüft das nicht. Nach der Freigabe in Phase 6 kann der Schutz entfallen.
- **V8 per Neustart statt `appendSwitch`** (zu §6.3, Schritt 3): Chromium wählt die Ozone-Plattform, bevor `main.ts` läuft; `appendSwitch('ozone-platform', 'headless')` käme zu spät. Unter Linux im CLI-Modus ohne `DISPLAY`/`WAYLAND_DISPLAY` ersetzt sich der Prozess deshalb per `process.execve` durch sich selbst mit `--ozone-platform=headless --disable-gpu` (PID, Ausgaben und Exit-Code bleiben). Fehlt `execve`, bleibt `appendSwitch` als Versuch.
- **Registry ohne `winreg`** (Paket a, Spezifikation §6.2/§6.5): Den WoW-Installationsort und `AppsUseLightTheme` liest die App über `reg query` (ohne Shell, ohne Konsolenfenster), weil Node kein `winreg` hat und keine nativen Module mitkommen sollen. Die Ausgabe wird als UTF-8 gelesen; ein Installationspfad mit Umlauten kann dabei verstümmelt ankommen – dann greifen wie bisher die festen Laufwerksorte und die Ordnerwahl.
- **CI-Job `gegenprobe`** (zu §10): `.github/workflows/electron.yml` hat neben der Matrix einen zweiten Job, der `npm run test:gegenprobe` (Python ↔ TS, §7.6) nur unter `ubuntu-latest` mit Python 3.13 ausführt. Der Python-Workflow `tests.yml` bleibt unverändert.
- **Ablösung der Python-Fassung:** `spoken_contribute/`, `tests/`, die Startskripte, `tests.yml`, die
  Gegenprobe (`app/tests/gegenprobe/`, vitest-Projekt und CI-Job `gegenprobe`) sind entfernt; zuletzt
  enthalten in Commit `e14d775`. `testzuordnung.test.ts` prüft seitdem gegen die Tabelle in
  `docs/electron-testzuordnung.md`. Die einmalige Passwort-Übernahme (`core/settings/legacy.ts`) bleibt
  für Umsteiger erhalten.
