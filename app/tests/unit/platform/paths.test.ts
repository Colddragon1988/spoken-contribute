// Konfig-/Datenordner (Spezifikation §6.1) und Electrons userData (Entscheidung 16) –
// nur mit erfundenen Umgebungen, nie mit dem echten Home.
import { describe, expect, it } from 'vitest';
import { defaultPaths, userDataDir } from '../../../src/core/platform';

const LINUX_HOME = '/home/erfunden';
const MAC_HOME = '/Users/erfunden';
const WIN_HOME = 'C:\\Users\\Erfunden';

describe('defaultPaths', () => {
  it('Linux mit XDG-Variablen', () => {
    expect(defaultPaths('linux', { XDG_CONFIG_HOME: '/x/konfig', XDG_DATA_HOME: '/x/daten' }, LINUX_HOME)).toEqual({
      configDir: '/x/konfig/spoken-contribute',
      dataDir: '/x/daten/spoken-contribute',
      home: LINUX_HOME,
    });
  });

  it('Linux ohne (oder mit leeren) XDG-Variablen', () => {
    const expected = {
      configDir: '/home/erfunden/.config/spoken-contribute',
      dataDir: '/home/erfunden/.local/share/spoken-contribute',
      home: LINUX_HOME,
    };
    expect(defaultPaths('linux', {}, LINUX_HOME)).toEqual(expected);
    expect(defaultPaths('linux', { XDG_CONFIG_HOME: '', XDG_DATA_HOME: '' }, LINUX_HOME)).toEqual(expected);
  });

  it('macOS: beides im selben Ordner, Umgebung egal', () => {
    const paths = defaultPaths('darwin', { XDG_CONFIG_HOME: '/x', APPDATA: '/y' }, MAC_HOME);
    expect(paths.configDir).toBe('/Users/erfunden/Library/Application Support/spoken-contribute');
    expect(paths.dataDir).toBe(paths.configDir);
  });

  it('Windows mit APPDATA/LOCALAPPDATA', () => {
    expect(defaultPaths('win32', { APPDATA: 'D:\\Profil\\Roaming', LOCALAPPDATA: 'D:\\Profil\\Local' }, WIN_HOME)).toEqual({
      configDir: 'D:\\Profil\\Roaming\\spoken-contribute',
      dataDir: 'D:\\Profil\\Local\\spoken-contribute',
      home: WIN_HOME,
    });
  });

  it('Windows ohne Variablen fällt auf das Home zurück', () => {
    const paths = defaultPaths('win32', { APPDATA: '' }, WIN_HOME);
    expect(paths.configDir).toBe('C:\\Users\\Erfunden\\AppData\\Roaming\\spoken-contribute');
    expect(paths.dataDir).toBe('C:\\Users\\Erfunden\\AppData\\Local\\spoken-contribute');
  });
});

describe('userDataDir (Entscheidung 16)', () => {
  it('eigener Ordner neben dem Konfig-Ordner, nie dieser selbst', () => {
    const cases = [
      ['linux', {}, LINUX_HOME, '/home/erfunden/.config/spoken-upload-electron'],
      ['linux', { XDG_CONFIG_HOME: '/x/konfig' }, LINUX_HOME, '/x/konfig/spoken-upload-electron'],
      ['darwin', {}, MAC_HOME, '/Users/erfunden/Library/Application Support/spoken-upload-electron'],
      ['win32', {}, WIN_HOME, 'C:\\Users\\Erfunden\\AppData\\Roaming\\spoken-upload-electron'],
      ['win32', { APPDATA: 'D:\\R' }, WIN_HOME, 'D:\\R\\spoken-upload-electron'],
    ] as const;
    for (const [platform, env, home, expected] of cases) {
      const dir = userDataDir(platform, env, home);
      expect(dir).toBe(expected);
      const paths = defaultPaths(platform, env, home);
      expect(dir).not.toBe(paths.configDir);
      expect(dir).not.toBe(paths.dataDir);
      expect(dir.startsWith(paths.configDir)).toBe(false);
    }
  });
});
