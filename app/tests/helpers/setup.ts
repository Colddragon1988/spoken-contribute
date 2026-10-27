import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Regel 1: Selbst ein versehentlicher Zugriff auf Standardpfade landet in einem Temp-Ordner.
const home = mkdtempSync(join(tmpdir(), 'spoken-home-'));
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.XDG_CONFIG_HOME = join(home, '.config');
process.env.XDG_DATA_HOME = join(home, '.local', 'share');
process.env.APPDATA = join(home, 'AppData', 'Roaming');
process.env.LOCALAPPDATA = join(home, 'AppData', 'Local');
delete process.env.WINEPREFIX;

// Regel 2: Netz nur zu 127.0.0.1/localhost.
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
    return Promise.reject(new Error(`Test wollte ins Netz: ${url.host}`));
  }
  return realFetch(input, init);
});

if (new Date(2026, 0, 15).getTimezoneOffset() !== -60) {
  throw new Error('Tests erwarten TZ=Europe/Berlin (vitest.config.ts).');
}
