// Portiert aus tests/test_wowdata.py::Cache, dazu Randfälle aus Spezifikation §5.2.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Buffer } from 'node:buffer';
import { describe, expect, it, onTestFinished } from 'vitest';
import { createWowData, parseCache } from '../../../src/core/wowdata';
import type { Flavor } from '../../../src/shared/types';
import { dbcache } from '../../helpers/fixtures';

const wowData = createWowData();

/** Nachbau von Sandbox.flavor()/cache() aus tests/helpers.py, ohne den übrigen Kern. */
async function tempWow() {
  const root = await mkdtemp(join(tmpdir(), 'spoken-test-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const wow = join(root, 'World of Warcraft');
  return {
    flavor(name = '_classic_era_'): Flavor {
      return { dir: join(wow, name), folder: name, name: wowData.flavorName(name) };
    },
    async cache(flavor: Flavor, lang = 'deDE'): Promise<string> {
      const dir = join(flavor.dir, 'Cache', 'ADB', lang);
      await mkdir(dir, { recursive: true });
      return join(dir, 'DBCache.bin');
    },
  };
}

const rows = (texts: ReadonlyMap<number, unknown>): number[] => [...texts.keys()].sort((a, b) => a - b);

describe('Cache', () => {
  it('test_reads_only_live_broadcast_texts', () => {
    const data = Buffer.concat([
      dbcache(70003, [[1, 'Hallo', 'Hallo'], [2, 'Er', 'Sie']]),
      dbcache(70003, [[3, 'gelöscht', '']], 2).subarray(44),
      dbcache(70003, [[4, 'andere Tabelle', '']], 1, 0x12345678).subarray(44),
    ]);
    const { build, texts } = parseCache(data);
    expect(build).toBe(70003);
    expect(rows(texts)).toEqual([1, 2]);
    expect(texts.get(2)).toEqual({ id: 2, text: 'Er', text1: 'Sie' });
  });

  it('test_broken_files_do_not_crash', async () => {
    const t = await tempWow();
    const path = await t.cache(t.flavor());
    const cases = [
      Buffer.alloc(0), Buffer.from('kaputt'), dbcache(1, [[1, 'a', 'b']]).subarray(0, -5),
      Buffer.concat([Buffer.from('XFTH'), Buffer.alloc(60)]),
    ];
    for (const data of cases) {
      await writeFile(path, data);
      await wowData.newestTexts([path]); // über die Datei, wie parse_cache(path) in Python
      parseCache(data);
    }
  });

  it('test_newest_build_wins', async () => {
    const t = await tempWow();
    const folder = dirname(await t.cache(t.flavor()));
    await writeFile(join(folder, 'DBCache.bin'), dbcache(70003, [[1, 'neu', '']]));
    await writeFile(join(folder, 'DBCache.bin1652.tmp'), dbcache(60000, [[1, 'alt', ''], [2, 'nur alt', '']]));
    const byBuild = await wowData.newestTexts(await wowData.cacheFiles(folder));
    expect(byBuild.get(70003)?.map((r) => r.text)).toEqual(['neu']);
    expect(byBuild.get(60000)?.map((r) => r.text)).toEqual(['nur alt']);
  });
});

describe('DBCache – Randfälle', () => {
  it('fehlende Datei: keine Texte; fehlender Kopf-MAGIC oder zu kurz: Build 0', async () => {
    const t = await tempWow();
    expect(await wowData.newestTexts([join(t.flavor().dir, 'fehlt', 'DBCache.bin')])).toEqual(new Map());
    expect(parseCache(Buffer.alloc(43))).toEqual({ build: 0, texts: new Map() });
    expect(parseCache(Buffer.concat([Buffer.from('XFTX'), dbcache(5, [[1, 'a', '']]).subarray(4)])).build).toBe(0);
  });

  it('abgebrochener Eintrag: alles davor gilt; fehlender Nullterminator oder zwei leere Texte: übersprungen', () => {
    const good = dbcache(9, [[1, 'eins', '']]);
    const noNul = dbcache(9, [[2, 'x', '']]).subarray(44);
    noNul.fill(0x41, 32); // Daten ohne Nullbyte
    const empty = dbcache(9, [[3, '', '']]).subarray(44);
    const female = dbcache(9, [[4, '', 'sie']]).subarray(44);
    const cut = dbcache(9, [[5, 'abgeschnitten', '']]).subarray(44, 60);
    const { build, texts } = parseCache(Buffer.concat([good, noNul, empty, female, cut]));
    expect(build).toBe(9);
    expect([...texts.values()]).toEqual([{ id: 1, text: 'eins', text1: '' }, { id: 4, text: '', text1: 'sie' }]);
  });

  it('fremde Bytes statt MAGIC beenden das Lesen', () => {
    const data = Buffer.concat([dbcache(9, [[1, 'a', '']]), Buffer.alloc(40, 1), dbcache(9, [[2, 'b', '']]).subarray(44)]);
    expect(rows(parseCache(data).texts)).toEqual([1]);
  });

  it('dieselbe ID später in der Datei überschreibt, behält aber ihren Platz', () => {
    const data = Buffer.concat([dbcache(9, [[7, 'alt', ''], [8, 'x', '']]), dbcache(9, [[7, 'neu', '']]).subarray(44)]);
    expect([...parseCache(data).texts.values()].map((r) => r.text)).toEqual(['neu', 'x']);
  });

  it('kaputtes UTF-8 in Texten wird zu U+FFFD', () => {
    const data = dbcache(9, [[1, 'ä', '']]);
    data[data.length - 12] = 0xff; // erstes Byte von "ä" → kaputt
    expect(parseCache(data).texts.get(1)?.text).toBe('��');
  });

  it('newestTexts: bei gleichem Build gewinnt die spätere Datei; Reihenfolge der IDs und Builds bleibt', async () => {
    const t = await tempWow();
    const folder = dirname(await t.cache(t.flavor()));
    await writeFile(join(folder, 'DBCache.bin'), dbcache(100, [[1, 'erste', ''], [2, 'b', '']]));
    await writeFile(join(folder, 'DBCache.bin1.tmp'), dbcache(100, [[1, 'zweite', ''], [3, 'c', '']]));
    await writeFile(join(folder, 'DBCache.bin2.tmp'), dbcache(50, [[4, 'd', ''], [2, 'alt', '']]));
    const byBuild = await wowData.newestTexts(await wowData.cacheFiles(folder));
    expect([...byBuild.keys()]).toEqual([100, 50]);
    expect(byBuild.get(100)?.map((r) => r.text)).toEqual(['zweite', 'b', 'c']);
    expect(byBuild.get(50)?.map((r) => r.text)).toEqual(['d']);
  });

  it('cacheFolders: nur Ordner mit genau einer Client-Sprache, je Version sortiert', async () => {
    const t = await tempWow();
    const era = t.flavor('_classic_era_');
    const classic = t.flavor('_classic_');
    for (const lang of ['frFR', 'deDE', 'dede', 'xxXX']) await t.cache(era, lang);
    await t.cache(classic, 'enUS');
    const adb = (f: Flavor, lang: string): string => join(f.dir, 'Cache', 'ADB', lang);
    expect(await wowData.cacheFolders([era, classic])).toEqual([adb(era, 'deDE'), adb(era, 'frFR'), adb(classic, 'enUS')]);
    expect(await wowData.cacheFolders([t.flavor('_ohne_')])).toEqual([]);
  });

  it('cacheFiles: DBCache.bin* sortiert, andere Dateien nicht', async () => {
    const t = await tempWow();
    const folder = dirname(await t.cache(t.flavor()));
    for (const name of ['DBCache.bin', 'DBCache.bin1652.tmp', 'DBCache.bin.old', 'Other.bin', 'xDBCache.bin']) {
      await writeFile(join(folder, name), '');
    }
    expect(await wowData.cacheFiles(folder)).toEqual(
      ['DBCache.bin', 'DBCache.bin.old', 'DBCache.bin1652.tmp'].map((n) => join(folder, n)));
    expect(await wowData.cacheFiles(join(folder, 'fehlt'))).toEqual([]);
  });
});
