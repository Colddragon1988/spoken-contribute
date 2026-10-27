// Portierung von tests/test_history_settings_system.py::History (4 Tests) über die Sandbox
// (createCore verdrahtet alle Pakete). Dieselben Abläufe mit eigenen Fakes: archive.test.ts.
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { casefold } from '../../../src/shared/casefold';
import { daily, detailsText, statistics } from '../../../src/core/history';
import { contributionsLua, envelope } from '../../helpers/fixtures';
import { useSandbox } from '../../helpers/sandbox';

const DAY = 86_400_000;

describe('History', () => {
  it('test_entries_newest_first_with_search_and_statistics', async () => {
    const box = await useSandbox();
    const history = box.core.history;
    const now = box.clock.now();
    await history.record({
      kind: 'zeilen',
      info: { status: 'ok', versionen: ['Classic Era'], anzahl: 2, ergebnis: { neu: 1, bekannt: 1 } },
      payload: { gesendet: { envelopes: [envelope(1), envelope(2)] } },
      when: new Date(now.getTime() - DAY),
    });
    await history.record({
      kind: 'npc-texte',
      info: { status: 'ok', versionen: ['WoW Forever'], sprache: 'deDE', anzahl: 1, ergebnis: { neu: 1, aktualisiert: 0 } },
      payload: { gesendet: [{ lang: 'deDE', build: 1, texts: [{ id: 9, text: 'Seid gegrüßt', text1: '' }] }] },
      when: now,
    });
    await history.record({ // eigene Sekunde, sonst ist die Reihenfolge offen
      kind: 'zeilen',
      info: { status: 'fehler', versionen: ['Classic Era'], fehler: 'Server-Fehler 500' },
      when: new Date(now.getTime() + 1000),
    });
    const entries = await history.entries();
    expect(entries.map((e) => e.info.art)).toEqual(['zeilen', 'npc-texte', 'zeilen']);
    const searchText = async (i: number): Promise<string> => {
      const entry = entries[i];
      if (!entry) throw new Error('Eintrag fehlt');
      return casefold(detailsText(entry, await history.payload(entry), (e) => box.core.wowData.parseEnvelope(e)));
    };
    expect(await searchText(2)).toContain('quest 2');
    expect(await searchText(1)).toContain(casefold('seid gegrüßt'));

    const stats = statistics(entries);
    expect([stats.uploads, stats.failed, stats.lines, stats.texts]).toEqual([2, 1, 2, 1]);
    expect(Object.fromEntries(stats.perVersion)).toEqual({ 'Classic Era': [2, 0], 'WoW Forever': [0, 1] });
    const days = daily(entries, box.clock.now(), 30);
    expect(days).toHaveLength(30);
    expect([days[29]?.lines, days[29]?.texts]).toEqual([0, 1]);
    expect([days[28]?.lines, days[28]?.texts]).toEqual([2, 0]);

    // dasselbe über die Ansicht des Fensters
    const result = await box.core.historyViews.query({ search: 'Quest 2', art: 'alle', version: '' }, new AbortController().signal);
    expect(result.rows.map((r) => r.art)).toEqual(['Gesammelte Zeilen']);
  });

  it('test_entry_without_time_zone_or_broken_is_still_sortable', async () => {
    const box = await useSandbox();
    const history = box.core.history;
    await history.record({ kind: 'zeilen', info: { status: 'ok', anzahl: 1 } });
    const broken: [string, unknown][] = [
      ['ohne-zone', { zeit: '2026-10-20T10:00:00', art: 'zeilen' }],
      ['liste', ['kein', 'dict']],
      ['ohne-zeit', { art: 'zeilen' }],
    ];
    for (const [name, info] of broken) {
      const folder = join(history.root, name);
      await mkdir(folder);
      await writeFile(join(folder, 'eintrag.json'), JSON.stringify(info), 'utf8');
    }
    const found = await history.entries();
    expect(found).toHaveLength(2);
    expect(found.at(-1)?.id).toBe('ohne-zone');
  });

  it('test_old_archive_is_migrated', async () => {
    const box = await useSandbox();
    const old = join(box.dataDir, '2026-10-24_17-23-10_classic_era_ACC_SpokenContributions.lua');
    await mkdir(box.dataDir, { recursive: true });
    await writeFile(old, contributionsLua([envelope(1)]));
    await box.core.history.migrateOldArchive();
    const [entry, ...rest] = await box.core.history.entries();
    expect(rest).toEqual([]);
    if (!entry) throw new Error('kein Eintrag');
    expect((await box.core.history.payload(entry))?.gesendet).toEqual({ envelopes: [envelope(1)] });
    expect(existsSync(old)).toBe(false);
  });

  it('test_old_archive_with_impossible_time_stays_put', async () => {
    const box = await useSandbox();
    const good = join(box.dataDir, '2026-10-24_17-23-10_ACC_SpokenContributions.lua');
    const bad = join(box.dataDir, '2026-13-45_17-23-10_ACC_SpokenContributions.lua');
    await mkdir(box.dataDir, { recursive: true });
    for (const path of [good, bad]) await writeFile(path, contributionsLua([envelope(1)]));
    await box.core.history.migrateOldArchive();
    expect(await box.core.history.entries()).toHaveLength(1);
    expect(existsSync(good)).toBe(false);
    expect(existsSync(bad)).toBe(true);
  });
});
