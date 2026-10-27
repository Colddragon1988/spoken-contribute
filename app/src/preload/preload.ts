/**
 * preload (sandboxed): stellt window.spoken bereit – genau die Methoden von SpokenApi, sonst nichts.
 * Kein ipcRenderer, kein IpcRendererEvent und keine Node-API erreichen die Seite (Architektur §4.4).
 * Objekte werden Feld für Feld neu gebaut, damit nichts Zusätzliches mitreist.
 */
import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS, EVENTS, type SpokenApi, type ThemeView, type Unsubscribe, type UploadEvent } from '../shared/ipc';

/** Abonnieren; der Seite wird nur die Nutzlast gereicht, nie das IpcRendererEvent. */
function subscribe(channel: string, deliver: (payload: unknown) => void): Unsubscribe {
  const handler = (_event: Electron.IpcRendererEvent, payload: unknown): void => { deliver(payload); };
  ipcRenderer.on(channel, handler);
  return () => { ipcRenderer.removeListener(channel, handler); };
}

const api: SpokenApi = {
  getState: () => ipcRenderer.invoke(CHANNELS.getState),
  setWowDir: (text) => ipcRenderer.invoke(CHANNELS.setWowDir, text),
  chooseWowDir: () => ipcRenderer.invoke(CHANNELS.chooseWowDir),
  findWow: () => ipcRenderer.invoke(CHANNELS.findWow),
  getOverview: (wowDir) => ipcRenderer.invoke(CHANNELS.getOverview, wowDir),
  setAutoUpload: (value) => ipcRenderer.invoke(CHANNELS.setAutoUpload, value),
  setTheme: (theme) => ipcRenderer.invoke(CHANNELS.setTheme, theme),
  getAccount: () => ipcRenderer.invoke(CHANNELS.getAccount),
  // einmal senden, nie zurückbekommen (§5.5)
  signIn: (email, password) => ipcRenderer.invoke(CHANNELS.signIn, { email, password }),
  signOut: () => ipcRenderer.invoke(CHANNELS.signOut),
  startUpload: (test) => ipcRenderer.invoke(CHANNELS.startUpload, { test }),
  openHistory: () => ipcRenderer.invoke(CHANNELS.openHistory),
  queryHistory: (query) => ipcRenderer.invoke(CHANNELS.queryHistory, {
    seq: query.seq, search: query.search, art: query.art, version: query.version,
  }),
  historyDetails: (id) => ipcRenderer.invoke(CHANNELS.historyDetails, id),
  openEntryFolder: (id) => ipcRenderer.invoke(CHANNELS.openEntryFolder, id),
  openArchive: () => ipcRenderer.invoke(CHANNELS.openArchive),
  openRegister: () => ipcRenderer.invoke(CHANNELS.openRegister),
  closeWindow: () => ipcRenderer.invoke(CHANNELS.closeWindow),
  showMessage: (message) => ipcRenderer.invoke(CHANNELS.showMessage, {
    kind: message.kind, title: message.title, text: message.text,
  }),
  onUpload: (listener) => subscribe(EVENTS.upload, (payload) => { listener(payload as UploadEvent); }),
  onTheme: (listener) => subscribe(EVENTS.theme, (payload) => { listener(payload as ThemeView); }),
  onHistoryChanged: (listener) => subscribe(EVENTS.historyChanged, () => { listener(); }),
};

contextBridge.exposeInMainWorld('spoken', api);
