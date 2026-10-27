// Reine Funktionen der Planung und Auswertung (§2.3).
import { describe, expect, it } from 'vitest';
import {
  batchNotes, count, planBatch, pyRepr, refusedCount, resultLine, shortTitles, summedResult,
} from '../../../src/core/upload/plan';
import type { ContributionStore, Flavor } from '../../../src/shared/types';

const era: Flavor = { dir: '/w/_classic_era_', folder: '_classic_era_', name: 'Classic Era' };
const forever: Flavor = { dir: '/w/_forever_', folder: '_forever_', name: 'WoW Forever' };
const store = (flavor: Flavor, lua: string, envelopes: string[]): ContributionStore => ({ flavor, lua, envelopes });
const envs = (prefix: string, n: number): string[] => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

describe('planBatch', () => {
  it('Datei ganz oder gar nicht; spätere kleinere Datei passt noch; erste geht immer mit', () => {
    const batch = planBatch([
      store(era, 'a.lua', envs('a', 3)),
      store(era, 'leer.lua', []),
      store(forever, 'b.lua', envs('b', 3)), // passt nicht mehr (3 + 3 > 5)
      store(forever, 'c.lua', ['a0', 'c0', 'c1']), // a0 schon gesehen → 2 neue, passt
    ], 5);
    expect(batch.envelopes).toEqual(['a0', 'a1', 'a2', 'c0', 'c1']);
    expect(batch.files).toEqual(['a.lua', 'leer.lua', 'c.lua']);
    expect([...batch.perFlavor]).toEqual([['Classic Era', 3], ['WoW Forever', 2]]);
    expect(batch.deferred).toBe(3);
    // die erste Datei geht auch über der Grenze mit
    const big = planBatch([store(era, 'x.lua', envs('x', 7)), store(era, 'y.lua', ['y'])], 5);
    expect(big.envelopes).toHaveLength(7);
    expect(big.files).toEqual(['x.lua']);
    expect(big.deferred).toBe(1);
  });

  it('Hinweise wörtlich', () => {
    const batch = planBatch([store(era, 'x.lua', envs('x', 2))]);
    batch.deferred = 7;
    expect(batchNotes(batch, ['T1'], 2)).toEqual([
      'T1',
      'Mehr als 2000 Zeilen in einer Datei – sie gehen in 2 Uploads.',
      '7 weitere passen nicht mehr in diesen Upload (höchstens 2000) und gehen beim nächsten Mal mit.',
    ]);
    expect(batchNotes({ ...batch, deferred: 0 }, [], 1)).toEqual([]);
  });

  it('shortTitles: zehn Titel, der Rest gezählt', () => {
    expect(shortTitles(['a', 'b'])).toBe('a, b');
    expect(shortTitles(envs('t', 12))).toBe('t0, t1, t2, t3, t4, t5, t6, t7, t8, t9 und 2 weitere');
  });
});

describe('Antworten zählen', () => {
  it('refused als Zahl oder Objekt', () => {
    expect(refusedCount(3)).toBe(3);
    expect(refusedCount({ kaputt: 2, doppelt: 1 })).toBe(3);
    expect(refusedCount({})).toBe(0);
    expect(refusedCount(undefined)).toBe(0);
  });

  it('Nicht-Ganzzahlen zählen als 0 (auch true, anders als in Python)', () => {
    for (const value of [1.5, '3', true, null, [1], { a: 1 }, Number.NaN]) expect(count(value)).toBe(0);
    expect(refusedCount({ a: '2', b: 1.5, c: 4 })).toBe(4);
    expect(summedResult([
      { ok: true, accepted: 5, known: 2, refused: { x: 1 } },
      { ok: true, accepted: 'viele', known: 1.5, refused: 2 },
    ])).toEqual({ neu: 3, bekannt: 2, abgelehnt: 3 });
  });

  it('resultLine', () => {
    expect(resultLine({ neu: 2, bekannt: 0, abgelehnt: 0 })).toBe('2 neu für das Projekt');
    expect(resultLine({ neu: 12, bekannt: 3, abgelehnt: 1 })).toBe('12 neu für das Projekt, 3 kannte es schon, 1 nicht verwendbar');
  });

  it('pyRepr wie Pythons str(dict)', () => {
    expect(pyRepr({ ok: false, n: 1, s: "it's", l: [null, true] })).toBe("{'ok': False, 'n': 1, 's': \"it's\", 'l': [None, True]}");
  });
});
