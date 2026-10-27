import { describe, expect, it } from 'vitest';
import {
  accountText, INITIAL_LOG, limitLine, overviewLines, overviewStatus, reportView, saveErrorText,
  startText, unexpectedReport, unexpectedText,
} from '../../../src/renderer/main/format';
import type { Overview } from '../../../src/shared/types';

const base: Overview = { flavors: ['Classic Era', 'WoW Forever'], running: [], lines: 0, texts: 0, uploadsLeft: 10, freeAt: null };
const ov = (patch: Partial<Overview>): Overview => ({ ...base, ...patch });

describe('Statuszeilen zum WoW-Ordner (§7.2)', () => {
  it('kein WoW-Hauptordner: rot', () => {
    expect(overviewStatus({ wowDir: '/x', kind: 'keinWow' })).toEqual({
      text: 'Hier liegt kein World of Warcraft – bitte über „Ändern …“ oder „Suchen“ den Ordner „World of Warcraft“ wählen.',
      error: true,
    });
  });

  it('Fehler beim Prüfen: rot', () => {
    expect(overviewStatus({ wowDir: '/x', kind: 'fehler', message: 'EACCES' })).toEqual({ text: 'Fehler beim Prüfen: EACCES', error: true });
  });

  it('keine Version mit Spoken: rot', () => {
    expect(overviewLines(ov({ flavors: [] }))).toEqual({ text: 'Spoken ist in keiner WoW-Version in diesem Ordner installiert.', error: true });
  });

  it('nichts Neues, alle Uploads frei: zwei Zeilen', () => {
    expect(overviewStatus({ wowDir: '/x', kind: 'ok', overview: base })).toEqual({
      text: 'Spoken in: Classic Era, WoW Forever\nBereit: nichts Neues', error: false,
    });
  });

  it('Zeilen und Texte bereit', () => {
    expect(overviewLines(ov({ lines: 3, texts: 7 })).text).toBe('Spoken in: Classic Era, WoW Forever\nBereit: 3 gesammelte Zeilen und 7 NPC-Texte');
    expect(overviewLines(ov({ texts: 7 })).text).toBe('Spoken in: Classic Era, WoW Forever\nBereit: 7 NPC-Texte');
    expect(overviewLines(ov({ lines: 3 })).text).toBe('Spoken in: Classic Era, WoW Forever\nBereit: 3 gesammelte Zeilen');
  });

  it('laufende Version wird markiert und übersprungen', () => {
    expect(overviewLines(ov({ running: ['Classic Era'], lines: 2 })).text).toBe(
      'Spoken in: Classic Era (läuft gerade), WoW Forever\n' +
      'Bereit: 2 gesammelte Zeilen (ohne Classic Era – wird beim Upload übersprungen)');
  });

  it('laufende Version unbekannt: alle laufen, Hinweis statt „Bereit“', () => {
    expect(overviewLines(ov({ running: null, lines: 5 })).text).toBe(
      'Spoken in: Classic Era (läuft gerade), WoW Forever (läuft gerade)\n' +
      'Ein WoW läuft, aber welche Version, ist nicht zu erkennen – bitte erst beenden.');
  });

  it('Upload-Grenze: erreicht, teilweise verbraucht, frei', () => {
    expect(limitLine({ freeAt: '14:05', uploadsLeft: 0 })).toBe('Upload-Grenze erreicht (10 pro Stunde) – gesammelte Zeilen wieder ab 14:05 Uhr.');
    expect(limitLine({ freeAt: null, uploadsLeft: 7 })).toBe('Noch 7 von 10 Uploads in dieser Stunde frei.');
    expect(limitLine({ freeAt: null, uploadsLeft: 10 })).toBeNull();
    expect(overviewLines(ov({ uploadsLeft: 9 })).text).toBe(
      'Spoken in: Classic Era, WoW Forever\nBereit: nichts Neues\nNoch 9 von 10 Uploads in dieser Stunde frei.');
  });
});

describe('Konto-Anzeige (§7.2, V1, V2)', () => {
  const tail = 'Die Anmeldung ist nur für die NPC-Texte nötig – die gesammelten Zeilen gehen anonym hoch.';

  it('nicht angemeldet', () => {
    expect(accountText({ email: null, place: null, backend: 'system' })).toEqual({
      label: 'Nicht angemeldet', button: 'Anmelden …', signedIn: false,
      hint: 'Nur für die NPC-Texte aus dem Spiel-Cache nötig – die gesammelten Zeilen gehen anonym hoch.',
    });
  });

  it('Passwort im Schlüsselbund', () => {
    expect(accountText({ email: 'a@b.c', place: 'schluesselbund', backend: 'system' })).toEqual({
      label: 'Angemeldet als a@b.c', button: 'Abmelden', signedIn: true,
      hint: `Das Passwort liegt im Schlüsselbund des Systems. ${tail}`,
    });
  });

  it('Passwort in der Datei, kein Schlüsselbund', () => {
    expect(accountText({ email: 'a@b.c', place: 'datei', backend: 'none' }).hint).toBe(
      `Das Passwort liegt in einer Datei, die nur du lesen kannst (kein Schlüsselbund gefunden). ${tail}`);
  });

  it('V1: basic_text – nur durch die Dateirechte geschützt', () => {
    expect(accountText({ email: 'a@b.c', place: 'datei', backend: 'basic_text' }).hint).toBe(
      'Das Passwort liegt in einer Datei, die nur du lesen kannst (kein Schlüsselbund gefunden – nur durch die Dateirechte geschützt). ' + tail);
  });

  it('V2: Passwort nicht mehr lesbar', () => {
    expect(accountText({ email: 'a@b.c', place: 'unlesbar', backend: 'system' }).hint).toBe(
      `Das Passwort ist auf diesem Rechner nicht mehr lesbar – bitte ab- und neu anmelden. ${tail}`);
  });
});

describe('Bericht und Meldungen', () => {
  it('Kopfzeile, Leerzeile, Abschnitte mit Leerzeile getrennt', () => {
    const view = reportView({ head: 'Erfolgreich hochgeladen – danke!', sections: ['Geprüft: Classic Era', 'Gesammelte Zeilen: …'], failed: false });
    expect(view.head + view.rest).toBe('Erfolgreich hochgeladen – danke!\n\nGeprüft: Classic Era\n\nGesammelte Zeilen: …\n');
    expect(view.failed).toBe(false);
  });

  it('unerwarteter Fehler wird zum roten Bericht', () => {
    expect(unexpectedReport(new Error('kaputt'))).toEqual({
      head: 'Unerwarteter Fehler.',
      sections: ['Error: kaputt', 'Was nicht hochgeladen wurde, bleibt liegen und geht beim nächsten Mal mit.'],
      failed: true,
    });
  });

  it('feste Texte wörtlich', () => {
    expect(INITIAL_LOG).toBe('„Jetzt hochladen“ sendet alles, was bereitliegt; „Testlauf“ zeigt nur, was gesendet würde.');
    expect(startText(true)).toBe('Testlauf …');
    expect(startText(false)).toBe('Lade hoch …');
    expect(saveErrorText('EROFS')).toBe('Die Einstellungen ließen sich nicht speichern (EROFS). Sie gelten nur bis zum Schließen.');
    expect(unexpectedText(new TypeError('x'))).toBe('Unerwarteter Fehler:\n\nTypeError: x');
  });
});
