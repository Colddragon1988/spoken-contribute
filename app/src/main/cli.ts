/**
 * Kommandozeile wie spoken_contribute/main.py (rein, ohne Electron): USAGE, Altlasten aufräumen,
 * ein Durchgang im Terminal. main.ts ruft runCli mit dem echten Kern auf, die Tests mit der Sandbox.
 */
import { errText } from '../core/errors';
import { reportText } from '../core/upload';
import type { LegacyResult } from '../core/settings';
import type { Core } from '../shared/types';

/** Hilfetext; Programmname „Spoken-Upload“ statt „Spoken-Upload.pyw“ (V3). */
export const USAGE = `Aufruf: Spoken-Upload [--test | --ohne-fenster]
  (ohne)          Fenster öffnen
  --test          im Terminal zeigen, was gesendet würde – nichts wird gesendet oder gelöscht
  --ohne-fenster  im Terminal hochladen, z. B. für einen Zeitplan`;

/** V7: CLI, während schon eine Instanz läuft. */
export const ALREADY_RUNNING = 'Spoken-Upload läuft bereits – bitte erst das andere Fenster schließen.';

export const NO_WOW_DIR = 'Kein WoW-Ordner gefunden – bitte einmal im Fenster auswählen.';

export type Mode = 'fenster' | 'test' | 'ohne-fenster';

export type ArgsResult =
  | { readonly kind: 'usage'; readonly exitCode: 0 | 2 }
  | { readonly kind: 'mode'; readonly mode: Mode };

/** Ausgabe; jede Zeichenkette wird so geschrieben, wie sie ist (Zeilenende inklusive). */
export interface CliIo {
  out(text: string): void;
  err(text: string): void;
}

export interface CliDeps {
  /** Kern erst bauen, wenn er gebraucht wird – bei USAGE wird nichts angelegt. */
  core(): Promise<Core> | Core;
  /** Fensterbetrieb; liefert den Exit-Code nach dem Schließen. */
  openWindow?(core: Core): Promise<number>;
  /** Passwort einmalig aus dem Schlüsselbund der Python-Fassung übernehmen (nur echte Daten, nie Sandbox). */
  importLegacyPassword?(core: Core): Promise<LegacyResult>;
}

export const LEGACY_FAILED = 'Das Passwort der Python-Fassung ließ sich nicht übernehmen – bitte im Fenster neu anmelden.';

/** Wie main.py: unbekanntes Argument → USAGE (0 bei -h/--help, sonst 2); --test gewinnt. */
export function interpretArgs(args: readonly string[]): ArgsResult {
  if (args.some((arg) => arg !== '--test' && arg !== '--ohne-fenster')) {
    return { kind: 'usage', exitCode: args.includes('-h') || args.includes('--help') ? 0 : 2 };
  }
  if (args.includes('--test')) return { kind: 'mode', mode: 'test' };
  return { kind: 'mode', mode: args.length > 0 ? 'ohne-fenster' : 'fenster' };
}

/** Was frühere Fassungen hinterlassen haben, in die heutige Form bringen (nicht bei --test). */
export async function tidyUp(core: Core, io: CliIo, importLegacy?: CliDeps['importLegacyPassword']): Promise<void> {
  try {
    await core.history.migrateOldArchive();
  } catch (err) {
    io.err(`Altes Archiv nicht übernommen: ${errText(err)}\n`);
  }
  try {
    await core.login.movePasswordToKeyring(); // Passwort einer früheren Fassung aus login.json holen
  } catch (err) { // login.json nicht beschreibbar; das Passwort steht noch darin
    io.err(`Passwort nicht in den Schlüsselbund umgezogen: ${errText(err)}\n`);
  }
  if (!importLegacy) return;
  try {
    if ((await importLegacy(core)) === 'fehlgeschlagen') io.err(`${LEGACY_FAILED}\n`);
  } catch { // login.json nicht beschreibbar – der alte Eintrag bleibt ja bestehen
    io.err(`${LEGACY_FAILED}\n`);
  }
}

/** Ein Durchgang ohne Fenster; der Rückgabewert ist der Exit-Code (1 = nicht alles geklappt). */
export async function runInTerminal(core: Core, test: boolean, io: CliIo): Promise<number> {
  // Entscheidung 9: Der Testlauf speichert auch einen gefundenen WoW-Ordner nicht.
  const config = await core.settings.load({ persistFound: !test });
  if (!config.wowDir) {
    io.out(`${NO_WOW_DIR}\n`);
    return 1;
  }
  const report = await core.uploader.run(config.wowDir, await core.login.credentials(), {
    test,
    log: (line) => { io.out(`${line}\n`); },
  });
  io.out(`${reportText(report)}\n`);
  return report.failed ? 1 : 0;
}

/** Wie main.main(args): Argumente auswerten, Altlasten aufräumen, dann Fenster oder Terminal. */
export async function runCli(args: readonly string[], deps: CliDeps, io: CliIo): Promise<number> {
  const parsed = interpretArgs(args);
  if (parsed.kind === 'usage') {
    io.out(`${USAGE}\n`);
    return parsed.exitCode;
  }
  const core = await deps.core();
  const test = parsed.mode === 'test';
  if (!test) await tidyUp(core, io, deps.importLegacyPassword?.bind(deps)); // der Testlauf verspricht, nichts zu verändern
  if (parsed.mode === 'fenster') return deps.openWindow ? deps.openWindow(core) : 0;
  return runInTerminal(core, test, io);
}
