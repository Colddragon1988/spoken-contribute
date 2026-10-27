import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished } from 'vitest';

export const POSIX = process.platform !== 'win32';

/** Leerer Temp-Ordner für einen Test; der Konfig-Ordner liegt darunter und existiert noch nicht. */
export async function tempConfigDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'spoken-settings-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  return join(root, 'config');
}

/** Zugriffsrechte (nur die unteren 9 Bit). */
export async function mode(path: string): Promise<number> {
  return (await stat(path)).mode & 0o777;
}
