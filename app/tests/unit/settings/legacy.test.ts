// Übernahme des Passworts aus dem Schlüsselbund der Python-Fassung – nur mit vorgetäuschten Programmen.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createLegacyReader, createLoginStore, importLegacyPassword } from '../../../src/core/settings';
import type { ProcessRunner } from '../../../src/shared/types';
import { FakeKeyring } from '../../helpers/fakeKeyring';
import { tempConfigDir } from './temp';

type Answers = Record<string, { ok: boolean; stdout: string }>;

/** Vorgetäuschte Programme; merkt sich die Aufrufe. */
function fakeRunner(answers: Answers): ProcessRunner & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    run(command, args) {
      calls.push([command, ...args]);
      return Promise.resolve(answers[command] ?? { ok: false, stdout: '' });
    },
  };
}

async function setup(loginJson: string | null, kind: 'system' | 'basic_text' = 'system') {
  const configDir = await tempConfigDir();
  if (loginJson !== null) {
    await mkdir(configDir, { recursive: true });
    await writeFile(join(configDir, 'login.json'), loginJson);
  }
  const ring = new FakeKeyring(kind);
  return { configDir, ring, login: createLoginStore({ configDir, secrets: ring }) };
}

describe('createLegacyReader', () => {
  it('fragt zuerst python3/keyring, mit dem Konto als Argument statt im Programmtext', async () => {
    const runner = fakeRunner({ python3: { ok: true, stdout: 'alt geheim' } });
    expect(await createLegacyReader('linux', runner)('a@b.c')).toBe('alt geheim');
    expect(runner.calls).toHaveLength(1);
    const [command, ...args] = runner.calls[0] ?? [];
    expect(command).toBe('python3');
    expect(args.slice(0, 2)).toEqual(['-I', '-c']);
    expect(args.at(-1)).toBe('a@b.c');
    expect(args[2]).not.toContain('a@b.c');
    expect(args[2]).toContain('"spoken-contribute"');
  });

  it('unter Linux danach kwallet-query (Zeilenende weg) und secret-tool', async () => {
    const runner = fakeRunner({ 'kwallet-query': { ok: true, stdout: 'aus kwallet\n' } });
    expect(await createLegacyReader('linux', runner)('a@b.c')).toBe('aus kwallet');
    expect(runner.calls.map((c) => c[0])).toEqual(['python3', 'kwallet-query']);
    expect(runner.calls[1]).toEqual(['kwallet-query', '-r', 'a@b.c', '-f', 'spoken-contribute', 'kdewallet']);

    const tool = fakeRunner({ 'secret-tool': { ok: true, stdout: 'aus secret' } });
    expect(await createLegacyReader('linux', tool)('a@b.c')).toBe('aus secret');
  });

  it('leere Ausgabe oder Fehler überall: null; Windows/macOS ohne kwallet-query', async () => {
    const empty = fakeRunner({ python3: { ok: true, stdout: '' } });
    expect(await createLegacyReader('linux', empty)('a@b.c')).toBeNull();
    const win = fakeRunner({});
    expect(await createLegacyReader('win32', win)('a@b.c')).toBeNull();
    expect(win.calls.map((c) => c[0])).toEqual(['py', 'python']);
    const mac = fakeRunner({});
    await createLegacyReader('darwin', mac)('a@b.c');
    expect(mac.calls.map((c) => c[0])).toEqual(['python3']);
  });
});

describe('importLegacyPassword', () => {
  it('übernimmt das Passwort in den neuen Speicher und prüft es', async () => {
    const { login, ring, configDir } = await setup('{"email": "a@b.c"}');
    const result = await importLegacyPassword({ login, secrets: ring, readLegacy: () => Promise.resolve('alt') });
    expect(result).toBe('uebernommen');
    expect(ring.store.get('a@b.c')).toBe('alt');
    expect(await readFile(join(configDir, 'login.json'), 'utf8')).toBe('{"email": "a@b.c"}');
    // zweiter Start: nichts mehr zu tun, das alte Programm wird gar nicht gefragt
    let asked = false;
    const again = await importLegacyPassword({
      login, secrets: ring, readLegacy: () => { asked = true; return Promise.resolve('x'); },
    });
    expect(again).toBe('nicht-noetig');
    expect(asked).toBe(false);
  });

  it('nicht angemeldet oder Passwort steht in login.json: nichts zu tun', async () => {
    for (const json of [null, '{"email": "a@b.c", "password": "p"}']) {
      const { login, ring } = await setup(json);
      expect(await importLegacyPassword({ login, secrets: ring, readLegacy: () => Promise.resolve('alt') }))
        .toBe('nicht-noetig');
      expect(ring.store.size).toBe(0);
    }
  });

  it('alter Eintrag nicht lesbar: fehlgeschlagen, nichts verändert', async () => {
    const { login, ring, configDir } = await setup('{"email": "a@b.c"}');
    expect(await importLegacyPassword({ login, secrets: ring, readLegacy: () => Promise.resolve(null) }))
      .toBe('fehlgeschlagen');
    expect(ring.store.size).toBe(0);
    expect(await readFile(join(configDir, 'login.json'), 'utf8')).toBe('{"email": "a@b.c"}');
  });

  it('neuer Speicher gesperrt: nichts überschreiben', async () => {
    const { login, ring } = await setup('{"email": "a@b.c"}');
    ring.store.set('a@b.c', 'neu');
    ring.locked = true;
    expect(await importLegacyPassword({ login, secrets: ring, readLegacy: () => Promise.resolve('alt') }))
      .toBe('fehlgeschlagen');
    ring.locked = false;
    expect(ring.store.get('a@b.c')).toBe('neu');
  });

  it('ohne echten Schlüsselbund (basic_text) landet es wie in Python in login.json', async () => {
    const { login, ring, configDir } = await setup('{"email": "a@b.c"}', 'basic_text');
    expect(await importLegacyPassword({ login, secrets: ring, readLegacy: () => Promise.resolve('alt') }))
      .toBe('uebernommen');
    expect(await readFile(join(configDir, 'login.json'), 'utf8')).toBe('{"email": "a@b.c", "password": "alt"}');
  });

  it('Schlüsselbund vergisst es: fehlgeschlagen erkannt, Passwort steht dann in login.json', async () => {
    const { login, ring } = await setup('{"email": "a@b.c"}');
    ring.forgetful = true;
    // saveLogin legt es dann in login.json ab – also übernommen und lesbar
    expect(await importLegacyPassword({ login, secrets: ring, readLegacy: () => Promise.resolve('alt') }))
      .toBe('uebernommen');
    expect(await login.credentials()).toEqual({ email: 'a@b.c', password: 'alt' });
  });
});
