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
/** Version im user-agent `spoken-contribute/{CLIENT_VERSION} ({System})` – V4 abgelehnt: wie Python. */
export const CLIENT_VERSION = '2.1';

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
