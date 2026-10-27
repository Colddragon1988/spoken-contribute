// Kommandozeile (§8, Architektur §6): Portierung von test_history_settings_system::CommandLine plus
// Ergänzungen. Läuft über den echten Kern in der Sandbox – nie gegen echte Pfade.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEGACY_FAILED, runCli, USAGE, type CliIo } from '../../../src/main/cli';
import { contributionsLua, envelope } from '../../helpers/fixtures';
import { useSandbox, type Sandbox } from '../../helpers/sandbox';

interface Captured extends CliIo {
  readonly stdout: () => string;
  readonly stderr: () => string;
}

function capture(): Captured {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out: (text) => { out.push(text); },
    err: (text) => { err.push(text); },
    stdout: () => out.join(''),
    stderr: () => err.join(''),
  };
}

/** Wie run_main im Python-Test: Ausgaben werden geschluckt, nur der Exit-Code zählt. */
function runMain(sandbox: Sandbox | null, ...args: string[]): Promise<number> {
  return runCli(args, {
    core: () => {
      if (!sandbox) throw new Error('Der Kern darf hier nicht gebraucht werden.');
      return sandbox.core;
    },
  }, capture());
}

/** Alle Dateien unter root mit SHA-256 – vorher/nachher-Vergleich für „schreibt nichts“. */
async function tree(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  async function walk(dir: string): Promise<void> {
    for (const name of await readdir(dir)) {
      const path = join(dir, name);
      if ((await stat(path)).isDirectory()) await walk(path);
      else result[path.slice(root.length)] = createHash('sha256').update(await readFile(path)).digest('hex');
    }
  }
  await walk(root);
  return result;
}

describe('CommandLine (Python-Tests)', () => {
  it('test_test_run_changes_nothing', async () => {
    // --test verspricht, nichts zu verändern: auch kein Archiv-Umzug und kein Passwort-Umzug.
    const sb = await useSandbox();
    const old = join(sb.dataDir, '2026-10-24_17-23-10_ACC_SpokenContributions.lua');
    await mkdir(sb.dataDir, { recursive: true });
    await writeFile(old, contributionsLua([envelope(1)]));
    await sb.core.login.saveLogin('a@b.c', 'geheim'); // ohne Schlüsselbund: Passwort in login.json
    sb.keyring.kind = 'system';
    expect(await runMain(sb, '--test')).toBe(1); // kein WoW-Ordner eingetragen
    expect(existsSync(old)).toBe(true);
    expect(sb.keyring.store.size).toBe(0);
  });

  it('test_unknown_argument', async () => {
    expect(await runMain(null, '--gibts-nicht')).toBe(2);
    expect(await runMain(null, '--help')).toBe(0);
  });
});

describe('Passwort der Python-Fassung übernehmen', () => {
  it('nur ohne --test; ein Fehlschlag wird auf stderr gemeldet, der Lauf geht weiter', async () => {
    const sb = await useSandbox();
    const calls: string[] = [];
    const deps = (result: 'uebernommen' | 'fehlgeschlagen') => ({
      core: () => sb.core,
      importLegacyPassword: () => { calls.push(result); return Promise.resolve(result); },
    });
    let io = capture();
    expect(await runCli(['--test'], deps('fehlgeschlagen'), io)).toBe(1); // kein WoW-Ordner
    expect(calls).toEqual([]);
    io = capture();
    expect(await runCli(['--ohne-fenster'], deps('fehlgeschlagen'), io)).toBe(1);
    expect(calls).toEqual(['fehlgeschlagen']);
    expect(io.stderr()).toContain(LEGACY_FAILED);
    io = capture();
    await runCli(['--ohne-fenster'], deps('uebernommen'), io);
    expect(io.stderr()).not.toContain(LEGACY_FAILED);
  });
});

describe('Kommandozeile (Ergänzungen)', () => {
  it('USAGE auf stdout, der Kern wird nicht gebaut', async () => {
    for (const [args, code] of [[['-h'], 0], [['--test', '--help'], 0], [['--x'], 2], [['--test', 'foo'], 2]] as const) {
      const io = capture();
      expect(await runCli(args, { core: () => { throw new Error('nicht bauen'); } }, io)).toBe(code);
      expect(io.stdout()).toBe(`${USAGE}\n`);
      expect(io.stderr()).toBe('');
    }
  });

  it('ohne WoW-Ordner: Hinweis auf stdout und Exit 1', async () => {
    const sb = await useSandbox();
    const io = capture();
    expect(await runCli(['--ohne-fenster'], { core: () => sb.core }, io)).toBe(1);
    expect(io.stdout()).toBe('Kein WoW-Ordner gefunden – bitte einmal im Fenster auswählen.\n');
  });

  it('--ohne-fenster räumt Altlasten auf: Archiv übernommen, Passwort umgezogen', async () => {
    const sb = await useSandbox();
    const old = join(sb.dataDir, '2026-10-24_17-23-10_ACC_SpokenContributions.lua');
    await mkdir(sb.dataDir, { recursive: true });
    await writeFile(old, contributionsLua([envelope(1)]));
    await sb.core.login.saveLogin('a@b.c', 'geheim');
    sb.keyring.kind = 'system';
    expect(await runMain(sb, '--ohne-fenster')).toBe(1); // weiterhin kein WoW-Ordner
    expect(existsSync(old)).toBe(false);
    expect(sb.keyring.store.get('a@b.c')).toBe('geheim');
    expect((await sb.core.history.entries()).length).toBe(1);
  });

  it('--test schreibt nichts, auch keinen gefundenen WoW-Ordner (E. 9)', async () => {
    const sb = await useSandbox();
    const flavor = await sb.flavor();
    await writeFile(await sb.lua(flavor), contributionsLua([envelope(1), envelope(2)]));
    (sb.env.wow as { findWow: () => Promise<string | null> }).findWow = () => Promise.resolve(sb.wow);
    const before = await tree(sb.root);
    const io = capture();
    expect(await runCli(['--test'], { core: () => sb.core }, io)).toBe(0);
    expect(io.stdout()).toContain('Testlauf – nichts gesendet, gelöscht oder archiviert.');
    expect(io.stdout()).toContain('Gesammelte Zeilen: würde');
    expect(sb.server.calls).toEqual([]);
    expect(await tree(sb.root)).toEqual(before);
    expect(existsSync(join(sb.configDir, 'settings.json'))).toBe(false);
  });

  it('--ohne-fenster lädt hoch: Fortschritt zeilenweise, dann der Bericht; failed → 1', async () => {
    const sb = await useSandbox();
    const flavor = await sb.flavor();
    await writeFile(await sb.lua(flavor), contributionsLua([envelope(1)]));
    await sb.core.settings.save({ wowDir: sb.wow, autoUpload: false, theme: 'system' });
    const io = capture();
    expect(await runCli(['--ohne-fenster'], { core: () => sb.core }, io)).toBe(0);
    expect(io.stdout()).toContain('Gesammelte Zeilen: sende 1 …\n');
    expect(io.stdout()).toContain('Erfolgreich hochgeladen – danke!');
    expect(sb.server.paths()).toEqual(['/api/contributions/batch']);

    await writeFile(await sb.lua(flavor), contributionsLua([envelope(3)]));
    sb.server.fail.set('/api/contributions/batch', [{ status: 500 }]);
    const failed = capture();
    expect(await runCli(['--ohne-fenster'], { core: () => sb.core }, failed)).toBe(1);
    expect(failed.stdout()).toContain('Nicht alles hat geklappt.');
  });
});
