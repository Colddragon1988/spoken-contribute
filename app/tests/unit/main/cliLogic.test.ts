// runCli gegen einen kleinen Fake-Kern: Reihenfolge, Exit-Codes und Fehlertexte ohne die anderen Pakete.
import { describe, expect, it, vi } from 'vitest';
import { interpretArgs, runCli, type CliIo } from '../../../src/main/cli';
import type { Core, Credentials, Report, RunOptions, Settings } from '../../../src/shared/types';

// Berichtstext laut Spezifikation §2.2 Schritt 7 – unabhängig vom Stand von Paket (c).
vi.mock('../../../src/core/upload', () => ({
  reportText: (report: Report) => [report.head, ...report.sections].join('\n\n'),
}));

interface FakeCore {
  readonly core: Core;
  readonly calls: string[];
}

function fakeCore(options: {
  wowDir?: string; report?: Report; migrateFails?: boolean; moveFails?: boolean;
} = {}): FakeCore {
  const calls: string[] = [];
  const settings: Settings = { wowDir: options.wowDir ?? '', autoUpload: false, theme: 'system' };
  const credentials: Credentials = { email: 'a@b.c', password: 'geheim' };
  const core = {
    history: {
      migrateOldArchive: () => {
        calls.push('migrate');
        return options.migrateFails ? Promise.reject(new Error('kaputt')) : Promise.resolve();
      },
    },
    login: {
      movePasswordToKeyring: () => {
        calls.push('move');
        return options.moveFails ? Promise.reject(new Error('gesperrt')) : Promise.resolve();
      },
      credentials: () => { calls.push('credentials'); return Promise.resolve(credentials); },
    },
    settings: {
      load: (opts: { persistFound: boolean }) => {
        calls.push(`load persistFound=${String(opts.persistFound)}`);
        return Promise.resolve(settings);
      },
    },
    uploader: {
      run: (wow: string, creds: Credentials | null, run: RunOptions) => {
        calls.push(`run ${wow} test=${String(run.test)} pw=${String(creds?.password === 'geheim')}`);
        run.log('Zeile 1');
        run.log('Zeile 2');
        return Promise.resolve(options.report ?? { head: 'Kopf', sections: ['A', 'B'], failed: false });
      },
    },
  } as unknown as Core;
  return { core, calls };
}

function capture(): CliIo & { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, out: (t) => { stdout.push(t); }, err: (t) => { stderr.push(t); } };
}

describe('interpretArgs', () => {
  it('wie main.py', () => {
    expect(interpretArgs([])).toEqual({ kind: 'mode', mode: 'fenster' });
    expect(interpretArgs(['--test'])).toEqual({ kind: 'mode', mode: 'test' });
    expect(interpretArgs(['--ohne-fenster', '--ohne-fenster'])).toEqual({ kind: 'mode', mode: 'ohne-fenster' });
    expect(interpretArgs(['--ohne-fenster', '--test'])).toEqual({ kind: 'mode', mode: 'test' });
    expect(interpretArgs(['-h'])).toEqual({ kind: 'usage', exitCode: 0 });
    expect(interpretArgs(['--TEST'])).toEqual({ kind: 'usage', exitCode: 2 });
  });
});

describe('runCli mit Fake-Kern', () => {
  it('--test: keine Altlasten, Einstellungen ohne Speichern, Ausgabe zeilenweise', async () => {
    const { core, calls } = fakeCore({ wowDir: '/wow' });
    const io = capture();
    expect(await runCli(['--test'], { core: () => core }, io)).toBe(0);
    expect(calls).toEqual(['load persistFound=false', 'credentials', 'run /wow test=true pw=true']);
    expect(io.stdout).toEqual(['Zeile 1\n', 'Zeile 2\n', 'Kopf\n\nA\n\nB\n']);
  });

  it('--ohne-fenster: erst Altlasten, dann speichernd laden', async () => {
    const { core, calls } = fakeCore({ wowDir: '/wow' });
    expect(await runCli(['--ohne-fenster'], { core: () => core }, capture())).toBe(0);
    expect(calls).toEqual(['migrate', 'move', 'load persistFound=true', 'credentials', 'run /wow test=false pw=true']);
  });

  it('failed → Exit 1', async () => {
    const { core } = fakeCore({ wowDir: '/wow', report: { head: 'Nicht alles hat geklappt.', sections: [], failed: true } });
    expect(await runCli(['--ohne-fenster'], { core: () => core }, capture())).toBe(1);
  });

  it('Fehler beim Aufräumen gehen auf stderr, der Lauf geht weiter', async () => {
    const { core, calls } = fakeCore({ wowDir: '/wow', migrateFails: true, moveFails: true });
    const io = capture();
    expect(await runCli(['--ohne-fenster'], { core: () => core }, io)).toBe(0);
    expect(io.stderr).toEqual([
      'Altes Archiv nicht übernommen: kaputt\n',
      'Passwort nicht in den Schlüsselbund umgezogen: gesperrt\n',
    ]);
    expect(calls).toContain('run /wow test=false pw=true');
  });

  it('Fenster: Altlasten, dann openWindow mit dessen Exit-Code', async () => {
    const { core, calls } = fakeCore();
    const openWindow = vi.fn(() => Promise.resolve(0));
    expect(await runCli([], { core: () => core, openWindow }, capture())).toBe(0);
    expect(calls).toEqual(['migrate', 'move']);
    expect(openWindow).toHaveBeenCalledWith(core);
  });
});
