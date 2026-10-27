/**
 * Das Hauptfenster (Spezifikation §7.2): WoW-Ordner, Konto bei spoken.rusty.one, automatischer
 * Upload, Design, Ergebnis. Die Arbeit (Dateien, Netz, Schlüsselbund) macht der Main; dieses
 * Skript spricht nur über window.spoken mit ihm und zeigt die Antworten.
 */
import { THEME_SETTINGS } from '../../shared/ipc';
import type { AccountView, Report } from '../../shared/types';
import { byId, clip, h, setStatus, showUnexpectedErrors } from '../common/dom';
import { applyTheme, followTheme } from '../common/theme';
import {
  accountText, checkFailed, INITIAL_LOG, overviewStatus, reportView, saveErrorText, startText, TEXT, TITLE,
  unexpectedReport,
} from './format';
import { createLoginDialog } from './login';

const api = window.spoken;

const wowInput = byId('wow-pfad', HTMLInputElement);
const wowStatus = byId('wow-status', HTMLElement);
const accountLabel = byId('konto-text', HTMLElement);
const accountButton = byId('konto-knopf', HTMLButtonElement);
const accountHint = byId('konto-hinweis', HTMLElement);
const autoUpload = byId('auto-upload', HTMLInputElement);
const themeSelect = byId('design', HTMLSelectElement);
const log = byId('protokoll', HTMLElement);
const testButton = byId('testlauf', HTMLButtonElement);
const uploadButton = byId('hochladen', HTMLButtonElement);
const progress = byId('fortschritt', HTMLProgressElement);

let signedIn = false;
let busy = false;
let wowRound = 0; // jede Prüfung zählt hoch; eine veraltete Antwort (anderer Ordner) verfällt

function showError(text: string): void {
  void api.showMessage({ kind: 'fehler', title: TITLE, text: clip(text) });
}

function reportSaveError(saveError: string | null): void {
  if (saveError !== null) showError(saveErrorText(saveError));
}

// ---------------------------------------------------------------- WoW-Ordner

async function refreshWow(): Promise<void> {
  const round = ++wowRound;
  setStatus(wowStatus, TEXT.checking);
  try {
    const result = await api.getOverview(wowInput.value.trim());
    if (round !== wowRound) return; // inzwischen wurde ein anderer Ordner gewählt
    const status = overviewStatus(result);
    setStatus(wowStatus, status.text, status.error);
  } catch (err) {
    if (round !== wowRound) return;
    const status = checkFailed(String(err));
    setStatus(wowStatus, status.text, status.error);
  }
}

/** Eingabe übernehmen: der Main trimmt, löst ~ auf, sucht den Hauptordner und speichert. */
async function setWow(text: string): Promise<void> {
  const result = await api.setWowDir(text);
  wowInput.value = result.wowDir;
  reportSaveError(result.saveError);
  await refreshWow();
}

async function chooseWow(): Promise<void> {
  const chosen = await api.chooseWowDir();
  if (chosen) await setWow(chosen);
}

async function searchWow(): Promise<void> {
  wowRound++; // eine noch laufende Prüfung soll „Suche …“ nicht überschreiben
  setStatus(wowStatus, TEXT.searching);
  const before = wowInput.value;
  const found = await api.findWow();
  if (wowInput.value !== before) return; // während der Suche wurde schon ein Ordner gewählt; der gilt
  if (found) await setWow(found);
  else setStatus(wowStatus, TEXT.notFound, true);
}

// ---------------------------------------------------------------- Konto

function showAccount(view: AccountView): void {
  const text = accountText(view);
  signedIn = text.signedIn;
  accountLabel.textContent = text.label;
  accountButton.textContent = text.button;
  accountHint.textContent = text.hint;
}

async function refreshAccount(): Promise<void> {
  showAccount(await api.getAccount());
}

const login = createLoginDialog(showAccount, () => { void refreshAccount(); });

async function toggleAccount(): Promise<void> {
  if (!signedIn) {
    login.open();
    return;
  }
  // Rückfrage, Abmelden und Warnungen erledigt der Main mit nativen Dialogen.
  accountButton.disabled = true;
  try {
    showAccount(await api.signOut());
  } finally {
    accountButton.disabled = false;
  }
}

// ---------------------------------------------------------------- Ergebnis und Upload

function writeMuted(text: string, append: boolean): void {
  const part = h('span', { class: 'gedaempft' }, text);
  if (append) {
    log.append(part);
    log.scrollTop = log.scrollHeight;
  } else {
    log.replaceChildren(part);
    log.scrollTop = 0;
  }
}

function setBusy(value: boolean): void {
  busy = value;
  testButton.disabled = value;
  uploadButton.disabled = value;
  progress.hidden = !value;
}

function beginUpload(test: boolean): void {
  setBusy(true);
  writeMuted(`${startText(test)}\n`, false);
}

/** Ergebnis zeigen – die Fortschrittszeilen weichen ihm, es soll von oben lesbar sein. */
function finishUpload(report: Report): void {
  if (!busy) return; // schon gezeigt (Antwort und Ereignis kommen beide an)
  setBusy(false);
  const view = reportView(report);
  const head = h('span', { class: view.failed ? 'kopf fehler' : 'kopf' }, view.head);
  log.replaceChildren(head, view.rest);
  log.scrollTop = 0;
  void refreshWow();
}

async function startUpload(test: boolean): Promise<void> {
  if (busy) return;
  beginUpload(test);
  try {
    const report = await api.startUpload(test);
    if (report) finishUpload(report); // null: es lief schon einer – dessen Ereignisse beenden ihn
  } catch (err) {
    finishUpload(unexpectedReport(err));
  }
}

api.onUpload((event) => {
  switch (event.type) {
    case 'gestartet': // auch der automatische Upload, den dieses Fenster nicht selbst ausgelöst hat
      if (!busy) beginUpload(event.test);
      break;
    case 'fortschritt':
      if (busy) writeMuted(`${event.line}\n`, true);
      break;
    case 'fertig':
      finishUpload(event.report);
      break;
  }
});

// ---------------------------------------------------------------- Bedienung

wowInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.isComposing) {
    event.preventDefault();
    void setWow(wowInput.value);
  }
});
byId('wow-aendern', HTMLButtonElement).addEventListener('click', () => { void chooseWow(); });
byId('wow-suchen', HTMLButtonElement).addEventListener('click', () => { void searchWow(); });
accountButton.addEventListener('click', () => { void toggleAccount(); });
autoUpload.addEventListener('change', () => {
  void api.setAutoUpload(autoUpload.checked).then((r) => { reportSaveError(r.saveError); });
});
themeSelect.addEventListener('change', () => {
  const value = THEME_SETTINGS.find((t) => t === themeSelect.value);
  if (value) void api.setTheme(value).then((r) => { reportSaveError(r.saveError); });
});
byId('verlauf', HTMLButtonElement).addEventListener('click', () => { void api.openHistory(); });
testButton.addEventListener('click', () => { void startUpload(true); });
uploadButton.addEventListener('click', () => { void startUpload(false); });
// Während eines Uploads lehnt der Main ab und sagt „Der Upload läuft noch – bitte kurz warten.“
byId('schliessen', HTMLButtonElement).addEventListener('click', () => { void api.closeWindow(); });

// ---------------------------------------------------------------- Start

async function start(): Promise<void> {
  showUnexpectedErrors(TITLE);
  followTheme((view) => { themeSelect.value = view.setting; });
  const state = await api.getState();
  applyTheme(state.theme);
  themeSelect.value = state.theme.setting;
  wowInput.value = state.settings.wowDir;
  autoUpload.checked = state.settings.autoUpload;
  writeMuted(INITIAL_LOG, false);
  if (state.uploadRunning) beginUpload(false); // der automatische Upload lief schon los
  await Promise.all([refreshAccount(), refreshWow()]);
}

void start();
