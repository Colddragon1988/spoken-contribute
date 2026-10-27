// Ergebniskurztext, Tabellenzeile, Summenzeile und Detailtext eines Verlaufseintrags (§5.6).
// Die Texte folgen history.py wörtlich. Werte aus eintrag.json/daten.json.gz werden wie Pythons
// str() eingesetzt (pyStr), Wahrheitswerte wie in Python geprüft (truthy) – die Dateien können
// auch von der Python-Fassung oder von Hand stammen.
import type { EnvelopeFields, HistoryEntry, HistoryRow, JsonObject } from '../../shared/types';
import { formatDetailsTime, formatTableTime } from '../time';

export const KIND_LABELS: Readonly<Record<string, string>> = {
  zeilen: 'Gesammelte Zeilen',
  'npc-texte': 'NPC-Texte',
};
const SOURCE_NAMES: Readonly<Record<string, string>> = { quests: 'Quest', books: 'Buch', readables: 'Buch' };
const EVENT_NAMES: Readonly<Record<string, string>> = {
  detail: 'Annahme', progress: 'Fortschritt', complete: 'Abschluss', greeting: 'Begrüßung', gossip: 'Gespräch',
};

// ------------------------------------------------------------------ Python-Nachbildungen

/** Eigener Schlüssel eines Objekts (kein Prototyp), sonst undefined. */
export function own(obj: Readonly<Record<string, unknown>>, key: string): unknown {
  return Object.hasOwn(obj, key) ? obj[key] : undefined;
}

/** dict.get(key, default): default nur, wenn der Schlüssel fehlt (auch null zählt als Wert). */
export function pyGet(obj: unknown, key: string, fallback: unknown = null): unknown {
  return isObject(obj) && Object.hasOwn(obj, key) ? obj[key] : fallback;
}

export function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Pythons Wahrheitswert: None, False, 0, "", [] und {} sind falsch. */
export function truthy(value: unknown): boolean {
  if (value === null || value === undefined || value === false || value === 0 || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

/** Wie Pythons str() für JSON-Werte (None, True/False, Zahlen, Text). */
export function pyStr(value: unknown): string {
  if (value === null || value === undefined) return 'None';
  if (value === true) return 'True';
  if (value === false) return 'False';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return JSON.stringify(value);
}

/** Zahl für Summen; alles andere zählt 0 (Python würde dort abstürzen). */
export function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Leerraum laut Pythons str.isspace – String.trim kennt \x1c–\x1f nicht, entfernt dafür U+FEFF. */
const PY_SPACE = '\\t\\n\\v\\f\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const STRIP = new RegExp(`^[${PY_SPACE}]+|[${PY_SPACE}]+$`, 'gu');
export const pyStrip = (text: string): string => text.replace(STRIP, '');

const LINE_BREAKS = '\\r\\n|[\\n\\r\\v\\f\\x1c-\\x1e\\x85\\u2028\\u2029]';
const LINE_BREAK = new RegExp(LINE_BREAKS, 'u');

/** Wie Pythons str.splitlines() (ohne Zeilenenden). */
export function pySplitlines(text: string): string[] {
  const lines = text.split(LINE_BREAK);
  if (lines.at(-1) === '') lines.pop(); // ein abschließender Umbruch ergibt keine leere Zeile
  return lines;
}

/** Liste der Versionen aus eintrag.json; anderes als eine Liste gilt als leer. */
export function versionsOf(info: JsonObject): string[] {
  const list = own(info, 'versionen');
  return Array.isArray(list) ? list.map(pyStr) : [];
}

// ------------------------------------------------------------------ Ergebnis, Zeile, Summen

/** Kurzfassung des Ergebnisses, z. B. „12 neu, 3 schon bekannt“. */
export function resultText(info: JsonObject): string {
  if (own(info, 'status') !== 'ok') return 'Fehlgeschlagen';
  const result = own(info, 'ergebnis');
  if (!truthy(result)) return 'gesendet (Antwort nicht gespeichert)';
  const parts = [`${pyStr(pyGet(result, 'neu', 0))} neu`];
  for (const [key, label] of [['bekannt', 'schon bekannt'], ['aktualisiert', 'aktualisiert'], ['abgelehnt', 'nicht verwendbar']] as const) {
    const value = pyGet(result, key);
    if (truthy(value)) parts.push(`${pyStr(value)} ${label}`);
  }
  return parts.join(', ');
}

/** Versionstext der Tabelle: „Classic Era, WoW Forever (deDE)“. */
export function versionText(info: JsonObject): string {
  let version = versionsOf(info).join(', ');
  const lang = own(info, 'sprache');
  if (truthy(lang)) version += ` (${pyStr(lang)})`;
  return version;
}

export function kindLabel(info: JsonObject): string {
  const art = own(info, 'art');
  return (typeof art === 'string' ? KIND_LABELS[art] : undefined) ?? '?';
}

/** Eine Zeile der Verlaufstabelle: Zeitpunkt, Art, Version, Anzahl, Ergebnis. */
export function row(entry: HistoryEntry): HistoryRow {
  const { info } = entry;
  return {
    id: entry.id,
    zeit: formatTableTime(entry.time),
    art: kindLabel(info),
    version: versionText(info),
    anzahl: Object.hasOwn(info, 'anzahl') ? pyStr(info.anzahl) : '',
    ergebnis: resultText(info),
    failed: entry.failed,
  };
}

/** Die Summenzeile über dem Verlauf. */
export function totals(found: readonly HistoryEntry[]): string {
  const ok = found.filter((e) => !e.failed);
  const sumOf = (art: string): number =>
    ok.filter((e) => own(e.info, 'art') === art).reduce((s, e) => s + num(own(e.info, 'anzahl')), 0);
  const answered = ok.map((e) => own(e.info, 'ergebnis')).filter(truthy);
  let text = `${ok.length} Uploads: ${sumOf('zeilen')} gesammelte Zeilen und ${sumOf('npc-texte')} NPC-Texte`;
  if (answered.length > 0) { // beim übernommenen Archiv kennt man die Antwort des Servers nicht
    text += `, davon ${answered.reduce((s: number, r) => s + num(pyGet(r, 'neu', 0)), 0)} neu für das Projekt`;
  }
  const failed = found.length - ok.length;
  return text + (failed ? ` · ${failed} fehlgeschlagen` : '');
}

// ------------------------------------------------------------------ Details

export type ParseEnvelope = (envelope: string) => EnvelopeFields;

/** Alles zu einem Upload als Text; die erste Zeile ist die Überschrift. */
export function detailsText(entry: HistoryEntry, payload: JsonObject | null, parseEnvelope: ParseEnvelope): string {
  const { info } = entry;
  const out = [`${kindLabel(info)} – ${formatDetailsTime(entry.time)}`, `Version: ${versionText(info) || '?'}`];
  const summary = own(info, 'zusammenfassung');
  if (truthy(summary)) out.push(`Inhalt: ${pyStr(summary)}`);
  if (entry.failed) {
    out.push(`Fehlgeschlagen: ${pyStr(pyGet(info, 'fehler', '?'))}`);
    out.push('Gelöscht wurde dabei nichts; die Daten gingen beim nächsten Upload erneut mit.');
  } else {
    out.push(`Ergebnis: ${resultText(info)}`);
  }
  const tooLong = own(info, 'zu_lang');
  if (truthy(tooLong)) {
    out.push(`${pyStr(tooLong)} Texte waren länger als der Server annimmt; sie stehen unten unter „Nicht gesendet“.`);
  }
  const note = own(info, 'hinweis');
  if (truthy(note)) out.push(pyStr(note));
  if (payload && truthy(payload)) {
    out.push('', 'Gesendet:');
    // concat statt push(...): bei Zehntausenden Texten wären das zu viele Argumente
    const sent = own(info, 'art') === 'zeilen' ? envelopeLines(payload, parseEnvelope) : textLines(payload);
    return out.concat(sent).join('\n');
  }
  return out.join('\n');
}

/** Länge in Codepunkten wie Pythons len(). */
const codePoints = (text: string): number => {
  let n = 0;
  for (const _ of text) n++;
  return n;
};

/** Je Umschlag: Titel, Art, Ereignis und NPC, darunter der Text. */
function envelopeLines(payload: JsonObject, parseEnvelope: ParseEnvelope): string[] {
  const lines: string[] = [];
  const sent = own(payload, 'gesendet');
  const envelopes = pyGet(truthy(sent) ? sent : {}, 'envelopes', []);
  if (!Array.isArray(envelopes)) return lines;
  for (const envelope of envelopes) {
    if (typeof envelope !== 'string') continue;
    const fields = parseEnvelope(envelope);
    const npc = (fields.get('npc') ?? '').replace(/^\p{Nd}+\s+/u, ''); // "276 Viktori …" → "Viktori …"
    const source = fields.get('source') ?? '?';
    const event = fields.get('event');
    const meta = [SOURCE_NAMES[source] ?? source, event === undefined ? '' : (EVENT_NAMES[event] ?? event), npc]
      .filter((x) => x).join(' · ');
    const title = [fields.get('title'), fields.get('book')].find((x) => x) ?? '(ohne Titel)'; // leer zählt nicht
    lines.push(`\n• ${title}   (${meta})`);
    let text = fields.get('text') ?? '';
    if (!text) { // sonst das längste mehrzeilige Feld (bei Gleichstand das erste)
      for (const value of fields.values()) {
        if (value.includes('\n') && codePoints(value) > codePoints(text)) text = value;
      }
    }
    text = text.replace(/<[^>]*>/g, ''); // Bücher sind als HTML gespeichert
    for (const line of pySplitlines(text)) {
      const stripped = pyStrip(line);
      if (stripped) lines.push(`    ${stripped}`);
    }
  }
  return lines;
}

/** Je Paket Sprache und Build, darunter die Texte; am Ende die zu langen. */
function textLines(payload: JsonObject): string[] {
  const show = (text: unknown): string => pyStr(text).replaceAll('\n', '\n        ');
  const lines: string[] = [];
  const requests = own(payload, 'gesendet');
  for (const request of Array.isArray(requests) ? requests : []) {
    const texts = pyGet(request, 'texts', []);
    const list: readonly unknown[] = Array.isArray(texts) ? texts : [];
    lines.push(`\nSprache ${pyStr(pyGet(request, 'lang'))}, Build ${pyStr(pyGet(request, 'build'))} – ${list.length} Texte:`);
    for (const t of list) {
      const male = pyGet(t, 'text', '');
      const female = pyGet(t, 'text1', '');
      lines.push(`#${pyStr(pyGet(t, 'id'))}  ${show(truthy(male) ? male : female)}`);
      if (truthy(male) && truthy(female) && female !== male) lines.push(`        weiblich: ${show(female)}`);
    }
  }
  const skipped = own(payload, 'nicht_gesendet');
  if (Array.isArray(skipped) && skipped.length > 0) {
    lines.push(`\nNicht gesendet (zu lang für den Server) – ${skipped.length} Texte:`);
    for (const t of skipped) {
      const text = pyGet(t, 'text');
      lines.push(`#${pyStr(pyGet(t, 'id'))}  ${show(truthy(text) ? text : pyGet(t, 'text1', ''))}`);
    }
  }
  return lines;
}
