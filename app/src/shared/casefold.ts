/** Kleinschreibung wie Python casefold für die relevanten Fälle (Entscheidung 18). Für Suche UND Hervorhebung. */
const SPECIAL: Readonly<Record<string, string>> = {
  'ß': 'ss', 'ſ': 's', 'ς': 'σ', 'µ': 'μ',
  'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st',
};
const SPECIAL_PATTERN = /[ßſςµ\uFB00-\uFB06]/gu;

export function casefold(text: string): string {
  return text.toLowerCase().replace(SPECIAL_PATTERN, (ch) => SPECIAL[ch] ?? ch);
}

/** Gefalteter Text plus Rückabbildung: origin[i] = UTF-16-Index im Original für Zeichen i des gefalteten Texts. */
export function casefoldMapped(text: string): { folded: string; origin: number[] } {
  let folded = '';
  const origin: number[] = [];
  let index = 0;
  for (const ch of text) {
    const part = casefold(ch);
    folded += part;
    origin.push(...new Array<number>(part.length).fill(index));
    index += ch.length;
  }
  origin.push(index);
  return { folded, origin };
}
