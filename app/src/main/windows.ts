/**
 * Haupt- und Verlaufsfenster (Architektur §5.3, gui.py App/HistoryWindow): Optionen, Größen,
 * nur je eine Instanz, Schließsperre während des Uploads, Verlauf schließt mit dem Hauptfenster.
 */
import { BrowserWindow, Menu, type WebContents } from 'electron';
import { HISTORY_PAGE, MAIN_PAGE } from './protocol';
import type { WindowKind } from './validate';
import {
  HISTORY_SIZE, HISTORY_TITLE, MAIN_SIZE, MAIN_TITLE, backgroundFor, windowOptions, type WindowSize,
} from './windowOptions';

export interface WindowManagerDeps {
  readonly preload: string;
  readonly packaged: boolean;
  readonly platform: NodeJS.Platform;
  /** aktuelles Design (für den Hintergrund vor dem ersten Zeichnen) */
  dark(): boolean;
  /** darf das Hauptfenster schließen? false = Upload läuft (Hinweis zeigt der Aufrufer) */
  mayCloseMain(window: BrowserWindow): boolean;
  /** Verlaufsfenster ist zu (laufende Suche abbrechen) */
  historyClosed?(contents: WebContents): void;
  /** Hauptfenster hat sich gezeigt (Auto-Upload) */
  mainShown?(window: BrowserWindow): void;
}

export interface WindowManager {
  openMain(): BrowserWindow;
  /** öffnen oder, wenn schon offen, nach vorn holen */
  openHistory(): BrowserWindow;
  main(): BrowserWindow | null;
  history(): BrowserWindow | null;
  all(): BrowserWindow[];
  /** zu welchem unserer Fenster gehört der Absender? */
  kindOf(contents: WebContents): WindowKind | null;
  /** Hauptfenster nach vorn (zweiter Start ohne Schalter) */
  focusMain(): void;
  /** Hintergrund beider Fenster an das Design anpassen */
  setDark(dark: boolean): void;
}

/** Linux/Windows ohne Menü; macOS braucht App- und Bearbeiten-Menü für Cmd+C/V/X/A. */
export function installMenu(platform: NodeJS.Platform): void {
  if (platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }]));
  } else {
    Menu.setApplicationMenu(null);
  }
}

export function createWindowManager(deps: WindowManagerDeps): WindowManager {
  let mainWindow: BrowserWindow | null = null;
  let historyWindow: BrowserWindow | null = null;
  const alive = (window: BrowserWindow | null): BrowserWindow | null =>
    window !== null && !window.isDestroyed() ? window : null;

  function create(title: string, size: WindowSize, page: string): BrowserWindow {
    const window = new BrowserWindow(windowOptions(title, size, deps.dark(), deps.preload, deps.packaged));
    window.once('ready-to-show', () => { window.show(); });
    // Der Seitentitel darf den Fenstertitel nicht ersetzen.
    window.on('page-title-updated', (event) => { event.preventDefault(); });
    void window.loadURL(page);
    return window;
  }

  function bringToFront(window: BrowserWindow): void {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }

  const manager: WindowManager = {
    openMain() {
      const existing = alive(mainWindow);
      if (existing) return existing;
      const window = create(MAIN_TITLE, MAIN_SIZE, MAIN_PAGE);
      window.once('ready-to-show', () => { deps.mainShown?.(window); });
      window.on('close', (event) => {
        if (!deps.mayCloseMain(window)) event.preventDefault();
      });
      window.on('closed', () => {
        mainWindow = null;
        alive(historyWindow)?.close(); // der Verlauf schließt mit
      });
      mainWindow = window;
      return window;
    },
    openHistory() {
      const existing = alive(historyWindow);
      if (existing) {
        bringToFront(existing);
        return existing;
      }
      const window = create(HISTORY_TITLE, HISTORY_SIZE, HISTORY_PAGE);
      const contents = window.webContents;
      window.on('closed', () => {
        historyWindow = null;
        deps.historyClosed?.(contents);
      });
      historyWindow = window;
      return window;
    },
    main: () => alive(mainWindow),
    history: () => alive(historyWindow),
    all: () => [alive(mainWindow), alive(historyWindow)].filter((w): w is BrowserWindow => w !== null),
    kindOf(contents) {
      if (alive(mainWindow)?.webContents === contents) return 'haupt';
      if (alive(historyWindow)?.webContents === contents) return 'verlauf';
      return null;
    },
    focusMain() {
      const window = alive(mainWindow);
      if (window) bringToFront(window);
    },
    setDark(dark) {
      for (const window of manager.all()) window.setBackgroundColor(backgroundFor(dark));
    },
  };
  return manager;
}
