/**
 * Kommandozeile der gebauten App (Architektur §6, §8 (f)): USAGE, Testlauf, Upload, Einzelinstanz
 * und die Schutzprüfungen der Sandbox. Alles mit Temp-HOME und vorgetäuschtem Server.
 */
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { appEnvironment, createSandboxRoot, prepareDemo } from '../helpers/sandbox-start';
import { launchApp, runApp, runInSandbox } from './launch';

const USAGE = `Aufruf: Spoken-Upload [--test | --ohne-fenster]
  (ohne)          Fenster öffnen
  --test          im Terminal zeigen, was gesendet würde – nichts wird gesendet oder gelöscht
  --ohne-fenster  im Terminal hochladen, z. B. für einen Zeitplan
`;

/** Dateien mit SHA-256, ohne die Ordner, in die Electron/Chromium selbst schreiben. */
async function tree(root: string, skip: readonly string[] = ['userdata', 'home']): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  async function walk(dir: string): Promise<void> {
    for (const name of await readdir(dir)) {
      const path = join(dir, name);
      if (dir === root && skip.includes(name)) continue;
      if ((await stat(path)).isDirectory()) await walk(path);
      else result[path.slice(root.length)] = createHash('sha256').update(await readFile(path)).digest('hex');
    }
  }
  await walk(root);
  return result;
}

/** Umgebung ohne Sandbox, aber mit Temp-HOME – für USAGE und die Schutzprüfung. */
async function withoutSandbox<T>(run: (env: Record<string, string>, home: string) => Promise<T>): Promise<T> {
  const root = await createSandboxRoot('spoken-ohne-');
  try {
    const env = appEnvironment(root, 'http://127.0.0.1:9');
    delete env.SPOKEN_UPLOAD_SANDBOX;
    delete env.SPOKEN_UPLOAD_SERVER;
    return await run(env, env.HOME ?? root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('--help und unbekanntes Argument: USAGE, 0 bzw. 2, nichts angelegt', async () => {
  await withoutSandbox(async (env, home) => {
    const help = await runApp(['--help'], { env });
    expect(help.code).toBe(0);
    expect(help.stdout).toBe(USAGE);
    const unknown = await runApp(['--gibts-nicht'], { env });
    expect(unknown.code).toBe(2);
    expect(unknown.stdout).toBe(USAGE);
    const both = await runApp(['--test', '-h'], { env });
    expect(both.code).toBe(0);
    // weder userData noch Konfig-Ordner – höchstens der Schriftcache von Chromium
    const made = await readdir(join(home, '.config')).catch(() => []);
    expect(made).toEqual([]);
  });
});

test('unverpackt ohne Sandbox startet nichts (Schutz bis Phase 6)', async () => {
  await withoutSandbox(async (env, home) => {
    for (const args of [[], ['--test'], ['--ohne-fenster']]) {
      const run = await runApp(args, { env });
      expect(run.code).toBe(1);
      expect(run.stderr).toContain('unverpackt nur in der Sandbox');
    }
    expect(await readdir(join(home, '.config')).catch(() => [])).toEqual([]);
  });
});

test('Sandbox-Variablen: nur unter os.tmpdir() und nur mit Server 127.0.0.1', async () => {
  const root = await createSandboxRoot();
  try {
    for (const server of ['https://spoken.rusty.one', 'http://localhost:4000', 'http://127.0.0.1']) {
      const run = await runApp(['--test'], { env: appEnvironment(root, server) });
      expect(run.code, server).toBe(1);
      expect(run.stderr).toContain('Sandbox abgelehnt');
    }
    // ein Ordner außerhalb des Temp-Ordners (hier: os.tmpdir() selbst ist schon „außerhalb“)
    const outside = await runApp(['--test'], { env: appEnvironment(tmpdir(), 'http://127.0.0.1:9') });
    expect(outside.code).toBe(1);
    expect(outside.stderr).toContain('Sandbox abgelehnt');
    const relative = await runApp(['--test'], { env: { ...appEnvironment(root, 'http://127.0.0.1:9'), SPOKEN_UPLOAD_SANDBOX: 'sandbox' } });
    expect(relative.code).toBe(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('--test in der Sandbox: zeigt, was gesendet würde, schreibt und sendet nichts', async () => {
  let before: Record<string, string> = {};
  const run = await runInSandbox(['--test'], {
    prepare: async (root) => {
      await prepareDemo(root);
      before = await tree(root);
    },
    inspect: async (root, server) => {
      expect(server.server.calls).toEqual([]);
      expect(await tree(root)).toEqual(before);
    },
  });
  expect(run.stderr).not.toContain('Unerwarteter Fehler');
  expect(run.stdout).toContain('Testlauf – nichts gesendet, gelöscht oder archiviert.');
  expect(run.stdout).toContain('Gesammelte Zeilen: würde');
  expect(run.stdout).toContain('NPC-Texte (WoW Forever, deDE): würde 2 Texte senden. Anmeldung fehlt noch.');
  expect(run.code).toBe(0);
});

test('--test ohne WoW-Ordner: Hinweis und Exit 1', async () => {
  const run = await runInSandbox(['--test']);
  expect(run.stdout).toBe('Kein WoW-Ordner gefunden – bitte einmal im Fenster auswählen.\n');
  expect(run.code).toBe(1);
});

test('--ohne-fenster lädt in der Sandbox hoch; ohne Anmeldung bleiben die NPC-Texte (Exit 1)', async () => {
  const run = await runInSandbox(['--ohne-fenster'], {
    prepare: (root) => prepareDemo(root),
    inspect: async (root, server) => {
      expect(server.server.paths()).toEqual(['/api/contributions/batch']);
      const entries = await readdir(join(root, 'data', 'verlauf'));
      expect(entries.some((name) => name.endsWith('_zeilen'))).toBe(true);
    },
  });
  expect(run.stdout).toContain('Gesammelte Zeilen: sende 3 …');
  expect(run.stdout).toContain('Nicht alles hat geklappt.');
  expect(run.stdout).toContain('NPC-Texte: nicht angemeldet');
  expect(run.code).toBe(1);
});

test('Einzelinstanz: CLI und zweites Fenster, während das Fenster offen ist', async () => {
  const launched = await launchApp({ prepare: (root) => prepareDemo(root) });
  try {
    const env = appEnvironment(launched.root, launched.server.url);
    const cli = await runApp(['--ohne-fenster'], { env });
    expect(cli.code).toBe(1);
    expect(cli.stderr).toContain('Spoken-Upload läuft bereits – bitte erst das andere Fenster schließen.');
    expect(launched.server.server.calls).toEqual([]); // nie zwei Uploads auf denselben Dateien
    const second = await runApp([], { env });
    expect(second.code).toBe(0);
    expect(launched.app.windows()).toHaveLength(1);
  } finally {
    await launched.close();
  }
});

test('userData liegt in der Sandbox, nie im Konfig-Ordner der Python-Fassung', async () => {
  const launched = await launchApp({ prepare: (root) => prepareDemo(root) });
  try {
    const userData = await launched.app.evaluate(({ app }) => app.getPath('userData'));
    expect(userData).toBe(join(launched.root, 'userdata'));
    const config = await readdir(join(launched.root, 'home', '.config')).catch(() => []);
    expect(config).not.toContain('spoken-contribute');
    expect(config).not.toContain('Spoken-Upload');
  } finally {
    await launched.close();
  }
});

test('Sandbox-Ordner unter dem Temp-Ordner, aber ein Symlink nach draußen wird abgelehnt', async () => {
  test.skip(process.platform === 'win32', 'Symlinks brauchen unter Windows Sonderrechte');
  const outside = await mkdtemp(join(process.cwd(), '.tmp-aussen-')); // im Arbeitsbaum, nicht unter os.tmpdir()
  const root = await createSandboxRoot();
  try {
    const link = join(root, 'link');
    await symlink(outside, link);
    const run = await runApp(['--test'], { env: { ...appEnvironment(root, 'http://127.0.0.1:9'), SPOKEN_UPLOAD_SANDBOX: link } });
    expect(run.code).toBe(1);
    expect(run.stderr).toContain('Sandbox abgelehnt');
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('Linux ohne Bildschirm (V8): die Kommandozeile läuft trotzdem', async () => {
  test.skip(process.platform !== 'linux', 'nur Linux');
  const root = await createSandboxRoot();
  try {
    await prepareDemo(root);
    const env = appEnvironment(root, 'http://127.0.0.1:9');
    delete env.DISPLAY;
    delete env.WAYLAND_DISPLAY;
    const run = await runApp(['--test'], { env });
    expect(run.stdout).toContain('Testlauf – nichts gesendet, gelöscht oder archiviert.');
    expect(run.code).toBe(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
