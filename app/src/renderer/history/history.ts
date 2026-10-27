/**
 * Das Verlaufsfenster (Spezifikation §7.4): alle archivierten Uploads mit Suche und Filtern,
 * darunter alles zum gewählten Upload; auf der zweiten Seite die Statistik mit einem Diagramm
 * der letzten 30 Tage. Filtern und Suchen macht der Main (history:query) – die Suche muss das
 * Gesendete jedes Uploads lesen und darf das Fenster nicht aufhalten.
 */
import type { ArtFilter, HistoryQueryResult, HistoryRow } from '../../shared/types';
import { ART_FILTERS } from '../../shared/ipc';
import { MAX_HIGHLIGHTS, SEARCH_DEBOUNCE_MS } from '../../shared/types';
import { byId, h, replaceChildren, setStatus, showUnexpectedErrors } from '../common/dom';
import { applyTheme, followTheme } from '../common/theme';
import { createChart } from './chart';
import { findMatches, splitByRanges } from './highlight';

const TITLE = 'Spoken – Verlauf der Uploads';
const api = window.spoken;

const searchInput = byId('suche', HTMLInputElement);
const artSelect = byId('art', HTMLSelectElement);
const versionSelect = byId('version', HTMLSelectElement);
const summary = byId('summe', HTMLElement);
const tbody = byId('zeilen', HTMLTableSectionElement);
const details = byId('details', HTMLElement);
const statsText = byId('statistik-text', HTMLElement);
const folderButton = byId('ordner', HTMLButtonElement);
const chart = createChart(byId('diagramm', HTMLElement));

let rows: readonly HistoryRow[] = [];
let selected = -1;
let queryRound = 0; // jede Abfrage zählt hoch; eine überholte Antwort verfällt
let detailsRound = 0;
let searchTimer: number | undefined;

// ---------------------------------------------------------------- Abfrage

const currentSearch = (): string => searchInput.value.trim();
const currentArt = (): ArtFilter => ART_FILTERS.find((a) => a === artSelect.value) ?? 'alle';

/** Filter anwenden; mit Suchtext läuft die Suche im Main, eine überholte bricht dort ab. */
async function query(): Promise<void> {
  window.clearTimeout(searchTimer);
  searchTimer = undefined;
  const seq = ++queryRound;
  const search = currentSearch();
  if (search) setStatus(summary, 'Suche …');
  const answer = await api.queryHistory({ seq, search, art: currentArt(), version: versionSelect.value });
  if (answer.seq !== queryRound || seq !== queryRound) return; // überholt
  switch (answer.status) {
    case 'abgebrochen':
      return;
    case 'fehler':
      setStatus(summary, `Suche fehlgeschlagen: ${answer.message}`);
      return;
    case 'ok':
      if (!updateVersions(answer.result.versions)) {
        await query(); // die gewählte Version gibt es nicht mehr: mit „Alle“ neu
        return;
      }
      show(answer.result);
  }
}

/** Beim Tippen erst kurz warten, damit nicht nach jedem Buchstaben gesucht wird. */
function scheduleQuery(): void {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => { void query(); }, SEARCH_DEBOUNCE_MS);
}

/** Auswahl „Version“ auffrischen; false, wenn die gewählte weg ist (dann gilt wieder „Alle“). */
function updateVersions(versions: readonly string[]): boolean {
  const chosen = versionSelect.value;
  const options = [h('option', { value: '' }, 'Alle'), ...versions.map((v) => h('option', { value: v }, v))];
  replaceChildren(versionSelect, ...options);
  if (chosen && !versions.includes(chosen)) {
    versionSelect.value = '';
    return false;
  }
  versionSelect.value = chosen;
  return true;
}

function show(result: HistoryQueryResult): void {
  rows = result.rows;
  setStatus(summary, result.summary);
  replaceChildren(tbody, ...rows.map((row, i) => rowElement(row, i)));
  selected = -1;
  // Statistik und Diagramm gelten für die gefilterten Einträge.
  replaceChildren(statsText, h('span', { class: 'kopf' }, result.statistics.heading), '\n' + result.statistics.lines.join('\n'));
  statsText.scrollTop = 0;
  chart.show(result.daily);
  if (rows.length) {
    select(0); // der erste Eintrag ist automatisch gewählt
  } else {
    folderButton.disabled = true;
    details.replaceChildren();
  }
}

function rowElement(row: HistoryRow, index: number): HTMLTableRowElement {
  const tr = h('tr', { 'aria-selected': 'false' },
    h('td', {}, row.zeit), h('td', {}, row.art), h('td', { title: row.version }, row.version),
    h('td', { class: 'zahl' }, row.anzahl), h('td', { title: row.ergebnis }, row.ergebnis));
  if (row.failed) tr.classList.add('fehler');
  tr.addEventListener('click', () => { select(index); });
  return tr;
}

// ---------------------------------------------------------------- Auswahl und Details

function select(index: number): void {
  const row = rows[index];
  if (!row || index === selected) return;
  tbody.children[selected]?.setAttribute('aria-selected', 'false');
  selected = index;
  const tr = tbody.children[index];
  tr?.setAttribute('aria-selected', 'true');
  tr?.scrollIntoView({ block: 'nearest' });
  void showDetails(row.id);
}

/** Alles zum gewählten Upload; Suchtreffer markiert (höchstens 1000), Ansicht beim ersten. */
async function showDetails(id: string): Promise<void> {
  const round = ++detailsRound;
  const view = await api.historyDetails(id);
  if (round !== detailsRound) return;
  if (!view) {
    folderButton.disabled = true;
    details.replaceChildren();
    return;
  }
  folderButton.disabled = false;
  const search = currentSearch();
  const headMatches = findMatches(view.heading, search);
  const bodyMatches = findMatches(view.body, search, Math.max(0, MAX_HIGHLIGHTS - headMatches.length));
  const head = h('span', { class: 'kopf' }, ...marked(view.heading, headMatches));
  details.replaceChildren(head, '\n', ...marked(view.body, bodyMatches));
  const first = details.querySelector('mark');
  if (first) first.scrollIntoView({ block: 'center' });
  else details.scrollTop = 0;
}

function marked(text: string, ranges: ReturnType<typeof findMatches>): (Node | string)[] {
  return splitByRanges(text, ranges).map((part) => (part.match ? h('mark', {}, part.text) : part.text));
}

tbody.addEventListener('keydown', (event) => {
  const last = rows.length - 1;
  const target = { ArrowDown: selected + 1, ArrowUp: selected - 1, Home: 0, End: last, PageDown: selected + 10, PageUp: selected - 10 }[event.key];
  if (target === undefined || last < 0) return;
  event.preventDefault();
  select(Math.min(Math.max(target, 0), last));
});

// ---------------------------------------------------------------- Seiten „Uploads“ und „Statistik“

const tabs = [
  { button: byId('reiter-uploads', HTMLButtonElement), page: byId('seite-uploads', HTMLElement) },
  { button: byId('reiter-statistik', HTMLButtonElement), page: byId('seite-statistik', HTMLElement) },
];

function showPage(index: number): void {
  tabs.forEach((tab, i) => {
    const active = i === index;
    tab.button.setAttribute('aria-selected', String(active));
    tab.button.tabIndex = active ? 0 : -1;
    tab.page.hidden = !active;
  });
  if (index === 1) chart.redraw();
}

tabs.forEach((tab, i) => {
  tab.button.addEventListener('click', () => { showPage(i); });
  tab.button.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const next = (i + 1) % tabs.length;
    showPage(next);
    tabs[next]?.button.focus();
  });
});

// ---------------------------------------------------------------- teilbarer Bereich (1:2)

const splitter = byId('teiler', HTMLElement);
const grip = byId('griff', HTMLElement);
const MIN_PANE = 60;

function setTableHeight(px: number): void {
  const max = splitter.clientHeight - grip.offsetHeight - MIN_PANE;
  const height = Math.round(Math.min(Math.max(px, MIN_PANE), Math.max(max, MIN_PANE)));
  splitter.style.gridTemplateRows = `${height}px ${grip.offsetHeight}px minmax(${MIN_PANE}px, 1fr)`;
}

grip.addEventListener('pointerdown', (event) => {
  grip.setPointerCapture(event.pointerId);
  const move = (e: PointerEvent): void => { setTableHeight(e.clientY - splitter.getBoundingClientRect().top); };
  const stop = (): void => {
    grip.removeEventListener('pointermove', move);
    grip.removeEventListener('pointerup', stop);
    grip.removeEventListener('pointercancel', stop);
  };
  grip.addEventListener('pointermove', move);
  grip.addEventListener('pointerup', stop);
  grip.addEventListener('pointercancel', stop);
});
grip.addEventListener('keydown', (event) => {
  const delta = { ArrowUp: -20, ArrowDown: 20 }[event.key];
  if (delta === undefined) return;
  event.preventDefault();
  const current = splitter.firstElementChild instanceof HTMLElement ? splitter.firstElementChild.offsetHeight : MIN_PANE;
  setTableHeight(current + delta);
});

// ---------------------------------------------------------------- Bedienung

searchInput.addEventListener('input', scheduleQuery);
searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.isComposing) void query();
});
artSelect.addEventListener('change', () => { void query(); });
versionSelect.addEventListener('change', () => { void query(); });
folderButton.addEventListener('click', () => {
  const row = rows[selected];
  if (row) void api.openEntryFolder(row.id);
});
byId('archiv', HTMLButtonElement).addEventListener('click', () => { void api.openArchive(); });
byId('schliessen', HTMLButtonElement).addEventListener('click', () => { void api.closeWindow(); });
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !event.defaultPrevented) void api.closeWindow();
});
// Nach jedem Upload neu laden; der Suchcache im Main bleibt.
api.onHistoryChanged(() => { void query(); });

async function start(): Promise<void> {
  showUnexpectedErrors(TITLE);
  followTheme(() => { chart.redraw(); });
  applyTheme((await api.getState()).theme);
  await query();
}

void start();
