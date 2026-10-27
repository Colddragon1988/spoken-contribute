/**
 * Alle IPC-Kanäle (Architektur §4.2). Jeder Handler prüft zuerst den Absender, dann die
 * Argumente, und fängt alles ab: Er liefert definierte Ergebnisse oder undefined, wirft aber nie –
 * so protokolliert Electron keine Argumente (das Passwort!).
 */
import { mkdir, stat } from 'node:fs/promises';
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { errText, UploadError } from '../core/errors';
import { normalizePath } from '../core/platform';
import {
  CHANNELS, EVENTS, type AppState, type HistoryQueryAnswer, type OverviewResult, type SaveResult, type UploadEvent,
} from '../shared/ipc';
import { REGISTER_URL, type AccountView, type Core, type Logger, type Settings } from '../shared/types';
import type { NativeUi } from './nativeUi';
import type { ThemeController } from './theme';
import type { UploadController } from './uploadController';
import {
  INVALID, bool, entryId, expandUser, historyQuery, isInvalid, messageRequest, senderAllowed, signInArgs,
  themeSetting, uploadArgs, wowPath, type ChannelWindows, type Invalid, type SenderInfo,
} from './validate';
import { MAIN_TITLE } from './windowOptions';
import type { WindowManager } from './windows';

export const SIGN_OUT_QUESTION = 'Die Anmeldung von diesem Rechner löschen (auch aus dem Schlüsselbund)?\n\n' +
  'Ohne Anmeldung bleiben die NPC-Texte im Spiel-Cache liegen, bis du dich wieder anmeldest.';
export const SIGN_OUT_LEFTOVER = 'Abgemeldet – aber der Schlüsselbund war gesperrt oder nicht erreichbar, das ' +
  'Passwort steht womöglich noch darin (Eintrag „spoken-contribute“). Es lässt sich dort von Hand löschen.';
export const EMPTY_LOGIN = 'Bitte E-Mail und Passwort eingeben.';
export const UPLOAD_RUNNING = 'Der Upload läuft noch – bitte kurz warten.';
export const CHOOSE_TITLE = 'Ordner „World of Warcraft“ wählen';

/** Veränderlicher Zustand des Fensterbetriebs (die Einstellungen gelten auch ungespeichert). */
export interface AppStateHolder {
  settings: Settings;
}

export interface IpcContext {
  readonly core: Core;
  readonly state: AppStateHolder;
  readonly windows: WindowManager;
  readonly ui: NativeUi;
  readonly uploads: UploadController;
  readonly theme: ThemeController;
  readonly logger: Logger;
  readonly version: string;
}

export interface IpcRegistration {
  /** laufende Verlaufssuche eines geschlossenen Fensters abbrechen */
  historyClosed(contents: WebContents): void;
}

/** Der Ordner, der im Feld steht – wie gui.py wow_path(): getrimmt, ~ aufgelöst, wie Path(). */
export function wowPathOf(text: string, core: Core): string {
  const { platform } = core.env;
  return normalizePath(expandUser(text.trim(), core.env.paths.home, platform === 'win32'), platform);
}

type Parser<T> = (args: readonly unknown[]) => T | Invalid;
const noArgs: Parser<true> = (args) => (args.length === 0 ? true : INVALID);
const oneArg = <T>(check: (value: unknown) => T | Invalid): Parser<T> =>
  (args) => (args.length === 1 ? check(args[0]) : INVALID);

function senderInfo(event: IpcMainInvokeEvent, windows: WindowManager): SenderInfo {
  const frame = event.senderFrame;
  const main = event.sender.mainFrame;
  const isMainFrame = frame !== null && (frame === main ||
    (frame.parent === null && frame.processId === main.processId && frame.routingId === main.routingId));
  return { hasFrame: frame !== null, isMainFrame, url: frame?.url ?? '', window: windows.kindOf(event.sender) };
}

export function registerIpc(ctx: IpcContext): IpcRegistration {
  const { core, state, windows, ui, uploads, theme, logger } = ctx;
  const queries = new Map<number, AbortController>();

  function handle<T>(
    channel: string, allowed: ChannelWindows, parse: Parser<T>,
    run: (value: T, event: IpcMainInvokeEvent) => unknown,
  ): void {
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      if (!senderAllowed(senderInfo(event, windows), allowed)) {
        logger.warn(`IPC ${channel}: fremder Absender verworfen.`);
        return undefined;
      }
      const value = parse(args);
      if (isInvalid(value)) {
        logger.warn(`IPC ${channel}: ungültige Argumente verworfen.`); // die Argumente selbst nie
        return undefined;
      }
      try {
        return await run(value, event);
      } catch (err) {
        logger.error(`IPC ${channel}: unerwarteter Fehler (${err instanceof Error ? err.name : typeof err}).`);
        return undefined;
      }
    });
  }

  const ownerOf = (event: IpcMainInvokeEvent): BrowserWindow | null => BrowserWindow.fromWebContents(event.sender);

  async function save(): Promise<SaveResult> {
    try {
      await core.settings.save(state.settings);
      return { saveError: null };
    } catch (err) {
      return { saveError: errText(err) };
    }
  }

  async function accountView(): Promise<AccountView> {
    try {
      return await core.login.accountView();
    } catch {
      // Datei unlesbar o. Ä.: so anzeigen, als wäre das Passwort nicht zu holen
      const email = await core.login.account().catch(() => null);
      return { email, place: email === null ? null : 'unlesbar', backend: core.env.secrets.backend() };
    }
  }

  async function openFolder(owner: BrowserWindow | null, folder: string): Promise<void> {
    const error = await ui.openPath(folder);
    if (error) await ui.message(owner, 'fehler', MAIN_TITLE, `Der Ordner ließ sich nicht öffnen (${error}):\n\n${folder}`);
  }

  handle(CHANNELS.getState, 'beide', noArgs, (): AppState => ({
    version: ctx.version,
    platform: core.env.platform,
    settings: state.settings,
    uploadRunning: uploads.running(),
    theme: theme.view,
  }));

  handle(CHANNELS.setWowDir, 'haupt', oneArg(wowPath), async (text) => {
    const chosen = wowPathOf(text, core);
    const found = await core.env.wow.wowRoot(chosen).catch(() => null);
    const wowDir = found ?? chosen;
    state.settings = { ...state.settings, wowDir };
    return { wowDir, ...(await save()) };
  });

  handle(CHANNELS.chooseWowDir, 'haupt', noArgs, async (_none, event) => {
    const current = wowPathOf(state.settings.wowDir, core);
    const isDir = await stat(current).then((s) => s.isDirectory(), () => false);
    return ui.chooseFolder(ownerOf(event), CHOOSE_TITLE, isDir ? current : core.env.paths.home);
  });

  handle(CHANNELS.findWow, 'haupt', noArgs, () => core.env.wow.findWow().catch(() => null));

  handle(CHANNELS.getOverview, 'haupt', oneArg(wowPath), async (wowDir): Promise<OverviewResult> => {
    const wow = wowPathOf(wowDir, core);
    if (!(await core.env.wow.isWowRoot(wow).catch(() => false))) return { wowDir, kind: 'keinWow' };
    try {
      return { wowDir, kind: 'ok', overview: await core.uploader.overview(wow) };
    } catch (err) {
      return { wowDir, kind: 'fehler', message: errText(err) };
    }
  });

  handle(CHANNELS.setAutoUpload, 'haupt', oneArg(bool), (autoUpload) => {
    state.settings = { ...state.settings, autoUpload };
    return save();
  });

  handle(CHANNELS.setTheme, 'haupt', oneArg(themeSetting), async (setting) => {
    state.settings = { ...state.settings, theme: setting };
    const result = await save();
    await theme.setSetting(setting);
    return result;
  });

  handle(CHANNELS.getAccount, 'haupt', noArgs, accountView);

  // Das Passwort steht nur in diesen Argumenten, in signIn und in saveLogin – nie in Logs oder Antworten.
  handle(CHANNELS.signIn, 'haupt', oneArg(signInArgs), async ({ email, password }) => {
    if (!email || !password) return { ok: false, message: EMPTY_LOGIN };
    try {
      await core.env.openSite().signIn(email, password); // erst prüfen, dann speichern
      await core.login.saveLogin(email, password);
    } catch (err) {
      const message = err instanceof UploadError ? err.message : `Unerwarteter Fehler: ${String(err)}`;
      return { ok: false, message };
    }
    return { ok: true, account: await accountView() };
  });

  handle(CHANNELS.signOut, 'haupt', noArgs, async (_none, event) => {
    const owner = ownerOf(event);
    if ((await core.login.account().catch(() => null)) === null) return accountView();
    if (!(await ui.confirm(owner, 'Abmelden', SIGN_OUT_QUESTION))) return accountView();
    let removed = true;
    let failure: string | null = null;
    try {
      removed = await core.login.deleteLogin();
    } catch (err) {
      failure = errText(err);
    }
    const view = await accountView();
    // Hinweise nicht abwarten: die Anzeige soll sofort stimmen (wie gui.py signed_out)
    if (failure !== null) void ui.message(owner, 'fehler', 'Abmelden', `Abmelden ist fehlgeschlagen (${failure}).`);
    else if (!removed) void ui.message(owner, 'warnung', 'Abmelden', SIGN_OUT_LEFTOVER);
    return view;
  });

  handle(CHANNELS.startUpload, 'haupt', oneArg(uploadArgs), ({ test }) => uploads.start(test));

  handle(CHANNELS.openHistory, 'haupt', noArgs, () => { windows.openHistory(); });

  handle(CHANNELS.queryHistory, 'verlauf', oneArg(historyQuery), async (query, event): Promise<HistoryQueryAnswer> => {
    const key = event.sender.id;
    queries.get(key)?.abort(); // eine überholte Suche bricht ab
    const controller = new AbortController();
    queries.set(key, controller);
    const { seq, search, art, version } = query;
    try {
      const result = await core.historyViews.query({ search, art, version }, controller.signal);
      return { seq, status: 'ok', result };
    } catch (err) {
      if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
        return { seq, status: 'abgebrochen' };
      }
      return { seq, status: 'fehler', message: errText(err) };
    } finally {
      if (queries.get(key) === controller) queries.delete(key);
    }
  });

  handle(CHANNELS.historyDetails, 'verlauf', oneArg(entryId), (id) => core.historyViews.details(id).catch(() => null));

  handle(CHANNELS.openEntryFolder, 'verlauf', oneArg(entryId), async (id, event) => {
    const folder = await core.historyViews.folderOf(id); // nur Ordner, die der Verlauf selbst kennt
    if (folder !== null) await openFolder(ownerOf(event), folder);
  });

  handle(CHANNELS.openArchive, 'verlauf', noArgs, async (_none, event) => {
    await mkdir(core.history.root, { recursive: true }).catch(() => undefined); // das meldet dann openFolder
    await openFolder(ownerOf(event), core.history.root);
  });

  handle(CHANNELS.openRegister, 'haupt', noArgs, () => ui.openExternal(REGISTER_URL)); // feste Adresse

  handle(CHANNELS.closeWindow, 'beide', noArgs, (_none, event) => { ownerOf(event)?.close(); });

  handle(CHANNELS.showMessage, 'beide', oneArg(messageRequest), (request, event) =>
    ui.message(ownerOf(event), request.kind, request.title, request.text));

  return {
    historyClosed(contents) {
      const key = contents.id;
      queries.get(key)?.abort();
      queries.delete(key);
    },
  };
}

/** Upload-Ereignisse und „Verlauf neu laden“ an die Fenster. */
export function uploadNotifier(windows: WindowManager, core: Core): {
  emit: (event: UploadEvent) => void;
  finished: () => void;
} {
  return {
    emit(event) {
      windows.main()?.webContents.send(EVENTS.upload, event);
    },
    finished() {
      core.historyViews.reload(); // der Suchcache bleibt: Einträge ändern sich nach dem Schreiben nicht
      windows.history()?.webContents.send(EVENTS.historyChanged);
    },
  };
}
