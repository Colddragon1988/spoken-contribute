// Suche im Verlauf: der durchsuchbare Text je Upload (Detailtext in Kleinschreibung, §5.6).
import { setImmediate as yieldToLoop } from 'node:timers/promises';
import type { HistoryEntry } from '../../shared/types';
import { SEARCH_CACHE_CHARS } from '../../shared/types';

/** Nach so vielen Einträgen gibt eine lange Schleife die Ereignisschleife frei (§3.3). */
export const YIELD_EVERY = 50;

export interface SearchIndex {
  /** Suchtext eines Eintrags; load liest ihn (Detailtext samt Gesendetem, casefold). */
  text(entry: HistoryEntry, load: () => Promise<string>): Promise<string>;
  /** Zeichen im Cache (für Tests). */
  size(): number;
}

/** Hält höchstens limit Zeichen vor: Ein Upload mit Zehntausenden NPC-Texten hat schnell
 *  10 Millionen Zeichen, und bei vielen davon würde der Speicher knapp. Was nicht mehr
 *  hineinpasst, wird bei jeder Suche neu gelesen. Einträge ändern sich nach dem Schreiben nicht,
 *  daher bleibt der Cache auch beim Neuladen des Verlaufs. */
export function createSearchIndex(limit: number = SEARCH_CACHE_CHARS): SearchIndex {
  const texts = new Map<string, string>();
  let size = 0;
  return {
    async text(entry, load) {
      const known = texts.get(entry.folder);
      if (known !== undefined) return known;
      const text = await load();
      if (!texts.has(entry.folder) && size + text.length <= limit) {
        texts.set(entry.folder, text);
        size += text.length;
      }
      return text;
    },
    size: () => size,
  };
}

/** Die Einträge, deren Suchtext needle enthält (needle bereits getrimmt und gefaltet).
 *  Wirft den Abbruchgrund (AbortError), sobald signal abgebrochen ist. */
export async function searchEntries(
  candidates: readonly HistoryEntry[],
  needle: string,
  textOf: (entry: HistoryEntry) => Promise<string>,
  signal: AbortSignal,
): Promise<HistoryEntry[]> {
  const found: HistoryEntry[] = [];
  for (const [i, entry] of candidates.entries()) {
    if (i > 0 && i % YIELD_EVERY === 0) await yieldToLoop();
    signal.throwIfAborted(); // inzwischen weitergetippt oder Fenster geschlossen
    if ((await textOf(entry)).includes(needle)) found.push(entry);
  }
  signal.throwIfAborted();
  return found;
}
