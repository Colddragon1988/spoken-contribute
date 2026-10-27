/**
 * Sicherheitsprüfungen im laufenden Fenster (Architektur §7.4). Laufen auch mit Platzhalter-Seiten:
 * Sie brauchen nur window.spoken aus dem preload, nicht die Oberfläche.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { SpokenApi } from '../../src/shared/ipc';
import { prepareDemo } from '../helpers/sandbox-start';
import { launchApp, type LaunchedApp } from './launch';

/** Was die Tests im Renderer anfassen (die Node-Seite kennt keine DOM-Typen). */
interface Renderer {
  readonly spoken: SpokenApi;
  readonly location: { href: string };
  open(url: string): unknown;
  readonly navigator: { permissions: { query(d: { name: string }): Promise<{ state: string }> } };
}

/** Genau die Methoden von SpokenApi (src/shared/ipc.ts). */
const API_KEYS = [
  'chooseWowDir', 'closeWindow', 'findWow', 'getAccount', 'getOverview', 'getState', 'historyDetails',
  'onHistoryChanged', 'onTheme', 'onUpload', 'openArchive', 'openEntryFolder', 'openHistory', 'openRegister',
  'queryHistory', 'setAutoUpload', 'setTheme', 'setWowDir', 'showMessage', 'signIn', 'signOut', 'startUpload',
];

const TEST_PASSWORD = 'Test-Passwort-7f3c-niemals-ausgeben';

let launched: LaunchedApp | undefined;
test.afterEach(async () => {
  await launched?.close();
  launched = undefined;
});

async function start(): Promise<LaunchedApp> {
  launched = await launchApp({ prepare: (root) => prepareDemo(root) });
  await launched.window.waitForFunction(() => 'spoken' in globalThis);
  return launched;
}

test('keine Node-APIs im Renderer, window.spoken hat genau die Schlüssel von SpokenApi', async () => {
  const { window } = await start();
  expect(await window.evaluate(() => [typeof require, typeof process, typeof module, typeof Buffer])).toEqual(
    ['undefined', 'undefined', 'undefined', 'undefined'],
  );
  const keys = await window.evaluate(() => Object.keys((globalThis as unknown as Renderer).spoken).sort());
  expect(keys).toEqual([...API_KEYS].sort());
  // nur Funktionen, kein ipcRenderer o. Ä. versteckt
  expect(await window.evaluate(() => Object.values((globalThis as unknown as Renderer).spoken)
    .every((v) => typeof v === 'function'))).toBe(true);
  expect(window.url()).toBe('app://spoken/main/index.html');
});

test('Navigation, neue Fenster und Netz sind gesperrt', async () => {
  const { window, app } = await start();
  await window.evaluate(() => { (globalThis as unknown as Renderer).location.href = 'https://example.org/'; });
  await window.waitForTimeout(300);
  expect(window.url()).toBe('app://spoken/main/index.html');
  await window.evaluate(() => { (globalThis as unknown as Renderer).location.href = 'app://spoken/history/index.html'; });
  await window.waitForTimeout(300);
  expect(window.url()).toBe('app://spoken/main/index.html');

  expect(await window.evaluate(() => (globalThis as unknown as Renderer).open('https://example.org/') === null)).toBe(true);
  expect(await window.evaluate(() => (globalThis as unknown as Renderer).open('app://spoken/history/index.html') === null)).toBe(true);
  expect(app.windows()).toHaveLength(1);

  const fetched = await window.evaluate(async (url) => {
    const results: string[] = [];
    for (const target of ['https://example.org/', url]) {
      try {
        await fetch(target);
        results.push('erreicht');
      } catch {
        results.push('gesperrt');
      }
    }
    return results;
  }, `${launched?.server.url ?? ''}/api/contributions/batch`);
  expect(fetched).toEqual(['gesperrt', 'gesperrt']);
  expect(launched?.server.server.calls).toEqual([]);
});

test('Protokoll liefert CSP und nosniff, aber nichts außerhalb von dist/renderer', async () => {
  const { app } = await start();
  const answers = await app.evaluate(async ({ session }) => {
    const ui = session.fromPartition('spoken-ui');
    const result: { url: string; status: number; csp: string | null; nosniff: string | null }[] = [];
    for (const url of [
      'app://spoken/main/index.html', 'app://spoken/../main/main.cjs', 'app://spoken/main/main.js.map',
      'app://anders/main/index.html',
    ]) {
      try {
        const response = await ui.fetch(url);
        result.push({
          url, status: response.status,
          csp: response.headers.get('content-security-policy'), nosniff: response.headers.get('x-content-type-options'),
        });
      } catch {
        result.push({ url, status: 0, csp: null, nosniff: null }); // schon von der Netzsperre abgebrochen
      }
    }
    return result;
  });
  expect(answers[0]).toMatchObject({ status: 200, nosniff: 'nosniff' });
  expect(answers[0]?.csp).toContain("default-src 'none'");
  expect(answers[0]?.csp).toContain("frame-ancestors 'none'");
  expect(answers.slice(1).map((a) => a.status)).toEqual([404, 404, 0]);
});

test('Fensteroptionen wie §5.3 und keine Berechtigungen', async () => {
  const { app, window } = await start();
  const prefs = await app.evaluate(({ BrowserWindow, session }) => {
    const w = BrowserWindow.getAllWindows()[0];
    // zur Laufzeit vorhanden, in den Typen von Electron 45 nicht beschrieben
    const p = (w?.webContents as unknown as { getLastWebPreferences(): Record<string, unknown> | null } | undefined)
      ?.getLastWebPreferences();
    return {
      title: w?.getTitle(), contextIsolation: p?.contextIsolation, nodeIntegration: p?.nodeIntegration,
      sandbox: p?.sandbox, webSecurity: p?.webSecurity, webviewTag: p?.webviewTag,
      uiSession: w?.webContents.session === session.fromPartition('spoken-ui'),
      persistent: w?.webContents.session.isPersistent(),
    };
  });
  expect(prefs).toEqual({
    title: 'Spoken – Beiträge hochladen', contextIsolation: true, nodeIntegration: false, sandbox: true,
    webSecurity: true, webviewTag: false, uiSession: true, persistent: false,
  });
  const permission = await window.evaluate(async () => {
    try {
      const { navigator } = globalThis as unknown as Renderer;
      return (await navigator.permissions.query({ name: 'geolocation' })).state;
    } catch {
      return 'denied';
    }
  });
  expect(permission).not.toBe('granted');
});

test('ungültige IPC-Argumente und falsche Fenster werden abgelehnt', async () => {
  const { window } = await start();
  const before = await window.evaluate(() => (globalThis as unknown as Renderer).spoken.getState());
  const answers = await window.evaluate(async () => {
    // absichtlich falsche Typen am Vertrag vorbei
    const api = (globalThis as unknown as Renderer).spoken as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
    const call = async (name: string, ...args: unknown[]): Promise<string> => {
      const value = await api[name]?.(...args);
      return value === undefined ? 'abgelehnt' : JSON.stringify(value);
    };
    return [
      await call('setAutoUpload', 'ja'),
      await call('setWowDir', 123),
      await call('setWowDir', 'x'.repeat(5000)),
      await call('setTheme', 'lila'),
      await call('startUpload', 'ja'),
      await call('showMessage', { kind: 'boese', title: 't', text: 't' }),
      await call('historyDetails', '../../etc'),
      // Kanäle des Verlaufsfensters aus dem Hauptfenster
      await call('queryHistory', { seq: 1, search: '', art: 'alle', version: '' }),
      await call('openArchive'),
    ];
  });
  expect(answers).toEqual(Array(answers.length).fill('abgelehnt'));
  expect(await window.evaluate(() => (globalThis as unknown as Renderer).spoken.getState())).toEqual(before);
});

test('das Test-Passwort taucht nach einem Anmeldefehler nirgends auf', async () => {
  const app = await start();
  app.server.server.fail.set('/api/auth/sign-in/email', [{ status: 401 }, { network: 'ECONNRESET' }]);
  const first = await app.window.evaluate((pw) => (globalThis as unknown as Renderer).spoken.signIn('test@example.org', pw), TEST_PASSWORD);
  expect(first).toEqual({ ok: false, message: 'Anmeldung abgelehnt – E-Mail oder Passwort stimmen nicht.' });
  const second = await app.window.evaluate((pw) => (globalThis as unknown as Renderer).spoken.signIn('test@example.org', pw), TEST_PASSWORD);
  expect(second.ok).toBe(false);
  expect(JSON.stringify(second)).not.toContain(TEST_PASSWORD);
  const tooLong = await app.window.evaluate(() => (globalThis as unknown as Renderer).spoken.signIn('a@b.c', 'p'.repeat(2000)));
  expect(tooLong).toBeUndefined();
  await app.window.waitForTimeout(200);
  expect(app.stdout()).not.toContain(TEST_PASSWORD);
  expect(app.stderr()).not.toContain(TEST_PASSWORD);
  // auch in keiner Datei der Sandbox (Konfig, Daten, userData)
  const hits: string[] = [];
  async function scan(dir: string): Promise<void> {
    for (const name of await readdir(dir)) {
      const path = join(dir, name);
      const info = await stat(path).catch(() => null);
      if (info?.isDirectory()) await scan(path);
      else if (info?.isFile() && (await readFile(path)).includes(TEST_PASSWORD)) hits.push(path);
    }
  }
  await scan(app.root);
  expect(hits).toEqual([]);
});
