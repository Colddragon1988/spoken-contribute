/** Kleine Dateihelfer des Pakets (e): Python-kompaktes JSON und Datei-löschen-falls-vorhanden. */
import { unlink } from 'node:fs/promises';

/** JSON wie Pythons json.dumps(dict, ensure_ascii=False) ohne indent: Trennzeichen ", " und ": ".
 * Nur für flache Objekte aus Strings (login.json, passwort.safestorage). */
export function compactJson(pairs: readonly (readonly [string, string])[]): string {
  return `{${pairs.map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(', ')}}`;
}

/** Wie Pythons Path.unlink(missing_ok=True): eine fehlende Datei ist kein Fehler. */
export async function unlinkIfExists(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (err) {
    if (!isMissing(err)) throw err;
  }
}

/** Fehlt die Datei (ENOENT)? */
export function isMissing(err: unknown): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT';
}
