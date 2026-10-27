// Eigene Ordner je Betriebssystem (Spezifikation §6.1, Entscheidung 16).
// Alles rein: Plattform, Umgebung und Home kommen herein – nie process.env oder os.homedir().
import { posix, win32 } from 'node:path';
import type { PlatformPath } from 'node:path';
import type { AppPaths, EnvVars, Platform } from '../../shared/types';
import { APP_DIR_NAME, USER_DATA_DIR_NAME } from '../../shared/types';

/** Pfadregeln des Zielsystems – so lassen sich Windows-Pfade auch unter Linux testen. */
export function pathFor(platform: Platform): PlatformPath {
  return platform === 'win32' ? win32 : posix;
}

/** Wie Pythons `os.environ.get(name) or fallback`: auch ein leerer Wert gilt als nicht gesetzt. */
function envOr(env: EnvVars, name: string, fallback: string): string {
  const value = env[name];
  return value !== undefined && value !== '' ? value : fallback;
}

/** Grundordner für Einstellungen (ohne App-Namen): dort legt auch Electron sein userData an. */
function configBase(platform: Platform, env: EnvVars, home: string): string {
  const p = pathFor(platform);
  if (platform === 'win32') return envOr(env, 'APPDATA', p.join(home, 'AppData', 'Roaming'));
  if (platform === 'darwin') return p.join(home, 'Library', 'Application Support');
  return envOr(env, 'XDG_CONFIG_HOME', p.join(home, '.config'));
}

function dataBase(platform: Platform, env: EnvVars, home: string): string {
  const p = pathFor(platform);
  if (platform === 'win32') return envOr(env, 'LOCALAPPDATA', p.join(home, 'AppData', 'Local'));
  if (platform === 'darwin') return p.join(home, 'Library', 'Application Support');
  return envOr(env, 'XDG_DATA_HOME', p.join(home, '.local', 'share'));
}

/** Einstellungen/Zugangsdaten und Archiv – dieselben Ordner wie die Python-Fassung,
 *  damit Einstellungen und Verlauf übernommen werden. */
export function defaultPaths(platform: Platform, env: EnvVars, home: string): AppPaths {
  const p = pathFor(platform);
  return {
    configDir: p.join(configBase(platform, env, home), APP_DIR_NAME),
    dataDir: p.join(dataBase(platform, env, home), APP_DIR_NAME),
    home,
  };
}

/** Electrons eigener Ordner (Cache, GPUCache, Local Storage …) – bewusst NICHT der
 *  Konfig-Ordner der Python-Fassung, sonst landete Chromiums Kram zwischen settings.json
 *  und login.json (Entscheidung 16). Liegt neben ihm, wie Electrons Vorgabe. */
export function userDataDir(platform: Platform, env: EnvVars, home: string): string {
  return pathFor(platform).join(configBase(platform, env, home), USER_DATA_DIR_NAME);
}
