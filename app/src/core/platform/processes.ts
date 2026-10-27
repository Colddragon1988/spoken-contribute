// Hilfsprogramme starten und die laufenden Prozesse auflisten (Spezifikation §6.4).
import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Platform, ProcessResult, ProcessRunner, ProcessSource } from '../../shared/types';

/** Prozessliste: wie Python höchstens 30 s warten. */
export const PROCESS_LIST_TIMEOUT_MS = 30_000;
/** Großzügig: eine Prozessliste mit langen Pfaden darf nicht am Puffer scheitern. */
const MAX_BUFFER = 64 * 1024 * 1024;

// errors="replace" wie in Python: PowerShell gibt Pfade mit Umlauten womöglich in der
// Konsolen-Codepage aus – das darf nicht zum Absturz führen.
const decoder = new TextDecoder('utf-8', { fatal: false });

function decode(data: unknown): string {
  if (typeof data === 'string') return data;
  return data instanceof Uint8Array ? decoder.decode(data) : '';
}

/**
 * Startet Programme ohne Shell (keine Deutung von Argumenten) und unter Windows ohne
 * aufblitzendes Konsolenfenster. Wirft nie.
 * - Programm fehlt, Zeitüberschreitung, zu viel Ausgabe → { ok: false, stdout: '' }.
 * - Endet es mit Fehlercode, ist ok false, die Ausgabe bleibt aber erhalten: Python wertet
 *   stdout unabhängig vom Exit-Code aus (z. B. `defaults read` bei hellem Design).
 */
export function createProcessRunner(): ProcessRunner {
  return {
    run(command, args, options) {
      return new Promise<ProcessResult>((resolve) => {
        try {
          execFile(command, [...args], {
            shell: false,
            windowsHide: true,
            timeout: options.timeoutMs,
            maxBuffer: MAX_BUFFER,
            encoding: 'buffer',
          }, (error, stdout) => {
            if (!error) {
              resolve({ ok: true, stdout: decode(stdout) });
              return;
            }
            // Nur ein regulär beendetes Programm (Zahl als Exit-Code, nicht abgebrochen) liefert Ausgabe.
            const exited = typeof (error as { code?: unknown }).code === 'number' && !error.killed;
            resolve({ ok: false, stdout: exited ? decode(stdout) : '' });
          });
        } catch {
          resolve({ ok: false, stdout: '' });
        }
      });
    },
  };
}

/** Die nicht leeren, getrimmten Ausgabezeilen (wie Pythons _output). */
export function outputLines(stdout: string): string[] {
  return stdout.split(/\r\n|\r|\n/u).map((line) => line.trim()).filter((line) => line !== '');
}

/** Programmpfade aus /proc/<pid>/cmdline: je Prozess das erste NUL-getrennte Argument.
 *  Unter Wine steht dort der Windows-Pfad (Z:\home\…\_forever_\Wow.exe). */
export async function readProcPrograms(procRoot: string): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(procRoot);
  } catch {
    return [];
  }
  const pids = names.filter((name) => /^[0-9]/u.test(name)); // wie glob "[0-9]*"
  const programs = await Promise.all(pids.map(async (pid) => {
    try {
      const body = await readFile(join(procRoot, pid, 'cmdline'));
      const end = body.indexOf(0);
      return decoder.decode(end === -1 ? body : body.subarray(0, end)).trim();
    } catch {
      return ''; // inzwischen beendet
    }
  }));
  return programs.filter((program) => program !== '');
}

const WINDOWS_PROCESS_LIST =
  'Get-CimInstance Win32_Process | ForEach-Object ' +
  '{ if ($_.ExecutablePath) { $_.ExecutablePath } else { $_.Name } }';

/**
 * Programmpfade aller laufenden Prozesse – nur das Programm, nicht seine Argumente: WoW
 * startet z. B. mit -launcherlogin, und ein Editor kann „Wow.exe“ in seiner Zeile haben.
 * procRoot ist nur für Tests austauschbar (Linux).
 */
export function createProcessSource(
  platform: Platform, runner: ProcessRunner, options: { readonly procRoot?: string } = {},
): ProcessSource {
  const fromCommand = async (command: string, args: readonly string[]): Promise<string[]> => {
    try {
      const result = await runner.run(command, args, { timeoutMs: PROCESS_LIST_TIMEOUT_MS });
      return outputLines(result.stdout);
    } catch {
      return [];
    }
  };
  return {
    listPrograms() {
      if (platform === 'win32') {
        return fromCommand('powershell', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_PROCESS_LIST]);
      }
      if (platform === 'darwin') return fromCommand('ps', ['-axo', 'comm=']);
      return readProcPrograms(options.procRoot ?? '/proc');
    },
  };
}
