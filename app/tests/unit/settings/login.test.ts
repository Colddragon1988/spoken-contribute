// Anmeldung (§6.6): Portierung der 10 Python-Tests test_history_settings_system::Login plus Ergänzungen.
// Grundsatz überall: Das Passwort liegt nach jedem Schritt an mindestens einer Stelle.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createLoginStore } from '../../../src/core/settings';
import type { LoginStore } from '../../../src/shared/types';
import { FakeKeyring } from '../../helpers/fakeKeyring';
import { useSandbox } from '../../helpers/sandbox';
import { mode, POSIX, tempConfigDir } from './temp';

interface Setup {
  readonly configDir: string;
  readonly file: string;
  readonly ring: FakeKeyring;
  readonly login: LoginStore;
}

/** Wie die Python-Sandbox: Standard ohne Schlüsselbund ('none'); kind lässt sich später ändern. */
async function setup(kind: 'system' | 'basic_text' | 'none' = 'none'): Promise<Setup> {
  const configDir = await tempConfigDir();
  const ring = new FakeKeyring(kind);
  return { configDir, file: join(configDir, 'login.json'), ring, login: createLoginStore({ configDir, secrets: ring }) };
}

const read = (path: string): Promise<string> => readFile(path, 'utf8');

/** login.json nicht mehr ersetzbar machen: ein Ordner blockiert die Zwischendatei login.json.tmp. */
const blockRewrite = (file: string): Promise<string | undefined> => mkdir(`${file}.tmp`, { recursive: true });

describe('Login (Python-Tests)', () => {
  it('test_without_keyring_the_password_is_in_a_private_file', async () => {
    const { login, file } = await setup();
    await login.saveLogin('a@b.c', 'geheim');
    expect(await login.credentials()).toEqual({ email: 'a@b.c', password: 'geheim' });
    expect(await login.passwordInKeyring()).toBe(false);
    if (POSIX) expect(await mode(file)).toBe(0o600);
  });

  it('test_with_keyring_the_file_has_no_password', async () => {
    const { login, file, ring } = await setup('system');
    await login.saveLogin('a@b.c', 'geheim');
    expect(await read(file)).not.toContain('geheim');
    expect(await login.passwordInKeyring()).toBe(true);
    expect((await login.credentials())?.password).toBe('geheim');
    expect(await login.deleteLogin()).toBe(true);
    expect(ring.store.size).toBe(0);
    expect(await login.credentials()).toBeNull();
  });

  it('test_old_password_moves_into_keyring', async () => {
    const { login, file, ring } = await setup('none');
    await login.saveLogin('a@b.c', 'geheim'); // frühere Fassung: Passwort in der Datei
    ring.kind = 'system';
    await login.movePasswordToKeyring();
    expect(await read(file)).not.toContain('geheim');
    expect((await login.credentials())?.password).toBe('geheim');
  });

  it('test_password_stays_in_file_while_keyring_is_locked', async () => {
    const { login, ring } = await setup();
    await login.saveLogin('a@b.c', 'geheim'); // ohne Schlüsselbund: in der Datei
    ring.kind = 'system';
    ring.locked = true;
    await login.movePasswordToKeyring();
    expect((await login.credentials())?.password).toBe('geheim');
  });

  it('test_password_stays_in_file_when_keyring_loses_it', async () => {
    const { login, ring, file } = await setup();
    await login.saveLogin('a@b.c', 'geheim');
    ring.kind = 'system';
    ring.forgetful = true; // meldet Erfolg, speichert aber nichts
    await login.movePasswordToKeyring();
    expect((await login.credentials())?.password).toBe('geheim');
    expect(await read(file)).toContain('geheim');
  });

  it('test_password_survives_when_login_file_cannot_be_rewritten', async () => {
    const { login, ring, file } = await setup();
    await login.saveLogin('a@b.c', 'geheim');
    ring.kind = 'system';
    await blockRewrite(file);
    await expect(login.movePasswordToKeyring()).rejects.toThrow();
    expect(await read(file)).toContain('geheim');
  });

  it('test_logout_with_locked_keyring_reports_the_leftover', async () => {
    const { login, ring } = await setup('system');
    await login.saveLogin('a@b.c', 'geheim');
    ring.locked = true;
    expect(await login.deleteLogin()).toBe(false);
    expect(await login.account()).toBeNull(); // abgemeldet ist man trotzdem
  });

  it('test_logout_without_keyring_entry_is_clean', async () => {
    const { login, file } = await setup();
    await login.saveLogin('a@b.c', 'geheim'); // Passwort in der Datei
    expect(await login.deleteLogin()).toBe(true);
    await expect(read(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('test_new_account_replaces_the_old_keyring_entry', async () => {
    const { login, ring } = await setup('system');
    await login.saveLogin('alt@b.c', 'eins');
    await login.saveLogin('neu@b.c', 'zwei');
    expect([...ring.store.keys()]).toEqual(['neu@b.c']);
    expect(await login.credentials()).toEqual({ email: 'neu@b.c', password: 'zwei' });
  });

  it('test_locked_keyring_gives_no_password', async () => {
    const { login, ring } = await setup('system');
    await login.saveLogin('a@b.c', 'geheim');
    ring.store.clear();
    expect(await login.credentials()).toEqual({ email: 'a@b.c', password: null });
  });
});

describe('login.json', () => {
  it('steht exakt im Python-Kompaktstil, mit und ohne Passwort', async () => {
    const { login, file, ring } = await setup('system');
    await login.saveLogin('a@b.c', 'geheim');
    expect(await read(file)).toBe('{"email": "a@b.c"}');
    ring.kind = 'none';
    await login.saveLogin('ä@b.c', 'gé"heim');
    expect(await read(file)).toBe('{"email": "ä@b.c", "password": "gé\\"heim"}');
  });

  it('Datei 0600, neuer Ordner 0700, keine Zwischendatei übrig', async () => {
    const { login, file, configDir } = await setup();
    await login.saveLogin('a@b.c', 'geheim');
    if (POSIX) {
      expect(await mode(file)).toBe(0o600);
      expect(await mode(configDir)).toBe(0o700);
    }
    await expect(read(`${file}.tmp`)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('kaputt, kein Objekt oder leere E-Mail: nicht angemeldet', async () => {
    const { login, file, configDir } = await setup();
    await mkdir(configDir, { recursive: true });
    for (const text of ['{kaputt', '["a@b.c"]', '{"email": ""}', '{"email": 5, "password": "geheim"}']) {
      await writeFile(file, text);
      expect(await login.account()).toBeNull();
      expect(await login.credentials()).toBeNull();
      expect(await login.passwordInKeyring()).toBe(false);
      expect((await login.accountView()).place).toBeNull();
    }
  });

  it('ein leeres Passwort in der Datei zählt nicht', async () => {
    const { login, file, configDir, ring } = await setup('system');
    await mkdir(configDir, { recursive: true });
    await ring.set('a@b.c', 'geheim');
    await writeFile(file, '{"email": "a@b.c", "password": ""}');
    expect(await login.passwordInKeyring()).toBe(true);
    expect((await login.credentials())?.password).toBe('geheim');
  });
});

describe('Passwort geht nie verloren', () => {
  it('saveLogin mit gesperrtem Schlüsselbund: Passwort in der Datei', async () => {
    const { login, ring, file } = await setup('system');
    ring.locked = true;
    await login.saveLogin('a@b.c', 'geheim');
    expect(await read(file)).toContain('geheim');
    ring.locked = false;
    expect((await login.credentials())?.password).toBe('geheim');
  });

  it('saveLogin mit vergesslichem Schlüsselbund: Passwort in der Datei', async () => {
    const { login, ring, file } = await setup('system');
    ring.forgetful = true;
    await login.saveLogin('a@b.c', 'geheim');
    expect(await read(file)).toContain('geheim');
    expect(await login.passwordInKeyring()).toBe(false);
  });

  it('basic_text ist kein Schlüsselbund: Passwort in der Datei, Schlüsselbund unberührt', async () => {
    const { login, ring, file } = await setup('basic_text');
    await login.saveLogin('a@b.c', 'geheim');
    expect(await read(file)).toContain('geheim');
    expect(ring.store.size).toBe(0);
    expect(await login.accountView()).toEqual({ email: 'a@b.c', place: 'datei', backend: 'basic_text' });
  });

  it('nicht schreibbare login.json beim Anmelden: Fehler, alte Anmeldung bleibt', async () => {
    const { login, file } = await setup();
    await login.saveLogin('alt@b.c', 'eins');
    await blockRewrite(file);
    await expect(login.saveLogin('neu@b.c', 'zwei')).rejects.toThrow();
    expect(await login.credentials()).toEqual({ email: 'alt@b.c', password: 'eins' });
  });

  it('Umzug bei nicht schreibbarer login.json: Passwort an beiden Stellen', async () => {
    const { login, ring, file } = await setup();
    await login.saveLogin('a@b.c', 'geheim');
    ring.kind = 'system';
    await blockRewrite(file);
    const err: unknown = await login.movePasswordToKeyring().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String(err)).not.toContain('geheim');
    expect(ring.store.get('a@b.c')).toBe('geheim');
    expect(await read(file)).toContain('geheim');
  });

  it('Umzug ohne Schlüsselbund oder ohne Datei-Passwort ändert nichts', async () => {
    const { login, ring, file } = await setup();
    await login.movePasswordToKeyring(); // nicht angemeldet
    await login.saveLogin('a@b.c', 'geheim');
    const before = await read(file);
    await login.movePasswordToKeyring(); // kein Schlüsselbund
    expect(await read(file)).toBe(before);
    ring.kind = 'system';
    await login.movePasswordToKeyring();
    await login.movePasswordToKeyring(); // schon umgezogen
    expect(await read(file)).toBe('{"email": "a@b.c"}');
    expect(ring.store.get('a@b.c')).toBe('geheim');
  });
});

describe('Abmelden', () => {
  it('nicht angemeldet: true, auch eine kaputte login.json verschwindet', async () => {
    const { login, file, configDir } = await setup();
    expect(await login.deleteLogin()).toBe(true);
    await mkdir(configDir, { recursive: true });
    await writeFile(file, '{kaputt');
    expect(await login.deleteLogin()).toBe(true);
    await expect(read(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('Passwort in der Datei, aber ein Rest im Schlüsselbund: wird mit entfernt', async () => {
    const { login, ring } = await setup();
    await login.saveLogin('a@b.c', 'geheim');
    ring.kind = 'system';
    ring.store.set('a@b.c', 'alt');
    expect(await login.deleteLogin()).toBe(true);
    expect(ring.store.size).toBe(0);
  });

  it('Passwort in der Datei und Schlüsselbund gesperrt: trotzdem true', async () => {
    const { login, ring } = await setup();
    await login.saveLogin('a@b.c', 'geheim');
    ring.kind = 'system';
    ring.locked = true;
    expect(await login.deleteLogin()).toBe(true);
    expect(await login.account()).toBeNull();
  });
});

describe('accountView (Entscheidung 12)', () => {
  it('nicht angemeldet', async () => {
    const { login } = await setup('system');
    expect(await login.accountView()).toEqual({ email: null, place: null, backend: 'system' });
  });

  it('schluesselbund, datei, unlesbar', async () => {
    const { login, ring } = await setup('system');
    await login.saveLogin('a@b.c', 'geheim');
    expect(await login.accountView()).toEqual({ email: 'a@b.c', place: 'schluesselbund', backend: 'system' });
    ring.locked = true;
    expect((await login.accountView()).place).toBe('unlesbar');
    ring.locked = false;
    ring.store.clear();
    expect((await login.accountView()).place).toBe('unlesbar');
    ring.kind = 'none';
    expect(await login.accountView()).toEqual({ email: 'a@b.c', place: 'unlesbar', backend: 'none' });
    await login.saveLogin('a@b.c', 'geheim');
    expect(await login.accountView()).toEqual({ email: 'a@b.c', place: 'datei', backend: 'none' });
  });

  it('passwordInKeyring bleibt wie in Python nur aus der Datei abgeleitet', async () => {
    const { login, ring } = await setup('system');
    await login.saveLogin('a@b.c', 'geheim');
    ring.store.clear();
    expect(await login.passwordInKeyring()).toBe(true);
  });
});

describe('über createCore (Sandbox)', () => {
  it('core.login benutzt den Schlüsselbund und den Konfig-Ordner der Umgebung', async () => {
    const sandbox = await useSandbox();
    sandbox.keyring.kind = 'system';
    await sandbox.core.login.saveLogin('a@b.c', 'geheim');
    expect(await read(join(sandbox.configDir, 'login.json'))).toBe('{"email": "a@b.c"}');
    expect(sandbox.keyring.store.get('a@b.c')).toBe('geheim');
    expect(await sandbox.core.login.credentials()).toEqual({ email: 'a@b.c', password: 'geheim' });
  });
});
