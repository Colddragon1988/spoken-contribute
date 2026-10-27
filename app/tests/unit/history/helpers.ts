// Hilfen für die Tests von Paket (d): kleine WowData-Attrappe (nur was der Verlauf braucht)
// und Erzeuger für Dateien im Format der Python-Fassung.
import { Buffer } from 'node:buffer';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';
import { onTestFinished } from 'vitest';
import type { Clock, EnvelopeFields, JsonValue, Summary, WowData } from '../../../src/shared/types';

/** parse_envelope wie wowdata.py. */
export function parseEnvelope(envelope: string): EnvelopeFields {
  const [first = '', ...rest] = envelope.split('\n');
  const space = first.indexOf(' ');
  const fields = new Map<string, string>([['source', space < 0 ? '?' : first.slice(space + 1)]]);
  const set = (key: string, value: string): void => {
    if (!fields.has(key)) fields.set(key, value);
  };
  for (let i = 0; i < rest.length; i++) {
    const line = rest[i] ?? '';
    if (line.endsWith('<<')) {
      const block: string[] = [];
      for (i++; i < rest.length && rest[i] !== '>>'; i++) block.push(rest[i] ?? '');
      set(line.slice(0, -2), block.join('\n'));
    } else if (line.includes('=')) {
      const cut = line.indexOf('=');
      set(line.slice(0, cut), line.slice(cut + 1));
    }
  }
  return fields;
}

const KIND_NAMES: Readonly<Record<string, string>> = {
  quests: 'Quest- und Gesprächszeilen', books: 'Buchseiten', readables: 'Buchseiten',
};

/** summarize wie wowdata.py. */
export function summarize(envelopes: readonly string[]): Summary {
  const counts = new Map<string, number>();
  const titles: string[] = [];
  for (const envelope of envelopes) {
    const fields = parseEnvelope(envelope);
    const source = fields.get('source') ?? '?';
    counts.set(source, (counts.get(source) ?? 0) + 1);
    const title = [fields.get('title'), fields.get('book')].find((x) => x) ?? '';
    if (title && !titles.includes(title)) titles.push(title);
  }
  const kinds = [...counts].map(([s, n]) => `${n} ${KIND_NAMES[s] ?? s}`).join(', ');
  return { kinds, titles };
}

/** Umschläge einer .lua – reicht für die Dateien aus fixtures.contributionsLua. */
export async function envelopesIn(path: string): Promise<string[]> {
  let body: Buffer;
  try {
    body = await readFile(path);
  } catch {
    return [];
  }
  const text = body.toString('latin1');
  const out: string[] = [];
  for (const m of text.matchAll(/"((?:[^"\\]|\\[\s\S])*)"/g)) {
    const raw = m[1] ?? '';
    if (!raw.startsWith('!SPOKEN')) continue;
    const decoded = raw.replace(/\\(\d{1,3}|[\s\S])/g, (_, c: string) => {
      if (/^\d/.test(c)) return String.fromCharCode(Number(c) & 0xff);
      return ({ n: '\n', r: '\r', t: '\t' } as Record<string, string>)[c] ?? c;
    });
    out.push(Buffer.from(decoded, 'latin1').toString('utf8'));
  }
  return out;
}

const notNeeded = (): never => {
  throw new Error('im Verlaufstest nicht gebraucht');
};

export const fakeWowData: WowData = {
  flavorName: notNeeded,
  spokenFlavors: notNeeded,
  envelopesIn,
  collectContributions: notNeeded,
  clearContributions: notNeeded,
  parseEnvelope,
  summarize,
  cacheFolders: notNeeded,
  cacheFiles: notNeeded,
  newestTexts: notNeeded,
};

export class FixedClock implements Clock {
  constructor(public fixed: Date = new Date()) {}
  now(): Date {
    return new Date(this.fixed);
  }
}

/** Temp-Ordner für einen Test, wird danach gelöscht (Regel 1: nie echte Daten). */
export async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'spoken-verlauf-'));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

// ------------------------------------------------------------------ Python-Formate

/** Ein String wie Pythons json.dumps mit ensure_ascii=True (Nicht-ASCII als \uXXXX). */
function pyString(text: string, ensureAscii: boolean): string {
  const json = JSON.stringify(text);
  return ensureAscii
    ? json.replace(/[\u0080-\uffff]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`)
    : json;
}

/** json.dumps(value, ensure_ascii=…, indent=…) wie Python (Trenner ", " und ": " ohne Einrückung). */
export function pyJsonDumps(value: JsonValue, options: { indent?: number; ensureAscii?: boolean } = {}): string {
  const { indent, ensureAscii = true } = options;
  const dump = (v: JsonValue, depth: number): string => {
    if (v === null) return 'null';
    if (typeof v === 'boolean' || typeof v === 'number') return JSON.stringify(v);
    if (typeof v === 'string') return pyString(v, ensureAscii);
    const items = Array.isArray(v)
      ? v.map((x) => dump(x, depth + 1))
      : Object.entries(v).map(([k, x]) => `${pyString(k, ensureAscii)}: ${dump(x, depth + 1)}`);
    const [open, close] = Array.isArray(v) ? ['[', ']'] : ['{', '}'];
    if (items.length === 0) return open + close;
    if (indent === undefined) return open + items.join(', ') + close;
    const pad = '\n' + ' '.repeat(indent * (depth + 1));
    return open + pad + items.join(',' + pad) + '\n' + ' '.repeat(indent * depth) + close;
  };
  return dump(value, 0);
}

/** gzip wie Pythons gzip.open(…, "wt"): mit Dateinamen im Kopf (FNAME) – Node schreibt keinen. */
export function pyGzip(text: string, name = 'daten.json'): Buffer {
  const data = Buffer.from(text, 'utf8');
  const head = Buffer.from([0x1f, 0x8b, 8, 8, 0x10, 0x20, 0x30, 0x40, 2, 0xff]);
  const tail = Buffer.alloc(8);
  tail.writeUInt32LE(crc32(data), 0);
  tail.writeUInt32LE(data.length >>> 0, 4);
  return Buffer.concat([head, Buffer.from(`${name}\0`, 'latin1'), deflateRawSync(data), tail]);
}
