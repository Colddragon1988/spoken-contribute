/**
 * Fensteroptionen exakt wie Architektur §5.3 (rein, getestet). Nur Typ-Import aus Electron.
 */
import type { BrowserWindowConstructorOptions } from 'electron';

export const MAIN_TITLE = 'Spoken – Beiträge hochladen';
export const HISTORY_TITLE = 'Spoken – Verlauf der Uploads';
/** Name der nicht persistenten Fenster-Session (ohne „persist:“: nichts landet auf der Platte). */
export const UI_PARTITION = 'spoken-ui';

export interface WindowSize {
  readonly width: number;
  readonly height: number;
  readonly minWidth: number;
  readonly minHeight: number;
}

export const MAIN_SIZE: WindowSize = { width: 700, height: 600, minWidth: 580, minHeight: 480 };
export const HISTORY_SIZE: WindowSize = { width: 900, height: 640, minWidth: 640, minHeight: 440 };

/** Hintergrund vor dem ersten Zeichnen (§7.1), damit nichts weiß aufblitzt. */
export const backgroundFor = (dark: boolean): string => (dark ? '#1e1f22' : '#f2f2f2');

export function windowOptions(
  title: string, size: WindowSize, dark: boolean, preload: string, packaged: boolean,
): BrowserWindowConstructorOptions {
  return {
    show: false,
    title,
    width: size.width,
    height: size.height,
    minWidth: size.minWidth,
    minHeight: size.minHeight,
    backgroundColor: backgroundFor(dark),
    autoHideMenuBar: true,
    webPreferences: {
      preload,
      partition: UI_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      spellcheck: false,
      safeDialogs: true,
      devTools: !packaged,
    },
  };
}
