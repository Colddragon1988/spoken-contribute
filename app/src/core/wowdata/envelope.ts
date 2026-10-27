// Umschläge zerlegen und zusammenfassen (Spezifikation §5.1.3, §5.1.4).
import type { EnvelopeFields, Summary } from '../../shared/types';

const SOURCE_LABELS = new Map([
  ['quests', 'Quest- und Gesprächszeilen'], ['books', 'Buchseiten'], ['readables', 'Buchseiten'],
]);

/** Die Felder eines Umschlags, z. B. source → "quests", title, npc, text …
 *  Aufbau: Kopfzeile "!SPOKEN1 <Art>", dann "schlüssel=wert" oder "schlüssel<<" … ">>".
 *  Bei doppelten Schlüsseln gewinnt der erste. */
export function parseEnvelope(envelope: string): EnvelopeFields {
  const [first = '', ...rest] = envelope.split('\n');
  const space = first.indexOf(' ');
  const fields = new Map<string, string>([['source', space >= 0 ? first.slice(space + 1) : '?']]);
  const setDefault = (key: string, value: string): void => {
    if (!fields.has(key)) fields.set(key, value);
  };
  // ein gemeinsamer Iterator wie in Python: der Block liest die Zeilen, die die Schleife danach überspringt
  const lines = rest[Symbol.iterator]();
  for (const line of lines) {
    if (line.endsWith('<<')) {
      // Block bis zur Zeile ">>" (fehlt sie, bis zum Ende)
      const block: string[] = [];
      for (let next = lines.next(); next.done !== true && next.value !== '>>'; next = lines.next()) {
        block.push(next.value);
      }
      setDefault(line.slice(0, -2), block.join('\n'));
    } else {
      const eq = line.indexOf('=');
      if (eq >= 0) setDefault(line.slice(0, eq), line.slice(eq + 1));
    }
  }
  return fields;
}

/** ("12 Quest- und Gesprächszeilen, 3 Buchseiten", [Titel der Quests und Bücher]). */
export function summarize(envelopes: readonly string[]): Summary {
  const counts = new Map<string, number>();
  const titles: string[] = [];
  for (const envelope of envelopes) {
    const fields = parseEnvelope(envelope);
    const source = fields.get('source') ?? '?';
    counts.set(source, (counts.get(source) ?? 0) + 1);
    // wie Python `title or book`: ein leerer Titel zählt als fehlend
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- gewollt: '' ersetzen
    const title = fields.get('title') || fields.get('book');
    if (title && !titles.includes(title)) titles.push(title);
  }
  const kinds = [...counts].map(([source, n]) => `${n} ${SOURCE_LABELS.get(source) ?? source}`).join(', ');
  return { kinds, titles };
}
