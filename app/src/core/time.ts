// Zeitpunkte schreiben und lesen (Entscheidung 21): immer Ortszeit, gerechnet wird mit Date.
// Formatiert wird von Hand statt mit toLocale…/Intl – so hängt nichts von der Systemsprache ab.
const p2 = (n: number): string => String(n).padStart(2, '0');

/** "2026-10-25" – Kalendertag in Ortszeit (auch Schlüssel der Tageswerte). */
export function formatDayKey(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, '0')}-${p2(date.getMonth() + 1)}-${p2(date.getDate())}`;
}

/** "2026-10-25T14:03:12+01:00" – Ortszeit mit Offset, Sekunden (Entscheidung 21). */
export function formatIsoLocal(date: Date): string {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return `${formatDayKey(date)}T${p2(date.getHours())}:${p2(date.getMinutes())}:${p2(date.getSeconds())}` +
    `${sign}${p2(Math.floor(abs / 60))}:${p2(abs % 60)}`;
}

/** "2026-10-25_14-03-12" für Verlaufsordner. */
export function folderStamp(date: Date): string {
  return `${formatDayKey(date)}_${p2(date.getHours())}-${p2(date.getMinutes())}-${p2(date.getSeconds())}`;
}

export const formatClock = (date: Date): string => `${p2(date.getHours())}:${p2(date.getMinutes())}`;
export const formatDate = (date: Date): string =>
  `${p2(date.getDate())}.${p2(date.getMonth() + 1)}.${String(date.getFullYear()).padStart(4, '0')}`;
/** Tabellenspalte: "dd.mm.YYYY  HH:MM" (zwei Leerzeichen) */
export const formatTableTime = (date: Date): string => `${formatDate(date)}  ${formatClock(date)}`;
/** Detailüberschrift: "dd.mm.YYYY um HH:MM:SS" */
export const formatDetailsTime = (date: Date): string =>
  `${formatDate(date)} um ${formatClock(date)}:${p2(date.getSeconds())}`;

export const addHours = (date: Date, hours: number): Date => new Date(date.getTime() + hours * 3_600_000);

export interface ParsedTime {
  readonly date: Date;
  readonly hasOffset: boolean;
}

const ISO_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,6}))?)?(Z|[+-]\d{2}(?::?\d{2})?)?$/;

function daysInMonth(year: number, month: number): number {
  const d = new Date(0);
  d.setUTCFullYear(year, month, 0);
  return d.getUTCDate();
}

/** ISO-8601 lesen (wie Pythons fromisoformat für die vorkommenden Formen). Ohne Offset = Ortszeit. */
export function parseIso(text: unknown): ParsedTime | null {
  if (typeof text !== 'string') return null;
  const m = ISO_PATTERN.exec(text);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6] ?? '0');
  const millis = m[7] === undefined ? 0 : Math.floor(Number(m[7].padEnd(6, '0')) / 1000);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month) ||
      hour > 23 || minute > 59 || second > 59) {
    return null;
  }
  const zone = m[8];
  if (zone === undefined) {
    const local = new Date(2000, 0, 1, hour, minute, second, millis);
    local.setFullYear(year, month - 1, day);
    return { date: local, hasOffset: false };
  }
  let offsetMinutes = 0;
  if (zone !== 'Z') {
    const digits = zone.slice(1).replace(':', '');
    const oh = Number(digits.slice(0, 2));
    const om = Number(digits.slice(2) || '0');
    if (oh > 23 || om > 59) return null;
    offsetMinutes = (zone.startsWith('-') ? -1 : 1) * (oh * 60 + om);
  }
  const utc = new Date(0);
  utc.setUTCFullYear(year, month - 1, day);
  utc.setUTCHours(hour, minute, second, millis);
  return { date: new Date(utc.getTime() - offsetMinutes * 60_000), hasOffset: true };
}
