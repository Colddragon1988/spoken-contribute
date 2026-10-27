// SpokenContributions.lua finden, einlesen und nach dem Upload leeren (Spezifikation §2.3, §2.4).
import { open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ContributionStore, Flavor } from '../../shared/types';
import { comparePaths, listNames } from './glob';
import { cleared, envelopesInBytes } from './lua';
import { decodeUtf8Text } from './utf8';

export const CONTRIBUTIONS = 'SpokenContributions.lua';

const isErrno = (err: unknown, code: string): boolean =>
  err instanceof Error && (err as NodeJS.ErrnoException).code === code;

/** WoWs Sicherungskopie neben der Datei (vom vorletzten Speichern). */
export function backupOf(lua: string): string {
  return lua + '.bak';
}

/** Dateiinhalt; fehlt die Datei: null. Andere Dateifehler gehen weiter (wie Python). */
async function readIfExists(path: string): Promise<Uint8Array | null> {
  try {
    return await readFile(path);
  } catch (err) {
    if (isErrno(err, 'ENOENT')) return null;
    throw err;
  }
}

/** Alle SpokenContributions.lua einer Version. Auch eine .bak ohne zugehörige .lua zählt:
 *  sie kann Zeilen enthalten, die sonst fehlen. */
export async function contributionFiles(flavor: string): Promise<string[]> {
  // Glob WTF/Account/*/SavedVariables/SpokenContributions.lua*, danach nur die beiden exakten Namen
  const accounts = join(flavor, 'WTF', 'Account');
  const found = new Set<string>();
  for (const account of await listNames(accounts)) {
    const dir = join(accounts, account, 'SavedVariables');
    for (const name of await listNames(dir)) {
      if (name === CONTRIBUTIONS || name === CONTRIBUTIONS + '.bak') found.add(join(dir, CONTRIBUTIONS));
    }
  }
  return [...found].sort(comparePaths);
}

/** Alle "!SPOKEN…"-Umschläge in einer Datei; fehlt sie, keine. */
export async function envelopesIn(path: string): Promise<string[]> {
  const data = await readIfExists(path);
  return data ? envelopesInBytes(data) : [];
}

/** (Version, .lua, Umschläge aus .lua und .bak ohne Doppelte) je Datei, die es gibt. */
export async function collectContributions(flavors: readonly Flavor[]): Promise<ContributionStore[]> {
  const stores: ContributionStore[] = [];
  for (const flavor of flavors) {
    for (const lua of await contributionFiles(flavor.dir)) {
      const envelopes = [...(await envelopesIn(lua)), ...(await envelopesIn(backupOf(lua)))];
      stores.push({ flavor, lua, envelopes: [...new Set(envelopes)] });
    }
  }
  return stores;
}

/** Erst in eine Nachbardatei schreiben und dann ersetzen: bricht etwas ab, bleibt die alte
 *  Datei vollständig statt halb geschrieben. */
async function replaceFile(path: string, data: Uint8Array): Promise<void> {
  const tmp = join(dirname(path), `${CONTRIBUTIONS}.spoken-tmp`);
  try {
    const handle = await open(tmp, 'w');
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => undefined); // keine halbe Nachbardatei liegen lassen
    throw err;
  }
}

/** Die gesammelten Zeilen aus den .lua-Dateien entfernen und WoWs .bak-Kopien löschen.
 *
 *  Die Dateien werden dafür noch einmal gelesen. Steht darin inzwischen ein Umschlag, der
 *  nicht gesendet wurde, bleiben .lua und .bak unberührt – lieber einmal doppelt senden als
 *  etwas verlieren. Ergebnis: die Dateien, die deshalb liegen geblieben sind.
 *  Ein Dateifehler bricht ab; bis dahin geleerte Dateien bleiben geleert. */
export async function clearContributions(files: readonly string[], sent: ReadonlySet<string>): Promise<string[]> {
  const kept: string[] = [];
  for (const lua of files) {
    const bak = backupOf(lua);
    const luaData = await readIfExists(lua);
    const bakData = await readIfExists(bak);
    const now = [...(luaData ? envelopesInBytes(luaData) : []), ...(bakData ? envelopesInBytes(bakData) : [])];
    if (!now.every((envelope) => sent.has(envelope))) {
      kept.push(lua);
      continue;
    }
    if (luaData) {
      // Geleert wird genau der Inhalt, der eben geprüft wurde (Python liest dafür ein zweites Mal).
      await replaceFile(lua, new TextEncoder().encode(cleared(decodeUtf8Text(luaData))));
    }
    // .bak erst löschen, wenn die .lua sicher geschrieben ist; fehlt sie, ist das kein Fehler
    await unlink(bak).catch((err: unknown) => {
      if (!isErrno(err, 'ENOENT')) throw err;
    });
  }
  return kept;
}
