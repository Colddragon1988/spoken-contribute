// Einstellungen (§5.3, Entscheidung 9).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSettingsStore } from '../../../src/core/settings';
import type { SettingsStore } from '../../../src/shared/types';
import { useSandbox } from '../../helpers/sandbox';
import { tempConfigDir } from './temp';

interface Setup {
  readonly configDir: string;
  readonly file: string;
  readonly store: SettingsStore;
  readonly searches: { count: number };
}

async function setup(found: string | null = null): Promise<Setup> {
  const configDir = await tempConfigDir();
  const searches = { count: 0 };
  const store = createSettingsStore({
    configDir,
    findWow: () => {
      searches.count += 1;
      return Promise.resolve(found);
    },
  });
  return { configDir, file: join(configDir, 'settings.json'), store, searches };
}

async function withFile(s: Setup, text: string): Promise<void> {
  await mkdir(s.configDir, { recursive: true });
  await writeFile(s.file, text);
}

const DEFAULTS = { wowDir: '', autoUpload: false, theme: 'system' };

describe('Einstellungen laden', () => {
  it('fehlende, kaputte oder Nicht-Objekt-Datei ergibt die Standardwerte', async () => {
    const s = await setup();
    expect(await s.store.load({ persistFound: true })).toEqual(DEFAULTS);
    for (const text of ['{kaputt', '[1, 2]', '"text"', 'null', '']) {
      await withFile(s, text);
      expect(await s.store.load({ persistFound: true })).toEqual(DEFAULTS);
    }
  });

  it('liest gültige Werte', async () => {
    const s = await setup();
    await withFile(s, '{"wow_dir": "/spiele/World of Warcraft", "auto_upload": true, "theme": "dunkel"}');
    expect(await s.store.load({ persistFound: true }))
      .toEqual({ wowDir: '/spiele/World of Warcraft', autoUpload: true, theme: 'dunkel' });
    expect(s.searches.count).toBe(0);
  });

  it('auto_upload nur bei exakt true, ungültiges Design → system', async () => {
    const s = await setup();
    for (const [auto, theme] of [['"true"', '"Dunkel"'], ['1', '"toString"'], ['null', '5'], ['{}', '"__proto__"']]) {
      await withFile(s, `{"wow_dir": "/w", "auto_upload": ${auto ?? ''}, "theme": ${theme ?? ''}}`);
      expect(await s.store.load({ persistFound: true })).toEqual({ wowDir: '/w', autoUpload: false, theme: 'system' });
    }
    await withFile(s, '{"wow_dir": "/w", "theme": "hell"}');
    expect((await s.store.load({ persistFound: true })).theme).toBe('hell');
  });

  it('wow_dir wie Python str(wert or ""): leere Werte → "", Zahlen als Text', async () => {
    const s = await setup();
    for (const value of ['""', 'null', 'false', '0', '[]', '{}']) {
      await withFile(s, `{"wow_dir": ${value}}`);
      expect((await s.store.load({ persistFound: false })).wowDir).toBe('');
    }
    await withFile(s, '{"wow_dir": 42}');
    expect((await s.store.load({ persistFound: false })).wowDir).toBe('42');
  });
});

describe('WoW-Ordner suchen', () => {
  it('ohne eingetragenen Ordner wird gesucht und der Fund sofort gespeichert', async () => {
    const s = await setup('/gefunden/World of Warcraft');
    await withFile(s, '{"wow_dir": "", "auto_upload": true, "theme": "hell"}');
    const settings = await s.store.load({ persistFound: true });
    expect(settings).toEqual({ wowDir: '/gefunden/World of Warcraft', autoUpload: true, theme: 'hell' });
    expect(s.searches.count).toBe(1);
    expect(await readFile(s.file, 'utf8')).toBe(
      '{\n  "wow_dir": "/gefunden/World of Warcraft",\n  "auto_upload": true,\n  "theme": "hell"\n}',
    );
    // beim nächsten Mal steht er drin, es wird nicht mehr gesucht
    await s.store.load({ persistFound: true });
    expect(s.searches.count).toBe(1);
  });

  it('persistFound:false schreibt nichts (Entscheidung 9)', async () => {
    const s = await setup('/gefunden/World of Warcraft');
    expect((await s.store.load({ persistFound: false })).wowDir).toBe('/gefunden/World of Warcraft');
    await expect(readFile(s.file, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(mkdir(s.configDir)).resolves.toBeUndefined(); // nicht einmal der Ordner wurde angelegt
  });

  it('nichts gefunden: nichts geschrieben', async () => {
    const s = await setup(null);
    expect((await s.store.load({ persistFound: true })).wowDir).toBe('');
    await expect(readFile(s.file, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('ein Schreibfehler beim Speichern des Fundes wird ignoriert', async () => {
    const s = await setup('/gefunden/World of Warcraft');
    await mkdir(`${s.file}.tmp`, { recursive: true }); // Zwischendatei blockiert
    expect((await s.store.load({ persistFound: true })).wowDir).toBe('/gefunden/World of Warcraft');
    await expect(readFile(s.file, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('Einstellungen speichern', () => {
  it('Einrückung 2, Umlaute direkt, ohne Zeilenende wie Python', async () => {
    const s = await setup();
    await s.store.save({ wowDir: 'C:\\Spiele\\Wörld of Warcraft', autoUpload: false, theme: 'dunkel' });
    expect(await readFile(s.file, 'utf8')).toBe(
      '{\n  "wow_dir": "C:\\\\Spiele\\\\Wörld of Warcraft",\n  "auto_upload": false,\n  "theme": "dunkel"\n}',
    );
    expect(await s.store.load({ persistFound: true }))
      .toEqual({ wowDir: 'C:\\Spiele\\Wörld of Warcraft', autoUpload: false, theme: 'dunkel' });
  });

  it('ein Schreibfehler wird weitergegeben, die alte Datei bleibt', async () => {
    const s = await setup();
    await s.store.save({ wowDir: '/w', autoUpload: true, theme: 'hell' });
    await mkdir(`${s.file}.tmp`);
    await expect(s.store.save({ wowDir: '/x', autoUpload: false, theme: 'system' })).rejects.toThrow();
    expect((await s.store.load({ persistFound: true })).wowDir).toBe('/w');
  });

  it('gleichzeitiges Speichern (Design per Pfeiltaste durchgeschaltet): jedes gelingt, die letzte Fassung bleibt', async () => {
    const s = await setup();
    const themes = ['hell', 'dunkel', 'system', 'hell', 'dunkel', 'system', 'hell', 'dunkel'] as const;
    // Ohne Reihenfolge teilen sich die Aufrufe settings.json.tmp: ENOENT/EPERM beim Umbenennen
    // oder eine Mischung aus zwei Fassungen in settings.json.
    await Promise.all(themes.map((theme, i) => s.store.save({ wowDir: `/w${'x'.repeat(i % 3)}`, autoUpload: i % 2 === 0, theme })));
    expect(JSON.parse(await readFile(s.file, 'utf8'))).toEqual({ wow_dir: '/wx', auto_upload: false, theme: 'dunkel' });
  });
});

describe('über createCore (Sandbox)', () => {
  it('core.settings liest und schreibt im Konfig-Ordner der Umgebung', async () => {
    const sandbox = await useSandbox();
    expect(await sandbox.core.settings.load({ persistFound: true })).toEqual(DEFAULTS); // findWow → null
    await sandbox.core.settings.save({ wowDir: sandbox.wow, autoUpload: true, theme: 'dunkel' });
    expect(JSON.parse(await readFile(join(sandbox.configDir, 'settings.json'), 'utf8')))
      .toEqual({ wow_dir: sandbox.wow, auto_upload: true, theme: 'dunkel' });
  });
});
