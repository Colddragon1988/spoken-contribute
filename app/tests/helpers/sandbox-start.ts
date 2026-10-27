/**
 * Probelauf und UI-Sandbox (Architektur §7.1/7.2): „npm run start:sandbox“ startet die gebaute App
 * mit Temp-WoW aus den Fixtures und vorgetäuschtem Server auf 127.0.0.1. Die Helfer hier benutzen
 * auch die Playwright-Tests (tests/ui/launch.ts).
 *
 * Regeln 1–3: Alles liegt in einem Temp-Ordner – auch HOME, XDG_* und APPDATA des App-Prozesses,
 * damit selbst ein Fehler in der Sandbox-Erkennung keine echten Daten erreicht. Der Sitzungsbus ist
 * abgeschaltet (kein KWallet, kein Portal), Chromium nimmt password-store=basic.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contributionsLua, dbcache, envelope } from './fixtures';
import { startHttpFakeServer } from './httpFakeServer';

export const SANDBOX_VAR = 'SPOKEN_UPLOAD_SANDBOX';
export const SERVER_VAR = 'SPOKEN_UPLOAD_SERVER';

/** system.json zu Beginn: kein Spiel läuft, helles System, kein Schlüsselbund. */
export const DEFAULT_SYSTEM = {
  prozesse: [],
  dunkel: false,
  schluesselbund: { art: 'none', gesperrt: false, eintraege: {} },
} as const;

/** Variablen, die der App-Prozess vom Aufrufer erben darf – alles andere bleibt draußen. */
const INHERITED = [
  'PATH', 'DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'XDG_RUNTIME_DIR', 'XDG_SESSION_TYPE', 'LANG', 'LC_ALL',
  'TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'SYSTEMROOT', 'windir', 'ComSpec', 'PATHEXT', 'SystemDrive',
] as const;

/** Neuer Sandbox-Ordner unter os.tmpdir() (realpath, wie die App ihn prüft). */
export async function createSandboxRoot(prefix = 'spoken-ui-'): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  await mkdir(join(root, 'home'), { recursive: true });
  await writeFile(join(root, 'system.json'), JSON.stringify(DEFAULT_SYSTEM, null, 2));
  return root;
}

/** Umgebung des App-Prozesses: Sandbox-Variablen, Temp-Home, kein Sitzungsbus. */
export function appEnvironment(root: string, serverUrl: string, extra: Record<string, string> = {}): Record<string, string> {
  const home = join(root, 'home');
  const env: Record<string, string> = {};
  for (const key of INHERITED) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return {
    ...env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_DATA_HOME: join(home, '.local', 'share'),
    XDG_CACHE_HOME: join(home, '.cache'),
    APPDATA: join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: join(home, 'AppData', 'Local'),
    DBUS_SESSION_BUS_ADDRESS: 'disabled:', // kein KWallet, kein Secret Service, kein Portal
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    [SANDBOX_VAR]: root,
    [SERVER_VAR]: serverUrl,
    ...extra,
  };
}

/** Pfad des Electron-Programms aus app/node_modules (unter plain Node liefert require den Pfad). */
export function electronBinary(appDir: string): string {
  return createRequire(join(appDir, 'package.json'))('electron') as string;
}

/** Ein WoW zum Ausprobieren: Classic Era mit 3 Zeilen, WoW Forever mit 2 NPC-Texten. */
export async function prepareDemo(root: string): Promise<void> {
  const wow = join(root, 'World of Warcraft');
  const era = join(wow, '_classic_era_');
  await mkdir(join(era, 'Interface', 'AddOns', 'Spoken'), { recursive: true });
  const saved = join(era, 'WTF', 'Account', 'ACC', 'SavedVariables');
  await mkdir(saved, { recursive: true });
  await writeFile(join(saved, 'SpokenContributions.lua'), contributionsLua([envelope(1), envelope(2), envelope(3, 'books')]));
  const forever = join(wow, '_forever_');
  await mkdir(join(forever, 'Interface', 'AddOns', 'Spoken'), { recursive: true });
  await mkdir(join(forever, 'WTF'), { recursive: true });
  const cache = join(forever, 'Cache', 'ADB', 'deDE');
  await mkdir(cache, { recursive: true });
  await writeFile(join(cache, 'DBCache.bin'), dbcache(70003, [[1, 'Seid gegrüßt, Reisender.', ''], [2, 'Habt Dank!', 'Habt Dank, Heldin!']]));
  await mkdir(join(root, 'config'), { recursive: true });
  await writeFile(join(root, 'config', 'settings.json'),
    JSON.stringify({ wow_dir: wow, auto_upload: false, theme: 'system' }, null, 2));
  await writeFile(join(root, 'system.json'), JSON.stringify({ ...DEFAULT_SYSTEM, wowSuche: wow }, null, 2));
}

/** npm run start:sandbox – aus app/ heraus, mit dist/ von „npm run build“. */
async function startSandbox(): Promise<number> {
  const appDir = process.cwd();
  const pkg = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8')) as { name?: string };
  if (pkg.name !== 'spoken-upload') throw new Error('Bitte aus dem Ordner app/ starten (npm run start:sandbox).');
  const root = await createSandboxRoot('spoken-probe-');
  await prepareDemo(root);
  const server = await startHttpFakeServer();
  process.stdout.write(`Sandbox: ${root}\nVorgetäuschter Server: ${server.url}\n` +
    'Laufende Spiele, Systemdesign und Schlüsselbund lassen sich in system.json ändern.\n');
  try {
    const child = spawn(electronBinary(appDir), ['.', ...process.argv.slice(2)], {
      cwd: appDir, env: appEnvironment(root, server.url), stdio: 'inherit',
    });
    return await new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => { resolve(code ?? 1); });
    });
  } finally {
    const calls = server.server.paths();
    process.stdout.write(`Anfragen an den vorgetäuschten Server: ${calls.length > 0 ? calls.join(', ') : 'keine'}\n`);
    await server.close();
    if (process.env.SPOKEN_SANDBOX_BEHALTEN === '1') process.stdout.write(`Sandbox bleibt: ${root}\n`);
    else await rm(root, { recursive: true, force: true });
  }
}

// Nur als dist-dev/sandbox-start.cjs ausführen – beim Import aus den UI-Tests nicht.
if (/sandbox-start\.c?js$/.test(process.argv[1] ?? '')) {
  startSandbox().then((code) => { process.exitCode = code; }, (err: unknown) => {
    process.stderr.write(`${String(err)}\n`);
    process.exitCode = 1;
  });
}
