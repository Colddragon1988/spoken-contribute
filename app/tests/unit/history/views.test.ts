// Ansicht des Verlaufsfensters: Filter (§7.4), Summenzeile, Suche mit casefold, Suchcache, Abbruch.
import { describe, expect, it } from 'vitest';
import { createHistoryStore, createHistoryViews, createHistoryViewsWith, createSearchIndex } from '../../../src/core/history';
import type { HistoryEntry, HistoryFilter, HistoryStore, RecordInput } from '../../../src/shared/types';
import { envelope } from '../../helpers/fixtures';
import { fakeWowData, FixedClock, tempDir } from './helpers';

const NOW = new Date(2026, 9, 25, 14, 0, 0);
const filter = (part: Partial<HistoryFilter> = {}): HistoryFilter => ({ search: '', art: 'alle', version: '', ...part });
const signal = (): AbortSignal => new AbortController().signal;

async function setup(records: readonly RecordInput[] = []) {
  const clock = new FixedClock(NOW);
  const store = createHistoryStore({ dataDir: await tempDir(), clock, wowData: fakeWowData });
  for (const input of records) await store.record(input);
  return { store, clock, views: createHistoryViews({ store, wowData: fakeWowData, clock }) };
}

const at = (minutes: number): Date => new Date(NOW.getTime() - minutes * 60_000);
const SAMPLE: RecordInput[] = [
  { kind: 'zeilen', info: { status: 'ok', versionen: ['Classic Era'], anzahl: 2, ergebnis: { neu: 2, bekannt: 0 } },
    payload: { gesendet: { envelopes: [envelope(1), envelope(2, 'quests', 'Die STRASSE nach Süden')] } }, when: at(30) },
  { kind: 'npc-texte', info: { status: 'ok', versionen: ['WoW Forever'], sprache: 'deDE', anzahl: 1, ergebnis: { neu: 1, aktualisiert: 0 } },
    payload: { gesendet: [{ lang: 'deDE', build: 1, texts: [{ id: 9, text: 'Seid gegrüßt', text1: '' }] }] }, when: at(20) },
  { kind: 'zeilen', info: { status: 'fehler', versionen: ['Classic Era', 'Classic'], fehler: 'Server-Fehler 500' }, when: at(10) },
  { kind: 'npc-texte', info: { status: 'fehler', versionen: ['WoW Forever'], fehler: 'keine Verbindung' }, when: at(5) },
];

describe('Filter und Summenzeile', () => {
  it('ohne Einträge: „Noch keine Uploads archiviert.“', async () => {
    const { views } = await setup();
    const result = await views.query(filter(), signal());
    expect(result.summary).toBe('Noch keine Uploads archiviert.');
    expect(result.rows).toEqual([]);
    expect(result.statistics.heading).toBe('Statistik');
    expect(result.daily).toHaveLength(30);
  });

  it('alle: Summen ohne „gefiltert“, Versionen sortiert', async () => {
    const { views } = await setup(SAMPLE);
    const result = await views.query(filter(), signal());
    expect(result.rows.map((r) => [r.art, r.failed])).toEqual([
      ['NPC-Texte', true], ['Gesammelte Zeilen', true], ['NPC-Texte', false], ['Gesammelte Zeilen', false],
    ]);
    expect(result.versions).toEqual(['Classic', 'Classic Era', 'WoW Forever']);
    expect(result.summary).toBe('2 Uploads: 2 gesammelte Zeilen und 1 NPC-Texte, davon 3 neu für das Projekt · 2 fehlgeschlagen');
    expect(result.statistics.heading).toBe('Statistik');
    expect(result.daily.at(-1)).toEqual({ day: '2026-10-25', lines: 2, texts: 1 });
  });

  it('Art: Fehlgeschlagen nur Fehler; Zeilen/NPC-Texte nur ok-Einträge der Art', async () => {
    const { views } = await setup(SAMPLE);
    const failed = await views.query(filter({ art: 'fehlgeschlagen' }), signal());
    expect(failed.rows.every((r) => r.failed)).toBe(true);
    expect(failed.rows).toHaveLength(2);
    expect(failed.summary).toBe('0 Uploads: 0 gesammelte Zeilen und 0 NPC-Texte · 2 fehlgeschlagen   (gefiltert: 2 von 4)');
    expect(failed.statistics.heading).toBe('Statistik (gefiltert)');
    const lines = await views.query(filter({ art: 'zeilen' }), signal());
    expect(lines.rows.map((r) => [r.art, r.failed])).toEqual([['Gesammelte Zeilen', false]]);
    expect(lines.summary).toBe('1 Uploads: 2 gesammelte Zeilen und 0 NPC-Texte, davon 2 neu für das Projekt   (gefiltert: 1 von 4)');
    const texts = await views.query(filter({ art: 'npc-texte' }), signal());
    expect(texts.rows.map((r) => [r.art, r.failed])).toEqual([['NPC-Texte', false]]);
  });

  it('Version muss in versionen stehen; verschwundene Version gilt als Alle', async () => {
    const { views } = await setup(SAMPLE);
    const classic = await views.query(filter({ version: 'Classic' }), signal());
    expect(classic.rows).toHaveLength(1);
    expect(classic.rows[0]?.version).toBe('Classic Era, Classic');
    const gone = await views.query(filter({ version: 'Gibt es nicht' }), signal());
    expect(gone.rows).toHaveLength(4);
    expect(gone.summary).not.toContain('gefiltert');
  });

  it('nichts passt: „Keine Uploads passen zu Suche und Filter.“', async () => {
    const { views } = await setup(SAMPLE);
    const result = await views.query(filter({ art: 'npc-texte', version: 'Classic' }), signal());
    expect(result.summary).toBe('Keine Uploads passen zu Suche und Filter.');
    expect(result.statistics.lines[0]).toBe('0 Uploads');
  });
});

describe('Suche', () => {
  it('casefold: „Straße“ findet „STRASSE“ und umgekehrt, getrimmt', async () => {
    const { views } = await setup(SAMPLE);
    const a = await views.query(filter({ search: '  Straße ' }), signal());
    expect(a.rows).toHaveLength(1);
    expect(a.rows[0]?.art).toBe('Gesammelte Zeilen');
    const b = await views.query(filter({ search: 'GEGRÜSST' }), signal());
    expect(b.rows.map((r) => r.art)).toEqual(['NPC-Texte']);
    expect(b.summary).toContain('(gefiltert: 1 von 4)');
  });

  it('findet Fehlertexte, Überschrift und Versionen; Leerraum allein ist keine Suche', async () => {
    const { views } = await setup(SAMPLE);
    expect((await views.query(filter({ search: 'server-fehler 500' }), signal())).rows).toHaveLength(1);
    expect((await views.query(filter({ search: 'wow forever (dede)' }), signal())).rows).toHaveLength(1);
    expect((await views.query(filter({ search: '25.10.2026 um' }), signal())).rows).toHaveLength(4);
    expect((await views.query(filter({ search: ' \t' }), signal())).rows).toHaveLength(4);
  });

  it('Suche und Filter wirken zusammen', async () => {
    const { views } = await setup(SAMPLE);
    const result = await views.query(filter({ search: 'classic', art: 'fehlgeschlagen' }), signal());
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.version).toBe('Classic Era, Classic');
  });

  it('test_search_finds_text_in_the_sent_data (Datenlogik)', async () => {
    const texts = Array.from({ length: 3000 }, (_, i) => ({ id: i, text: `Seid gegrüßt ${i}`, text1: '' }));
    const { views } = await setup([
      { kind: 'zeilen', info: { status: 'ok', versionen: ['Classic Era'], anzahl: 1 }, payload: { gesendet: { envelopes: [envelope(1)] } } },
      { kind: 'npc-texte', info: { status: 'ok', versionen: ['WoW Forever'], anzahl: 3000 }, payload: { gesendet: [{ lang: 'deDE', build: 1, texts }] } },
    ]);
    expect((await views.query(filter(), signal())).rows).toHaveLength(2);
    const found = await views.query(filter({ search: 'gegrüßt 2999' }), signal());
    expect(found.rows.map((r) => r.art)).toEqual(['NPC-Texte']);
  });

  it('Abbruch per AbortSignal: vorher und mittendrin', async () => {
    const { store, clock } = await setup(SAMPLE);
    const before = new AbortController();
    before.abort();
    const views = createHistoryViews({ store, wowData: fakeWowData, clock });
    await expect(views.query(filter({ search: 'x' }), before.signal)).rejects.toMatchObject({ name: 'AbortError' });

    const during = new AbortController();
    let reads = 0;
    const spy: HistoryStore = {
      ...store,
      payload: (entry: HistoryEntry) => {
        reads += 1;
        during.abort(); // während des ersten Lesens weitergetippt
        return store.payload(entry);
      },
    };
    const aborted = createHistoryViews({ store: spy, wowData: fakeWowData, clock });
    await expect(aborted.query(filter({ search: 'nirgends' }), during.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(reads).toBe(1);
  });

  it('Suchcache: hält höchstens limit Zeichen, der Rest wird je Suche neu gelesen; bleibt beim Neuladen', async () => {
    const { store, clock } = await setup(SAMPLE);
    const reads: string[] = [];
    const spy: HistoryStore = {
      ...store,
      payload: (entry: HistoryEntry) => {
        reads.push(entry.id);
        return store.payload(entry);
      },
    };
    // klein: passt nur der kurze Fehler-Eintrag (ohne Payload) hinein, nicht die mit Payload
    const views = createHistoryViewsWith({ store: spy, wowData: fakeWowData, clock, searchLimit: 300 });
    await views.query(filter({ search: 'xyz' }), signal());
    expect(reads).toHaveLength(4);
    reads.length = 0;
    await views.query(filter({ search: 'xyz' }), signal());
    const uncached = reads.length;
    expect(uncached).toBeGreaterThan(0);
    expect(uncached).toBeLessThan(4);
    reads.length = 0;
    views.reload();
    await views.query(filter({ search: 'xyz' }), signal());
    expect(reads).toHaveLength(uncached);

    // groß genug: ab der zweiten Suche nichts mehr lesen
    reads.length = 0;
    const roomy = createHistoryViewsWith({ store: spy, wowData: fakeWowData, clock });
    await roomy.query(filter({ search: 'xyz' }), signal());
    await roomy.query(filter({ search: 'abc' }), signal());
    expect(reads).toHaveLength(4);
  });

  it('createSearchIndex zählt Zeichen und nimmt Zu-Großes nicht auf', async () => {
    const index = createSearchIndex(10);
    const e = (id: string): HistoryEntry => ({ id, folder: `/x/${id}`, info: {}, time: NOW, failed: false });
    let loads = 0;
    const load = (text: string) => () => { loads += 1; return Promise.resolve(text); };
    expect(await index.text(e('a'), load('123456'))).toBe('123456');
    expect(await index.text(e('a'), load('anders'))).toBe('123456');
    expect(await index.text(e('b'), load('12345'))).toBe('12345'); // 6 + 5 > 10
    expect(await index.text(e('b'), load('12345'))).toBe('12345');
    expect(index.size()).toBe(6);
    expect(loads).toBe(3);
  });
});

describe('Neu laden, Details, Ordner', () => {
  it('reload() liest neue Einträge; details() und folderOf()', async () => {
    const { store, views } = await setup(SAMPLE.slice(0, 1));
    expect((await views.query(filter(), signal())).rows).toHaveLength(1);
    const second = SAMPLE[1];
    if (!second) throw new Error('Beispiel fehlt');
    const added = await store.record(second);
    expect((await views.query(filter(), signal())).rows).toHaveLength(1); // noch die alte Liste
    // details findet den neuen Eintrag trotzdem (frisch gelesen)
    expect((await views.details(added.id))?.heading).toBe('NPC-Texte – 25.10.2026 um 13:40:00');
    views.reload();
    expect((await views.query(filter(), signal())).rows).toHaveLength(2);

    const details = await views.details(added.id);
    expect(details).toEqual({
      id: added.id,
      heading: 'NPC-Texte – 25.10.2026 um 13:40:00',
      body: [
        'Version: WoW Forever (deDE)', 'Ergebnis: 1 neu', '', 'Gesendet:',
        '\nSprache deDE, Build 1 – 1 Texte:', '#9  Seid gegrüßt',
      ].join('\n'),
    });
    expect(await views.folderOf(added.id)).toBe(added.folder);
    expect(await views.folderOf('../gibt-es-nicht')).toBeNull();
    expect(await views.details('gibt-es-nicht')).toBeNull();
  });
});
