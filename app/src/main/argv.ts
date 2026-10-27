/**
 * Kommandozeile des Electron-Programms auf die Argumente der App eingrenzen (rein, ohne Electron).
 *
 * Electron, Chromium, Node und Playwright hängen eigene Schalter an; die zählen nicht als
 * App-Argumente, sonst würde jeder Testlauf mit USAGE und Exit 2 enden (Architektur §6.2).
 */
import { interpretArgs, type ArgsResult } from './cli';

/** Schalter, die nicht der App gehören: mit Wert („--x=…“) oder ohne. */
const FOREIGN_PREFIXES = [
  '--inspect', // --inspect, --inspect=0, --inspect-brk …
  '--remote-debugging-port=',
  '--enable-logging',
  '--password-store=',
  '--ozone-platform', // --ozone-platform=…, --ozone-platform-hint=…
  '--enable-features=',
] as const;
const FOREIGN_EXACT = new Set([
  '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--allow-file-access-from-files', // hängt Electron an argv von second-instance an
]);
/** --standard-schemes=app, --secure-schemes=app …: Electron hängt sie für registerSchemesAsPrivileged
 *  an die eigene Befehlszeile; second-instance bekommt sie mit – sonst holte ein zweiter
 *  Fensterstart das erste Fenster nie nach vorn. */
const SCHEME_SWITCH = /^--[a-z-]+-schemes=/u;

/** Gehört das Argument Chromium/Node/Playwright bzw. macOS (Prozessnummer des Finders)? */
export function isForeignSwitch(arg: string): boolean {
  if (FOREIGN_EXACT.has(arg) || arg.startsWith('-psn_') || SCHEME_SWITCH.test(arg)) return true;
  return FOREIGN_PREFIXES.some((prefix) => arg === prefix || arg.startsWith(prefix));
}

/**
 * Die Argumente der App aus process.argv. Unverpackt steht nach dem Programm noch der App-Pfad
 * (z. B. „.“) – das erste Argument, das kein Schalter ist, fällt deshalb weg.
 */
export function appArgs(argv: readonly string[], packaged: boolean): string[] {
  const rest = argv.slice(1);
  if (!packaged) {
    const appPath = rest.findIndex((arg) => !arg.startsWith('-'));
    if (appPath >= 0) rest.splice(appPath, 1);
  }
  return rest.filter((arg) => !isForeignSwitch(arg));
}

/** process.argv → USAGE mit Exit-Code oder die Betriebsart. */
export function parseArgv(argv: readonly string[], packaged: boolean): ArgsResult {
  return interpretArgs(appArgs(argv, packaged));
}
