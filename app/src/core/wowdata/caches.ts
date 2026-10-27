// Wo die DBCache-Dateien liegen (Spezifikation §2.5).
import { join } from 'node:path';
import type { Flavor } from '../../shared/types';
import { CACHE_LANGUAGES } from '../../shared/types';
import { comparePaths, listNames, startsWithName } from './glob';

/** Cache/ADB/<Sprache> aller Versionen, z. B. …/_classic_era_/Cache/ADB/deDE.
 *  Nur Ordnernamen, die genau eine Client-Sprache sind (Groß/Klein zählt). */
export async function cacheFolders(flavors: readonly Flavor[]): Promise<string[]> {
  const folders: string[] = [];
  for (const flavor of flavors) {
    const adb = join(flavor.dir, 'Cache', 'ADB');
    const names = (await listNames(adb)).filter((name) => CACHE_LANGUAGES.includes(name));
    folders.push(...names.map((name) => join(adb, name)).sort(comparePaths));
  }
  return folders;
}

/** DBCache.bin und die Zwischenstände, die WoW daneben ablegt (DBCache.bin1652.tmp …). */
export async function cacheFiles(folder: string): Promise<string[]> {
  return (await listNames(folder))
    .filter((name) => startsWithName(name, 'DBCache.bin'))
    .map((name) => join(folder, name))
    .sort(comparePaths);
}
