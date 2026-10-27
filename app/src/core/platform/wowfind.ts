// WoW-Installation finden und erkennen (Spezifikation §6.2).
// Unterstützt Windows, macOS und Linux (WoW über Wine/Proton mit Lutris, Bottles, Steam o. Ä.).
import { readdir, stat } from 'node:fs/promises';
import type { EnvVars, Platform, ProcessRunner, WowLocator } from '../../shared/types';
import { pathFor } from './paths';
import { outputLines } from './processes';

export const WOW_FOLDER = 'World of Warcraft';

/** Ein Versionsordner hat WTF, Interface oder .flavor.info – das unterscheidet ihn von
 *  anderen Ordnern, die zufällig mit _ beginnen und enden. */
const FLAVOR_MARKERS = ['WTF', 'Interface', '.flavor.info'] as const;
/** wie glob "_*_" (fnmatch: * passt auch auf Zeilenumbrüche) */
const FLAVOR_GLOB = /^_.*_$/su;

const REGISTRY_KEY = 'HKLM\\SOFTWARE\\WOW6432Node\\Blizzard Entertainment\\World of Warcraft';
const REGISTRY_TIMEOUT_MS = 10_000;
const REGISTRY_VALUE = /^InstallPath\s+REG_(?:EXPAND_)?SZ\s+(.+)$/iu;

// Wo Lutris, Bottles, Steam (Proton) und Wine selbst ihre Präfixe anlegen.
export const WINE_PREFIXES: readonly string[] = [
  'Games/*', '.wine', '.local/share/wineprefixes/*',
  '.local/share/lutris/prefixes/*',
  '.local/share/bottles/bottles/*',
  '.var/app/com.usebottles.bottles/data/bottles/bottles/*',
  '.steam/steam/steamapps/compatdata/*/pfx',
  '.local/share/Steam/steamapps/compatdata/*/pfx',
  '.var/app/com.valvesoftware.Steam/.local/share/Steam/steamapps/compatdata/*/pfx',
];

export interface WowFindDeps {
  readonly platform: Platform;
  readonly env: EnvVars;
  readonly home: string;
  readonly runner: ProcessRunner;
  /** nur für Tests: ob ein Laufwerk wie "C:\\" vorhanden ist (Windows) */
  readonly driveExists?: (drive: string) => Promise<boolean>;
}

// ---------------------------------------------------------------- Pfade wie Pythons Path

/** Wurzel und Bestandteile, wie Pythons PurePath sie sieht: doppelte Trenner und "." fallen
 *  weg, ".." bleibt stehen (Path löst es nicht auf). */
function split(path: string, platform: Platform): { root: string; parts: string[] } {
  const p = pathFor(platform);
  const rawRoot = p.parse(path).root;
  let root = platform === 'win32' ? rawRoot.replaceAll('/', '\\') : rawRoot;
  // Freigabe ohne Schlusstrenner (\\nas\spiele): Python schreibt sie als \\nas\spiele\ –
  // sonst klebte ein Unterordner direkt am Freigabenamen.
  if (platform === 'win32' && root.startsWith('\\\\') && !root.endsWith('\\')) root += '\\';
  const rest = path.slice(rawRoot.length);
  const parts = rest.split(platform === 'win32' ? /[\\/]/u : /\//u).filter((part) => part !== '' && part !== '.');
  return { root, parts };
}

function build(root: string, parts: readonly string[], platform: Platform): string {
  const text = root + parts.join(pathFor(platform).sep);
  return text === '' ? '.' : text;
}

/** Wie str(Path(text)) – "" wird zu ".". */
export function normalizePath(path: string, platform: Platform): string {
  const { root, parts } = split(path, platform);
  return build(root, parts, platform);
}

/** Wie Path.parents: alle übergeordneten Ordner, der nächste zuerst. */
export function parentsOf(path: string, platform: Platform): string[] {
  const { root, parts } = split(path, platform);
  const result: string[] = [];
  for (let i = parts.length - 1; i >= 0; i--) result.push(build(root, parts.slice(0, i), platform));
  return result;
}

/** Wie Path.parent (die Wurzel ist ihr eigener Elternordner). */
function parentOf(path: string, platform: Platform): string {
  return parentsOf(path, platform)[0] ?? normalizePath(path, platform);
}

function child(base: string, platform: Platform, ...names: string[]): string {
  const { root, parts } = split(base, platform);
  return build(root, [...parts, ...names], platform);
}

// ---------------------------------------------------------------- Dateisystem, ohne Wurf

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function listDir(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

/** Die Unterordner nach dem Muster _*_ (noch ungeprüft). */
async function flavorCandidates(root: string, platform: Platform): Promise<string[]> {
  return (await listDir(root)).filter((name) => FLAVOR_GLOB.test(name)).map((name) => child(root, platform, name));
}

// ---------------------------------------------------------------- WoW erkennen

/** Der WoW-Hauptordner enthält Versionsordner wie _classic_era_ oder _retail_.
 *  Dateisystemfehler ergeben false. */
export async function isWowRoot(path: string, platform: Platform): Promise<boolean> {
  try {
    for (const folder of await flavorCandidates(normalizePath(path, platform), platform)) {
      if (!(await isDirectory(folder))) continue;
      for (const marker of FLAVOR_MARKERS) {
        if (await exists(child(folder, platform, marker))) return true;
      }
    }
  } catch {
    // wie Python: OSError → kein WoW
  }
  return false;
}

/** Der WoW-Hauptordner zu einem gewählten Ordner: er selbst, der Unterordner
 *  „World of Warcraft“ oder ein übergeordneter (wenn z. B. _classic_era_ gewählt wurde). */
export async function wowRoot(path: string, platform: Platform): Promise<string | null> {
  const candidates = [normalizePath(path, platform), child(path, platform, WOW_FOLDER), ...parentsOf(path, platform)];
  for (const candidate of candidates) {
    if (await isWowRoot(candidate, platform)) return candidate;
  }
  return null;
}

/** Ob in einer Version dieses Hauptordners Spoken installiert ist (_*_/Interface/AddOns/Spoken). */
async function hasSpoken(root: string, platform: Platform): Promise<boolean> {
  for (const folder of await flavorCandidates(root, platform)) {
    if (await exists(child(folder, platform, 'Interface', 'AddOns', 'Spoken'))) return true;
  }
  return false;
}

// ---------------------------------------------------------------- Kandidaten je System

/** Codepunktweiser Vergleich wie Pythons str-Vergleich. */
function compareText(a: string, b: string): number {
  const ca = Array.from(a);
  const cb = Array.from(b);
  for (let i = 0; i < Math.min(ca.length, cb.length); i++) {
    const x = ca[i]?.codePointAt(0) ?? 0;
    const y = cb[i]?.codePointAt(0) ?? 0;
    if (x !== y) return x - y;
  }
  return ca.length - cb.length;
}

/** Sortierung wie sorted() über Path-Objekte: Bestandteil für Bestandteil, nicht als Zeichenkette
 *  (sonst stünde "123 4/pfx" vor "123/pfx"). */
function comparePaths(a: string, b: string, platform: Platform): number {
  const pa = split(a, platform).parts;
  const pb = split(b, platform).parts;
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    const order = compareText(pa[i] ?? '', pb[i] ?? '');
    if (order !== 0) return order;
  }
  return pa.length - pb.length;
}

/** Wie Path.home().glob(pattern) für Muster aus festen Namen und "*" (passt wie bei pathlib
 *  auch auf versteckte Einträge). Zwischenstufen müssen Ordner sein, das Ende muss existieren. */
async function globUnder(base: string, pattern: string, platform: Platform): Promise<string[]> {
  let current = [normalizePath(base, platform)];
  for (const segment of pattern.split('/')) {
    const next: string[] = [];
    for (const dir of current) {
      if (segment === '*') {
        if (!(await isDirectory(dir))) continue;
        for (const name of await listDir(dir)) next.push(child(dir, platform, name));
      } else {
        next.push(child(dir, platform, segment));
      }
    }
    current = next;
  }
  const found: string[] = [];
  for (const path of current) if (await exists(path)) found.push(path);
  return found.sort((a, b) => comparePaths(a, b, platform));
}

/** Alle Wine-Präfixe des Benutzers, ohne Doppelte; WINEPREFIX zuerst. */
export async function winePrefixes(deps: Pick<WowFindDeps, 'platform' | 'env' | 'home'>): Promise<string[]> {
  const found: string[] = [];
  const winePrefix = deps.env.WINEPREFIX;
  if (winePrefix !== undefined && winePrefix !== '') found.push(normalizePath(winePrefix, deps.platform));
  for (const pattern of WINE_PREFIXES) found.push(...await globUnder(deps.home, pattern, deps.platform));
  return [...new Set(found)];
}

/** Was der Battle.net-Installer unter Windows einträgt (ein Versionsordner wie …\_retail_\). */
export async function registryWow(runner: ProcessRunner): Promise<string[]> {
  try {
    const result = await runner.run('reg', ['query', REGISTRY_KEY, '/v', 'InstallPath'], { timeoutMs: REGISTRY_TIMEOUT_MS });
    for (const line of outputLines(result.stdout)) {
      const value = REGISTRY_VALUE.exec(line)?.[1]?.trim();
      if (value !== undefined && value !== '') return [value];
    }
  } catch {
    // Runner wirft eigentlich nie – sicher ist sicher.
  }
  return [];
}

const defaultDriveExists = (drive: string): Promise<boolean> => isDirectory(drive);

/** Die üblichen Installationsorte je System; ob dort wirklich WoW liegt, prüft findWow. */
export async function wowCandidates(deps: WowFindDeps): Promise<string[]> {
  const { platform, home } = deps;
  const p = pathFor(platform);
  if (platform === 'win32') {
    const driveExists = deps.driveExists ?? defaultDriveExists;
    const drives: string[] = [];
    for (const letter of 'CDEFGHIJ') {
      const drive = `${letter}:\\`;
      if (await driveExists(drive)) drives.push(drive);
    }
    const subs = ['Program Files (x86)', 'Program Files', 'Games', 'Spiele', ''];
    return [
      ...await registryWow(deps.runner),
      ...drives.flatMap((drive) => subs.map((sub) => p.join(drive, sub, WOW_FOLDER))),
    ];
  }
  if (platform === 'darwin') {
    return [p.join('/Applications', WOW_FOLDER), p.join(home, 'Applications', WOW_FOLDER)];
  }
  return (await winePrefixes(deps)).flatMap((prefix) =>
    ['Program Files (x86)', 'Program Files'].map((programFiles) => child(prefix, platform, 'drive_c', programFiles, WOW_FOLDER)));
}

/** WoW an den üblichen Orten suchen; eine Installation mit Spoken hat Vorrang. */
export async function findWow(deps: WowFindDeps): Promise<string | null> {
  const { platform } = deps;
  const roots: string[] = [];
  for (const candidate of await wowCandidates(deps)) {
    // die Registry nennt einen Versionsordner – daher auch der Elternordner
    for (const path of [normalizePath(candidate, platform), parentOf(candidate, platform)]) {
      if (!roots.includes(path) && await isWowRoot(path, platform)) roots.push(path);
    }
  }
  for (const root of roots) {
    if (await hasSpoken(root, platform)) return root;
  }
  return roots[0] ?? null;
}

export function createWowLocator(deps: WowFindDeps): WowLocator {
  return {
    isWowRoot: (path) => isWowRoot(path, deps.platform),
    wowRoot: (path) => wowRoot(path, deps.platform),
    findWow: () => findWow(deps),
  };
}
