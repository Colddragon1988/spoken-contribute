// app://-Protokoll (§5.1/5.2), Netzsperre und Fensteroptionen (§5.3/5.4).
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CSP, createAppHandler, resolveAppRequest } from '../../../src/main/protocol';
import { requestAllowed } from '../../../src/main/security';
import { HISTORY_SIZE, MAIN_SIZE, windowOptions } from '../../../src/main/windowOptions';

const ROOT = join(sep, 'app', 'dist', 'renderer');

describe('resolveAppRequest', () => {
  it('liefert Dateien unter dist/renderer mit Typ', () => {
    expect(resolveAppRequest('GET', 'app://spoken/main/index.html', ROOT))
      .toEqual({ path: join(ROOT, 'main', 'index.html'), type: 'text/html; charset=utf-8' });
    expect(resolveAppRequest('GET', 'app://spoken/main/main.js', ROOT)?.type).toBe('text/javascript; charset=utf-8');
    expect(resolveAppRequest('GET', 'app://spoken/common/base.css', ROOT)?.type).toBe('text/css; charset=utf-8');
    expect(resolveAppRequest('GET', 'app://spoken/common/icon.svg', ROOT)?.type).toBe('image/svg+xml');
    expect(resolveAppRequest('GET', 'app://spoken/main/index.html?x=1#y', ROOT)?.path).toBe(join(ROOT, 'main', 'index.html'));
  });

  it('nur GET, nur Host spoken, nur app:', () => {
    expect(resolveAppRequest('POST', 'app://spoken/main/index.html', ROOT)).toBeNull();
    expect(resolveAppRequest('GET', 'app://anders/main/index.html', ROOT)).toBeNull();
    expect(resolveAppRequest('GET', 'https://spoken/main/index.html', ROOT)).toBeNull();
    expect(resolveAppRequest('GET', 'kein url', ROOT)).toBeNull();
  });

  it('nichts außerhalb des Ordners, keine fremden Endungen', () => {
    for (const url of [
      'app://spoken/../main/main.cjs', 'app://spoken/..%2f..%2fx.js', 'app://spoken/%2e%2e%2f%2e%2e%2fx.html',
      'app://spoken/main/main.js.map', 'app://spoken/main/', 'app://spoken/', 'app://spoken/x%00.js',
      'app://spoken/%E0%A4%A.html', 'app://spoken/main/main.ts',
    ]) {
      expect(resolveAppRequest('GET', url, ROOT), url).toBeNull();
    }
    // %2e%2e als eigener Abschnitt löst schon der URL-Parser auf – es bleibt im Ordner
    expect(resolveAppRequest('GET', 'app://spoken/%2e%2e/%2e%2e/etc/passwd.html', ROOT)?.path)
      .toBe(join(ROOT, 'etc', 'passwd.html'));
  });
});

describe('createAppHandler', () => {
  let root = '';
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'spoken-protocol-'));
    await mkdir(join(root, 'main'));
    await writeFile(join(root, 'main', 'index.html'), '<!doctype html>');
  });
  afterAll(() => rm(root, { recursive: true, force: true }));

  it('Antwort mit CSP-Header und nosniff', async () => {
    const response = await createAppHandler(root)(new Request('http://x/'));
    expect(response.status).toBe(404); // http:// gehört nicht dazu
    const ok = await createAppHandler(root)({ method: 'GET', url: 'app://spoken/main/index.html' } as Request);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('<!doctype html>');
    expect(ok.headers.get('Content-Security-Policy')).toBe(CSP);
    expect(ok.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(ok.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    const missing = await createAppHandler(root)({ method: 'GET', url: 'app://spoken/history/index.html' } as Request);
    expect(missing.status).toBe(404);
    expect(missing.headers.get('Content-Security-Policy')).toBe(CSP);
  });

  it('CSP wörtlich wie §5.2', () => {
    expect(CSP).toBe("default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; " +
      "connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; " +
      "manifest-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  });
});

describe('Netzsperre der Fenster', () => {
  it('nur app://spoken/ und devtools://', () => {
    expect(requestAllowed('app://spoken/main/index.html')).toBe(true);
    expect(requestAllowed('devtools://devtools/bundled/x.html')).toBe(true);
    for (const url of ['https://spoken.rusty.one/', 'http://127.0.0.1:1/', 'file:///etc/passwd', 'app://spokenx/', 'data:text/html,x', 'ws://x']) {
      expect(requestAllowed(url), url).toBe(false);
    }
  });
});

describe('windowOptions (§5.3)', () => {
  it('exakt die Sicherheitsoptionen', () => {
    expect(windowOptions('T', MAIN_SIZE, true, '/p/preload.cjs', true)).toEqual({
      show: false, title: 'T', width: 700, height: 600, minWidth: 580, minHeight: 480,
      backgroundColor: '#1e1f22', autoHideMenuBar: true,
      webPreferences: {
        preload: '/p/preload.cjs',
        partition: 'spoken-ui',
        contextIsolation: true, nodeIntegration: false, nodeIntegrationInWorker: false,
        nodeIntegrationInSubFrames: false, sandbox: true, webSecurity: true,
        allowRunningInsecureContent: false, experimentalFeatures: false, webviewTag: false,
        navigateOnDragDrop: false, spellcheck: false, safeDialogs: true,
        devTools: false,
      },
    });
  });

  it('Verlauf 900×640, hell, unverpackt mit DevTools', () => {
    const options = windowOptions('V', HISTORY_SIZE, false, '/p', false);
    expect([options.width, options.height, options.minWidth, options.minHeight]).toEqual([900, 640, 640, 440]);
    expect(options.backgroundColor).toBe('#f2f2f2');
    expect(options.webPreferences?.devTools).toBe(true);
    expect(options.webPreferences?.partition).not.toMatch(/^persist:/);
  });
});
