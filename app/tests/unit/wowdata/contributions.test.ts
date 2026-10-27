// Portiert aus tests/test_wowdata.py::Contributions, dazu Entscheidung 6 / V10 und Randfälle
// des Leerens (§2.4). Alles in einem Temp-Ordner – nie die echte WoW-Installation (Regel 1).
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import {
  backupOf, cleared, contributionFiles, createWowData, envelopesInBytes,
} from '../../../src/core/wowdata';
import type { Flavor } from '../../../src/shared/types';
import { contributionsLua, envelope } from '../../helpers/fixtures';

const wowData = createWowData();

/** Nachbau von Sandbox.flavor()/lua() aus tests/helpers.py, ohne den übrigen Kern. */
async function tempWow() {
  const root = await mkdtemp(join(tmpdir(), 'spoken-test-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const wow = join(root, 'World of Warcraft');
  return {
    wow,
    async flavor(name = '_classic_era_'): Promise<Flavor> {
      const dir = join(wow, name);
      await mkdir(join(dir, 'Interface', 'AddOns', 'Spoken'), { recursive: true });
      return { dir, folder: name, name: wowData.flavorName(name) };
    },
    async lua(flavor: Flavor, account = 'ACC'): Promise<string> {
      const dir = join(flavor.dir, 'WTF', 'Account', account, 'SavedVariables');
      await mkdir(dir, { recursive: true });
      return join(dir, 'SpokenContributions.lua');
    },
  };
}

const exists = (path: string): Promise<boolean> => readFile(path).then(() => true, () => false);

describe('Contributions', () => {
  it('test_envelopes_survive_the_lua_file_bit_exact', async () => {
    const t = await tempWow();
    const originals = [envelope(1), envelope(2, 'books'), envelope(3, 'quests', 'Zeile 1\nZeile 2 \\n kein Umbruch')];
    const lua = await t.lua(await t.flavor());
    await writeFile(lua, contributionsLua(originals));
    expect(await wowData.envelopesIn(lua)).toEqual(originals);
  });

  it('test_lua_and_bak_are_merged_without_duplicates', async () => {
    const t = await tempWow();
    const flavor = await t.flavor();
    const lua = await t.lua(flavor);
    await writeFile(lua, contributionsLua([envelope(1), envelope(2)]));
    await writeFile(backupOf(lua), contributionsLua([envelope(2), envelope(3)]));
    const stores = await wowData.collectContributions([flavor]);
    expect(stores).toHaveLength(1);
    expect(stores[0]?.lua).toBe(lua);
    expect(stores[0]?.flavor).toBe(flavor);
    expect(stores[0]?.envelopes).toEqual([envelope(1), envelope(2), envelope(3)]);
  });

  it('test_bak_without_lua_counts', async () => {
    const t = await tempWow();
    const flavor = await t.flavor();
    const lua = await t.lua(flavor);
    await writeFile(backupOf(lua), contributionsLua([envelope(7)]));
    const stores = await wowData.collectContributions([flavor]);
    expect(stores[0]?.lua).toBe(lua);
    expect(stores[0]?.envelopes).toEqual([envelope(7)]);
  });

  it('test_clearing_keeps_flags_with_crlf', async () => {
    const t = await tempWow();
    const lua = await t.lua(await t.flavor());
    await writeFile(lua, contributionsLua([envelope(1)], { crlf: true }));
    await writeFile(backupOf(lua), contributionsLua([envelope(1)]));
    expect(await wowData.clearContributions([lua], new Set([envelope(1)]))).toEqual([]);
    const text = await readFile(lua, 'utf8');
    expect(text).toContain('["Enabled"] = true,');
    expect(text).toContain('["Introduced"] = false,');
    expect(await wowData.envelopesIn(lua)).toEqual([]);
    expect(await exists(backupOf(lua))).toBe(false);
  });

  it('test_file_with_unsent_lines_is_not_cleared', async () => {
    const t = await tempWow();
    const lua = await t.lua(await t.flavor());
    await writeFile(lua, contributionsLua([envelope(1), envelope(2)]));
    expect(await wowData.clearContributions([lua], new Set([envelope(1)]))).toEqual([lua]);
    expect(await wowData.envelopesIn(lua)).toHaveLength(2);
  });

  it('test_parse_envelope_and_summary', () => {
    const fields = wowData.parseEnvelope(envelope(5));
    expect([fields.get('source'), fields.get('title'), fields.get('event')]).toEqual(['quests', 'Quest 5', 'progress']);
    expect(fields.get('text')?.startsWith('Text 5')).toBe(true);
    const { kinds, titles } = wowData.summarize([envelope(1), envelope(2, 'books')]);
    expect(kinds).toBe('1 Quest- und Gesprächszeilen, 1 Buchseiten');
    expect(titles).toEqual(['Quest 1', 'Buch 2']);
  });
});

describe('Leeren – Datenverlust ausgeschlossen (§2.4)', () => {
  it('eine nicht gesendete Zeile nur in der .bak lässt .lua und .bak byte-gleich liegen', async () => {
    const t = await tempWow();
    const lua = await t.lua(await t.flavor());
    const luaBytes = contributionsLua([envelope(1)]);
    const bakBytes = contributionsLua([envelope(1), envelope(9)]);
    await writeFile(lua, luaBytes);
    await writeFile(backupOf(lua), bakBytes);
    expect(await wowData.clearContributions([lua], new Set([envelope(1)]))).toEqual([lua]);
    expect(await readFile(lua)).toEqual(luaBytes);
    expect(await readFile(backupOf(lua))).toEqual(bakBytes);
  });

  it('liest vor dem Leeren neu: eine während des Uploads hinzugekommene Zeile hält die Datei fest', async () => {
    const t = await tempWow();
    const flavor = await t.flavor();
    const lua = await t.lua(flavor);
    await writeFile(lua, contributionsLua([envelope(1)]));
    const [store] = await wowData.collectContributions([flavor]);
    await writeFile(lua, contributionsLua([envelope(1), envelope(2)])); // WoW schreibt dazwischen
    expect(await wowData.clearContributions([lua], new Set(store?.envelopes))).toEqual([lua]);
    expect(await wowData.envelopesIn(lua)).toEqual([envelope(1), envelope(2)]);
  });

  it('mehrere Dateien: nur die veränderte bleibt, die andere wird geleert; keine Nachbardatei bleibt liegen', async () => {
    const t = await tempWow();
    const flavor = await t.flavor();
    const a = await t.lua(flavor, 'A');
    const b = await t.lua(flavor, 'B');
    await writeFile(a, contributionsLua([envelope(1)]));
    await writeFile(b, contributionsLua([envelope(2), envelope(3)]));
    expect(await wowData.clearContributions([a, b], new Set([envelope(1), envelope(2)]))).toEqual([b]);
    expect(await wowData.envelopesIn(a)).toEqual([]);
    expect(await wowData.envelopesIn(b)).toHaveLength(2);
    expect((await readdir(join(a, '..'))).sort()).toEqual(['SpokenContributions.lua']);
  });

  it('nur eine .bak: sie wird gelöscht, eine .lua entsteht nicht', async () => {
    const t = await tempWow();
    const lua = await t.lua(await t.flavor());
    await writeFile(backupOf(lua), contributionsLua([envelope(1)]));
    expect(await wowData.clearContributions([lua], new Set([envelope(1)]))).toEqual([]);
    expect(await exists(lua)).toBe(false);
    expect(await exists(backupOf(lua))).toBe(false);
  });

  it('eine Datei ohne Umschläge wird geleert, fehlende Dateien sind kein Fehler', async () => {
    const t = await tempWow();
    const lua = await t.lua(await t.flavor());
    expect(await wowData.clearContributions([lua], new Set())).toEqual([]);
    await writeFile(lua, contributionsLua([]));
    expect(await wowData.clearContributions([lua], new Set())).toEqual([]);
    expect(await readFile(lua, 'utf8')).toBe(
      '\nSpokenContributionsDB = {\n["Enabled"] = true,\n["Introduced"] = false,\n["Lines"] = {\n},\n}\n');
  });

  it('ein Dateifehler bricht ab und lässt die .bak stehen', async () => {
    const t = await tempWow();
    const lua = await t.lua(await t.flavor());
    await mkdir(lua); // .lua ist ein Ordner → Lesefehler (EISDIR), wie OSError in Python
    await writeFile(backupOf(lua), contributionsLua([envelope(1)]));
    await expect(wowData.clearContributions([lua], new Set([envelope(1)]))).rejects.toThrow();
    expect(await exists(backupOf(lua))).toBe(true);
  });
});

describe('cleared (Entscheidung 6, V10)', () => {
  it('ohne Einrückung genau wie Python', () => {
    const text = contributionsLua([envelope(1)], { crlf: false }).toString('utf8');
    expect(cleared(text)).toBe(
      '\nSpokenContributionsDB = {\n["Enabled"] = true,\n["Introduced"] = false,\n["Lines"] = {\n},\n}\n');
  });

  it('eingerückte Schalter (Tabs/Leerzeichen, CRLF) bleiben erhalten und werden ohne Einrückung geschrieben', () => {
    for (const indent of ['\t', '    ', ' \t ']) {
      const text = contributionsLua([envelope(1)], { indent }).toString('utf8');
      expect(cleared(text)).toBe(
        '\nSpokenContributionsDB = {\n["Enabled"] = true,\n["Introduced"] = false,\n["Lines"] = {\n},\n}\n');
    }
  });

  it('Werte false/true, Reihenfolge der Datei; andere Schlüssel gehen verloren', () => {
    const text = '["Introduced"] = true,\n["Other"] = 1,\n["Enabled"] = false,\n';
    expect(cleared(text)).toBe('\nSpokenContributionsDB = {\n["Introduced"] = true,\n["Enabled"] = false,\n["Lines"] = {\n},\n}\n');
  });

  it('nur ganze Zeilen zählen (wie re.M: Zeilen enden nur an \\n)', () => {
    expect(cleared('x ["Enabled"] = true,\n')).not.toContain('Enabled');
    expect(cleared('["Enabled"] = true, -- Kommentar\n')).not.toContain('Enabled');
    expect(cleared('["Enabled"] = true, \n')).not.toContain('Enabled'); // U+2028 ist kein Zeilenende
    expect(cleared('["Enabled"] = true,\r\n')).toContain('["Enabled"] = true,\n');
  });

  it('beim Leeren wird ein einzelnes CR wie in Python (read_text) zum Zeilenende', async () => {
    const t = await tempWow();
    const lua = await t.lua(await t.flavor());
    await writeFile(lua, '\rSpokenContributionsDB = {\r["Enabled"] = true,\r["Lines"] = {\r},\r}\r');
    expect(await wowData.clearContributions([lua], new Set())).toEqual([]);
    expect(await readFile(lua, 'utf8')).toContain('\n["Enabled"] = true,\n');
  });
});

describe('Dateien finden und lesen', () => {
  it('contributionFiles: nur die exakten Namen, sortiert Teil für Teil wie Python', async () => {
    const t = await tempWow();
    const flavor = await t.flavor();
    const a = await t.lua(flavor, 'ACC-2');
    const b = await t.lua(flavor, 'ACC');
    await writeFile(a, '');
    await writeFile(backupOf(b), '');
    await writeFile(join(b, '..', 'SpokenContributions.lua.old'), '');
    await writeFile(join(b, '..', 'spokencontributions.lua'), '');
    // Python: sorted(Path) vergleicht ['…','ACC','SavedVariables',…] < ['…','ACC-2',…]
    expect(await contributionFiles(flavor.dir)).toEqual([b, a]);
  });

  it('keine WTF/Account-Ordner: keine Dateien', async () => {
    const t = await tempWow();
    const flavor = await t.flavor();
    expect(await contributionFiles(flavor.dir)).toEqual([]);
    expect(await wowData.collectContributions([flavor])).toEqual([]);
  });

  it('eine fehlende Datei liefert keine Umschläge; Dateien mit 0 Umschlägen zählen mit', async () => {
    const t = await tempWow();
    const flavor = await t.flavor();
    const lua = await t.lua(flavor);
    expect(await wowData.envelopesIn(lua)).toEqual([]);
    await writeFile(lua, contributionsLua([]));
    expect(await wowData.collectContributions([flavor])).toEqual([{ flavor, lua, envelopes: [] }]);
  });

  it('nur Literale, deren roher Inhalt mit !SPOKEN beginnt; Doppelte bleiben', () => {
    const data = Buffer.from('a = "!SPOKEN1 x", b = "\\033SPOKEN", c = " !SPOKEN", d = "!SPOKEN1 x"', 'utf8');
    expect(envelopesInBytes(data)).toEqual(['!SPOKEN1 x', '!SPOKEN1 x']);
  });
});

describe('parseEnvelope und summarize – Randfälle', () => {
  it('Kopf ohne Leerzeichen, erster Wert gewinnt, Block ohne Ende, "source" nicht überschreibbar', () => {
    const fields = wowData.parseEnvelope('!SPOKEN1\nsource=x\na=1\na=2\nb=c=d\nt<<\nx\n>>\nt=2\nu<<\nbis\nzum Ende');
    expect([...fields]).toEqual([
      ['source', '?'], ['a', '1'], ['b', 'c=d'], ['t', 'x'], ['u', 'bis\nzum Ende'],
    ]);
  });

  it('summarize: leerer Titel fällt auf book zurück, unbekannte Arten roh, books/readables getrennt gezählt', () => {
    const env = (head: string, rest: string): string => `!SPOKEN1 ${head}\n${rest}\n`;
    const { kinds, titles } = wowData.summarize([
      env('books', 'title=\nbook=B'), env('readables', 'book=B'), env('neu', 'title=T'), env('books', ''),
    ]);
    expect(kinds).toBe('2 Buchseiten, 1 Buchseiten, 1 neu');
    expect(titles).toEqual(['B', 'T']);
    expect(wowData.summarize([])).toEqual({ kinds: '', titles: [] });
  });
});
