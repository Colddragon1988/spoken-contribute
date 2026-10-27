// IPC-Prüfer (Architektur §4.1): Grenzwerte, Zusatzschlüssel, falsche Typen – nie ein Wurf.
import { describe, expect, it } from 'vitest';
import { LIMITS } from '../../../src/shared/ipc';
import {
  INVALID, bool, count, entryId, exactObject, expandUser, historyQuery, messageRequest, oneOf, senderAllowed,
  signInArgs, text, themeSetting, uploadArgs, wowPath, type SenderInfo,
} from '../../../src/main/validate';

const WEIRD: unknown[] = [undefined, null, 1, true, {}, [], () => 1, Symbol('x'), 10n];

describe('Grundprüfer', () => {
  it('text: Länge, NUL, Typ', () => {
    expect(text('abc', 3)).toBe('abc');
    expect(text('', 3)).toBe('');
    expect(text('abcd', 3)).toBe(INVALID);
    expect(text('a\0b', 10)).toBe(INVALID);
    for (const value of WEIRD) expect(text(value, 10)).toBe(INVALID);
    expect(wowPath('x'.repeat(LIMITS.path))).toBe('x'.repeat(LIMITS.path));
    expect(wowPath('x'.repeat(LIMITS.path + 1))).toBe(INVALID);
  });

  it('bool ist strikt', () => {
    expect(bool(true)).toBe(true);
    expect(bool(false)).toBe(false);
    for (const value of [0, 1, 'true', null, undefined, {}]) expect(bool(value)).toBe(INVALID);
  });

  it('oneOf und Designs', () => {
    expect(oneOf('b', ['a', 'b'])).toBe('b');
    expect(oneOf('c', ['a', 'b'])).toBe(INVALID);
    expect(themeSetting('dunkel')).toBe('dunkel');
    expect(themeSetting('Dunkel')).toBe(INVALID);
    expect(themeSetting(['system'])).toBe(INVALID);
  });

  it('count: sichere Ganzzahl ≥ 0', () => {
    expect(count(0)).toBe(0);
    expect(count(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Infinity, '1', null]) {
      expect(count(value)).toBe(INVALID);
    }
  });

  it('exactObject: genau diese Schlüssel, nur einfache Objekte', () => {
    expect(exactObject({ a: 1 }, ['a'])).toEqual({ a: 1 });
    expect(exactObject(Object.assign(Object.create(null) as object, { a: 1 }), ['a'])).toEqual({ a: 1 });
    expect(exactObject({ a: 1, b: 2 }, ['a'])).toBe(INVALID);
    expect(exactObject({}, ['a'])).toBe(INVALID);
    expect(exactObject({ b: 1 }, ['a'])).toBe(INVALID);
    expect(exactObject([1], ['0'])).toBe(INVALID);
    expect(exactObject(new Date(), [])).toBe(INVALID);
    expect(exactObject(null, [])).toBe(INVALID);
  });
});

describe('Kanalargumente', () => {
  it('entryId: nur ein Ordnername', () => {
    expect(entryId('2026-10-25_14-03-12_zeilen-2')).toBe('2026-10-25_14-03-12_zeilen-2');
    for (const value of ['', '../x', 'a/b', 'a\\b', '..', 'a\0', 'x'.repeat(LIMITS.entryId + 1), 3]) {
      expect(entryId(value)).toBe(INVALID);
    }
    expect(entryId('x'.repeat(LIMITS.entryId))).toBe('x'.repeat(LIMITS.entryId));
  });

  it('signInArgs: getrimmte E-Mail, Grenzen, keine Zusatzschlüssel', () => {
    expect(signInArgs({ email: '  a@b.c ', password: ' pw ' })).toEqual({ email: 'a@b.c', password: ' pw ' });
    expect(signInArgs({ email: '', password: '' })).toEqual({ email: '', password: '' }); // meldet der Handler
    expect(signInArgs({ email: 'x'.repeat(LIMITS.email + 1), password: 'p' })).toBe(INVALID);
    expect(signInArgs({ email: 'a', password: 'p'.repeat(LIMITS.password + 1) })).toBe(INVALID);
    expect(signInArgs({ email: 'a', password: 'p', extra: 1 })).toBe(INVALID);
    expect(signInArgs({ email: 'a' })).toBe(INVALID);
    expect(signInArgs({ email: 1, password: 'p' })).toBe(INVALID);
    expect(signInArgs(['a', 'p'])).toBe(INVALID);
  });

  it('uploadArgs', () => {
    expect(uploadArgs({ test: true })).toEqual({ test: true });
    expect(uploadArgs({ test: 'ja' })).toBe(INVALID);
    expect(uploadArgs({ test: false, x: 1 })).toBe(INVALID);
    expect(uploadArgs(true)).toBe(INVALID);
  });

  it('historyQuery', () => {
    const ok = { seq: 3, search: 'gegrüßt', art: 'npc-texte', version: 'Classic Era' };
    expect(historyQuery(ok)).toEqual(ok);
    expect(historyQuery({ ...ok, art: 'fehler' })).toBe(INVALID);
    expect(historyQuery({ ...ok, seq: -1 })).toBe(INVALID);
    expect(historyQuery({ ...ok, search: 's'.repeat(LIMITS.search + 1) })).toBe(INVALID);
    expect(historyQuery({ ...ok, version: 'v'.repeat(LIMITS.version + 1) })).toBe(INVALID);
    expect(historyQuery({ ...ok, more: true })).toBe(INVALID);
  });

  it('messageRequest', () => {
    const ok = { kind: 'warnung', title: 'T', text: 'x'.repeat(LIMITS.messageText) };
    expect(messageRequest(ok)).toEqual(ok);
    expect(messageRequest({ ...ok, kind: 'error' })).toBe(INVALID);
    expect(messageRequest({ ...ok, title: 't'.repeat(LIMITS.title + 1) })).toBe(INVALID);
    expect(messageRequest({ ...ok, text: 'x'.repeat(LIMITS.messageText + 1) })).toBe(INVALID);
  });
});

describe('expandUser', () => {
  it('wie Path.expanduser für ~ und ~/…', () => {
    expect(expandUser('~', '/home/x', false)).toBe('/home/x');
    expect(expandUser('~/Games', '/home/x', false)).toBe('/home/x/Games');
    expect(expandUser('~\\Games', 'C:\\Users\\x', true)).toBe('C:\\Users\\x\\Games');
    expect(expandUser('~\\Games', '/home/x', false)).toBe('~\\Games');
    expect(expandUser('/a/~', '/home/x', false)).toBe('/a/~');
    expect(expandUser('~fremd/x', '/home/x', false)).toBe('~fremd/x');
  });
});

describe('senderAllowed', () => {
  const main: SenderInfo = { hasFrame: true, isMainFrame: true, url: 'app://spoken/main/index.html', window: 'haupt' };
  it('unser Hauptframe im richtigen Fenster', () => {
    expect(senderAllowed(main, 'haupt')).toBe(true);
    expect(senderAllowed(main, 'beide')).toBe(true);
    expect(senderAllowed(main, 'verlauf')).toBe(false);
    expect(senderAllowed({ ...main, window: 'verlauf', url: 'app://spoken/history/index.html' }, 'verlauf')).toBe(true);
  });
  it('fremde Absender werden verworfen', () => {
    expect(senderAllowed({ ...main, hasFrame: false }, 'beide')).toBe(false);
    expect(senderAllowed({ ...main, isMainFrame: false }, 'beide')).toBe(false);
    expect(senderAllowed({ ...main, url: 'https://example.org/' }, 'beide')).toBe(false);
    expect(senderAllowed({ ...main, url: 'app://spokenx/main/index.html' }, 'beide')).toBe(false);
    expect(senderAllowed({ ...main, url: 'file:///app/main/index.html' }, 'beide')).toBe(false);
    expect(senderAllowed({ ...main, window: null }, 'beide')).toBe(false);
  });
});
