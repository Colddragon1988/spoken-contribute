// Paket (d): Verlauf, Archiv, Statistik, Suche.
import type { Clock, HistoryStore, HistoryViews, WowData } from '../../shared/types';
import { createArchive } from './archive';
import { migrateOldArchive } from './migrate';
import { createHistoryViewsWith } from './views';

export function createHistoryStore(deps: { dataDir: string; clock: Clock; wowData: WowData }): HistoryStore {
  const archive = createArchive({ dataDir: deps.dataDir, clock: deps.clock });
  return {
    root: archive.root,
    record: (input) => archive.record(input),
    entries: () => archive.entries(),
    payload: (entry) => archive.payload(entry),
    migrateOldArchive: () => migrateOldArchive({
      dataDir: deps.dataDir, wowData: deps.wowData, record: (input) => archive.record(input),
    }),
  };
}

export function createHistoryViews(deps: { store: HistoryStore; wowData: WowData; clock: Clock }): HistoryViews {
  return createHistoryViewsWith(deps);
}

// rein exportiert, für Tests und die Gegenprobe
export { DATA, INFO, ORIGINALS, compareNewestFirst } from './archive';
export { KIND_LABELS, detailsText, resultText, row, totals } from './format';
export { MIGRATION_NOTE } from './migrate';
export { createSearchIndex, searchEntries } from './search';
export { daily, statistics, statisticsView } from './stats';
export { allVersions, createHistoryViewsWith, passesFilters, summaryLine } from './views';
