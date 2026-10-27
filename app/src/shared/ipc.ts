// Kanalnamen, Ereignisse und die preload-API window.spoken (Architektur §4).
// Nur Typen und Konstanten – Main, preload und Renderer importieren diese Datei.
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
