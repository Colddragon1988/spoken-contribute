// Literal-Scanner (Architektur §3.4) und Zufalls-Robustheit aller Parser (fester Seed).
import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
  cleared, decodeLua, decodeUtf8Text, envelopesInBytes, luaLiterals, parseCache,
} from '../../../src/core/wowdata';
import { ADB_MAGIC, BROADCAST_TEXT_TABLE } from '../../../src/shared/types';

const b = (s: string): Uint8Array => Buffer.from(s, 'latin1');
const literals = (data: Uint8Array): string[] =>
  [...luaLiterals(data)].map(([start, end]) => Buffer.from(data.subarray(start, end)).toString('latin1'));

/** Die Python-Regex 1:1 als Referenz: latin1 bildet jedes Byte auf genau ein Zeichen ab. */
const LITERAL = /"((?:[^"\\]|\\[\s\S])*)"/g;
const regexLiterals = (data: Uint8Array): string[] =>
  [...Buffer.from(data).toString('latin1').matchAll(LITERAL)].map((m) => m[1] ?? '');

/** Kleiner, reproduzierbarer Zufallsgenerator (mulberry32). */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('Literal-Scanner', () => {
  it('einfache Literale, escapte Anführungszeichen, Bytes inkl. Zeilenumbruch', () => {
    expect(literals(b('x = "a", y = "b\\"c", z = "zwei\nZeilen" ""'))).toEqual(['a', 'b\\"c', 'zwei\nZeilen', '']);
  });

  it('offenes ": danach wird nichts mehr gefunden (wie die Regex)', () => {
    expect(literals(b('"a" "offen'))).toEqual(['a']);
    expect(literals(b('"a" "offen \\" b'))).toEqual(['a']);
    expect(regexLiterals(b('"a" "offen \\" b'))).toEqual(['a']);
    expect(literals(b('"a" "zu \\" "b'))).toEqual(['a', 'zu \\" ']);
  });

  it('\\ am Dateiende beendet kein Literal', () => {
    expect(literals(b('"a" "b\\'))).toEqual(['a']);
    expect(literals(b('"\\'))).toEqual([]);
    expect(literals(b('"\\\\"'))).toEqual(['\\\\']);
  });

  it('ein Literal endet nie an einem escapten "', () => {
    expect(literals(b('"\\""'))).toEqual(['\\"']);
    expect(literals(b('"a\\" "b"'))).toEqual(['a\\" ']);
  });

  it('gleiches Ergebnis wie die Python-Regex auf 3000 Zufallspuffern (Seed 1)', () => {
    const next = random(1);
    const pool = [0x22, 0x22, 0x5c, 0x5c, 0x5c, 0x41, 0x0a, 0x0d, 0x21, 0x30, 0xc3, 0xff];
    for (let n = 0; n < 3000; n++) {
      const len = Math.floor(next() * 80);
      const data = Uint8Array.from({ length: len }, () =>
        next() < 0.8 ? (pool[Math.floor(next() * pool.length)] ?? 0) : Math.floor(next() * 256));
      expect(literals(data)).toEqual(regexLiterals(data));
    }
  });

  it('läuft bei großen Dateien mit offenem " in linearer Zeit', () => {
    const data = new Uint8Array(4_000_000).fill(0x22); // lauter "
    data[0] = 0x41;
    expect(literals(data)).toHaveLength(1_999_999);
    const open = Buffer.concat([Buffer.from('"'), Buffer.alloc(4_000_000, 0x5c), Buffer.from('\\"')]);
    expect(literals(open)).toEqual([]);
  });
});

describe('Robustheit (1000 Zufallspuffer, Seed 4711)', () => {
  it('kein Parser wirft, Ergebnisse sind wohlgeformt', () => {
    const next = random(4711);
    const magic = Buffer.alloc(4);
    magic.writeUInt32LE(ADB_MAGIC);
    const table = Buffer.alloc(4);
    table.writeUInt32LE(BROADCAST_TEXT_TABLE);
    const pieces = [
      Buffer.from('"!SPOKEN1 quests\\nquest=1\\n'), Buffer.from('"'), Buffer.from('\\'), Buffer.from('\\195\\'),
      Buffer.from('\r\n'), Buffer.from('["Enabled"] = true,'), Buffer.from('\t["Introduced"] = false,\r\n'),
      magic, table, Buffer.from([1, 0, 0, 0]), Buffer.from([0]), Buffer.from([0xff, 0xfe, 0xc3]),
    ];
    for (let n = 0; n < 1000; n++) {
      const parts: Buffer[] = [];
      // jeder zweite Puffer beginnt wie eine echte DBCache-Datei, damit der Eintragsteil drankommt
      if (n % 2 === 0) parts.push(magic, Buffer.alloc(40, Math.floor(next() * 256)));
      const count = Math.floor(next() * 40);
      for (let k = 0; k < count; k++) {
        if (next() < 0.5) parts.push(pieces[Math.floor(next() * pieces.length)] ?? Buffer.alloc(0));
        else parts.push(Buffer.from(Array.from({ length: Math.floor(next() * 12) }, () => Math.floor(next() * 256))));
      }
      const data = Buffer.concat(parts);
      const envelopes = envelopesInBytes(data);
      for (const env of envelopes) expect(env.startsWith('!SPOKEN')).toBe(true);
      expect(typeof decodeLua(data)).toBe('string');
      expect(cleared(decodeUtf8Text(data))).toMatch(/^\nSpokenContributionsDB = \{\n[\s\S]*\["Lines"\] = \{\n\},\n\}\n$/);
      const { texts } = parseCache(data);
      for (const [id, row] of texts) {
        expect(row.id).toBe(id);
        expect(row.text + row.text1).not.toBe('');
      }
    }
  });
});
