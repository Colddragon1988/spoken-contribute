// Die echte fetch-Strecke gegen einen lokalen HTTP-Server (nur 127.0.0.1): Set-Cookie,
// Statuscodes, Fehlerkörper, Netzfehler und Timeout (mit kurzem, injiziertem Timeout).
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, onTestFinished } from 'vitest';
import { NetworkError, UploadError } from '../../../src/core/errors';
import { createFetchTransport, createSiteFactory } from '../../../src/core/upload';
import { createSiteSession } from '../../../src/core/upload/site';
import { CLIENT_VERSION } from '../../../src/shared/types';
import { startHttpFakeServer } from '../../helpers/httpFakeServer';
import type { HttpFakeServer } from '../../helpers/httpFakeServer';

const PASSWORD = 'Sehr-Geheim-4711';

async function start(): Promise<HttpFakeServer> {
  const server = await startHttpFakeServer();
  onTestFinished(() => server.close());
  return server;
}

const request = (url: string, timeoutMs = 5000) => ({
  url, headers: { 'content-type': 'application/json' }, body: '{"envelopes":[]}', timeoutMs,
});

async function networkError(promise: Promise<unknown>): Promise<NetworkError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof NetworkError) return err;
    throw err;
  }
  throw new Error('kein Fehler');
}

describe('createFetchTransport', () => {
  it('liefert Status, Set-Cookie und Body', async () => {
    const http = await start();
    const transport = createFetchTransport(globalThis.fetch);
    const answer = await transport.post({ ...request(`${http.url}/api/auth/sign-in/email`), body: '{"email":"a@b.c","password":"x"}' });
    expect(answer.status).toBe(200);
    expect(answer.setCookies).toEqual(['session=test-sitzung; Path=/; HttpOnly']);
    expect(JSON.parse(answer.body)).toEqual({ user: { email: 'a@b.c' } });
  });

  it('wirft bei HTTP-Fehlern nicht, sondern liefert den Status', async () => {
    const http = await start();
    http.server.fail.set('/api/contributions/batch', [{ status: 503, body: { error: 'Wartung' } }]);
    const answer = await createFetchTransport(globalThis.fetch).post(request(`${http.url}/api/contributions/batch`));
    expect(answer.status).toBe(503);
    expect(JSON.parse(answer.body)).toEqual({ error: 'Wartung' });
  });

  it('folgt keiner Weiterleitung', async () => {
    const http = await start();
    http.raw.set('/api/contributions/batch', [{ status: 307, body: '', headers: { location: 'http://127.0.0.1:9/woanders' } }]);
    const answer = await createFetchTransport(globalThis.fetch).post(request(`${http.url}/api/contributions/batch`));
    expect(answer.status).toBe(307);
    expect(http.server.calls).toHaveLength(0);
  });

  it('getrennte Verbindung → NetworkError', async () => {
    const http = await start();
    http.server.fail.set('/api/contributions/batch', [{ network: 'getrennt' }]);
    const err = await networkError(createFetchTransport(globalThis.fetch).post(request(`${http.url}/api/contributions/batch`)));
    expect(err.message).not.toBe('');
  });

  it('kein Server am Port → NetworkError mit Systemcode', async () => {
    // freien Port holen und sofort wieder schließen
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const { port } = probe.address() as AddressInfo;
    await new Promise<void>((resolve) => probe.close(() => { resolve(); }));
    const err = await networkError(createFetchTransport(globalThis.fetch).post(request(`http://127.0.0.1:${port}/api/x`)));
    expect(err.message).toBe('ECONNREFUSED');
  });

  it('Timeout → NetworkError „timed out“', async () => {
    const http = await start();
    http.delayMs = 2000;
    const err = await networkError(createFetchTransport(globalThis.fetch).post(request(`${http.url}/api/contributions/batch`, 150)));
    expect(err.message).toBe('timed out');
  });
});

describe('ganze Strecke SiteSession → fetch → lokaler Server', () => {
  it('Login setzt das Cookie, die Texte tragen es; Header kommen an', async () => {
    const http = await start();
    const openSite = createSiteFactory(createFetchTransport(globalThis.fetch), { baseUrl: http.url, platform: 'linux', version: CLIENT_VERSION });
    const site = openSite();
    await site.signIn('a@b.c', PASSWORD);
    const answer = await site.post('/api/broadcast-text', { lang: 'deDE', build: 1, texts: [{ id: 1, text: 'Hallo', text1: '' }] }, 'NPC-Texte');
    expect(answer).toEqual({ texts: 1, added: 1, changed: 0 });
    const [login, texts] = http.server.calls;
    expect(login?.headers['user-agent']).toBe('spoken-contribute/2.1 (Linux)');
    expect(login?.headers.origin).toBe('https://spoken.rusty.one');
    expect(login?.headers['content-type']).toBe('application/json');
    expect(login?.headers.cookie).toBeUndefined();
    expect(texts?.headers.cookie).toBe('session=test-sitzung');
  });

  it('Timeout und Netzfehler werden zur UploadError ohne Passwort', async () => {
    const http = await start();
    http.delayMs = 2000;
    const site = createSiteSession(createFetchTransport(globalThis.fetch), {
      baseUrl: http.url, platform: 'linux', version: CLIENT_VERSION, timeoutMs: 150,
    });
    const err = await site.signIn('a@b.c', PASSWORD).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(UploadError);
    expect(String(err)).toBe('UploadError: Anmeldung: keine Verbindung zu spoken.rusty.one (timed out).');
    expect(String(err)).not.toContain(PASSWORD);
  });

  it('Rohantwort ohne JSON → „unerwartete Antwort vom Server“', async () => {
    const http = await start();
    http.raw.set('/api/contributions/batch', [{ status: 200, body: '<html></html>' }]);
    const site = createSiteFactory(createFetchTransport(globalThis.fetch), { baseUrl: http.url, platform: 'linux', version: CLIENT_VERSION })();
    await expect(site.post('/api/contributions/batch', {}, 'Gesammelte Zeilen'))
      .rejects.toThrow('Gesammelte Zeilen: unerwartete Antwort vom Server.');
  });
});
