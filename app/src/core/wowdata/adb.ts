// DBCache.bin lesen (Spezifikation §5.2).
//
// Aufbau (wie lib/broadcast/cache.ts auf der Website): 44 Byte Dateikopf mit MAGIC am Anfang
// und der Build-Nummer bei Byte 8, dann Einträge aus 32 Byte Kopf (MAGIC; bei Byte 16
// Tabelle, Zeilen-ID, Länge, Status) und den Daten. BroadcastText-Daten beginnen mit zwei
// nullterminierten Texten (männlich, weiblich); nur Status 1 ist ein gültiger Eintrag.
import { readFile } from 'node:fs/promises';
import type { BroadcastRow, ParsedCache, TextsByBuild } from '../../shared/types';
import { ADB_MAGIC, BROADCAST_TEXT_TABLE } from '../../shared/types';
import { decodeUtf8 } from './utf8';

const FILE_HEADER = 44;
const ENTRY_HEADER = 32;

/** (Build, {ID: Zeile}) der BroadcastText-Einträge aus den Bytes einer DBCache-Datei. */
export function parseCache(data: Uint8Array): ParsedCache {
  const texts = new Map<number, BroadcastRow>();
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const u32 = (pos: number): number => view.getUint32(pos, true);
  if (data.length < FILE_HEADER || u32(0) !== ADB_MAGIC) return { build: 0, texts };
  const build = u32(8);
  let pos = FILE_HEADER;
  while (pos + ENTRY_HEADER <= data.length) {
    if (u32(pos) !== ADB_MAGIC) break; // während des Schreibens abgebrochen; alles davor ist vollständig
    const table = u32(pos + 16);
    const rid = u32(pos + 20);
    const size = u32(pos + 24);
    const status = u32(pos + 28);
    const start = pos + ENTRY_HEADER;
    pos = start + size;
    if (pos > data.length) break;
    if (table !== BROADCAST_TEXT_TABLE || status !== 1) continue;
    const end = data.subarray(start, pos).indexOf(0);
    const end1 = end >= 0 ? data.subarray(start + end + 1, pos).indexOf(0) : -1;
    if (end < 0 || end1 < 0) continue;
    const text = decodeUtf8(data.subarray(start, start + end));
    const text1 = decodeUtf8(data.subarray(start + end + 1, start + end + 1 + end1));
    // set auf eine vorhandene ID behält deren Platz in der Reihenfolge – wie ein Python-dict
    if (text || text1) texts.set(rid, { id: rid, text, text1 });
  }
  return { build, texts };
}

/** parseCache für eine Datei; fehlt sie: (0, {}). */
export async function parseCacheFile(path: string): Promise<ParsedCache> {
  try {
    return parseCache(await readFile(path));
  } catch (err) {
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { build: 0, texts: new Map() };
    }
    throw err;
  }
}

/** {Build: Zeilen} über alle Dateien einer Sprache; je ID gewinnt der neueste Build
 *  (bei Gleichstand die spätere Datei). */
export async function newestTexts(files: readonly string[]): Promise<TextsByBuild> {
  const newest = new Map<number, readonly [number, BroadcastRow]>();
  for (const file of files) {
    const { build, texts } = await parseCacheFile(file);
    for (const [rid, row] of texts) {
      const old = newest.get(rid);
      if (old === undefined || build >= old[0]) newest.set(rid, [build, row]);
    }
  }
  const byBuild = new Map<number, BroadcastRow[]>();
  for (const [build, row] of newest.values()) {
    const rows = byBuild.get(build);
    if (rows) rows.push(row);
    else byBuild.set(build, [row]);
  }
  return byBuild;
}
