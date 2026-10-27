// Ergebniskurztext, Tabellenzeile, Summenzeile und Details wörtlich nach §5.6.
import { describe, expect, it } from 'vitest';
import { detailsText, MIGRATION_NOTE, resultText, row, totals } from '../../../src/core/history';
import type { HistoryEntry, JsonObject } from '../../../src/shared/types';
import { envelope } from '../../helpers/fixtures';
import { parseEnvelope } from './helpers';

let counter = 0;
function entry(info: JsonObject, time = new Date(2026, 9, 25, 14, 3, 12)): HistoryEntry {
  counter += 1;
  return { id: `e${counter}`, folder: `/tmp/e${counter}`, info, time, failed: info.status !== 'ok' };
}

describe('resultText', () => {
  it('Fehlgeschlagen, ohne Antwort, mit Teilen', () => {
    expect(resultText({ status: 'fehler' })).toBe('Fehlgeschlagen');
    expect(resultText({})).toBe('Fehlgeschlagen');
    expect(resultText({ status: 'ok' })).toBe('gesendet (Antwort nicht gespeichert)');
    expect(resultText({ status: 'ok', ergebnis: {} })).toBe('gesendet (Antwort nicht gespeichert)');
    expect(resultText({ status: 'ok', ergebnis: { neu: 2, bekannt: 1, abgelehnt: 0 } })).toBe('2 neu, 1 schon bekannt');
    expect(resultText({ status: 'ok', ergebnis: { neu: 0, aktualisiert: 3, abgelehnt: 4 } }))
      .toBe('0 neu, 3 aktualisiert, 4 nicht verwendbar');
    expect(resultText({ status: 'ok', ergebnis: { bekannt: 5 } })).toBe('0 neu, 5 schon bekannt');
  });
});

describe('row', () => {
  it('Zeit, Art, Version mit Sprache, Anzahl, Ergebnis', () => {
    const e = entry({ art: 'npc-texte', status: 'ok', versionen: ['Classic Era', 'WoW Forever'], sprache: 'deDE', anzahl: 12, ergebnis: { neu: 3, aktualisiert: 1 } },
      new Date(2026, 0, 5, 7, 8, 9));
    expect(row(e)).toEqual({
      id: e.id, zeit: '05.01.2026  07:08', art: 'NPC-Texte', version: 'Classic Era, WoW Forever (deDE)',
      anzahl: '12', ergebnis: '3 neu, 1 aktualisiert', failed: false,
    });
  });

  it('Fehler ohne Anzahl und unbekannte Art', () => {
    const e = entry({ art: 'zeilen', status: 'fehler', versionen: ['Classic Era'], fehler: 'x' });
    expect(row(e)).toMatchObject({ art: 'Gesammelte Zeilen', anzahl: '', ergebnis: 'Fehlgeschlagen', failed: true });
    expect(row(entry({ art: 'sonstwas', status: 'ok' }))).toMatchObject({ art: '?', version: '' });
  });
});

describe('totals', () => {
  it('Summen, neu für das Projekt, Fehlschläge', () => {
    const found = [
      entry({ art: 'zeilen', status: 'ok', anzahl: 5, ergebnis: { neu: 2, bekannt: 3 } }),
      entry({ art: 'npc-texte', status: 'ok', anzahl: 7, ergebnis: { neu: 4, aktualisiert: 1 } }),
      entry({ art: 'zeilen', status: 'ok', anzahl: 1, hinweis: MIGRATION_NOTE }),
      entry({ art: 'zeilen', status: 'fehler', fehler: 'x' }),
    ];
    expect(totals(found)).toBe('3 Uploads: 6 gesammelte Zeilen und 7 NPC-Texte, davon 6 neu für das Projekt · 1 fehlgeschlagen');
  });

  it('ohne gespeicherte Antwort kein „davon“', () => {
    expect(totals([entry({ art: 'zeilen', status: 'ok', anzahl: 1 })])).toBe('1 Uploads: 1 gesammelte Zeilen und 0 NPC-Texte');
    expect(totals([])).toBe('0 Uploads: 0 gesammelte Zeilen und 0 NPC-Texte');
  });
});

describe('details', () => {
  it('Zeilen mit Payload: Titel, Meta, Text ohne HTML, eingerückt', () => {
    const book = '!SPOKEN1 readables\nbook=Ein Buch\ntext<<\n<p>Seite <b>eins</b></p>\n  zweite Zeile  \n\n>>\n';
    const untitled = '!SPOKEN1 eigenes\nevent=sonst\nfeld<<\nkurz\n>>\nlang<<\nerste\nzweite Zeile\n>>\n';
    const e = entry({
      art: 'zeilen', status: 'ok', versionen: ['Classic Era'], anzahl: 3,
      zusammenfassung: '1 Quest- und Gesprächszeilen, 1 Buchseiten, 1 eigenes', titel: ['Quest 1', 'Ein Buch'],
      ergebnis: { neu: 2, bekannt: 1, abgelehnt: 0 },
    });
    const text = detailsText(e, { gesendet: { envelopes: [envelope(1), book, untitled] } }, parseEnvelope);
    expect(text).toBe([
      'Gesammelte Zeilen – 25.10.2026 um 14:03:12',
      'Version: Classic Era',
      'Inhalt: 1 Quest- und Gesprächszeilen, 1 Buchseiten, 1 eigenes',
      'Ergebnis: 2 neu, 1 schon bekannt',
      '',
      'Gesendet:',
      '\n• Quest 1   (Quest · Fortschritt · Händler 1)',
      '    Text 1 mit Ümläuten, "Zitat" und \\Backslash',
      '\n• Ein Buch   (Buch)',
      '    Seite eins',
      '    zweite Zeile',
      '\n• (ohne Titel)   (eigenes · sonst)',
      '    erste',
      '    zweite Zeile',
    ].join('\n'));
  });

  it('NPC-Texte: Pakete, weiblich, Zeilenumbrüche, nicht gesendet', () => {
    const e = entry({
      art: 'npc-texte', status: 'ok', versionen: ['WoW Forever'], sprache: 'deDE', builds: [1, 2], anzahl: 3, zu_lang: 1,
      ergebnis: { neu: 3, aktualisiert: 0 },
    });
    const payload = {
      gesendet: [
        { lang: 'deDE', build: 1, texts: [{ id: 1, text: 'Hallo', text1: 'Hallo' }, { id: 2, text: 'Er', text1: 'Sie' }] },
        { lang: 'deDE', build: 2, texts: [{ id: 3, text: '', text1: 'Nur\nweiblich' }] },
      ],
      antwort: [],
      nicht_gesendet: [{ id: 4, text: '', text1: 'sehr lang' }],
    };
    expect(detailsText(e, payload, parseEnvelope)).toBe([
      'NPC-Texte – 25.10.2026 um 14:03:12',
      'Version: WoW Forever (deDE)',
      'Ergebnis: 3 neu',
      '1 Texte waren länger als der Server annimmt; sie stehen unten unter „Nicht gesendet“.',
      '',
      'Gesendet:',
      '\nSprache deDE, Build 1 – 2 Texte:',
      '#1  Hallo',
      '#2  Er',
      '        weiblich: Sie',
      '\nSprache deDE, Build 2 – 1 Texte:',
      '#3  Nur\n        weiblich',
      '\nNicht gesendet (zu lang für den Server) – 1 Texte:',
      '#4  sehr lang',
    ].join('\n'));
  });

  it('Fehler-Eintrag', () => {
    const e = entry({ art: 'zeilen', status: 'fehler', versionen: ['Classic Era', 'Classic'], fehler: 'Gesammelte Zeilen: Server-Fehler 500.' });
    expect(detailsText(e, null, parseEnvelope)).toBe([
      'Gesammelte Zeilen – 25.10.2026 um 14:03:12',
      'Version: Classic Era, Classic',
      'Fehlgeschlagen: Gesammelte Zeilen: Server-Fehler 500.',
      'Gelöscht wurde dabei nichts; die Daten gingen beim nächsten Upload erneut mit.',
    ].join('\n'));
    expect(detailsText(entry({ status: 'fehler' }), null, parseEnvelope)).toBe([
      '? – 25.10.2026 um 14:03:12',
      'Version: ?',
      'Fehlgeschlagen: ?',
      'Gelöscht wurde dabei nichts; die Daten gingen beim nächsten Upload erneut mit.',
    ].join('\n'));
  });

  it('Migrierter Eintrag', () => {
    const e = entry({
      art: 'zeilen', status: 'ok', versionen: ['Classic Era'], anzahl: 1,
      zusammenfassung: '1 Quest- und Gesprächszeilen', titel: ['Quest 1'], hinweis: MIGRATION_NOTE,
    });
    expect(detailsText(e, { gesendet: { envelopes: [envelope(1)] } }, parseEnvelope)).toBe([
      'Gesammelte Zeilen – 25.10.2026 um 14:03:12',
      'Version: Classic Era',
      'Inhalt: 1 Quest- und Gesprächszeilen',
      'Ergebnis: gesendet (Antwort nicht gespeichert)',
      'Aus dem Archiv des früheren Skripts übernommen; die Antwort des Servers wurde damals nicht gespeichert.',
      '',
      'Gesendet:',
      '\n• Quest 1   (Quest · Fortschritt · Händler 1)',
      '    Text 1 mit Ümläuten, "Zitat" und \\Backslash',
    ].join('\n'));
  });

  it('leere Payload zeigt kein „Gesendet:“', () => {
    const e = entry({ art: 'zeilen', status: 'ok' });
    expect(detailsText(e, {}, parseEnvelope)).not.toContain('Gesendet:');
  });
});
