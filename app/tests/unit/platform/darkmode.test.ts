// Dunkelmodus-Abfrage (Spezifikation §6.5, Entscheidung 17) – nur mit vorgetäuschtem Runner.
import { describe, expect, it } from 'vitest';
import { createDarkModeProbe } from '../../../src/core/platform';
import type { ProcessResult, ProcessRunner } from '../../../src/shared/types';

/** Antwortet je Programm; unbekannte Programme gelten als nicht vorhanden. */
function scripted(answers: Record<string, ProcessResult>): { runner: ProcessRunner; calls: string[][]; timeouts: number[] } {
  const calls: string[][] = [];
  const timeouts: number[] = [];
  return {
    calls,
    timeouts,
    runner: {
      run(command, args, options) {
        calls.push([command, ...args]);
        timeouts.push(options.timeoutMs);
        return Promise.resolve(answers[command] ?? { ok: false, stdout: '' });
      },
    },
  };
}

describe('DarkModeProbe Linux', () => {
  it('Portal uint32 1 ist dunkel', async () => {
    const { runner, calls, timeouts } = scripted({ gdbus: { ok: true, stdout: '(<<uint32 1>>,)\n' } });
    expect(await createDarkModeProbe('linux', runner).prefersDark()).toBe(true);
    expect(calls).toEqual([[
      'gdbus', 'call', '--session', '--dest', 'org.freedesktop.portal.Desktop',
      '--object-path', '/org/freedesktop/portal/desktop',
      '--method', 'org.freedesktop.portal.Settings.Read',
      'org.freedesktop.appearance', 'color-scheme',
    ]]);
    expect(timeouts).toEqual([3000]);
  });

  it('Portal mit anderem Wert ist hell, gsettings wird dann nicht gefragt', async () => {
    const { runner, calls } = scripted({
      gdbus: { ok: true, stdout: '(<<uint32 2>>,)\n' },
      gsettings: { ok: true, stdout: "'prefer-dark'\n" },
    });
    expect(await createDarkModeProbe('linux', runner).prefersDark()).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('ohne Portal entscheidet gsettings', async () => {
    const dark = scripted({ gsettings: { ok: true, stdout: "'prefer-dark'\n" } });
    expect(await createDarkModeProbe('linux', dark.runner).prefersDark()).toBe(true);
    expect(dark.calls[1]).toEqual(['gsettings', 'get', 'org.gnome.desktop.interface', 'color-scheme']);
    const light = scripted({ gsettings: { ok: true, stdout: "'default'\n" } });
    expect(await createDarkModeProbe('linux', light.runner).prefersDark()).toBe(false);
  });

  it('keine Antwort ergibt null', async () => {
    expect(await createDarkModeProbe('linux', scripted({}).runner).prefersDark()).toBeNull();
    const blank = scripted({ gdbus: { ok: false, stdout: '\n  \n' }, gsettings: { ok: true, stdout: '' } });
    expect(await createDarkModeProbe('linux', blank.runner).prefersDark()).toBeNull();
  });

  it('ein werfender Runner ergibt null statt eines Fehlers', async () => {
    const runner: ProcessRunner = { run: () => Promise.reject(new Error('kaputt')) };
    expect(await createDarkModeProbe('linux', runner).prefersDark()).toBeNull();
  });
});

describe('DarkModeProbe macOS', () => {
  it('genau „Dark“ ist dunkel, sonst hell', async () => {
    const dark = scripted({ defaults: { ok: true, stdout: 'Dark\n' } });
    expect(await createDarkModeProbe('darwin', dark.runner).prefersDark()).toBe(true);
    expect(dark.calls).toEqual([['defaults', 'read', '-g', 'AppleInterfaceStyle']]);
    // helles Design: Schlüssel fehlt, defaults endet mit Fehler und ohne Ausgabe
    expect(await createDarkModeProbe('darwin', scripted({}).runner).prefersDark()).toBe(false);
    expect(await createDarkModeProbe('darwin', scripted({ defaults: { ok: true, stdout: 'Light\n' } }).runner)
      .prefersDark()).toBe(false);
  });
});

describe('DarkModeProbe Windows', () => {
  const output = (value: string): ProcessResult => ({
    ok: true,
    stdout: '\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize\r\n' +
      `    AppsUseLightTheme    REG_DWORD    ${value}\r\n\r\n`,
  });

  it('AppsUseLightTheme 0x0 ist dunkel, 0x1 hell', async () => {
    const dark = scripted({ reg: output('0x0') });
    expect(await createDarkModeProbe('win32', dark.runner).prefersDark()).toBe(true);
    expect(dark.calls).toEqual([['reg', 'query',
      'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', '/v', 'AppsUseLightTheme']]);
    expect(await createDarkModeProbe('win32', scripted({ reg: output('0x1') }).runner).prefersDark()).toBe(false);
  });

  it('ohne Wert null', async () => {
    expect(await createDarkModeProbe('win32', scripted({}).runner).prefersDark()).toBeNull();
  });
});
