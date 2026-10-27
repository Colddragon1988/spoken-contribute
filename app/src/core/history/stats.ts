// Statistik und Tageswerte über Verlaufseinträge (§5.6, Statistik-Text §7.4).
// Braucht nur eintrag.json, nicht das Gesendete.
import type { DailyValue, HistoryEntry, StatisticsView } from '../../shared/types';
import { DAILY_DAYS } from '../../shared/types';
import { formatDate, formatDayKey } from '../time';
import { num, own, pyGet, truthy, versionsOf } from './format';

export interface Statistics {
  uploads: number;
  failed: number;
  /** gesendete gesammelte Zeilen */
  lines: number;
  linesNew: number;
  linesKnown: number;
  /** gesendete NPC-Texte */
  texts: number;
  textsNew: number;
  textsChanged: number;
  /** Version → [Zeilen, NPC-Texte], Reihenfolge des ersten Auftretens */
  perVersion: Map<string, [number, number]>;
  first: Date | null;
  last: Date | null;
}

/** Summen über die Einträge. */
export function statistics(found: readonly HistoryEntry[]): Statistics {
  const stats: Statistics = {
    uploads: 0, failed: 0, lines: 0, linesNew: 0, linesKnown: 0,
    texts: 0, textsNew: 0, textsChanged: 0, perVersion: new Map(), first: null, last: null,
  };
  for (const entry of found) {
    if (entry.failed) {
      stats.failed += 1;
      continue;
    }
    const { info } = entry;
    const ergebnis = own(info, 'ergebnis');
    const result = truthy(ergebnis) ? ergebnis : {};
    const count = num(pyGet(info, 'anzahl', 0));
    stats.uploads += 1;
    if (!stats.first || entry.time < stats.first) stats.first = entry.time;
    if (!stats.last || entry.time > stats.last) stats.last = entry.time;
    const column = own(info, 'art') === 'zeilen' ? 0 : 1;
    if (column === 0) {
      stats.lines += count;
      stats.linesNew += num(pyGet(result, 'neu', 0));
      stats.linesKnown += num(pyGet(result, 'bekannt', 0));
    } else {
      stats.texts += count;
      stats.textsNew += num(pyGet(result, 'neu', 0));
      stats.textsChanged += num(pyGet(result, 'aktualisiert', 0));
    }
    const versions = versionsOf(info);
    for (const version of versions.length > 0 ? versions : ['?']) {
      const sums = stats.perVersion.get(version) ?? [0, 0];
      sums[column] += count;
      stats.perVersion.set(version, sums);
    }
  }
  return stats;
}

/** Der Text der Seite „Statistik“; filtered: es sind nicht alle Einträge zu sehen. */
export function statisticsView(found: readonly HistoryEntry[], filtered: boolean): StatisticsView {
  const s = statistics(found);
  let first = `${s.uploads} Uploads` + (s.failed ? `, ${s.failed} fehlgeschlagen` : '');
  if (s.first && s.last) first += ` – vom ${formatDate(s.first)} bis ${formatDate(s.last)}`;
  const lines = [
    first,
    `Gesammelte Zeilen: ${s.lines} gesendet, ${s.linesNew} neu für das Projekt, ${s.linesKnown} schon bekannt`,
    `NPC-Texte: ${s.texts} gesendet, ${s.textsNew} neu, ${s.textsChanged} aktualisiert`,
  ];
  const versions = [...s.perVersion.keys()].sort();
  for (const version of versions) {
    const [lineCount, textCount] = s.perVersion.get(version) ?? [0, 0];
    lines.push(`    ${version}: ${lineCount} Zeilen, ${textCount} NPC-Texte`);
  }
  return { heading: filtered ? 'Statistik (gefiltert)' : 'Statistik', lines };
}

/** (Tag, gesammelte Zeilen, NPC-Texte) für die letzten `days` Kalendertage bis heute (Ortszeit),
 *  aufsteigend. Gerechnet wird in Kalendertagen, damit eine Zeitumstellung keinen Tag doppelt
 *  zählt oder auslässt. */
export function daily(found: readonly HistoryEntry[], now: Date, days: number = DAILY_DAYS): DailyValue[] {
  const totals = new Map<string, [number, number]>();
  for (let n = days - 1; n >= 0; n--) {
    // Mittag statt Mitternacht: Kalendertag ohne Risiko durch eine Umstellung um Mitternacht
    totals.set(formatDayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - n, 12)), [0, 0]);
  }
  for (const entry of found) {
    const sums = totals.get(formatDayKey(entry.time));
    if (entry.failed || !sums) continue;
    sums[own(entry.info, 'art') === 'zeilen' ? 0 : 1] += num(pyGet(entry.info, 'anzahl', 0));
  }
  return [...totals].map(([day, [lines, texts]]) => ({ day, lines, texts }));
}
