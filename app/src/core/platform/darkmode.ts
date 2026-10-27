// Ob das System auf dunkles Design gestellt ist (Spezifikation §6.5, Entscheidung 17).
// Der Main nutzt das unter Linux als Ergänzung zu nativeTheme, das KDE/Portal nicht immer erkennt.
import type { DarkModeProbe, Platform, ProcessRunner } from '../../shared/types';
import { outputLines } from './processes';

export const DARK_MODE_TIMEOUT_MS = 3_000;

const PERSONALIZE_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize';
const LIGHT_THEME_VALUE = /^AppsUseLightTheme\s+REG_DWORD\s+(0x[0-9a-f]+|\d+)$/iu;

async function lines(runner: ProcessRunner, command: string, args: readonly string[]): Promise<string[]> {
  try {
    const result = await runner.run(command, args, { timeoutMs: DARK_MODE_TIMEOUT_MS });
    return outputLines(result.stdout);
  } catch {
    return [];
  }
}

/** Linux: die Desktop-Einstellung über das XDG-Portal (KDE, GNOME u. a.): 1 = dunkel …
 *  ohne Portal die GNOME-Einstellung. Ohne jede Antwort null (dann gilt nativeTheme). */
async function linuxDark(runner: ProcessRunner): Promise<boolean | null> {
  const portal = await lines(runner, 'gdbus', [
    'call', '--session', '--dest', 'org.freedesktop.portal.Desktop',
    '--object-path', '/org/freedesktop/portal/desktop',
    '--method', 'org.freedesktop.portal.Settings.Read',
    'org.freedesktop.appearance', 'color-scheme',
  ]);
  if (portal[0] !== undefined) return portal[0].includes('uint32 1');
  const gnome = await lines(runner, 'gsettings', ['get', 'org.gnome.desktop.interface', 'color-scheme']);
  if (gnome[0] !== undefined) return gnome[0].includes('dark');
  return null;
}

/** macOS: Bei hellem Design fehlt der Schlüssel (leere Ausgabe) – das ist hell, wie in Python. */
async function macDark(runner: ProcessRunner): Promise<boolean> {
  const answer = await lines(runner, 'defaults', ['read', '-g', 'AppleInterfaceStyle']);
  return answer.length === 1 && answer[0] === 'Dark';
}

/** Windows: AppsUseLightTheme == 0 heißt dunkel; ohne lesbaren Wert null. */
async function windowsDark(runner: ProcessRunner): Promise<boolean | null> {
  for (const line of await lines(runner, 'reg', ['query', PERSONALIZE_KEY, '/v', 'AppsUseLightTheme'])) {
    const value = LIGHT_THEME_VALUE.exec(line)?.[1];
    if (value !== undefined) return Number(value) === 0;
  }
  return null;
}

export function createDarkModeProbe(platform: Platform, runner: ProcessRunner): DarkModeProbe {
  return {
    prefersDark() {
      if (platform === 'win32') return windowsDark(runner);
      if (platform === 'darwin') return macDark(runner);
      return linuxDark(runner);
    },
  };
}
