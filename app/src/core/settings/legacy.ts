/**
 * Einmalige Übernahme des Passworts aus dem Schlüsselbund der Python-Fassung (Phase 6).
 *
 * Die Python-Fassung legt das Passwort über das Paket „keyring“ ab: Dienst „spoken-contribute“,
 * Konto = E-Mail aus login.json (unter KDE in KWallet, Ordner „spoken-contribute“). Electron kann diesen
 * Eintrag nicht selbst lesen; deshalb fragt die App einmal über python3/keyring bzw. kwallet-query oder
 * secret-tool nach und speichert das Passwort dann über saveLogin (safeStorage, sonst login.json).
 *
 * Der alte Eintrag bleibt stehen, damit die Python-Fassung weiter läuft. Das Passwort wird nie
 * ausgegeben oder geloggt; es steht nur in der Ausgabe des Hilfsprogramms (Pipe, im Speicher).
 */
import type { LoginStore, Platform, ProcessRunner, SecretStore } from '../../shared/types';

/** Dienstname der Python-Fassung im Schlüsselbund. */
export const LEGACY_SERVICE = 'spoken-contribute';

/** Liest das alte Passwort; null = nicht gefunden oder kein Weg funktioniert. */
export type LegacyReader = (email: string) => Promise<string | null>;

export type LegacyResult = 'uebernommen' | 'nicht-noetig' | 'fehlgeschlagen';

// Gibt das Passwort ohne Zeilenende aus; das Konto kommt als Argument, nie im Programmtext.
const PYTHON_SCRIPT =
  'import sys, keyring\n' +
  `p = keyring.get_password(${JSON.stringify(LEGACY_SERVICE)}, sys.argv[1])\n` +
  "sys.stdout.write(p or '')\n";

/** Zeit für eine Entsperr-Abfrage des Schlüsselbunds. */
const TIMEOUT_MS = 60_000;

/** Wege zum alten Eintrag, in dieser Reihenfolge; trimEnd = Zeilenende der Ausgabe abschneiden. */
function legacyCommands(platform: Platform, email: string): { command: string; args: string[]; trimEnd: boolean }[] {
  const pythons = platform === 'win32' ? ['py', 'python'] : ['python3'];
  const commands = pythons.map((command) => ({
    command,
    args: [...(command === 'py' ? ['-3'] : []), '-I', '-c', PYTHON_SCRIPT, email],
    trimEnd: false,
  }));
  if (platform === 'linux') {
    commands.push(
      { command: 'kwallet-query', args: ['-r', email, '-f', LEGACY_SERVICE, 'kdewallet'], trimEnd: true },
      { command: 'secret-tool', args: ['lookup', 'service', LEGACY_SERVICE, 'username', email], trimEnd: false },
    );
  }
  return commands;
}

export function createLegacyReader(platform: Platform, runner: ProcessRunner): LegacyReader {
  return async (email) => {
    for (const { command, args, trimEnd } of legacyCommands(platform, email)) {
      const result = await runner.run(command, args, { timeoutMs: TIMEOUT_MS });
      if (!result.ok) continue;
      const password = trimEnd ? result.stdout.replace(/\r?\n$/u, '') : result.stdout;
      if (password) return password;
    }
    return null;
  };
}

/**
 * Passwort übernehmen, wenn man angemeldet ist, login.json kein Passwort enthält und der neue Speicher
 * für dieses Konto noch keines hat. Danach wird durch Wieder-Auslesen geprüft.
 */
export async function importLegacyPassword(deps: {
  readonly login: LoginStore;
  readonly secrets: SecretStore;
  readonly readLegacy: LegacyReader;
}): Promise<LegacyResult> {
  const email = await deps.login.account();
  if (email === null || !(await deps.login.passwordInKeyring())) return 'nicht-noetig';
  try {
    if (deps.secrets.available() && (await deps.secrets.get(email)) !== null) return 'nicht-noetig';
  } catch {
    return 'fehlgeschlagen'; // vorhanden, aber gesperrt: nichts überschreiben
  }
  const password = await deps.readLegacy(email);
  if (password === null) return 'fehlgeschlagen';
  await deps.login.saveLogin(email, password);
  const check = await deps.login.credentials();
  return check?.email === email && check.password === password ? 'uebernommen' : 'fehlgeschlagen';
}
