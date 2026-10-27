/**
 * Suchtreffer im Detailtext finden (Spezifikation §7.4): ohne Groß/Klein-Unterscheidung über
 * dieselbe Faltung wie die Suche im Main (Entscheidung 18), höchstens MAX_HIGHLIGHTS Stück –
 * mehr zu markieren dauert spürbar und hilft niemandem. Rein, ohne DOM.
 */
import { casefold, casefoldMapped } from '../../shared/casefold';
import { MAX_HIGHLIGHTS } from '../../shared/types';

/** Bereich [start, end) in UTF-16-Indizes des Originaltexts. */
export type Range = readonly [number, number];

/**
 * Trefferbereiche von `query` in `text`, ohne Überlappung, in Textreihenfolge.
 * Die Anfrage wird getrimmt; eine leere Anfrage findet nichts.
 */
export function findMatches(text: string, query: string, max: number = MAX_HIGHLIGHTS): Range[] {
  const needle = casefold(query.trim());
  if (!needle || max <= 0) return [];
  const { folded, origin } = casefoldMapped(text);
  const ranges: [number, number][] = [];
  let from = 0;
  while (ranges.length < max) {
    const at = folded.indexOf(needle, from);
    if (at < 0) break;
    from = at + needle.length;
    const start = origin[at] ?? text.length;
    const end = endOf(origin, from);
    const last = ranges.at(-1);
    if (last && start < last[1]) {
      // Ein gefaltetes Zeichen (ß → ss) kann zwei Treffern gehören: dann zusammenlegen.
      last[1] = Math.max(last[1], end);
      continue;
    }
    ranges.push([start, end]);
  }
  return ranges;
}

/** Ende im Original für einen Treffer, der im gefalteten Text bei `to` endet: immer ganze Zeichen. */
function endOf(origin: readonly number[], to: number): number {
  const lastChar = origin[to - 1] ?? 0;
  let k = to;
  while (k < origin.length - 1 && origin[k] === lastChar) k++;
  return origin[k] ?? lastChar;
}

/** Text in Stücke zerlegen: abwechselnd normal und Treffer – für die Darstellung mit <mark>. */
export function splitByRanges(text: string, ranges: readonly Range[]): { text: string; match: boolean }[] {
  const parts: { text: string; match: boolean }[] = [];
  let pos = 0;
  for (const [start, end] of ranges) {
    if (start > pos) parts.push({ text: text.slice(pos, start), match: false });
    parts.push({ text: text.slice(start, end), match: true });
    pos = end;
  }
  if (pos < text.length) parts.push({ text: text.slice(pos), match: false });
  return parts;
}
