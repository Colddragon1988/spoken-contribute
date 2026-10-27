// WoW-Ordner erkennen und suchen (Spezifikation §6.2) – nur in Temp-Ordnern und mit
// vorgetäuschtem Runner (Registry), nie an den echten Installationsorten.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import { createWowLocator } from '../../../src/core/platform';
import {
  findWow, isWowRoot, normalizePath, parentsOf, winePrefixes, wowCandidates, wowRoot,
} from '../../../src/core/platform/wowfind';
import type { Platform, ProcessResult, ProcessRunner } from '../../../src/shared/types';
import { currentPlatform, useSandbox } from '../../helpers/sandbox';

const platform: Platform = currentPlatform();

function fakeRunner(answer: ProcessResult = { ok: false, stdout: '' }): { runner: ProcessRunner; calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    runner: {
      run(command, args) {
        calls.push([command, ...args]);
        return Promise.resolve(answer);
      },
    },
  };
}

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'spoken-wowfind-'));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** Versionsordner anlegen; spoken = mit Interface/AddOns/Spoken, sonst nur WTF. */
async function flavor(wow: string, name = '_classic_era_', spoken = true): Promise<string> {
  const dir = join(wow, name);
  await mkdir(join(dir, 'WTF'), { recursive: true });
  if (spoken) await mkdir(join(dir, 'Interface', 'AddOns', 'Spoken'), { recursive: true });
  return dir;
}

describe('WowFolder', () => {
  it('test_wow_root_from_inside_and_above', async () => {
    const sandbox = await useSandbox();
    const dir = await sandbox.flavor();
    expect(await sandbox.env.wow.wowRoot(join(dir, 'Interface', 'AddOns'))).toBe(sandbox.wow);
    expect(await sandbox.env.wow.wowRoot(join(sandbox.wow, '..'))).toBe(sandbox.wow);
    expect(await sandbox.env.wow.wowRoot(join(sandbox.root, 'leer'))).toBeNull();
  });

  it('test_wow_root_from_inside_and_above (direkt, ohne createCore)', async () => {
    const tmp = await tempDir();
    const wow = join(tmp, 'World of Warcraft');
    const dir = await flavor(wow);
    const locator = createWowLocator({ platform, env: {}, home: tmp, runner: fakeRunner().runner });
    expect(await locator.wowRoot(join(dir, 'Interface', 'AddOns'))).toBe(wow);
    expect(await locator.wowRoot(tmp)).toBe(wow);
    expect(await locator.wowRoot(join(tmp, 'leer'))).toBeNull();
  });
});

describe('isWowRoot', () => {
  it('erkennt Versionsordner an WTF, Interface oder .flavor.info', async () => {
    for (const marker of ['WTF', 'Interface', '.flavor.info']) {
      const wow = await tempDir();
      await mkdir(join(wow, '_ptr_'));
      expect(await isWowRoot(wow, platform)).toBe(false);
      await (marker === '.flavor.info' ? writeFile(join(wow, '_ptr_', marker), '') : mkdir(join(wow, '_ptr_', marker)));
      expect(await isWowRoot(wow, platform), marker).toBe(true);
    }
  });

  it('Dateien und andere Ordner zählen nicht', async () => {
    const wow = await tempDir();
    await writeFile(join(wow, '_datei_'), '');
    await mkdir(join(wow, 'WTF'));
    await mkdir(join(wow, '_'), { recursive: true });
    await mkdir(join(wow, 'x_classic_', 'WTF'), { recursive: true });
    expect(await isWowRoot(wow, platform)).toBe(false);
  });

  it('fehlende Pfade und Dateien ergeben false statt eines Fehlers', async () => {
    const tmp = await tempDir();
    await writeFile(join(tmp, 'datei'), '');
    expect(await isWowRoot(join(tmp, 'fehlt'), platform)).toBe(false);
    expect(await isWowRoot(join(tmp, 'datei'), platform)).toBe(false);
    expect(await isWowRoot(join(tmp, 'datei', 'darunter'), platform)).toBe(false);
  });
});

describe('wowRoot', () => {
  it('nimmt den Unterordner „World of Warcraft“ und liefert den normalisierten Pfad', async () => {
    const tmp = await tempDir();
    const wow = join(tmp, 'World of Warcraft');
    await flavor(wow, '_forever_', false);
    expect(await wowRoot(tmp, platform)).toBe(wow);
    expect(await wowRoot(`${wow}${platform === 'win32' ? '\\' : '/'}`, platform)).toBe(wow);
    expect(await wowRoot(join(wow, '_forever_', 'WTF', 'Account'), platform)).toBe(wow);
  });
});

describe('Pfade wie Pythons Path', () => {
  it('normalizePath', () => {
    expect(normalizePath('', 'linux')).toBe('.');
    expect(normalizePath('/a//b/./c/', 'linux')).toBe('/a/b/c');
    expect(normalizePath('a/../b', 'linux')).toBe('a/../b');
    expect(normalizePath('C:/Spiele//World of Warcraft\\', 'win32')).toBe('C:\\Spiele\\World of Warcraft');
  });

  it('parentsOf', () => {
    expect(parentsOf('/a/b/c', 'linux')).toEqual(['/a/b', '/a', '/']);
    expect(parentsOf('a/b', 'linux')).toEqual(['a', '.']);
    expect(parentsOf('/', 'linux')).toEqual([]);
    expect(parentsOf('C:\\x\\_retail_\\', 'win32')).toEqual(['C:\\x', 'C:\\']);
  });

  it('Netzlaufwerk (UNC): die Freigabe ist die Wurzel und endet wie bei Python auf \\', () => {
    expect(normalizePath('\\\\nas\\spiele', 'win32')).toBe('\\\\nas\\spiele\\');
    expect(normalizePath('//nas/spiele/World of Warcraft/', 'win32')).toBe('\\\\nas\\spiele\\World of Warcraft');
    expect(parentsOf('\\\\nas\\spiele\\World of Warcraft\\_retail_', 'win32'))
      .toEqual(['\\\\nas\\spiele\\World of Warcraft', '\\\\nas\\spiele\\']);
  });
});

describe('Kandidaten (findWow)', () => {
  it('Linux: Wine-Präfixe in Reihenfolge, WINEPREFIX zuerst, ohne Doppelte', async () => {
    const home = await tempDir();
    const dirs = [
      'eigen', 'Games/b', 'Games/a', '.wine', '.local/share/wineprefixes/wp',
      '.local/share/lutris/prefixes/lp', '.local/share/bottles/bottles/bb',
      '.var/app/com.usebottles.bottles/data/bottles/bottles/fb',
      '.steam/steam/steamapps/compatdata/123/pfx', '.steam/steam/steamapps/compatdata/123 4/pfx',
      '.steam/steam/steamapps/compatdata/99', // ohne pfx: kein Präfix
      '.local/share/Steam/steamapps/compatdata/7/pfx',
      '.var/app/com.valvesoftware.Steam/.local/share/Steam/steamapps/compatdata/8/pfx',
    ];
    for (const dir of dirs) await mkdir(join(home, ...dir.split('/')), { recursive: true });
    await writeFile(join(home, 'Games', 'notiz.txt'), ''); // pathlib-glob nimmt auch Dateien mit

    const deps = { platform: 'linux' as const, env: { WINEPREFIX: `${home}/.wine/` }, home, runner: fakeRunner().runner };
    const expected = [
      '.wine', 'Games/a', 'Games/b', 'Games/notiz.txt', '.local/share/wineprefixes/wp',
      '.local/share/lutris/prefixes/lp', '.local/share/bottles/bottles/bb',
      '.var/app/com.usebottles.bottles/data/bottles/bottles/fb',
      // Bestandteil für Bestandteil sortiert wie Python: "123" vor "123 4"
      '.steam/steam/steamapps/compatdata/123/pfx', '.steam/steam/steamapps/compatdata/123 4/pfx',
      '.local/share/Steam/steamapps/compatdata/7/pfx',
      '.var/app/com.valvesoftware.Steam/.local/share/Steam/steamapps/compatdata/8/pfx',
    ].map((rel) => `${normalizePath(home, 'linux')}/${rel}`);
    expect(await winePrefixes(deps)).toEqual(expected);
    expect(await wowCandidates(deps)).toEqual(expected.flatMap((prefix) => [
      `${prefix}/drive_c/Program Files (x86)/World of Warcraft`,
      `${prefix}/drive_c/Program Files/World of Warcraft`,
    ]));
  });

  it('Linux: ohne Präfixe keine Kandidaten', async () => {
    const home = await tempDir();
    expect(await wowCandidates({ platform: 'linux', env: {}, home, runner: fakeRunner().runner })).toEqual([]);
  });

  it('Windows: Registry zuerst, dann die vorhandenen Laufwerke', async () => {
    const regOutput = '\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Blizzard Entertainment\\World of Warcraft\r\n' +
      '    InstallPath    REG_SZ    C:\\Program Files (x86)\\World of Warcraft\\_retail_\\\r\n' +
      '    GamePath    REG_SZ    C:\\Program Files (x86)\\World of Warcraft\\_retail_\\Wow.exe\r\n\r\n';
    const { runner, calls } = fakeRunner({ ok: true, stdout: regOutput });
    const drives: string[] = [];
    const candidates = await wowCandidates({
      platform: 'win32', env: {}, home: 'C:\\Users\\Erfunden', runner,
      driveExists: (drive) => { drives.push(drive); return Promise.resolve(drive === 'C:\\' || drive === 'E:\\'); },
    });
    expect(calls).toEqual([['reg', 'query', 'HKLM\\SOFTWARE\\WOW6432Node\\Blizzard Entertainment\\World of Warcraft',
      '/v', 'InstallPath']]);
    expect(drives).toEqual(['C:\\', 'D:\\', 'E:\\', 'F:\\', 'G:\\', 'H:\\', 'I:\\', 'J:\\']);
    expect(candidates).toEqual([
      'C:\\Program Files (x86)\\World of Warcraft\\_retail_\\',
      'C:\\Program Files (x86)\\World of Warcraft', 'C:\\Program Files\\World of Warcraft',
      'C:\\Games\\World of Warcraft', 'C:\\Spiele\\World of Warcraft', 'C:\\World of Warcraft',
      'E:\\Program Files (x86)\\World of Warcraft', 'E:\\Program Files\\World of Warcraft',
      'E:\\Games\\World of Warcraft', 'E:\\Spiele\\World of Warcraft', 'E:\\World of Warcraft',
    ]);
  });

  it('Windows: ohne Registry-Eintrag nur die Laufwerke', async () => {
    const candidates = await wowCandidates({
      platform: 'win32', env: {}, home: 'C:\\Users\\Erfunden', runner: fakeRunner().runner,
      driveExists: (drive) => Promise.resolve(drive === 'D:\\'),
    });
    expect(candidates[0]).toBe('D:\\Program Files (x86)\\World of Warcraft');
    expect(candidates).toHaveLength(5);
  });

  it('macOS: /Applications und ~/Applications', async () => {
    const { runner, calls } = fakeRunner();
    expect(await wowCandidates({ platform: 'darwin', env: {}, home: '/Users/erfunden', runner })).toEqual([
      '/Applications/World of Warcraft', '/Users/erfunden/Applications/World of Warcraft',
    ]);
    expect(calls).toEqual([]);
  });
});

// Die Suche selbst nur unter Linux-Pfadregeln: Temp-Ordner sind POSIX-Pfade.
describe.runIf(platform === 'linux')('findWow (Linux, Temp-Home)', () => {
  const wowIn = (home: string, prefix: string, programFiles = 'Program Files (x86)'): string =>
    join(home, ...prefix.split('/'), 'drive_c', programFiles, 'World of Warcraft');

  it('eine Installation mit Spoken hat Vorrang', async () => {
    const home = await tempDir();
    await flavor(wowIn(home, 'Games/a'), '_classic_era_', false);
    const withSpoken = wowIn(home, '.local/share/lutris/prefixes/lp', 'Program Files');
    await flavor(withSpoken, '_forever_', true);
    expect(await findWow({ platform: 'linux', env: {}, home, runner: fakeRunner().runner })).toBe(withSpoken);
  });

  it('ohne Spoken der erste Fund, ohne WoW null', async () => {
    const home = await tempDir();
    const deps = { platform: 'linux' as const, env: {}, home, runner: fakeRunner().runner };
    expect(await findWow(deps)).toBeNull();
    const first = wowIn(home, 'Games/a');
    await flavor(first, '_classic_', false);
    await flavor(wowIn(home, 'Games/b'), '_classic_', false);
    expect(await findWow(deps)).toBe(first);
  });

  it('WINEPREFIX wird zuerst durchsucht', async () => {
    const home = await tempDir();
    const own = join(home, 'eigenes präfix');
    await flavor(wowIn(home, 'Games/a'), '_classic_', true);
    await flavor(join(own, 'drive_c', 'Program Files (x86)', 'World of Warcraft'), '_classic_', true);
    expect(await findWow({ platform: 'linux', env: { WINEPREFIX: own }, home, runner: fakeRunner().runner }))
      .toBe(join(own, 'drive_c', 'Program Files (x86)', 'World of Warcraft'));
  });
});
