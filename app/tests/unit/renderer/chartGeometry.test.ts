import { describe, expect, it } from 'vitest';
import { CHART_TITLE, chartGeometry, shortDay } from '../../../src/renderer/history/chartGeometry';
import type { DailyValue } from '../../../src/shared/types';

const measure = (text: string): number => text.length * 6;

function days(values: readonly (readonly [number, number])[]): DailyValue[] {
  return values.map(([lines, texts], i) => ({ day: `2026-10-${String(i + 1).padStart(2, '0')}`, lines, texts }));
}

const thirty = days(Array.from({ length: 30 }, (_, i) => [i % 3 === 0 ? 4 : 0, i === 29 ? 6 : 0] as const));

describe('Diagramm „Gesendet pro Tag, letzte 30 Tage“ (§7.4)', () => {
  it('nichts zeichnen unter 100×80 oder ohne Tage', () => {
    expect(chartGeometry(99, 220, thirty, measure)).toBeNull();
    expect(chartGeometry(600, 79, thirty, measure)).toBeNull();
    expect(chartGeometry(600, 220, [], measure)).toBeNull();
    expect(chartGeometry(100, 80, thirty, measure)).not.toBeNull();
  });

  it('Titel und Legende', () => {
    const g = chartGeometry(600, 220, thirty, measure);
    expect(CHART_TITLE).toBe('Gesendet pro Tag, letzte 30 Tage');
    const texts = g?.labels.filter((l) => !l.muted).map((l) => l.text);
    expect(texts).toEqual(['Gesendet pro Tag, letzte 30 Tage', 'NPC-Texte', 'Gesammelte Zeilen']);
    const legend = g?.rects.filter((r) => r.y === 10 && r.width === 10) ?? [];
    expect(legend.map((r) => r.series)).toEqual(['texts', 'lines']);
    // von rechts: NPC-Texte ganz rechts, Gesammelte Zeilen links davon
    expect(legend[0]?.x).toBe(600 - 12 - (measure('NPC-Texte') + 14));
  });

  it('Balkenbreite 70 % des Tagesabstands, Skala 0 und Maximum', () => {
    const g = chartGeometry(600, 220, thirty, measure);
    expect(g).not.toBeNull();
    if (!g) return;
    expect(g.peak).toBe(6);
    expect(g.left).toBe(measure('6') + 14);
    expect(g.bottom).toBe(196);
    expect(g.top).toBe(34);
    expect(g.step).toBeCloseTo((600 - g.left - 12) / 30);
    expect(g.bar).toBeCloseTo(g.step * 0.7);
    expect(g.baseline).toEqual({ x1: g.left, x2: 588, y: 196 });
    const scale = g.labels.filter((l) => l.align === 'end').map((l) => [l.text, l.y]);
    expect(scale).toEqual([['0', 196], ['6', 34]]);
  });

  it('Zeilen unten, Texte darüber, Höhe proportional zum Maximum', () => {
    const g = chartGeometry(600, 220, days([[2, 2], [0, 0]]), measure);
    if (!g) throw new Error('keine Geometrie');
    const bars = g.rects.filter((r) => !(r.y === 10 && r.width === 10));
    expect(bars.map((b) => b.series)).toEqual(['lines', 'texts']);
    const [lines, texts] = bars;
    const full = g.bottom - g.top;
    expect(lines?.height).toBeCloseTo(full / 2);
    expect(lines?.y).toBeCloseTo(g.bottom - full / 2);
    expect(texts?.y).toBeCloseTo(g.top);
    expect(lines?.x).toBeCloseTo(g.left + (g.step - g.bar) / 2);
  });

  it('Datum an jedem 5. Tag und am letzten Tag', () => {
    const g = chartGeometry(600, 220, thirty, measure);
    const dates = g?.labels.filter((l) => l.align === 'middle').map((l) => l.text);
    expect(dates).toEqual(['01.10.', '06.10.', '11.10.', '16.10.', '21.10.', '26.10.', '30.10.']);
    expect(shortDay('2026-03-07')).toBe('07.03.');
  });

  it('ohne gesendete Werte: nur Grundlinie und „0“, keine Balken', () => {
    const g = chartGeometry(600, 220, days([[0, 0], [0, 0]]), measure);
    expect(g?.peak).toBe(0);
    expect(g?.rects).toHaveLength(2); // nur die Legende
    expect(g?.labels.filter((l) => l.muted).map((l) => l.text)).toEqual(['0']);
  });

  it('sehr schmale Tage: Balken mindestens 1 breit', () => {
    const many = days(Array.from({ length: 30 }, () => [1, 0] as const));
    const g = chartGeometry(100, 80, many, (t) => t.length * 40);
    expect(g?.bar).toBe(1);
  });
});
