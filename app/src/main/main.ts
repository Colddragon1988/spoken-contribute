/**
 * Einstieg des Hauptprozesses (Architektur §6.3): Argumente, Umgebung, userData, Einzelinstanz,
 * dann Kommandozeile oder Fenster. Reihenfolge ist wichtig – alles bis zur Einzelinstanz läuft
 * synchron vor „ready“.
 */
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, nativeTheme, protocol, safeStorage, session } from 'electron';
import { createCore } from '../core';
import { createDarkModeProbe, createProcessRunner, userDataDir } from '../core/platform';
import { createLegacyReader, importLegacyPassword as importLegacy } from '../core/settings';
import { EVENTS } from '../shared/ipc';
import type { Core, CoreEnv, DarkModeProbe, Logger, SafeStorageLike, Settings } from '../shared/types';
import { appArgs } from './argv';
import { ALREADY_RUNNING, USAGE, interpretArgs, runCli, type CliIo } from './cli';
import {
  REAL_DATA_VAR, checkSandbox, currentPlatform, productionEnv, sandboxEnv, sandboxUserData,
} from './env';
import { UPLOAD_RUNNING, registerIpc, uploadNotifier, wowPathOf, type AppStateHolder } from './ipc';
import { createElectronUi, type NativeUi } from './nativeUi';
import { APP_SCHEME, createAppHandler } from './protocol';
import { createSandboxUi } from './sandbox';
import { hardenSession, hardenWebContents } from './security';
import { createThemeController } from './theme';
import { createUploadController } from './uploadController';
import { MAIN_TITLE, UI_PARTITION } from './windowOptions';
import { createWindowManager, installMenu } from './windows';

/** Schreiben und abwarten, bis es draußen ist (sonst schneidet app.exit die Ausgabe ab). */
function write(stream: NodeJS.WriteStream, text: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      stream.write(text, () => { resolve(); });
    } catch {
      resolve(); // Windows-GUI-Programm ohne Konsole (V9)
    }
  });
}

/** Ausgaben bis zum Ende sammeln und der Reihe nach schreiben. */
function createIo(): CliIo & { flush(): Promise<void> } {
  let chain = Promise.resolve();
  const enqueue = (stream: NodeJS.WriteStream, text: string): void => {
    chain = chain.then(() => write(stream, text));
  };
  return {
    out: (text) => { enqueue(process.stdout, text); },
    err: (text) => { enqueue(process.stderr, text); },
    flush: () => chain,
  };
}

/** Warnungen auf stderr – keine Log-Dateien, nie Argumente oder Passwörter. */
const logger: Logger = {
  info: () => undefined,
  warn: (message) => { process.stderr.write(`Spoken-Upload: ${message}\n`); },
  error: (message) => { process.stderr.write(`Spoken-Upload: ${message}\n`); },
};

function exitWith(io: { flush(): Promise<void> }, code: number): void {
  void io.flush().then(() => { app.exit(code); });
}

/**
 * safeStorage für den Kern; erst nach ready benutzen (§5.5). Electron 45 markiert die synchronen
 * Aufrufe als veraltet (Entfernung angekündigt für Electron 46), die asynchronen bleiben trotzdem
 * vorerst außen vor: Unter Linux kennt der asynchrone Weg laut Electron-Doku nur Secret-Portal,
 * Secret Service und einen Ersatz-Schlüssel – KWallet fehlt, und getSelectedStorageBackend()
 * beschreibt nur den synchronen Weg. Ein „kwallet6“ könnte dann still mit festem Schlüssel
 * verschlüsseln, ohne dass der basic_text-Hinweis erscheint. Vor einem Electron-Update auf 46
 * neu prüfen (Review 2, Electron-Sicherheit).
 */
function safeStorageAdapter(linux: boolean): SafeStorageLike {
  /* eslint-disable @typescript-eslint/no-deprecated -- siehe oben */
  return {
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encryptString: (plain) => safeStorage.encryptString(plain),
    decryptString: (encrypted) => safeStorage.decryptString(Buffer.from(encrypted)),
    ...(linux ? { getSelectedStorageBackend: () => safeStorage.getSelectedStorageBackend() } : {}),
  };
  /* eslint-enable @typescript-eslint/no-deprecated */
}

/**
 * V8: Linux-Kommandozeile ohne Bildschirm (z. B. cron). Die Ozone-Plattform wählt Chromium, bevor
 * dieses Skript läuft – appendSwitch käme zu spät. Deshalb ersetzt sich der Prozess per execve
 * durch sich selbst mit --ozone-platform=headless; PID, Ausgaben und Exit-Code bleiben dieselben.
 */
function headless(): void {
  if (process.argv.some((arg) => arg.startsWith('--ozone-platform'))) return; // schon neu gestartet
  const execve = (process as { execve?: (file: string, args: string[], env: NodeJS.ProcessEnv) => never }).execve;
  try {
    execve?.(process.execPath, [process.execPath, '--ozone-platform=headless', '--disable-gpu', ...process.argv.slice(1)], process.env);
  } catch {
    // ohne execve: wenigstens versuchen
  }
  app.commandLine.appendSwitch('ozone-platform', 'headless');
}

function start(): void {
  const io = createIo();
  const packaged = app.isPackaged;
  const args = appArgs(process.argv, packaged);

  // 1. USAGE vor allem anderen: es wird nichts angelegt.
  const parsed = interpretArgs(args);
  if (parsed.kind === 'usage') {
    io.out(`${USAGE}\n`);
    exitWith(io, parsed.exitCode);
    return;
  }
  const cli = parsed.mode !== 'fenster';

  // Fernsteuerung per DevTools-Protokoll gibt es in der verpackten App nicht: Chromium beachtet diese
  // Schalter auch dort, und keine Fuse sperrt sie – ein anderes Programm könnte das Fenster sonst bedienen.
  if (packaged && ['remote-debugging-port', 'remote-debugging-pipe'].some((s) => app.commandLine.hasSwitch(s))) {
    io.err('Spoken-Upload: Fernsteuerung (--remote-debugging-…) ist nicht erlaubt.\n');
    exitWith(io, 2);
    return;
  }

  // 2. Produktion oder Sandbox (nur unverpackt, nur unter os.tmpdir(), nur 127.0.0.1).
  const platform = currentPlatform();
  const sandbox = checkSandbox(process.env, packaged, tmpdir());
  if (sandbox.kind === 'fehler') {
    io.err(`${sandbox.message}\n`);
    exitWith(io, 1);
    return;
  }
  if (sandbox.kind === 'keine' && !packaged && process.env[REAL_DATA_VAR] !== '1') {
    // Schutz bis Phase 6 (Regel 1): aus dem Quellbaum nie unbeabsichtigt gegen echte Daten.
    io.err('Spoken-Upload: unverpackt nur in der Sandbox (npm run start:sandbox). Echte Daten erst ab ' +
      `Phase 6 mit ${REAL_DATA_VAR}=1.\n`);
    exitWith(io, 1);
    return;
  }

  // 3. Vor ready: eigener userData-Ordner (E. 16), Protokoll, Schalter.
  const home = homedir();
  app.setPath('userData', sandbox.kind === 'sandbox' ? sandboxUserData(sandbox.root) : userDataDir(platform, process.env, home));
  protocol.registerSchemesAsPrivileged([{ scheme: APP_SCHEME, privileges: { standard: true, secure: true } }]);
  if (sandbox.kind === 'sandbox') app.commandLine.appendSwitch('password-store', 'basic'); // nie KWallet & Co.
  if (cli && platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) headless(); // V8

  // 4. Einzelinstanz (E. 22): nie zwei Uploads auf denselben Dateien.
  if (!app.requestSingleInstanceLock()) {
    if (cli) io.err(`${ALREADY_RUNNING}\n`); // V7
    exitWith(io, cli ? 1 : 0);
    return;
  }
  hardenWebContents(app);

  let ui: NativeUi = createElectronUi();
  let darkMode: DarkModeProbe | null = null;
  let focusMain = (): void => undefined;
  app.on('second-instance', (_event, argv) => {
    // nur ein zweiter Fensterstart holt das Fenster nach vorn, nicht ein --test aus einem Zeitplan
    const second = interpretArgs(appArgs(argv, packaged));
    if (second.kind === 'mode' && second.mode === 'fenster') focusMain();
  });

  // 5.–8. Kern bauen, Altlasten, dann Terminal oder Fenster.
  const buildCore = async (): Promise<Core> => {
    await app.whenReady();
    let env: CoreEnv;
    if (sandbox.kind === 'sandbox') {
      const built = sandboxEnv(sandbox, { platform, fetchImpl: fetch, logger });
      env = built.env;
      darkMode = built.darkMode;
      ui = createSandboxUi(built.system);
    } else {
      env = productionEnv({
        platform, vars: process.env, home, fetchImpl: fetch, logger, safeStorage: safeStorageAdapter(platform === 'linux'),
      });
    }
    if (cli) app.dock?.hide();
    return createCore(env);
  };

  const openWindow = async (core: Core): Promise<number> => {
    const settings: Settings = await core.settings.load({ persistFound: true });
    const state: AppStateHolder = { settings };
    const uiSession = session.fromPartition(UI_PARTITION);
    hardenSession(uiSession);
    hardenSession(session.defaultSession);
    uiSession.protocol.handle(APP_SCHEME, createAppHandler(join(__dirname, '../renderer')));
    installMenu(process.platform);

    const probe = darkMode ?? createDarkModeProbe(platform, createProcessRunner());
    let windows: ReturnType<typeof createWindowManager> | null = null;
    const theme = createThemeController({
      nativeTheme,
      probe,
      useProbe: platform === 'linux' || darkMode !== null,
      broadcast: (view) => {
        windows?.setDark(view.dark);
        for (const window of windows?.all() ?? []) window.webContents.send(EVENTS.theme, view);
      },
    });
    await theme.start(settings.theme);

    let uploads: ReturnType<typeof createUploadController> | null = null;
    let registration: ReturnType<typeof registerIpc> | null = null;
    const manager = createWindowManager({
      preload: join(__dirname, '../preload/preload.cjs'),
      packaged,
      platform: process.platform,
      dark: () => theme.view.dark,
      mayCloseMain: (window) => {
        if (!uploads?.running()) return true;
        void ui.message(window, 'info', MAIN_TITLE, UPLOAD_RUNNING);
        return false;
      },
      historyClosed: (contents) => { registration?.historyClosed(contents); },
      mainShown: () => { if (state.settings.autoUpload) uploads?.scheduleAutoUpload(); },
    });
    windows = manager;
    const notify = uploadNotifier(manager, core);
    uploads = createUploadController({
      // Ordner aus dem Feld, Zugangsdaten erst jetzt: der Schlüsselbund kann nachfragen
      run: async (test, log) => core.uploader.run(wowPathOf(state.settings.wowDir, core), await core.login.credentials(), { test, log }),
      emit: notify.emit,
      finished: notify.finished,
    });
    registration = registerIpc({ core, state, windows: manager, ui, uploads, theme, logger, version: app.getVersion() });
    focusMain = () => { manager.focusMain(); };

    const closed = new Promise<number>((resolve) => {
      app.on('window-all-closed', () => {
        theme.stop();
        resolve(0);
      });
    });
    manager.openMain();
    return closed;
  };

  // Nur gegen echte Daten: in der Sandbox gibt es keinen alten Schlüsselbund (Regel 1).
  const importLegacyPassword = sandbox.kind === 'sandbox' ? undefined : (core: Core) => importLegacy({
    login: core.login, secrets: core.env.secrets, readLegacy: createLegacyReader(platform, createProcessRunner()),
  });
  void runCli(args, { core: buildCore, openWindow, importLegacyPassword }, io)
    .catch((err: unknown) => {
      io.err(`Unerwarteter Fehler: ${String(err)}\n`);
      return 1;
    })
    .then((code) => { exitWith(io, code); });
}

start();
