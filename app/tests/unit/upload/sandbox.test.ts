// Zusätzliche Durchgänge über die ganze Sandbox (alle Pakete verdrahtet): Testlauf schreibt
// nichts (Dateibaum-Hash), Cache nur mit zu langen Texten, Reihenfolge per onPost-Haken.
import { createHash } from 'node:crypto';
import { access, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createLimits, PER_HOUR } from '../../../src/core/upload/limits';
import { reportText } from '../../../src/core/upload';
import { contributionsLua, dbcache, envelope } from '../../helpers/fixtures';
import { useSandbox } from '../../helpers/sandbox';

const quiet = (): void => undefined;
const exists = (path: string): Promise<boolean> => access(path).then(() => true, () => false);

/** Alle Ordner und Dateien unter root mit SHA-256 (relativ, sortiert). */
async function tree(root: string): Promise<string[]> {
  const result: string[] = [];
  async function walk(dir: string, rel: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      const name = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        result.push(`${name}/`);
        await walk(path, name);
      } else {
        result.push(`${name} ${createHash('sha256').update(await readFile(path)).digest('hex')}`);
      }
    }
  }
  await walk(root, '');
  return result.sort();
}

describe('Testlauf', () => {
  it('schreibt nichts: Dateibaum vorher = nachher (auch upload-zeiten.json, Verlauf, Cache)', async () => {
    const sb = await useSandbox();
    const era = await sb.flavor('_classic_era_');
    const forever = await sb.flavor('_forever_');
    await writeFile(await sb.lua(era), contributionsLua([envelope(1), envelope(2, 'books')]));
    await writeFile(`${await sb.lua(forever)}.bak`, contributionsLua([envelope(3)]));
    await writeFile(await sb.cache(era), dbcache(70003, [[1, 'Hallo', ''], [2, 'x'.repeat(4001), '']]));
    // eine fast volle Stunde, damit auch die Limits-Rechnung durchlaufen wird
    const limits = createLimits({ dataDir: sb.dataDir, clock: sb.clock });
    for (let i = 0; i < PER_HOUR - 1; i++) await limits.noteUpload();
    const before = await tree(sb.root);
    for (const credentials of [null, sb.credentials]) {
      const report = await sb.core.uploader.run(sb.wow, credentials, { test: true, log: quiet });
      expect(report.head).toBe('Testlauf – nichts gesendet, gelöscht oder archiviert.');
      expect(report.failed, reportText(report)).toBe(false);
    }
    // auch mit einem Fehler im Testlauf (kein Fehler-Eintrag)
    sb.server.fail.set('/api/auth/sign-in/email', [{ status: 500 }]);
    await sb.core.uploader.run(sb.wow, sb.credentials, { test: true, log: quiet });
    expect(await tree(sb.root)).toEqual(before);
    expect(sb.server.calls).toEqual([]);
  });

  it('Bericht des Testlaufs wörtlich', async () => {
    const sb = await useSandbox();
    const era = await sb.flavor('_classic_era_');
    await writeFile(await sb.lua(era), contributionsLua([envelope(1), envelope(2, 'books')]));
    await writeFile(await sb.cache(era), dbcache(70003, [[1, 'Hallo', '']]));
    const report = await sb.core.uploader.run(sb.wow, null, { test: true, log: quiet });
    expect(reportText(report)).toBe([
      'Testlauf – nichts gesendet, gelöscht oder archiviert.',
      'Geprüft: Classic Era',
      'Gesammelte Zeilen: würde 1 Quest- und Gesprächszeilen, 1 Buchseiten senden (2 aus Classic Era).\n  Quest 1, Buch 2',
      'NPC-Texte (Classic Era, deDE): würde 1 Texte senden. Anmeldung fehlt noch.',
    ].join('\n\n'));
  });
});

describe('NPC-Texte in der Sandbox', () => {
  it('Cache nur mit zu langen Texten: kein Text-Request, ok-Eintrag anzahl 0 mit nicht_gesendet, Cache gelöscht', async () => {
    const sb = await useSandbox();
    const era = await sb.flavor('_classic_era_');
    const cache = await sb.cache(era);
    await writeFile(cache, dbcache(70003, [[2, 'x'.repeat(4001), '']]));
    await writeFile(`${cache}1652.tmp`, dbcache(70002, []));
    const report = await sb.core.uploader.run(sb.wow, sb.credentials, { test: false, log: quiet });
    expect(report.failed, reportText(report)).toBe(false);
    expect(sb.server.paths()).toEqual(['/api/auth/sign-in/email']);
    expect(await exists(cache)).toBe(false);
    expect(await exists(`${cache}1652.tmp`)).toBe(false);
    const [entry] = await sb.core.history.entries();
    if (!entry) throw new Error('kein Eintrag');
    expect(entry.info).toMatchObject({ art: 'npc-texte', status: 'ok', anzahl: 0, zu_lang: 1 });
    const payload = await sb.core.history.payload(entry);
    expect(payload).toEqual({ gesendet: [], antwort: [], nicht_gesendet: [{ id: 2, text: 'x'.repeat(4001), text1: '' }] });
  });

  it('Reihenfolge: Beim Senden ist noch nichts archiviert oder gelöscht', async () => {
    const sb = await useSandbox();
    const era = await sb.flavor('_classic_era_');
    const lua = await sb.lua(era);
    const cache = await sb.cache(era);
    await writeFile(lua, contributionsLua([envelope(1)]));
    await writeFile(cache, dbcache(70003, [[1, 'Hallo', '']]));
    const seen: string[] = [];
    sb.server.onPost = async (path) => {
      const archived = (await sb.core.history.entries()).length;
      const luaFull = (await sb.core.wowData.envelopesIn(lua)).length;
      seen.push(`${path} archiv=${archived} lua=${luaFull} cache=${String(await exists(cache))}`);
    };
    const report = await sb.core.uploader.run(sb.wow, sb.credentials, { test: false, log: quiet });
    expect(report.head, reportText(report)).toBe('Erfolgreich hochgeladen – danke!');
    expect(seen).toEqual([
      '/api/contributions/batch archiv=0 lua=1 cache=true',
      '/api/auth/sign-in/email archiv=1 lua=0 cache=true',
      '/api/broadcast-text archiv=1 lua=0 cache=true',
    ]);
    expect(await exists(cache)).toBe(false);
    expect((await sb.core.history.entries()).map((e) => e.info.art).sort()).toEqual(['npc-texte', 'zeilen']);
  });
});
