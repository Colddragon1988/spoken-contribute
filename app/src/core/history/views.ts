// Daten des Verlaufsfensters: Filter, Suche, Summenzeile, Statistik, Details (§7.4) – für die IPC.
import type {
  ArtFilter, Clock, DetailsView, HistoryEntry, HistoryFilter, HistoryQueryResult, HistoryStore,
  HistoryViews, WowData,
} from '../../shared/types';
import { casefold } from '../../shared/casefold';
import { DAILY_DAYS, SEARCH_CACHE_CHARS } from '../../shared/types';
import { detailsText, own, pyStrip, row, totals, versionsOf } from './format';
import { createSearchIndex, searchEntries } from './search';
import { daily, statisticsView } from './stats';

/** Art und Version – das steht in eintrag.json und geht sofort. version '' = Alle. */
export function passesFilters(entry: HistoryEntry, art: ArtFilter, version: string): boolean {
  if (art === 'fehlgeschlagen' && !entry.failed) return false;
  if ((art === 'zeilen' || art === 'npc-texte') && (own(entry.info, 'art') !== art || entry.failed)) return false;
  return version === '' || versionsOf(entry.info).includes(version);
}

/** Sortierte, eindeutige Versionen aller Einträge (für die Auswahl). */
export function allVersions(entries: readonly HistoryEntry[]): string[] {
  return [...new Set(entries.flatMap((e) => versionsOf(e.info)))].sort();
}

/** Summenzeile bzw. Hinweis über der Tabelle. */
export function summaryLine(all: readonly HistoryEntry[], shown: readonly HistoryEntry[]): string {
  if (all.length === 0) return 'Noch keine Uploads archiviert.';
  if (shown.length === 0) return 'Keine Uploads passen zu Suche und Filter.';
  const text = totals(shown);
  return shown.length === all.length ? text : `${text}   (gefiltert: ${shown.length} von ${all.length})`;
}

/** Wie createHistoryViews, mit einstellbarer Grenze des Suchcaches (Tests). */
export function createHistoryViewsWith(deps: {
  readonly store: HistoryStore;
  readonly wowData: WowData;
  readonly clock: Clock;
  readonly searchLimit?: number;
}): HistoryViews {
  const { store, wowData, clock } = deps;
  const index = createSearchIndex(deps.searchLimit ?? SEARCH_CACHE_CHARS);
  let loaded: Promise<HistoryEntry[]> | null = null;

  function current(): Promise<HistoryEntry[]> {
    if (!loaded) {
      const reading = store.entries();
      loaded = reading;
      reading.catch(() => {
        if (loaded === reading) loaded = null; // beim nächsten Mal erneut versuchen
      });
    }
    return loaded;
  }

  async function details(entry: HistoryEntry): Promise<string> {
    return detailsText(entry, await store.payload(entry), (e) => wowData.parseEnvelope(e));
  }

  /** Alles zu einem Upload in Kleinbuchstaben (Titel, Texte, Fehler …). Liest das Gesendete –
   *  bei vielen NPC-Texten einige MB. */
  const searchText = (entry: HistoryEntry): Promise<string> =>
    index.text(entry, async () => casefold(await details(entry)));

  /** Eintrag zur id; erst aus der geladenen Liste, sonst frisch gelesen (etwa gleich nach einem Upload). */
  async function find(id: string): Promise<HistoryEntry | null> {
    const hit = (await current()).find((e) => e.id === id);
    if (hit) return hit;
    return (await store.entries()).find((e) => e.id === id) ?? null;
  }

  return {
    async query(filter: HistoryFilter, signal: AbortSignal): Promise<HistoryQueryResult> {
      signal.throwIfAborted();
      const all = await current();
      signal.throwIfAborted();
      const versions = allVersions(all);
      // eine nach dem Neuladen verschwundene Version gilt wie „Alle“
      const version = versions.includes(filter.version) ? filter.version : '';
      const candidates = all.filter((e) => passesFilters(e, filter.art, version));
      const needle = casefold(pyStrip(filter.search));
      const shown = needle ? await searchEntries(candidates, needle, searchText, signal) : candidates;
      const filtered = shown.length !== all.length;
      return {
        rows: shown.map(row),
        versions,
        summary: summaryLine(all, shown),
        statistics: statisticsView(shown, filtered),
        daily: daily(shown, clock.now(), DAILY_DAYS),
      };
    },

    async details(id: string): Promise<DetailsView | null> {
      const entry = await find(id);
      if (!entry) return null;
      const text = await details(entry);
      const cut = text.indexOf('\n');
      return cut < 0
        ? { id, heading: text, body: '' }
        : { id, heading: text.slice(0, cut), body: text.slice(cut + 1) };
    },

    async folderOf(id: string): Promise<string | null> {
      return (await find(id))?.folder ?? null;
    },

    reload(): void {
      loaded = null; // der Suchcache bleibt: ein Eintrag ändert sich nach dem Schreiben nicht mehr
    },
  };
}
