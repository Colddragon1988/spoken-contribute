// Ordner auflisten und sortieren wie Pythons pathlib (glob, sorted(Path …)).
import { readdir, stat } from 'node:fs/promises';
import { sep } from 'node:path';

const WINDOWS = process.platform === 'win32';

/** Namen in einem Ordner; fehlt er oder ist er unlesbar: keine (wie pathlib.glob). */
export async function listNames(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

/** Ist path ein Ordner (Verknüpfungen werden verfolgt)? Fehler → false, wie Path.is_dir(). */
export async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** Beginnt der Name mit prefix? Groß/Klein zählt wie bei pathlib (nur unter Windows nicht). */
export function startsWithName(name: string, prefix: string): boolean {
  return WINDOWS ? name.toLowerCase().startsWith(prefix.toLowerCase()) : name.startsWith(prefix);
}

/** Zeichenketten nach Codepunkten vergleichen wie Python (JS vergleicht UTF-16-Einheiten). */
export function compareCodePoints(a: string, b: string): number {
  const x = a[Symbol.iterator]();
  const y = b[Symbol.iterator]();
  for (;;) {
    const p = x.next();
    const q = y.next();
    if (p.done === true || q.done === true) return (p.done === true ? 0 : 1) - (q.done === true ? 0 : 1);
    const d = (p.value.codePointAt(0) ?? 0) - (q.value.codePointAt(0) ?? 0);
    if (d !== 0) return d;
  }
}

/** Pfade wie sorted(Path …): Teil für Teil (nicht als ganze Zeichenkette – sonst stünde
 *  "ACC-2/…" vor "ACC/…"); unter Windows ohne Groß/Klein-Unterscheidung. */
export function comparePaths(a: string, b: string): number {
  const norm = (p: string): string[] => (WINDOWS ? p.toLowerCase() : p).split(sep);
  const x = norm(a);
  const y = norm(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = compareCodePoints(x[i] ?? '', y[i] ?? '');
    if (d !== 0) return d;
  }
  return x.length - y.length;
}
