// Gemeinsame Dateihelfer des Kerns: atomar schreiben (wie system.write_file) und JSON-Objekte lesen.
import { chmod, mkdir, open, readFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { JsonObject } from '../shared/types';

const POSIX = process.platform !== 'win32';

/** Laufende Schreibvorgänge je Zieldatei. Alle teilen sich <datei>.tmp (wie Python): Zwei
 *  gleichzeitige Aufrufe – etwa schnell nacheinander gespeicherte Einstellungen – würden sich sonst
 *  die Nachbardatei gegenseitig kürzen, umbenennen oder unter Windows sperren. */
const pending = new Map<string, Promise<void>>();

/** Atomar schreiben (§6.1): <datei>.tmp, fsync, rename. private: Datei 0600, neuer Ordner 0700.
 *  Aufrufe für dieselbe Datei laufen nacheinander; die zuletzt begonnene Fassung bleibt stehen. */
export function writeFileAtomic(
  path: string, data: string | Uint8Array, options: { readonly private?: boolean } = {},
): Promise<void> {
  const before = pending.get(path) ?? Promise.resolve();
  const mine = before.catch(() => undefined).then(() => writeNow(path, data, options.private === true));
  const settled = mine.catch(() => undefined);
  pending.set(path, settled);
  void settled.then(() => { if (pending.get(path) === settled) pending.delete(path); });
  return mine;
}

async function writeNow(path: string, data: string | Uint8Array, isPrivate: boolean): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: isPrivate ? 0o700 : 0o777 });
  const tmp = `${path}.tmp`;
  const handle = await open(tmp, 'w', isPrivate ? 0o600 : 0o666);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  if (POSIX && isPrivate) await chmod(tmp, 0o600);
  await rename(tmp, path);
}

/** JSON-Objekt lesen; fehlt die Datei, ist sie kaputt oder kein Objekt: null. */
export async function readJsonObject(path: string): Promise<JsonObject | null> {
  try {
    const value: unknown = JSON.parse(await readFile(path, 'utf8'));
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as JsonObject) : null;
  } catch {
    return null;
  }
}
