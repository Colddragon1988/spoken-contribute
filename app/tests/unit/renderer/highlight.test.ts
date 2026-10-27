import { describe, expect, it } from 'vitest';
import { findMatches, splitByRanges } from '../../../src/renderer/history/highlight';

describe('Hervorhebung der Suchtreffer (§7.4)', () => {
  it('ohne Groß/Klein-Unterscheidung, ohne Überlappung', () => {
    expect(findMatches('Seid gegrüßt, SEID willkommen', 'seid')).toEqual([[0, 4], [14, 18]]);
    expect(findMatches('aaaa', 'aa')).toEqual([[0, 2], [2, 4]]);
  });

  it('Anfrage wird getrimmt, leere findet nichts', () => {
    expect(findMatches('abc', '  b ')).toEqual([[1, 2]]);
    expect(findMatches('abc', '   ')).toEqual([]);
  });

  it('casefold: „STRASSE“ findet „Straße“ und umgekehrt, Bereiche im Original', () => {
    const text = 'Die Straße hinab';
    expect(findMatches(text, 'STRASSE')).toEqual([[4, 10]]);
    expect(text.slice(4, 10)).toBe('Straße');
    expect(findMatches('STRASSE', 'straße')).toEqual([[0, 7]]);
  });

  it('Treffer mitten in einem gefalteten Zeichen umfasst das ganze Zeichen', () => {
    // „s“ trifft beide Hälften von ß → ein Bereich über das ganze ß
    expect(findMatches('ß', 's')).toEqual([[0, 1]]);
    expect(findMatches('aßb', 'sb')).toEqual([[1, 3]]);
  });

  it('Zeichen außerhalb der BMP verschieben die Indizes richtig', () => {
    const text = '😀 Seid';
    expect(findMatches(text, 'seid')).toEqual([[3, 7]]);
  });

  it('test_search_finds_text_in_the_sent_data: höchstens 1000 Treffer', () => {
    const text = Array.from({ length: 3000 }, (_, i) => `#${i}  Seid gegrüßt ${i}`).join('\n');
    expect(findMatches(text, 'seid')).toHaveLength(1000);
    expect(findMatches(text, 'seid', 5)).toHaveLength(5);
    expect(findMatches(text, 'gegrüßt 2999')).toHaveLength(1);
  });

  it('splitByRanges zerlegt in normale Stücke und Treffer', () => {
    expect(splitByRanges('abcabc', [[1, 2], [4, 5]])).toEqual([
      { text: 'a', match: false }, { text: 'b', match: true }, { text: 'ca', match: false },
      { text: 'b', match: true }, { text: 'c', match: false },
    ]);
    expect(splitByRanges('ab', [[0, 2]])).toEqual([{ text: 'ab', match: true }]);
    expect(splitByRanges('', [])).toEqual([]);
  });
});
