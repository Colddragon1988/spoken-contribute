// Versionsordner und Anzeigenamen (Spezifikation §2.1).
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import { createWowData } from '../../../src/core/wowdata';

const wowData = createWowData();

describe('flavorName', () => {
  it('bekannte Namen, ohne Groß/Klein-Unterscheidung', () => {
    expect(wowData.flavorName('_classic_era_')).toBe('Classic Era');
    expect(wowData.flavorName('_Classic_Era_')).toBe('Classic Era');
    expect(wowData.flavorName('_forever_')).toBe('WoW Forever');
    expect(wowData.flavorName('_classic_')).toBe('Classic');
    expect(wowData.flavorName('_anniversary_')).toBe('Anniversary');
    expect(wowData.flavorName('_ptr_')).toBe('PTR');
    expect(wowData.flavorName('_classic_ptr_')).toBe('Classic PTR');
  });

  it('unbekannte Ordner ohne _ außen, wie str.strip("_")', () => {
    expect(wowData.flavorName('_retail_')).toBe('retail');
    expect(wowData.flavorName('__beta__')).toBe('beta');
    expect(wowData.flavorName('___')).toBe('');
    expect(wowData.flavorName('__proto__')).toBe('proto');
    expect(wowData.flavorName('_constructor_')).toBe('constructor');
  });
});

describe('spokenFlavors', () => {
  it('nur _*_-Ordner mit Interface/AddOns/Spoken, sortiert', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spoken-test-'));
    onTestFinished(() => rm(root, { recursive: true, force: true }));
    const wow = join(root, 'World of Warcraft');
    const spoken = (name: string) => mkdir(join(wow, name, 'Interface', 'AddOns', 'Spoken'), { recursive: true });
    await spoken('_forever_');
    await spoken('_classic_era_');
    await spoken('retail'); // kein _*_
    await spoken('_');
    await mkdir(join(wow, '_retail_', 'Interface', 'AddOns', 'Andere'), { recursive: true }); // ohne Spoken
    await mkdir(join(wow, '_ptr_', 'Interface', 'AddOns'), { recursive: true });
    await writeFile(join(wow, '_ptr_', 'Interface', 'AddOns', 'Spoken'), ''); // Datei statt Ordner
    expect(await wowData.spokenFlavors(wow)).toEqual([
      { dir: join(wow, '_classic_era_'), folder: '_classic_era_', name: 'Classic Era' },
      { dir: join(wow, '_forever_'), folder: '_forever_', name: 'WoW Forever' },
    ]);
  });

  it('fehlender WoW-Ordner: keine Versionen', async () => {
    expect(await wowData.spokenFlavors(join(tmpdir(), 'spoken-gibt-es-nicht-' + String(process.pid)))).toEqual([]);
  });
});
