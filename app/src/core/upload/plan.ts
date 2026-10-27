// Planung der gesammelten Zeilen und Auswertung der Server-Antworten (§2.3) – reine Funktionen.
import { MAX_ENVELOPES } from '../../shared/types';
import type { ContributionStore, JsonObject, JsonValue } from '../../shared/types';

/** Die gesammelten Zeilen, die in diesem Durchgang mitgehen. */
export interface Batch {
  /** ohne Doppelte */
  readonly envelopes: string[];
  /** die .lua-Dateien, die danach geleert werden */
  readonly files: string[];
  /** Anzahl je Version (Anzeigename), für die Meldung; Reihenfolge des ersten Auftretens */
  readonly perFlavor: Map<string, number>;
  /** Umschläge, die erst beim nächsten Mal mitgehen */
  deferred: number;
}

export interface ContributionResult {
  neu: number;
  bekannt: number;
  abgelehnt: number;
}

/** Wählt die Dateien für diesen Durchgang aus (zusammen höchstens maxEnvelopes Umschläge).
 *
 *  Eine Datei geht ganz oder gar nicht mit, denn danach wird sie geleert: Was nicht mehr passt,
 *  bleibt bis zum nächsten Mal liegen. Nur die erste Datei mit Umschlägen geht immer mit, auch
 *  wenn sie allein (.lua und .bak zusammen) über der Grenze liegt – sonst käme sie nie durch;
 *  sie wird dann auf mehrere Uploads verteilt. */
export function planBatch(stores: readonly ContributionStore[], maxEnvelopes = MAX_ENVELOPES): Batch {
  const batch: Batch = { envelopes: [], files: [], perFlavor: new Map(), deferred: 0 };
  const seen = new Set<string>();
  for (const store of stores) {
    const fresh = store.envelopes.filter((e) => !seen.has(e));
    if (batch.envelopes.length > 0 && batch.envelopes.length + fresh.length > maxEnvelopes) {
      batch.deferred += fresh.length;
      continue;
    }
    batch.envelopes.push(...fresh);
    for (const e of fresh) seen.add(e);
    batch.files.push(store.lua);
    if (fresh.length > 0) {
      const name = store.flavor.name;
      batch.perFlavor.set(name, (batch.perFlavor.get(name) ?? 0) + fresh.length);
    }
  }
  return batch;
}

/** Die ersten zehn Titel, der Rest nur gezählt. */
export function shortTitles(titles: readonly string[]): string {
  let text = titles.slice(0, 10).join(', ');
  if (titles.length > 10) text += ` und ${titles.length - 10} weitere`;
  return text;
}

/** Hinweise zum Upload: welche Quests und Bücher, Aufteilung, was liegen bleibt. */
export function batchNotes(batch: Batch, titles: readonly string[], uploads: number, maxEnvelopes = MAX_ENVELOPES): string[] {
  const notes = titles.length > 0 ? [shortTitles(titles)] : [];
  if (uploads > 1) notes.push(`Mehr als ${maxEnvelopes} Zeilen in einer Datei – sie gehen in ${uploads} Uploads.`);
  if (batch.deferred > 0) {
    notes.push(`${batch.deferred} weitere passen nicht mehr in diesen Upload (höchstens ${maxEnvelopes}) und gehen beim nächsten Mal mit.`);
  }
  return notes;
}

/** Ein Upload, wie ihn das Formular der Website schickt: anonym, ohne Name und E-Mail. */
export function contributionPayload(envelopes: readonly string[]): JsonObject {
  return { envelopes: [...envelopes], name: null, email: null, website: '' };
}

/** Zahl aus einer Server-Antwort; alles andere zählt als 0, statt nach dem Upload abzustürzen.
 *  Anders als in Python zählt true nicht als 1 (nur echte Ganzzahlen). */
export function count(value: JsonValue | undefined): number {
  return typeof value === 'number' && Number.isInteger(value) ? value : 0;
}

/** „refused“ kommt als Zahl oder als {Grund: Anzahl}. */
export function refusedCount(value: JsonValue | undefined): number {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return Object.values(value).reduce<number>((sum, n) => sum + count(n), 0);
  }
  return count(value);
}

/** Die Antworten aller Uploads zusammengezählt, so wie sie im Verlauf stehen. */
export function summedResult(answers: readonly JsonObject[]): ContributionResult {
  const result: ContributionResult = { neu: 0, bekannt: 0, abgelehnt: 0 };
  for (const answer of answers) {
    const accepted = count(answer.accepted);
    const known = count(answer.known);
    result.neu += accepted - known;
    result.bekannt += known;
    result.abgelehnt += refusedCount(answer.refused);
  }
  return result;
}

/** „12 neu für das Projekt, 3 kannte es schon, 1 nicht verwendbar“. */
export function resultLine(result: ContributionResult): string {
  let text = `${result.neu} neu für das Projekt`;
  if (result.bekannt) text += `, ${result.bekannt} kannte es schon`;
  if (result.abgelehnt) text += `, ${result.abgelehnt} nicht verwendbar`;
  return text;
}

/** Pythons str(dict) nachempfunden – nur für die Meldung „unerwartete Antwort“ (Entscheidung 13). */
export function pyRepr(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return 'None';
  if (value === true) return 'True';
  if (value === false) return 'False';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    const escaped = value.replaceAll('\\', '\\\\').replaceAll('\n', '\\n');
    // wie Python: doppelte Anführungszeichen, wenn nur einfache vorkommen
    if (value.includes("'") && !value.includes('"')) return `"${escaped}"`;
    return `'${escaped.replaceAll("'", "\\'")}'`;
  }
  if (Array.isArray(value)) return `[${value.map(pyRepr).join(', ')}]`;
  return `{${Object.entries(value).map(([k, v]) => `${pyRepr(k)}: ${pyRepr(v)}`).join(', ')}}`;
}
