// Sandbox-Erkennung (§5.4) und vorgetäuschte Umgebung aus system.json (§7.2).
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkSandbox, localOnlyFetch, SANDBOX_VAR, SERVER_VAR } from '../../../src/main/env';
import {
  createSandboxKeyring, createSandboxSystem, createSandboxUi, DIALOG_LOG, OPENED_LOG, SYSTEM_FILE,
} from '../../../src/main/sandbox';

const cleanups: string[] = [];
afterEach(async () => {
  for (const dir of cleanups.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'spoken-env-'));
  cleanups.push(dir);
  return dir;
}

const SERVER = 'http://127.0.0.1:4567';

describe('checkSandbox', () => {
  it('ohne Variablen: keine Sandbox', () => {
    expect(checkSandbox({}, false, tmpdir())).toEqual({ kind: 'keine' });
  });

  it('verpackt zählen die Variablen nie', async () => {
    const root = await tempDir();
    expect(checkSandbox({ [SANDBOX_VAR]: root, [SERVER_VAR]: SERVER }, true, tmpdir())).toEqual({ kind: 'keine' });
  });

  it('Ordner unter os.tmpdir() mit Server 127.0.0.1', async () => {
    const root = await tempDir();
    const result = checkSandbox({ [SANDBOX_VAR]: root, [SERVER_VAR]: `${SERVER}/` }, false, tmpdir());
    expect(result).toMatchObject({ kind: 'sandbox', server: SERVER });
  });

  it('nur eine der beiden Variablen: Abbruch', async () => {
    const root = await tempDir();
    expect(checkSandbox({ [SANDBOX_VAR]: root }, false, tmpdir()).kind).toBe('fehler');
    expect(checkSandbox({ [SERVER_VAR]: SERVER }, false, tmpdir()).kind).toBe('fehler');
  });

  it('anderer Server: Abbruch – auch spoken.rusty.one und localhost', async () => {
    const root = await tempDir();
    for (const server of [
      'https://spoken.rusty.one', 'http://localhost:80', 'http://127.0.0.1', 'http://127.0.0.1:0',
      'http://127.0.0.1:99999', 'http://127.0.0.1:80/pfad', 'http://127.0.0.10:80', 'https://127.0.0.1:80',
    ]) {
      expect(checkSandbox({ [SANDBOX_VAR]: root, [SERVER_VAR]: server }, false, tmpdir()).kind, server).toBe('fehler');
    }
  });

  it('Ordner außerhalb von os.tmpdir(), relativ, fehlend oder per Symlink hinaus: Abbruch', async () => {
    const root = await tempDir();
    const outside = await mkdtemp(join(process.env.HOME ?? root, 'spoken-aussen-')); // HOME ist ein Temp-Ordner (setup.ts)
    cleanups.push(outside);
    const fakeTmp = join(root, 'tmp');
    await mkdir(fakeTmp);
    const link = join(fakeTmp, 'link');
    await symlink(outside, link, 'junction'); // 'junction': unter Windows ohne Sonderrechte, sonst ohne Wirkung
    for (const dir of ['', 'relativ/ordner', join(root, 'fehlt'), tmpdir(), link]) {
      expect(checkSandbox({ [SANDBOX_VAR]: dir, [SERVER_VAR]: SERVER }, false, fakeTmp).kind, dir).toBe('fehler');
    }
    expect(checkSandbox({ [SANDBOX_VAR]: outside, [SERVER_VAR]: SERVER }, false, fakeTmp).kind).toBe('fehler');
  });
});

describe('localOnlyFetch', () => {
  it('lässt nur 127.0.0.1 durch', async () => {
    const seen: string[] = [];
    const fake = ((input: string | URL | Request) => {
      seen.push(input instanceof Request ? input.url : input.toString());
      return Promise.resolve(new Response('ok'));
    }) as typeof fetch;
    const guarded = localOnlyFetch(fake);
    await expect(guarded('https://spoken.rusty.one/api/contributions/batch')).rejects.toThrow('kein Netz');
    await expect(guarded('http://localhost:1/')).rejects.toThrow('kein Netz');
    expect((await guarded('http://127.0.0.1:1/x')).status).toBe(200);
    expect(seen).toEqual(['http://127.0.0.1:1/x']);
  });
});

describe('Sandbox aus system.json', () => {
  it('Prozesse, Design und Pfade nur innerhalb der Sandbox', async () => {
    const root = await tempDir();
    const system = createSandboxSystem(root);
    expect(system.programs()).toEqual([]);
    expect(system.dark()).toBeNull();
    await writeFile(join(root, SYSTEM_FILE), JSON.stringify({
      prozesse: ['C:\\WoW\\_classic_era_\\WoWClassic.exe', 3], dunkel: true,
      wowSuche: join(root, 'World of Warcraft'), ordnerwahl: '/etc',
    }));
    expect(system.programs()).toEqual(['C:\\WoW\\_classic_era_\\WoWClassic.exe']);
    expect(system.dark()).toBe(true);
    expect(system.pathInside('wowSuche')).toBe(join(root, 'World of Warcraft'));
    expect(system.pathInside('ordnerwahl')).toBeNull();
    await writeFile(join(root, SYSTEM_FILE), '{kaputt');
    expect(system.read()).toEqual({});
  });

  it('Schlüsselbund verhält sich wie FakeKeyring und folgt Änderungen zur Laufzeit', async () => {
    const root = await tempDir();
    const system = createSandboxSystem(root);
    const ring = createSandboxKeyring(system);
    expect(ring.available()).toBe(false);
    expect(ring.backend()).toBe('none');
    system.write({ schluesselbund: { art: 'system', gesperrt: false, eintraege: {} } });
    expect(ring.available()).toBe(true);
    await ring.set('a@b.c', 'pw');
    expect(await ring.get('a@b.c')).toBe('pw');
    expect(await ring.get('x@y.z')).toBeNull();
    await expect(ring.delete('x@y.z')).rejects.toThrow('kein Eintrag');
    system.write({ ...system.read(), schluesselbund: { art: 'system', gesperrt: true, eintraege: { 'a@b.c': 'pw' } } });
    await expect(ring.get('a@b.c')).rejects.toThrow('gesperrt');
    await expect(ring.set('a@b.c', 'neu')).rejects.toThrow('gesperrt');
    system.write({ schluesselbund: { art: 'basic_text', eintraege: { 'a@b.c': 'pw' } } });
    expect(ring.backend()).toBe('basic_text');
    expect(ring.available()).toBe(false);
    await ring.delete('a@b.c');
    expect(await ring.get('a@b.c')).toBeNull();
    expect(system.read()).toEqual({ schluesselbund: { art: 'basic_text', eintraege: {} } });
  });

  it('Dialoge und Öffnen werden nur protokolliert', async () => {
    const root = await tempDir();
    const system = createSandboxSystem(root);
    const ui = createSandboxUi(system);
    expect(await ui.confirm(null, 'Abmelden', 'Frage?')).toBe(false); // Standard: Nein
    system.write({ dialogAntwort: 'ja', ordnerwahl: join(root, 'wow') });
    expect(await ui.confirm(null, 'Abmelden', 'Frage?')).toBe(true);
    await ui.message(null, 'warnung', 'T', 'Text');
    expect(await ui.chooseFolder(null, 'Wahl', '/start')).toBe(join(root, 'wow'));
    expect(await ui.openPath(join(root, 'data'))).toBe('');
    await ui.openExternal('https://spoken.rusty.one/deDE/register');
    const dialogs: unknown = JSON.parse(await readFile(join(root, DIALOG_LOG), 'utf8'));
    expect(dialogs).toEqual([
      { art: 'frage', titel: 'Abmelden', text: 'Frage?' },
      { art: 'frage', titel: 'Abmelden', text: 'Frage?' },
      { art: 'warnung', titel: 'T', text: 'Text' },
      { art: 'ordnerwahl', titel: 'Wahl', text: '/start' },
    ]);
    const opened: unknown = JSON.parse(await readFile(join(root, OPENED_LOG), 'utf8'));
    expect(opened).toEqual([
      { art: 'ordner', ziel: join(root, 'data') },
      { art: 'extern', ziel: 'https://spoken.rusty.one/deDE/register' },
    ]);
    expect(existsSync(join(root, 'data'))).toBe(false);
  });
});
