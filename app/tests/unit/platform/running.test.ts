// Laufende WoW-Versionen aus Programmpfaden (Spezifikation §6.4).
import { describe, expect, it } from 'vitest';
import { runningFlavors } from '../../../src/core/platform';

describe('RunningGame', () => {
  it('test_paths_of_all_systems', () => {
    const cases: [string, Set<string> | null][] = [
      ['C:\\Program Files (x86)\\World of Warcraft\\_classic_era_\\WoWClassic.exe', new Set(['_classic_era_'])],
      ['Z:\\home\\x\\Games\\World of Warcraft\\_forever_\\Wow.exe', new Set(['_forever_'])],
      ['/Applications/World of Warcraft/_classic_era_/World of Warcraft Classic.app/Contents/MacOS/' +
        'World of Warcraft Classic', new Set(['_classic_era_'])],
      ['C:\\Program Files (x86)\\World of Warcraft\\_retail_\\WowVoiceProxy.exe', new Set()],
      ['/Applications/World of Warcraft/World of Warcraft Launcher.app/Contents/MacOS/' +
        'World of Warcraft Launcher', new Set()],
      ['/usr/bin/kate', new Set()],
      ['Wow.exe', null], // das Spiel läuft, aber der Ordner ist unbekannt
    ];
    for (const [program, expected] of cases) {
      expect(runningFlavors([program]), program).toEqual(expected);
    }
  });

  it('mehrere Clients ergeben die Menge ihrer Versionsordner, kleingeschrieben', () => {
    expect(runningFlavors([
      '/usr/bin/kate',
      'Z:\\Games\\World of Warcraft\\_Classic_Era_\\WowClassic.exe',
      'Z:\\Games\\World of Warcraft\\_forever_\\Wow.exe',
    ])).toEqual(new Set(['_classic_era_', '_forever_']));
  });

  it('der letzte Versionsordner im Pfad zählt', () => {
    expect(runningFlavors(['C:\\_backup_\\World of Warcraft\\_classic_\\Wow.exe'])).toEqual(new Set(['_classic_']));
  });

  it('ein Spiel ohne Versionsordner ergibt null, auch neben erkannten', () => {
    expect(runningFlavors(['Z:\\x\\_forever_\\Wow.exe', 'C:\\Spiele\\Wow.exe'])).toBeNull();
  });

  it('Launcher, Sprachchat und ähnliche Namen sind nicht das Spiel', () => {
    expect(runningFlavors([
      'C:\\World of Warcraft\\_retail_\\WowLauncher.exe',
      'C:\\World of Warcraft\\Battle.net.exe',
      'C:\\tools\\wowhead.exe.bak',
      '/home/x/notizen/Wow.exe.txt',
    ])).toEqual(new Set());
  });

  it('keine Prozesse ergeben eine leere Menge', () => {
    expect(runningFlavors([])).toEqual(new Set());
  });
});
