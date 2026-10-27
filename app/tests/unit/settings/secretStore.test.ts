// SafeStorageSecretStore (Entscheidung 15, V1, V5) – nur mit FakeSafeStorage, nie mit dem echten.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createLoginStore, createSafeStorageSecretStore } from '../../../src/core/settings';
import type { Platform, SecretStore } from '../../../src/shared/types';
import { FakeSafeStorage } from './fakeSafeStorage';
import { mode, POSIX, tempConfigDir } from './temp';

interface Setup {
  readonly configDir: string;
  readonly file: string;
  readonly safe: FakeSafeStorage;
  readonly store: SecretStore;
}

async function setup(platform: Platform = 'linux', backend: string | null = 'kwallet6'): Promise<Setup> {
  const configDir = await tempConfigDir();
  const safe = new FakeSafeStorage(backend);
  return {
    configDir, safe,
    file: join(configDir, 'passwort.safestorage'),
    store: createSafeStorageSecretStore({ configDir, safeStorage: safe, platform }),
  };
}

const read = (path: string): Promise<string> => readFile(path, 'utf8');

async function errorOf(work: Promise<unknown>): Promise<string> {
  const err: unknown = await work.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(Error);
  return String(err);
}

describe('available() und backend()', () => {
  it('Linux: nur echte Backends zählen, basic_text nicht (V1)', async () => {
    for (const name of ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6']) {
      const { store } = await setup('linux', name);
      expect([store.available(), store.backend()]).toEqual([true, 'system']);
    }
    const basic = await setup('linux', 'basic_text');
    expect([basic.store.available(), basic.store.backend()]).toEqual([false, 'basic_text']);
    for (const name of ['unknown', null]) {
      const { store } = await setup('linux', name);
      expect([store.available(), store.backend()]).toEqual([false, 'none']);
    }
  });

  it('Windows/macOS: Verschlüsselung verfügbar genügt', async () => {
    for (const platform of ['win32', 'darwin'] as const) {
      const { store, safe } = await setup(platform, null);
      expect([store.available(), store.backend()]).toEqual([true, 'system']);
      safe.encryptionAvailable = false;
      expect([store.available(), store.backend()]).toEqual([false, 'none']);
    }
  });

  it('ohne Verschlüsselung oder bei Fehlern der Abfrage: nicht verfügbar', async () => {
    const { store, safe } = await setup('linux', 'kwallet6');
    safe.encryptionAvailable = false;
    expect(store.available()).toBe(false);
    safe.encryptionAvailable = true;
    safe.isEncryptionAvailable = () => { throw new Error('vor ready'); };
    expect(store.available()).toBe(false);
    const other = await setup('linux', 'kwallet6');
    other.safe.getSelectedStorageBackend = () => { throw new Error('vor ready'); };
    expect([other.store.available(), other.store.backend()]).toEqual([false, 'none']);
  });
});

describe('Datei passwort.safestorage', () => {
  it('set/get: Format {"email", "verschluesselt"}, kein Klartext, 0600, Ordner 0700', async () => {
    const { store, file, configDir, safe } = await setup();
    await store.set('a@b.c', 'geheim');
    const text = await read(file);
    expect(text).toMatch(/^\{"email": "a@b\.c", "verschluesselt": "[A-Za-z0-9+/]+=*"\}$/);
    expect(text).not.toContain('geheim');
    const { verschluesselt } = JSON.parse(text) as { verschluesselt: string };
    expect(safe.decryptString(Buffer.from(verschluesselt, 'base64'))).toBe('geheim');
    if (POSIX) {
      expect(await mode(file)).toBe(0o600);
      expect(await mode(configDir)).toBe(0o700);
    }
    expect(await store.get('a@b.c')).toBe('geheim');
    await expect(read(`${file}.tmp`)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('Kontobindung: fremdes Konto → null, ohne zu entschlüsseln', async () => {
    const { store, safe } = await setup();
    await store.set('a@b.c', 'geheim');
    safe.decryptCalls = 0;
    expect(await store.get('x@b.c')).toBeNull();
    expect(safe.decryptCalls).toBe(0);
  });

  it('fehlende Datei → null', async () => {
    const { store } = await setup();
    expect(await store.get('a@b.c')).toBeNull();
  });

  it('beschädigte Datei → Wurf', async () => {
    const { store, file, configDir } = await setup();
    await mkdir(configDir, { recursive: true });
    for (const text of ['{kaputt', '[]', '{"email": "a@b.c"}', '{"email": 1, "verschluesselt": "AAAA"}']) {
      await writeFile(file, text);
      await expect(store.get('a@b.c')).rejects.toThrow('passwort.safestorage ist beschädigt.');
      await expect(store.delete('a@b.c')).rejects.toThrow();
    }
  });

  it('nicht entschlüsselbar → Wurf ohne Passwort im Text', async () => {
    const { store, safe } = await setup();
    await store.set('a@b.c', 'geheim');
    safe.locked = true;
    const text = await errorOf(store.get('a@b.c'));
    expect(text).toContain('Das Passwort ließ sich nicht entschlüsseln.');
    expect(text).not.toContain('geheim');
  });

  it('set ohne echten Schlüsselbund wirft und schreibt nichts', async () => {
    const { store, file } = await setup('linux', 'basic_text');
    expect(await errorOf(store.set('a@b.c', 'geheim'))).not.toContain('geheim');
    await expect(read(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('Verschlüsselungsfehler: Wurf ohne Passwort im Text, nichts geschrieben', async () => {
    const { store, safe, file } = await setup();
    safe.encryptString = (plain) => { throw new Error(`kaputt: ${plain}`); };
    const text = await errorOf(store.set('a@b.c', 'geheim'));
    expect(text).toContain('Das Passwort ließ sich nicht verschlüsseln.');
    expect(text).not.toContain('geheim');
    await expect(read(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('set für ein anderes Konto ersetzt den Eintrag', async () => {
    const { store } = await setup();
    await store.set('alt@b.c', 'eins');
    await store.set('neu@b.c', 'zwei');
    expect(await store.get('alt@b.c')).toBeNull();
    expect(await store.get('neu@b.c')).toBe('zwei');
  });

  it('delete: fehlt oder fremdes Konto → Wurf, sonst Datei weg', async () => {
    const { store, file } = await setup();
    await expect(store.delete('a@b.c')).rejects.toThrow();
    await store.set('a@b.c', 'geheim');
    await expect(store.delete('x@b.c')).rejects.toThrow();
    expect(await store.get('a@b.c')).toBe('geheim');
    await store.delete('a@b.c');
    await expect(read(file)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await store.get('a@b.c')).toBeNull();
  });
});

describe('Anmeldung mit SafeStorageSecretStore', () => {
  async function loginSetup(backend: string) {
    const s = await setup('linux', backend);
    return { ...s, loginFile: join(s.configDir, 'login.json'), login: createLoginStore({ configDir: s.configDir, secrets: s.store }) };
  }

  it('echtes Backend: Passwort verschlüsselt in passwort.safestorage, login.json nur mit E-Mail', async () => {
    const { login, loginFile, file } = await loginSetup('gnome_libsecret');
    await login.saveLogin('a@b.c', 'geheim');
    expect(await read(loginFile)).toBe('{"email": "a@b.c"}');
    expect(await read(file)).not.toContain('geheim');
    expect(await login.credentials()).toEqual({ email: 'a@b.c', password: 'geheim' });
    expect(await login.accountView()).toEqual({ email: 'a@b.c', place: 'schluesselbund', backend: 'system' });
    expect(await login.deleteLogin()).toBe(true);
    await expect(read(file)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(read(loginFile)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('basic_text: Passwort wie Python in login.json, keine passwort.safestorage (V1)', async () => {
    const { login, loginFile, file } = await loginSetup('basic_text');
    await login.saveLogin('a@b.c', 'geheim');
    expect(await read(loginFile)).toBe('{"email": "a@b.c", "password": "geheim"}');
    await expect(read(file)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await login.accountView()).toEqual({ email: 'a@b.c', place: 'datei', backend: 'basic_text' });
  });

  it('Kontowechsel löscht den neuen Eintrag nicht (V5)', async () => {
    const { login } = await loginSetup('kwallet6');
    await login.saveLogin('alt@b.c', 'eins');
    await login.saveLogin('neu@b.c', 'zwei');
    expect(await login.credentials()).toEqual({ email: 'neu@b.c', password: 'zwei' });
  });

  it('Kontowechsel, bei dem login.json nicht geschrieben werden kann: altes Konto bleibt benutzbar', async () => {
    const { login, loginFile, configDir } = await loginSetup('kwallet6');
    await login.saveLogin('alt@b.c', 'eins');
    await mkdir(join(configDir, 'login.json.tmp')); // blockiert das atomare Schreiben
    await expect(login.saveLogin('neu@b.c', 'zwei')).rejects.toThrow();
    expect(await read(loginFile)).toBe('{"email": "alt@b.c"}');
    expect(await login.credentials()).toEqual({ email: 'alt@b.c', password: 'eins' });
  });

  it('nicht entschlüsselbar: Anzeige „unlesbar“, kein Passwort, Abmelden meldet den Rest', async () => {
    const { login, safe, file } = await loginSetup('kwallet6');
    await login.saveLogin('a@b.c', 'geheim');
    safe.locked = true;
    expect((await login.accountView()).place).toBe('unlesbar');
    expect(await login.credentials()).toEqual({ email: 'a@b.c', password: null });
    // delete selbst klappt ohne Entschlüsseln – die Datei ist danach weg
    expect(await login.deleteLogin()).toBe(true);
    await expect(read(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('Umzug aus login.json, sobald es ein echtes Backend gibt', async () => {
    const { login, loginFile, safe } = await loginSetup('basic_text');
    await login.saveLogin('a@b.c', 'geheim');
    safe.getSelectedStorageBackend = () => 'kwallet6';
    await login.movePasswordToKeyring();
    expect(await read(loginFile)).toBe('{"email": "a@b.c"}');
    expect((await login.credentials())?.password).toBe('geheim');
  });

  it('Umzug, wenn Entschlüsseln scheitert: Passwort bleibt in login.json', async () => {
    const { login, loginFile, safe } = await loginSetup('basic_text');
    await login.saveLogin('a@b.c', 'geheim');
    safe.getSelectedStorageBackend = () => 'kwallet6';
    safe.locked = true;
    await login.movePasswordToKeyring();
    expect(await read(loginFile)).toContain('geheim');
  });
});
