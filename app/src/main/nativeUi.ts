/**
 * Native Dialoge und „Öffnen mit …“ hinter einer Schnittstelle: In der Sandbox ersetzt sie
 * sandbox.ts (Antworten aus system.json, nichts öffnet sich wirklich), sonst Electron.
 */
import { dialog, shell, type BrowserWindow, type MessageBoxOptions } from 'electron';

export type MessageKind = 'info' | 'warnung' | 'fehler';

export interface NativeUi {
  /** Hinweisdialog über owner; wartet, bis er geschlossen ist */
  message(owner: BrowserWindow | null, kind: MessageKind, title: string, text: string): Promise<void>;
  /** Ja/Nein-Frage wie messagebox.askyesno; true = Ja */
  confirm(owner: BrowserWindow | null, title: string, text: string): Promise<boolean>;
  /** Ordnerdialog; null = abgebrochen */
  chooseFolder(owner: BrowserWindow | null, title: string, start: string): Promise<string | null>;
  /** Ordner im Dateimanager öffnen; '' = geklappt, sonst Fehlertext */
  openPath(path: string): Promise<string>;
  /** Adresse im Browser öffnen (nur feste Adressen aus dem Main) */
  openExternal(url: string): Promise<void>;
}

const TYPES: Readonly<Record<MessageKind, MessageBoxOptions['type']>> = {
  info: 'info',
  warnung: 'warning',
  fehler: 'error',
};

function show(owner: BrowserWindow | null, options: MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> {
  return owner && !owner.isDestroyed() ? dialog.showMessageBox(owner, options) : dialog.showMessageBox(options);
}

export function createElectronUi(): NativeUi {
  return {
    async message(owner, kind, title, text) {
      await show(owner, { type: TYPES[kind], title, message: text, buttons: ['OK'], noLink: true });
    },
    async confirm(owner, title, text) {
      const { response } = await show(owner, {
        type: 'question', title, message: text, buttons: ['Ja', 'Nein'], defaultId: 0, cancelId: 1, noLink: true,
      });
      return response === 0;
    },
    async chooseFolder(owner, title, start) {
      const options = { title, defaultPath: start, properties: ['openDirectory' as const] };
      const result = owner && !owner.isDestroyed()
        ? await dialog.showOpenDialog(owner, options)
        : await dialog.showOpenDialog(options);
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
    openPath: (path) => shell.openPath(path),
    openExternal: (url) => shell.openExternal(url),
  };
}
