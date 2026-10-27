// Versionsordner einer WoW-Installation (Spezifikation §2.1).
import { basename, join } from 'node:path';
import type { Flavor } from '../../shared/types';
import { FLAVOR_NAMES } from '../../shared/types';
import { comparePaths, isDir, listNames } from './glob';

/** „Classic Era“ für _classic_era_ usw.; unbekannte Ordner zeigen ihren Namen ohne _ außen. */
export function flavorName(folder: string): string {
  const key = folder.toLowerCase();
  // Object.hasOwn: ein Ordner "__proto__" darf nicht ins Prototyp-Objekt greifen
  const known = Object.hasOwn(FLAVOR_NAMES, key) ? FLAVOR_NAMES[key] : undefined;
  return known ?? folder.replace(/^_+|_+$/g, '');
}

/** Glob "_*_": Name beginnt und endet mit _, mindestens zwei Zeichen. */
const isFlavorFolder = (name: string): boolean => name.length >= 2 && name.startsWith('_') && name.endsWith('_');

/** Installationsordner mit Spoken. Versionen ohne Spoken bleiben außen vor – so auch Retail,
 *  dessen neuere Build-Nummern auf dem Server die Classic-Texte verdrängen würden. */
export async function spokenFlavors(wow: string): Promise<Flavor[]> {
  const dirs = (await listNames(wow)).filter(isFlavorFolder).map((name) => join(wow, name)).sort(comparePaths);
  const flavors: Flavor[] = [];
  for (const dir of dirs) {
    if (await isDir(join(dir, 'Interface', 'AddOns', 'Spoken'))) {
      const folder = basename(dir);
      flavors.push({ dir, folder, name: flavorName(folder) });
    }
  }
  return flavors;
}
