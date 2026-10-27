// Archiv schreiben und lesen (§5.5) direkt, mit eigener WowData-Attrappe – ohne die anderen Pakete.
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { createHistoryStore, MIGRATION_NOTE } from '../../../src/core/history';
import { casefold } from '../../../src/shared/casefold';
import { daily, detailsText, statistics } from '../../../src/core/history';
import { contributionsLua, envelope } from '../../helpers/fixtures';
import { fakeWowData, FixedClock, parseEnvelope, pyGzip, pyJsonDumps, tempDir } from './helpers';

const DAY = 86_400_000;

async function setup(now = new Date(2026, 9, 25, 14, 3, 12)) {
  const dataDir = join(await tempDir(), 'data');
  const clock = new FixedClock(now);
  const store = createHistoryStore({ dataDir, clock, wowData: fakeWowData });
  return { dataDir, clock, store };
}

describe('History (direkt, mit Attrappen)', () => {
  it('test_entries_newest_first_with_search_and_statistics (direkt)', async () => {
    const { store, clock } = await setup(new Date());
    const now = clock.now();
    await store.record({
      kind: 'zeilen',
      info: { status: 'ok', versionen: ['Classic Era'], anzahl: 2, ergebnis: { neu: 1, bekannt: 1 } },
      payload: { gesendet: { envelopes: [envelope(1), envelope(2)] } },
      when: new Date(now.getTime() - DAY),
    });
    await store.record({
      kind: 'npc-texte',
      info: { status: 'ok', versionen: ['WoW Forever'], sprache: 'deDE', anzahl: 1, ergebnis: { neu: 1, aktualisiert: 0 } },
      payload: { gesendet: [{ lang: 'deDE', build: 1, texts: [{ id: 9, text: 'Seid gegrüßt', text1: '' }] }] },
      when: now,
    });
    await store.record({
      kind: 'zeilen',
      info: { status: 'fehler', versionen: ['Classic Era'], fehler: 'Server-Fehler 500' },
      when: new Date(now.getTime() + 1000),
    });
    const entries = await store.entries();
    expect(entries.map((e) => e.info.art)).toEqual(['zeilen', 'npc-texte', 'zeilen']);
    const text = async (i: number): Promise<string> => {
      const entry = entries[i];
      if (!entry) throw new Error('Eintrag fehlt');
      return casefold(detailsText(entry, await store.payload(entry), parseEnvelope));
    };
    expect(await text(2)).toContain('quest 2');
    expect(await text(1)).toContain(casefold('seid gegrüßt'));
    const stats = statistics(entries);
    expect([stats.uploads, stats.failed, stats.lines, stats.texts]).toEqual([2, 1, 2, 1]);
    expect(Object.fromEntries(stats.perVersion)).toEqual({ 'Classic Era': [2, 0], 'WoW Forever': [0, 1] });
    const days = daily(entries, now, 30);
    expect(days).toHaveLength(30);
    expect([days[29]?.lines, days[29]?.texts]).toEqual([0, 1]);
    expect([days[28]?.lines, days[28]?.texts]).toEqual([2, 0]);
  });

  it('test_entry_without_time_zone_or_broken_is_still_sortable (direkt)', async () => {
    const { store } = await setup(new Date());
    await store.record({ kind: 'zeilen', info: { status: 'ok', anzahl: 1 } });
    const broken: [string, unknown][] = [
      ['ohne-zone', { zeit: '2026-10-20T10:00:00', art: 'zeilen' }],
      ['liste', ['kein', 'dict']],
      ['ohne-zeit', { art: 'zeilen' }],
    ];
    for (const [name, info] of broken) {
      await mkdir(join(store.root, name));
      await writeFile(join(store.root, name, 'eintrag.json'), JSON.stringify(info), 'utf8');
    }
    const found = await store.entries();
    expect(found).toHaveLength(2);
    expect(found.at(-1)?.id).toBe('ohne-zone');
    // ohne Zeitzone = Ortszeit
    expect(found.at(-1)?.time.getTime()).toBe(new Date(2026, 9, 20, 10, 0, 0).getTime());
  });

  it('test_old_archive_is_migrated (direkt)', async () => {
    const { store, dataDir } = await setup();
    const old = join(dataDir, '2026-10-24_17-23-10_classic_era_ACC_SpokenContributions.lua');
    await mkdir(dataDir, { recursive: true });
    await writeFile(old, contributionsLua([envelope(1)]));
    await store.migrateOldArchive();
    const [entry, ...rest] = await store.entries();
    expect(rest).toEqual([]);
    if (!entry) throw new Error('kein Eintrag');
    expect((await store.payload(entry))?.gesendet).toEqual({ envelopes: [envelope(1)] });
    expect(existsSync(old)).toBe(false);
  });

  it('test_old_archive_with_impossible_time_stays_put (direkt)', async () => {
    const { store, dataDir } = await setup();
    const good = join(dataDir, '2026-10-24_17-23-10_ACC_SpokenContributions.lua');
    const bad = join(dataDir, '2026-13-45_17-23-10_ACC_SpokenContributions.lua');
    await mkdir(dataDir, { recursive: true });
    for (const path of [good, bad]) await writeFile(path, contributionsLua([envelope(1)]));
    await store.migrateOldArchive();
    expect(await store.entries()).toHaveLength(1);
    expect(existsSync(good)).toBe(false);
    expect(existsSync(bad)).toBe(true);
  });
});

describe('Archiv schreiben', () => {
  it('schreibt eintrag.json wie Python: Einrückung 2, zeit/art zuerst, UTF-8 ohne Escapes', async () => {
    const { store } = await setup();
    const entry = await store.record({
      kind: 'zeilen',
      info: { status: 'ok', versionen: ['Classic Era'], anzahl: 1, zusammenfassung: '1 Quest- und Gesprächszeilen', titel: [], ergebnis: { neu: 1, bekannt: 0, abgelehnt: 0 } },
    });
    expect(entry.id).toBe('2026-10-25_14-03-12_zeilen');
    expect(entry.failed).toBe(false);
    const raw = await readFile(join(entry.folder, 'eintrag.json'), 'utf8');
    expect(raw).toBe([
      '{',
      '  "zeit": "2026-10-25T14:03:12+01:00",',
      '  "art": "zeilen",',
      '  "status": "ok",',
      '  "versionen": [',
      '    "Classic Era"',
      '  ],',
      '  "anzahl": 1,',
      '  "zusammenfassung": "1 Quest- und Gesprächszeilen",',
      '  "titel": [],',
      '  "ergebnis": {',
      '    "neu": 1,',
      '    "bekannt": 0,',
      '    "abgelehnt": 0',
      '  }',
      '}',
    ].join('\n'));
    // byte-gleich zu json.dumps(info, ensure_ascii=False, indent=2)
    expect(raw).toBe(pyJsonDumps(JSON.parse(raw) as never, { indent: 2, ensureAscii: false }));
  });

  it('Sommerzeit: Offset +02:00, Ordner in Ortszeit', async () => {
    const { store } = await setup(new Date(2026, 6, 1, 9, 5, 7));
    const entry = await store.record({ kind: 'npc-texte', info: { status: 'ok' } });
    expect(entry.id).toBe('2026-07-01_09-05-07_npc-texte');
    expect(entry.info.zeit).toBe('2026-07-01T09:05:07+02:00');
  });

  it('schreibt daten.json.gz mit Einrückung 1 und ohne \\u-Escapes', async () => {
    const { store } = await setup();
    const payload = { gesendet: { envelopes: ['ä'], name: null, email: null, website: '' }, antwort: { ok: true } };
    const entry = await store.record({ kind: 'zeilen', info: { status: 'ok' }, payload });
    const text = gunzipSync(await readFile(join(entry.folder, 'daten.json.gz'))).toString('utf8');
    expect(text).toBe(pyJsonDumps(payload, { indent: 1, ensureAscii: false }));
    expect(text.split('\n').slice(0, 4)).toEqual(['{', ' "gesendet": {', '  "envelopes": [', '   "ä"']);
    expect(await store.payload(entry)).toEqual(payload);
  });

  it('ohne Payload keine daten.json.gz; payload() liefert null', async () => {
    const { store } = await setup();
    const entry = await store.record({ kind: 'zeilen', info: { status: 'fehler', fehler: 'x' } });
    expect(await readdir(entry.folder)).toEqual(['eintrag.json']);
    expect(entry.failed).toBe(true);
    expect(await store.payload(entry)).toBeNull();
  });

  it('gleiche Sekunde: Ordner -2, -3; Sortierung -2 vor dem ersten', async () => {
    const { store } = await setup();
    const a = await store.record({ kind: 'zeilen', info: { status: 'ok', n: 1 } });
    const b = await store.record({ kind: 'zeilen', info: { status: 'ok', n: 2 } });
    const c = await store.record({ kind: 'zeilen', info: { status: 'ok', n: 3 } });
    expect([a.id, b.id, c.id]).toEqual(['2026-10-25_14-03-12_zeilen', '2026-10-25_14-03-12_zeilen-2', '2026-10-25_14-03-12_zeilen-3']);
    expect((await store.entries()).map((e) => e.id)).toEqual([c.id, b.id, a.id]);
  });

  it('Abbruch vor eintrag.json: Eintrag bleibt unsichtbar', async () => {
    const { store, dataDir } = await setup();
    await expect(store.record({
      kind: 'zeilen', info: { status: 'ok' }, payload: { gesendet: { envelopes: [] } },
      originals: [{ source: join(dataDir, 'gibt-es-nicht.lua'), name: 'classic_era/ACC/SpokenContributions.lua' }],
    })).rejects.toThrow();
    const [folder] = await readdir(store.root);
    expect(folder).toBe('2026-10-25_14-03-12_zeilen');
    expect(existsSync(join(store.root, folder ?? '', 'daten.json.gz'))).toBe(true); // schon geschrieben …
    expect(existsSync(join(store.root, folder ?? '', 'eintrag.json'))).toBe(false); // … aber kein Eintrag
    expect(await store.entries()).toEqual([]);
  });

  it('kopiert Originale mit Zeitstempel nach originale/<Version>/<Account>/', async () => {
    const { store, dataDir } = await setup();
    const source = join(dataDir, 'quelle.lua');
    await mkdir(dataDir, { recursive: true });
    await writeFile(source, 'inhalt');
    const mtime = new Date(2026, 0, 2, 3, 4, 5);
    await utimes(source, mtime, mtime);
    const entry = await store.record({
      kind: 'zeilen', info: { status: 'ok' },
      originals: [{ source, name: 'classic_era/ACC/SpokenContributions.lua' }],
    });
    const target = join(entry.folder, 'originale', 'classic_era', 'ACC', 'SpokenContributions.lua');
    expect(await readFile(target, 'utf8')).toBe('inhalt');
    expect(Math.round((await stat(target)).mtimeMs / 1000)).toBe(Math.round(mtime.getTime() / 1000));
  });

  it('kein Verlaufsordner: entries() ist leer', async () => {
    const { store } = await setup();
    expect(await store.entries()).toEqual([]);
  });
});

describe('Einträge der Python-Fassung lesen', () => {
  it('kompaktes JSON mit \\uXXXX, Offset, gzip mit Dateinamen im Kopf', async () => {
    const { store } = await setup();
    const folder = join(store.root, '2026-10-24_10-00-00_npc-texte');
    await mkdir(folder, { recursive: true });
    const info = {
      zeit: '2026-10-24T10:00:00+02:00', art: 'npc-texte', versionen: ['WoW Forever'], sprache: 'deDE',
      builds: [1], anzahl: 1, zu_lang: 0, status: 'ok', ergebnis: { neu: 1, aktualisiert: 0 },
    };
    const raw = pyJsonDumps(info); // json.dumps(info) – Trenner ", " und Escapes
    expect(raw).toContain('{"zeit": "2026-10-24T10:00:00+02:00", "art": "npc-texte"');
    await writeFile(join(folder, 'eintrag.json'), raw, 'utf8');
    const payload = { gesendet: [{ lang: 'deDE', build: 1, texts: [{ id: 9, text: 'Seid gegrüßt', text1: '' }] }], antwort: [{ texts: 1, added: 1, changed: 0 }], nicht_gesendet: [] };
    const gz = pyJsonDumps(payload, { indent: 1 });
    expect(gz).toContain('gegr\\u00fc\\u00dft');
    await writeFile(join(folder, 'daten.json.gz'), pyGzip(gz));
    const [entry] = await store.entries();
    if (!entry) throw new Error('nicht gelesen');
    expect(entry.time.getTime()).toBe(new Date(2026, 9, 24, 10, 0, 0).getTime());
    expect(entry.failed).toBe(false);
    expect(entry.info).toEqual(info);
    expect(await store.payload(entry)).toEqual(payload);
  });

  it('Python-Migration (Einrückung 2, hinweis, kein ergebnis) und Zeit ohne Offset', async () => {
    const { store } = await setup();
    const folder = join(store.root, '2026-10-24_17-23-10_zeilen');
    await mkdir(folder, { recursive: true });
    const info = {
      zeit: '2026-10-24T17:23:10', art: 'zeilen', status: 'ok', versionen: ['Classic Era'], anzahl: 1,
      zusammenfassung: '1 Quest- und Gesprächszeilen', titel: ['Quest 1'], hinweis: MIGRATION_NOTE,
    };
    await writeFile(join(folder, 'eintrag.json'), pyJsonDumps(info, { indent: 2, ensureAscii: false }), 'utf8');
    await writeFile(join(folder, 'daten.json.gz'), pyGzip(pyJsonDumps({ gesendet: { envelopes: [envelope(1)] } }, { indent: 1, ensureAscii: false })));
    const [entry] = await store.entries();
    if (!entry) throw new Error('nicht gelesen');
    expect(entry.time.getTime()).toBe(new Date(2026, 9, 24, 17, 23, 10).getTime());
    expect((await store.payload(entry))?.gesendet).toEqual({ envelopes: [envelope(1)] });
  });

  it('übergeht kaputte Einträge (BOM, ungültiges UTF-8, kaputtes JSON, Zeit kein String, unmögliche Zeit)', async () => {
    const { store } = await setup();
    const files: [string, Buffer][] = [
      ['bom', Buffer.from('﻿{"zeit": "2026-10-24T10:00:00+02:00"}', 'utf8')],
      ['utf8', Buffer.concat([Buffer.from('{"zeit": "2026-10-24T10:00:00+02:00", "x": "'), Buffer.from([0xff]), Buffer.from('"}')])],
      ['json', Buffer.from('{"zeit": ')],
      ['zahl', Buffer.from('{"zeit": 5}')],
      ['monat13', Buffer.from('{"zeit": "2026-13-01T10:00:00"}')],
      ['gut', Buffer.from('{"zeit": "2026-10-24T10:00:00+02:00"}')],
    ];
    for (const [name, body] of files) {
      await mkdir(join(store.root, name), { recursive: true });
      await writeFile(join(store.root, name, 'eintrag.json'), body);
    }
    await writeFile(join(store.root, 'datei-statt-ordner'), 'x');
    const found = await store.entries();
    expect(found.map((e) => e.id)).toEqual(['gut']);
    expect(found[0]?.failed).toBe(true); // kein status "ok"
  });

  it('kaputte daten.json.gz ergibt keine Payload', async () => {
    const { store } = await setup();
    const entry = await store.record({ kind: 'zeilen', info: { status: 'ok' } });
    await writeFile(join(entry.folder, 'daten.json.gz'), 'kein gzip');
    expect(await store.payload(entry)).toBeNull();
    await writeFile(join(entry.folder, 'daten.json.gz'), pyGzip('[1, 2]'));
    expect(await store.payload(entry)).toBeNull(); // kein Objekt
  });
});

describe('Migration', () => {
  it('führt .lua und .bak einer Sekunde zusammen, Versionen und Originale wie Python', async () => {
    const { store, dataDir } = await setup();
    await mkdir(dataDir, { recursive: true });
    const stamp = '2026-10-24_17-23-10';
    await writeFile(join(dataDir, `${stamp}_forever_ACC_SpokenContributions.lua`), contributionsLua([envelope(1), envelope(2)]));
    await writeFile(join(dataDir, `${stamp}_forever_ACC_SpokenContributions.lua.bak`), contributionsLua([envelope(2), envelope(3, 'books')]));
    await writeFile(join(dataDir, `${stamp}_ZWEI_SpokenContributions.lua`), contributionsLua([envelope(1)]));
    await writeFile(join(dataDir, `${stamp}_retail_X_SpokenContributions.lua`), contributionsLua([]));
    await writeFile(join(dataDir, 'anderes_SpokenContributions.lua'), 'bleibt');
    await store.migrateOldArchive();
    const [entry, ...rest] = await store.entries();
    expect(rest).toEqual([]);
    if (!entry) throw new Error('kein Eintrag');
    expect(entry.id).toBe(`${stamp}_zeilen`);
    expect(entry.info).toEqual({
      zeit: '2026-10-24T17:23:10+02:00', art: 'zeilen', status: 'ok',
      versionen: ['Classic Era', 'WoW Forever', 'retail'], anzahl: 3,
      zusammenfassung: '2 Quest- und Gesprächszeilen, 1 Buchseiten', titel: ['Quest 1', 'Quest 2', 'Buch 3'],
      hinweis: MIGRATION_NOTE,
    });
    expect((await store.payload(entry))?.gesendet).toEqual({ envelopes: [envelope(1), envelope(2), envelope(3, 'books')] });
    const originals = join(entry.folder, 'originale');
    expect((await readdir(originals)).sort()).toEqual(['classic_era', 'forever', 'retail']);
    expect((await readdir(join(originals, 'forever', 'ACC'))).sort()).toEqual(['SpokenContributions.lua', 'SpokenContributions.lua.bak']);
    expect(await readdir(join(originals, 'classic_era', 'ZWEI'))).toEqual(['SpokenContributions.lua']);
    expect((await readdir(dataDir)).sort()).toEqual(['anderes_SpokenContributions.lua', 'verlauf']);
  });

  it('ohne Datenordner passiert nichts', async () => {
    const { store } = await setup();
    await expect(store.migrateOldArchive()).resolves.toBeUndefined();
  });
});
