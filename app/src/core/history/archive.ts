// Archiv und Verlauf aller Uploads (§5.5).
//
// Jeder Upload bekommt einen eigenen Ordner unter verlauf/ im Datenordner:
//   eintrag.json   wann, was, aus welcher Version, Ergebnis laut Server oder der Fehler
//   daten.json.gz  genau das, was gesendet wurde, und die Antworten des Servers
//   originale/     die SpokenContributions-Dateien, wie sie vor dem Leeren aussahen
//
// Nichts davon wird automatisch gelöscht. eintrag.json wird zuletzt geschrieben: Ein Ordner ohne
// sie ist ein abgebrochener Eintrag und erscheint nicht im Verlauf. Die Formate bleiben für die
// Python-Fassung lesbar (eintrag.json mit Einrückung 2, daten.json.gz mit Einrückung 1).
import { copyFile, mkdir, readdir, readFile, stat, utimes } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { gunzip, gzip } from 'node:zlib';
import type { Clock, HistoryEntry, JsonObject, RecordInput } from '../../shared/types';
import { FILES } from '../../shared/types';
import { writeFileAtomic } from '../fsutil';
import { folderStamp, formatIsoLocal, parseIso } from '../time';
import { isObject } from './format';

export const INFO = 'eintrag.json';
export const DATA = 'daten.json.gz';
export const ORIGINALS = 'originale';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/** Streng wie Pythons read_text(encoding="utf-8"): ungültige Bytes oder ein BOM machen die Datei unlesbar. */
const strictUtf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function isErrno(err: unknown, code: string): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === code;
}

/** Ein Eintrag aus Ordner und Inhalt von eintrag.json; null ohne lesbaren Zeitpunkt. */
export function makeEntry(folder: string, info: JsonObject): HistoryEntry | null {
  const parsed = parseIso(Object.hasOwn(info, 'zeit') ? info.zeit : undefined);
  if (!parsed) return null;
  // Ein Zeitpunkt ohne Zeitzone (etwa von Hand eingetragen) gilt als Ortszeit – sonst ließe er
  // sich nicht mit den übrigen vergleichen und sortieren (parseIso liefert dann Ortszeit).
  return { id: basename(folder), folder, info, time: parsed.date, failed: info.status !== 'ok' };
}

/** Neueste zuerst; bei gleicher Sekunde entscheidet der Ordnername (…_zeilen-2 vor …_zeilen),
 *  damit die Reihenfolge nicht davon abhängt, in welcher Folge das Dateisystem die Ordner liefert. */
export function compareNewestFirst(a: HistoryEntry, b: HistoryEntry): number {
  const byTime = b.time.getTime() - a.time.getTime();
  if (byTime !== 0) return byTime;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

export interface Archive {
  readonly root: string;
  record(input: RecordInput): Promise<HistoryEntry>;
  entries(): Promise<HistoryEntry[]>;
  payload(entry: HistoryEntry): Promise<JsonObject | null>;
}

export function createArchive(deps: { readonly dataDir: string; readonly clock: Clock }): Archive {
  const root = join(deps.dataDir, FILES.history);

  /** Ein neuer, leerer Ordner je Eintrag; zwei Uploads in derselben Sekunde bekommen -2 usw. */
  async function newFolder(when: Date, kind: string): Promise<string> {
    await mkdir(root, { recursive: true });
    const stamp = folderStamp(when);
    for (let n = 1; ; n++) {
      const folder = join(root, n === 1 ? `${stamp}_${kind}` : `${stamp}_${kind}-${n}`);
      try {
        await mkdir(folder); // exklusiv: gibt es ihn schon, kommt EEXIST
        return folder;
      } catch (err) {
        if (!isErrno(err, 'EEXIST')) throw err;
      }
    }
  }

  /** Einen Upload archivieren. originals: Quelle und Name unter originale/ – werden mit Zeitstempel kopiert. */
  async function record(input: RecordInput): Promise<HistoryEntry> {
    const when = input.when ?? deps.clock.now();
    const folder = await newFolder(when, input.kind);
    if (input.payload !== undefined && input.payload !== null) {
      const json = JSON.stringify(input.payload, null, 1);
      await writeFileAtomic(join(folder, DATA), await gzipAsync(Buffer.from(json, 'utf8')));
    }
    for (const { source, name } of input.originals ?? []) {
      const target = join(folder, ORIGINALS, ...name.split('/'));
      await mkdir(dirname(target), { recursive: true });
      await copyFile(source, target);
      const times = await stat(source);
      await utimes(target, times.atime, times.mtime); // wie shutil.copy2
    }
    // zeit und art zuerst; ein gleichnamiger Schlüssel in info überschreibt den Wert, nicht die Stelle
    const info: JsonObject = { zeit: formatIsoLocal(when), art: input.kind, ...input.info };
    await writeFileAtomic(join(folder, INFO), JSON.stringify(info, null, 2));
    const entry = makeEntry(folder, info);
    if (!entry) throw new Error(`Ungültiger Zeitpunkt im Eintrag ${folder}`);
    return entry;
  }

  async function readEntry(folder: string): Promise<HistoryEntry | null> {
    try {
      const value: unknown = JSON.parse(strictUtf8.decode(await readFile(join(folder, INFO))));
      return isObject(value) ? makeEntry(folder, value) : null;
    } catch {
      return null; // fehlt, beschädigt oder kein Ordner; er bleibt unberührt
    }
  }

  /** Alle archivierten Uploads, die neuesten zuerst. */
  async function entries(): Promise<HistoryEntry[]> {
    let names: string[];
    try {
      names = await readdir(root);
    } catch {
      return []; // noch kein Verlauf
    }
    const found: HistoryEntry[] = [];
    for (let i = 0; i < names.length; i += 64) { // nicht Tausende Dateien auf einmal öffnen
      const batch = await Promise.all(names.slice(i, i + 64).map((name) => readEntry(join(root, name))));
      for (const entry of batch) if (entry) found.push(entry);
    }
    return found.sort(compareNewestFirst);
  }

  /** Das Gesendete samt Antwort; null, wenn nichts (Lesbares) gespeichert ist. */
  async function payload(entry: HistoryEntry): Promise<JsonObject | null> {
    try {
      const raw = await gunzipAsync(await readFile(join(entry.folder, DATA)));
      const value: unknown = JSON.parse(strictUtf8.decode(raw));
      return isObject(value) ? value : null;
    } catch {
      return null;
    }
  }

  return { root, record, entries, payload };
}
