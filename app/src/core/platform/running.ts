// Laufende WoW-Versionen aus den Programmpfaden erkennen (Spezifikation §6.4).
import type { RunningFlavors } from '../../shared/types';

// Das Spiel selbst: Wow.exe, WowClassic.exe … (Windows, Wine) oder
// „World of Warcraft Classic.app/Contents/MacOS/…“ (macOS) – nicht Launcher oder Sprachchat-Helfer.
// Flag u zusätzlich zu i: Groß/Klein wie Pythons re.I (Unicode-Faltung).
const GAME = /(?:^|[\\/])(wow[a-z0-9-]*\.exe|World of Warcraft[^/]*\.app\/Contents\/MacOS\/[^/]+)$/iu;
const NOT_THE_GAME = /voiceproxy|launcher/iu;
const FLAVOR = /[\\/](_[a-z0-9_]+_)(?=[\\/])/giu;

/** Ordnernamen der laufenden WoW-Clients, z. B. {"_forever_"}. null heißt: ein WoW läuft,
 *  aber aus welchem Ordner, ist nicht zu erkennen. */
export function runningFlavors(programs: readonly string[]): RunningFlavors {
  const found = new Set<string>();
  for (const program of programs) {
    const game = GAME.exec(program);
    const name = game?.[1];
    if (name === undefined || NOT_THE_GAME.test(name)) continue;
    const folders = [...program.matchAll(FLAVOR)].map((match) => match[1] ?? '');
    const last = folders.at(-1);
    if (last === undefined) return null;
    found.add(last.toLowerCase());
  }
  return found;
}
