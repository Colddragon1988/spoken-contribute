/**
 * Zeichnet das Diagramm der letzten 30 Tage als SVG (Spezifikation §7.4). Die Maße kommen aus
 * chartGeometry.ts; die Farben stehen als CSS-Variablen in theme.css, deshalb folgt das
 * Diagramm einem Designwechsel ohne Neuzeichnen. Neu gezeichnet wird bei jeder Größenänderung.
 */
import type { DailyValue } from '../../shared/types';
import { chartGeometry } from './chartGeometry';

const SVG = 'http://www.w3.org/2000/svg';

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Readonly<Record<string, string | number>>): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, String(value));
  return element;
}

/** Textbreite in der Schrift des Diagramms (für die Skala links und die Legende). */
function measurer(host: HTMLElement): (text: string) => number {
  const context = document.createElement('canvas').getContext('2d');
  const probe = svg('text', {});
  host.append(probe);
  const style = getComputedStyle(probe);
  const font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  probe.remove();
  if (!context) return (text) => text.length * 7;
  context.font = font;
  return (text) => Math.ceil(context.measureText(text).width);
}

export interface Chart {
  show(days: readonly DailyValue[]): void;
  redraw(): void;
}

export function createChart(host: HTMLElement): Chart {
  let days: readonly DailyValue[] = [];

  function redraw(): void {
    const width = host.clientWidth;
    const height = host.clientHeight;
    const geometry = chartGeometry(width, height, days, measurer(host));
    if (!geometry) {
      host.replaceChildren(); // noch nicht sichtbar oder zu klein
      return;
    }
    const root = svg('svg', { viewBox: `0 0 ${width} ${height}`, width, height });
    const { baseline } = geometry;
    root.append(svg('line', { x1: baseline.x1, x2: baseline.x2, y1: baseline.y + 0.5, y2: baseline.y + 0.5 }));
    for (const rect of geometry.rects) {
      root.append(svg('rect', { x: rect.x, y: rect.y, width: rect.width, height: rect.height, class: rect.series }));
    }
    for (const label of geometry.labels) {
      const text = svg('text', {
        x: label.x, y: label.y, 'text-anchor': label.align, 'dominant-baseline': label.valign,
        class: label.muted ? 'gedaempft' : '',
      });
      text.textContent = label.text;
      root.append(text);
    }
    host.replaceChildren(root);
  }

  new ResizeObserver(() => { redraw(); }).observe(host);
  return {
    show(next) {
      days = next;
      redraw();
    },
    redraw,
  };
}
