// Portiert aus tests/test_wowdata.py::DecodeLua, dazu Randfälle aus Spezifikation §5.1.2.
import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { decodeLua, decodeUtf8, decodeUtf8Text } from '../../../src/core/wowdata';

const b = (s: string): Uint8Array => Buffer.from(s, 'latin1');

describe('DecodeLua', () => {
  it('test_escapes', () => {
    expect(decodeLua(b('a\\nb\\"c\\\\d\\065\\228'))).toBe('a\nb"c\\dA\uFFFD');
    expect(decodeLua(b('x\\\r\ny'))).toBe('x\ny'); // Backslash vor Windows-Zeilenende
  });

  it('test_utf8_bytes_as_decimal_escapes', () => {
    expect(decodeLua(b('\\195\\164'))).toBe('ä');
  });

  it('übrige einfache Escapes und Backslash vor LF', () => {
    expect(decodeLua(b("\\r\\t\\a\\b\\f\\v\\'\\\n"))).toBe("\r\t\x07\b\f\v'\n");
  });

  it('\\ddd nimmt höchstens drei Ziffern und rechnet & 0xFF', () => {
    expect(decodeLua(b('\\999'))).toBe('\uFFFD'); // Byte 231 allein ist kein gültiges UTF-8
    expect(decodeLua(b('\\195\\999\\167'))).toBe('\uFFFD\uFFFD'); // C3 E7 A7: zwei kaputte Folgen
    expect(decodeLua(b('\\0651'))).toBe('A1');
    expect(decodeLua(b('\\9x'))).toBe('\tx');
  });

  it('unbekannte Folgen lassen den Backslash stehen', () => {
    expect(decodeLua(b('\\x41\\z\\u{41}'))).toBe('\\x41\\z\\u{41}');
    expect(decodeLua(b('a\\\rb'))).toBe('a\\\rb'); // einzelnes CR ist kein Escape
    expect(decodeLua(b('ende\\'))).toBe('ende\\'); // Backslash am Ende
    expect(decodeLua(b(''))).toBe('');
  });

  it('UTF-8 wie Python errors="replace", BOM bleibt erhalten', () => {
    expect(decodeUtf8(Uint8Array.of(0xef, 0xbb, 0xbf, 0x41))).toBe('\uFEFFA');
    expect(decodeUtf8(Uint8Array.of(0xed, 0xa0, 0x80))).toBe('\uFFFD\uFFFD\uFFFD'); // Surrogat
    expect(decodeUtf8(Uint8Array.of(0xe2, 0x82, 0x41))).toBe('\uFFFDA'); // abgeschnittene Folge
    expect(decodeUtf8(Uint8Array.of(0xc0, 0xaf))).toBe('\uFFFD\uFFFD'); // Überlänge
  });

  it('Text lesen mit universellen Zeilenenden wie read_text', () => {
    expect(decodeUtf8Text(b('a\r\nb\rc\nd'))).toBe('a\nb\nc\nd');
  });
});
