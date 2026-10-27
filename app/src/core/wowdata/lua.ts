// SpokenContributions.lua lesen und leeren (Spezifikation §5.1, §2.4) – kein echter Lua-Parser,
// sondern dasselbe Vorgehen wie die Python-Fassung.
import { decodeUtf8 } from './utf8';

const QUOTE = 0x22; // "
const BACKSLASH = 0x5c;
const SPOKEN = [0x21, 0x53, 0x50, 0x4f, 0x4b, 0x45, 0x4e]; // "!SPOKEN"

// Einfache Escapes wie SIMPLE_ESCAPES in wowdata.py (Schlüssel: Byte nach dem Backslash).
const SIMPLE_ESCAPES = new Map<number, number>([
  [0x6e, 10], [0x72, 13], [0x74, 9], [0x61, 7], [0x62, 8], [0x66, 12], [0x76, 11], // n r t a b f v
  [0x5c, 92], [0x22, 34], [0x27, 39], [0x0a, 10], // \ " ' LF
]);

const isDigit = (b: number | undefined): b is number => b !== undefined && b >= 0x30 && b <= 0x39;

/** Lua-String-Literal entschlüsseln, genau wie decodeLuaString auf der Website. */
export function decodeLua(body: Uint8Array): string {
  const out: number[] = [];
  let i = 0;
  for (;;) {
    const b = body[i];
    if (b === undefined) break;
    if (b !== BACKSLASH) {
      out.push(b);
      i += 1;
      continue;
    }
    // \ddd: ein Byte, dezimal (1–3 Ziffern; \999 ergibt 999 & 0xFF)
    let n = 0;
    let digits = 0;
    for (let d = body[i + 1]; digits < 3 && isDigit(d); d = body[i + 1 + digits]) {
      n = n * 10 + d - 0x30;
      digits += 1;
    }
    const next = body[i + 1];
    const simple = next === undefined ? undefined : SIMPLE_ESCAPES.get(next);
    if (digits > 0) {
      out.push(n & 0xff);
      i += 1 + digits;
    } else if (next === 0x0d && body[i + 2] === 0x0a) { // Backslash am Zeilenende (Windows-Zeilenende)
      out.push(10);
      i += 3;
    } else if (simple !== undefined) {
      out.push(simple);
      i += 2;
    } else { // unbekannte Folge: Backslash bleibt stehen
      out.push(BACKSLASH);
      i += 1;
    }
  }
  return decodeUtf8(Uint8Array.from(out));
}

/** Alle String-Literale wie Pythons LITERAL.finditer mit rb'"((?:[^"\\]|\\[\s\S])*)"':
 *  [Anfang, Ende) des Inhalts ohne die Anführungszeichen, von links, ohne Überlappung. */
export function* luaLiterals(data: Uint8Array): Generator<readonly [number, number]> {
  let pos = data.indexOf(QUOTE);
  while (pos >= 0) {
    // Inhalt: beliebige Bytes außer " und \, oder \ plus genau ein beliebiges Byte.
    let i = pos + 1;
    for (;;) {
      const b = data[i];
      if (b === undefined || b === QUOTE) break;
      if (b === BACKSLASH) {
        if (i + 1 >= data.length) break; // \ am Dateiende beendet nichts
        i += 2;
      } else {
        i += 1;
      }
    }
    if (data[i] !== QUOTE) {
      // Kein schließendes ": Die Regex sucht ab dem nächsten Byte weiter. Jedes spätere "
      // liegt aber hinter einem \ in genau dem Bereich, den dieser Versuch schon bis zum Ende
      // durchlaufen hat – jeder weitere Versuch liefe ebenso ins Leere. Daher hier Schluss
      // (gleiches Ergebnis wie die Regex, nur ohne quadratische Laufzeit; der Zufallstest
      // vergleicht beides).
      return;
    }
    yield [pos + 1, i] as const;
    pos = data.indexOf(QUOTE, i + 1);
  }
}

const startsWithSpoken = (data: Uint8Array, start: number, end: number): boolean =>
  end - start >= SPOKEN.length && SPOKEN.every((b, k) => data[start + k] === b);

/** Alle "!SPOKEN…"-Umschläge in den Bytes einer Datei, in Dateireihenfolge, Doppelte bleiben.
 *  Ob ein Literal ein Umschlag ist, entscheidet der rohe (noch escapte) Inhalt. */
export function envelopesInBytes(body: Uint8Array): string[] {
  const found: string[] = [];
  for (const [start, end] of luaLiterals(body)) {
    if (startsWithSpoken(body, start, end)) found.push(decodeLua(body.subarray(start, end)));
  }
  return found;
}

// Schalterzeile, die beim Leeren erhalten bleibt. Abweichung (Entscheidung 6): führende
// Leerzeichen/Tabs sind erlaubt, sonst gingen eingerückte Schalter verloren; geschrieben wird
// Gruppe 1, also ohne Einrückung (V10). Bewusst ohne m-Flag und je Zeile geprüft: JavaScripts
// ^/$ im Multiline-Modus trennen auch an einzelnem \r und U+2028/U+2029, Pythons re.M nur an \n.
const FLAG_LINE = /^[ \t]*(\["(?:Enabled|Introduced)"\] = (?:true|false),)\r?$/;

/** Die Datei ohne gesammelte Zeilen; die Schalter Enabled/Introduced bleiben erhalten.
 *  WoW schreibt die Datei unter Windows und Wine mit Windows-Zeilenenden, daher das optionale \r. */
export function cleared(text: string): string {
  const keep: string[] = [];
  for (const line of text.split('\n')) {
    const m = FLAG_LINE.exec(line);
    if (m?.[1] !== undefined) keep.push(m[1]);
  }
  return '\nSpokenContributionsDB = {\n' + keep.map((k) => k + '\n').join('') + '["Lines"] = {\n},\n}\n';
}
