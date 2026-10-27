// Die eine UTF-8-Dekodierfunktion des Pakets (Entscheidung 19): Umschläge, .lua-Text beim
// Leeren und DBCache-Texte laufen alle hier durch, damit Lesen und Vergleichen nie auseinanderlaufen.

// ignoreBOM: true behält ein U+FEFF am Anfang wie Pythons "utf-8" (nicht "utf-8-sig");
// ohne den Schalter würde TextDecoder es stillschweigend verschlucken.
// Ersetzt wird wie Python errors="replace": je ungültiger Teilfolge ein U+FFFD. Ein Vergleich mit
// 20 000 Zufallspuffern voller Randfälle (Surrogate, Überlängen, abgeschnittene Folgen, F5–FF)
// ergab keine Abweichung zu Python 3.13; die Gegenprobe (Phase 4) prüft das erneut.
const decoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true });

/** Bytes als UTF-8 lesen, kaputte Folgen werden zu U+FFFD (wie Python errors="replace"). */
export function decodeUtf8(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

/** Text so lesen wie Pythons read_text(encoding="utf-8", errors="replace"): mit universellen
 *  Zeilenenden, also CRLF und einzelnes CR werden zu LF. */
export function decodeUtf8Text(bytes: Uint8Array): string {
  return decodeUtf8(bytes).replace(/\r\n?/g, '\n');
}
