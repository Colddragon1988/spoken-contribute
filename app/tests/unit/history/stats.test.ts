// Statistik, Statistik-Text (§7.4) und Tageswerte (§5.6).
import { describe, expect, it } from 'vitest';
import { daily, statistics, statisticsView } from '../../../src/core/history';
import type { HistoryEntry, JsonObject } from '../../../src/shared/types';

let counter = 0;
function entry(info: JsonObject, time: Date): HistoryEntry {
  counter += 1;
  return { id: `e${counter}`, folder: `/tmp/e${counter}`, info, time, failed: info.status !== 'ok' };
}

describe('statistics', () => {
  it('zählt ok-Einträge je Art und Version, Fehlschläge nur als failed', () => {
    const found = [
      entry({ art: 'zeilen', status: 'ok', versionen: ['Classic Era'], anzahl: 5, ergebnis: { neu: 2, bekannt: 3 } }, new Date(2026, 9, 3)),
      entry({ art: 'npc-texte', status: 'ok', versionen: ['WoW Forever', 'Classic Era'], anzahl: 7, ergebnis: { neu: 4, aktualisiert: 1 } }, new Date(2026, 9, 1)),
      entry({ art: 'zeilen', status: 'ok', anzahl: 1 }, new Date(2026, 9, 10)),
      entry({ art: 'zeilen', status: 'fehler', versionen: ['Classic'], anzahl: 99 }, new Date(2026, 9, 20)),
    ];
    const s = statistics(found);
    expect(s).toMatchObject({ uploads: 3, failed: 1, lines: 6, linesNew: 2, linesKnown: 3, texts: 7, textsNew: 4, textsChanged: 1 });
    expect(Object.fromEntries(s.perVersion)).toEqual({ 'Classic Era': [5, 7], 'WoW Forever': [0, 7], '?': [1, 0] });
    expect(s.first?.getDate()).toBe(1);
    expect(s.last?.getDate()).toBe(10);
  });

  it('Statistik-Text wörtlich, Versionen alphabetisch', () => {
    const found = [
      entry({ art: 'zeilen', status: 'ok', versionen: ['WoW Forever'], anzahl: 5, ergebnis: { neu: 2, bekannt: 3 } }, new Date(2026, 9, 3, 12)),
      entry({ art: 'npc-texte', status: 'ok', versionen: ['Classic Era'], anzahl: 7, ergebnis: { neu: 4, aktualisiert: 1 } }, new Date(2026, 8, 30, 12)),
      entry({ art: 'zeilen', status: 'fehler' }, new Date(2026, 9, 20)),
    ];
    expect(statisticsView(found, true)).toEqual({
      heading: 'Statistik (gefiltert)',
      lines: [
        '2 Uploads, 1 fehlgeschlagen – vom 30.09.2026 bis 03.10.2026',
        'Gesammelte Zeilen: 5 gesendet, 2 neu für das Projekt, 3 schon bekannt',
        'NPC-Texte: 7 gesendet, 4 neu, 1 aktualisiert',
        '    Classic Era: 0 Zeilen, 7 NPC-Texte',
        '    WoW Forever: 5 Zeilen, 0 NPC-Texte',
      ],
    });
  });

  it('ohne Uploads kein Zeitraum', () => {
    expect(statisticsView([], false)).toEqual({
      heading: 'Statistik',
      lines: [
        '0 Uploads',
        'Gesammelte Zeilen: 0 gesendet, 0 neu für das Projekt, 0 schon bekannt',
        'NPC-Texte: 0 gesendet, 0 neu, 0 aktualisiert',
      ],
    });
  });
});

describe('daily', () => {
  it('30 Kalendertage über die Zeitumstellung im Herbst, aufsteigend', () => {
    const now = new Date(2026, 10, 10, 0, 30); // 10.11.2026, kurz nach Mitternacht
    const found = [
      entry({ art: 'zeilen', status: 'ok', anzahl: 2 }, new Date(2026, 9, 25, 2, 30)), // Tag der Umstellung
      entry({ art: 'zeilen', status: 'ok', anzahl: 3 }, new Date(2026, 9, 25, 23, 59)),
      entry({ art: 'npc-texte', status: 'ok', anzahl: 4 }, new Date(2026, 9, 26, 0, 0)),
      entry({ art: 'zeilen', status: 'ok', anzahl: 5 }, new Date(2026, 9, 11, 23, 0)), // zu alt
      entry({ art: 'zeilen', status: 'fehler', anzahl: 6 }, new Date(2026, 10, 10, 0, 10)),
      entry({ art: 'zeilen', status: 'ok', anzahl: 1 }, new Date(2026, 10, 10, 0, 10)),
    ];
    const days = daily(found, now, 30);
    expect(days).toHaveLength(30);
    expect(days[0]?.day).toBe('2026-10-12');
    expect(days.at(-1)).toEqual({ day: '2026-11-10', lines: 1, texts: 0 });
    expect(new Set(days.map((d) => d.day)).size).toBe(30);
    expect(days.find((d) => d.day === '2026-10-25')).toEqual({ day: '2026-10-25', lines: 5, texts: 0 });
    expect(days.find((d) => d.day === '2026-10-26')).toEqual({ day: '2026-10-26', lines: 0, texts: 4 });
    expect(days.reduce((s, d) => s + d.lines, 0)).toBe(6);
  });

  it('über die Zeitumstellung im Frühjahr', () => {
    const days = daily([], new Date(2026, 2, 30, 23, 59), 3);
    expect(days.map((d) => d.day)).toEqual(['2026-03-28', '2026-03-29', '2026-03-30']);
  });
});
