/**
 * Geometrie des Diagramms „Gesendet pro Tag, letzte 30 Tage“ (Spezifikation §7.4): gestapelte
 * Balken je Tag, Zeilen unten, Texte darüber. Maße wie in der Python-Fassung (gui.draw_chart).
 * Rein, ohne DOM: Textbreiten misst der Aufrufer (`measure`), gezeichnet wird in chart.ts.
 */
import type { DailyValue } from '../../shared/types';
import { DAILY_DAYS } from '../../shared/types';

export const CHART_TITLE = `Gesendet pro Tag, letzte ${DAILY_DAYS} Tage`;
export const LEGEND_LINES = 'Gesammelte Zeilen';
export const LEGEND_TEXTS = 'NPC-Texte';
/** kleinste Fläche, auf der gezeichnet wird – sonst ist das Fenster noch gar nicht sichtbar */
export const MIN_WIDTH = 100;
export const MIN_HEIGHT = 80;

export type Series = 'lines' | 'texts';
/** Ausrichtung wie Tk-anchor: waagrecht (SVG text-anchor) und senkrecht (dominant-baseline). */
export type HAlign = 'start' | 'middle' | 'end';
export type VAlign = 'hanging' | 'central';

export interface Label {
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly align: HAlign;
  readonly valign: VAlign;
  /** gedämpft (Skala, Datum) oder normal (Titel, Legende) */
  readonly muted: boolean;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly series: Series;
}

export interface ChartGeometry {
  readonly peak: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  /** Tagesabstand */
  readonly step: number;
  /** Balkenbreite = 70 % des Tagesabstands, mindestens 1 */
  readonly bar: number;
  readonly labels: readonly Label[];
  /** Legendenkästchen und Balken */
  readonly rects: readonly Rect[];
  /** Grundlinie in der Rahmenfarbe */
  readonly baseline: { readonly x1: number; readonly x2: number; readonly y: number };
}

/** "YYYY-MM-DD" → "dd.mm." */
export function shortDay(day: string): string {
  const [, month = '', date = ''] = day.split('-');
  return `${date}.${month}.`;
}

/**
 * Alles, was auf eine Fläche von width×height gehört; null, wenn nichts zu zeichnen ist
 * (Fläche kleiner als 100×80 oder keine Tage).
 */
export function chartGeometry(
  width: number, height: number, days: readonly DailyValue[], measure: (text: string) => number,
): ChartGeometry | null {
  if (width < MIN_WIDTH || height < MIN_HEIGHT || days.length === 0) return null;
  const peak = Math.max(...days.map((d) => d.lines + d.texts));
  const left = measure(String(peak)) + 14; // Platz für die Beschriftung der Skala
  const right = 12;
  const top = 34;
  const bottom = height - 24;
  const step = (width - left - right) / days.length;
  const bar = Math.max(step * 0.7, 1);

  const labels: Label[] = [{ x: left, y: 8, text: CHART_TITLE, align: 'start', valign: 'hanging', muted: false }];
  const rects: Rect[] = [];
  let x = width - right; // Legende von rechts nach links, Breite nach der Schrift bemessen
  for (const [series, text] of [['texts', LEGEND_TEXTS], ['lines', LEGEND_LINES]] as const) {
    x -= measure(text) + 14;
    rects.push({ x, y: 10, width: 10, height: 10, series });
    labels.push({ x: x + 14, y: 15, text, align: 'start', valign: 'central', muted: false });
    x -= 16;
  }
  labels.push({ x: left - 6, y: bottom, text: '0', align: 'end', valign: 'central', muted: true });
  const geometry = { peak, left, right, top, bottom, step, bar, labels, rects, baseline: { x1: left, x2: width - right, y: bottom } };
  if (!peak) return geometry; // nichts gesendet in diesen Tagen; eine Skala bis „1“ wäre irreführend

  labels.push({ x: left - 6, y: top, text: String(peak), align: 'end', valign: 'central', muted: true });
  days.forEach((day, i) => {
    const bx = left + i * step + (step - bar) / 2;
    let y = bottom;
    for (const [value, series] of [[day.lines, 'lines'], [day.texts, 'texts']] as const) {
      if (!value) continue;
      const h = ((bottom - top) * value) / peak;
      rects.push({ x: bx, y: y - h, width: bar, height: h, series });
      y -= h;
    }
    if (i % 5 === 0 || i === days.length - 1) {
      labels.push({ x: bx + bar / 2, y: bottom + 4, text: shortDay(day.day), align: 'middle', valign: 'hanging', muted: true });
    }
  });
  return geometry;
}
