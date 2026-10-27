// SiteSession (§3): Header, Cookie-Jar, Fehlertexte, Anmeldung, Passwort-Hygiene.
import { describe, expect, it } from 'vitest';
import { UploadError } from '../../../src/core/errors';
import { createSiteFactory } from '../../../src/core/upload';
import { createSiteSession } from '../../../src/core/upload/site';
import { CLIENT_VERSION } from '../../../src/shared/types';
import type { HttpRequest, HttpResponse, HttpTransport, Platform } from '../../../src/shared/types';
import { FakeServer } from '../../helpers/fakeServer';

const BASE = 'http://127.0.0.1:9';
const PASSWORD = 'Sehr-Geheim-4711';

function factory(server: HttpTransport, platform: Platform = 'linux') {
  return createSiteFactory(server, { baseUrl: BASE, platform, version: CLIENT_VERSION });
}

/** Transport mit fester Antwort, zeichnet die Anfragen auf. */
function fixed(response: Partial<HttpResponse> & { status: number }) {
  const requests: HttpRequest[] = [];
  const transport: HttpTransport = {
    post: (request) => {
      requests.push(request);
      return Promise.resolve({ setCookies: [], body: '{}', ...response });
    },
  };
  return { transport, requests };
}

async function message(promise: Promise<unknown>): Promise<UploadError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof UploadError) return err;
    throw err;
  }
  throw new Error('kein Fehler');
}

describe('Header', () => {
  it('schickt content-type, origin und user-agent wie Python (V4 abgelehnt: 2.1)', async () => {
    expect(CLIENT_VERSION).toBe('2.1');
    for (const [platform, system] of [['linux', 'Linux'], ['win32', 'Windows'], ['darwin', 'Darwin']] as const) {
      const server = new FakeServer();
      await factory(server, platform)().post('/api/contributions/batch', { envelopes: [] }, 'Gesammelte Zeilen');
      expect(server.calls[0]?.headers).toEqual({
        'content-type': 'application/json',
        origin: 'https://spoken.rusty.one',
        'user-agent': `spoken-contribute/2.1 (${system})`,
      });
    }
  });

  it('sendet an baseUrl + Pfad, POST mit JSON-Body und 120 s Timeout', async () => {
    const { transport, requests } = fixed({ status: 200 });
    await createSiteSession(transport, { baseUrl: `${BASE}/`, platform: 'linux', version: '2.1' })
      .post('/api/broadcast-text', { lang: 'deDE', build: 1, texts: [] }, 'x');
    expect(requests[0]?.url).toBe(`${BASE}/api/broadcast-text`);
    expect(JSON.parse(requests[0]?.body ?? '')).toEqual({ lang: 'deDE', build: 1, texts: [] });
    expect(requests[0]?.timeoutMs).toBe(120_000);
  });
});

describe('Cookies', () => {
  it('Sitzungs-Cookie nach dem Login geht bei den Texten mit, nicht über Durchgänge hinweg', async () => {
    const server = new FakeServer();
    const openSite = factory(server);
    const site = openSite();
    const user = await site.signIn('a@b.c', PASSWORD);
    expect(user).toEqual({ email: 'a@b.c' });
    await site.post('/api/broadcast-text', { lang: 'deDE', build: 1, texts: [] }, 'NPC-Texte (Classic Era, deDE)');
    expect(server.calls[0]?.headers.cookie).toBeUndefined();
    expect(server.calls[1]?.headers.cookie).toBe('session=test-sitzung');
    // neuer Durchgang = neue Sitzung, kein Cookie
    await openSite().post('/api/broadcast-text', { lang: 'deDE', build: 1, texts: [] }, 'x');
    expect(server.calls[2]?.headers.cookie).toBeUndefined();
  });

  it('beachtet Path, Max-Age=0 und Secure', async () => {
    const answers: string[][] = [
      ['a=1; Path=/', 'b=2; Path=/anderswo', 'c=3; Secure; Path=/api'],
      ['a=; Max-Age=0; Path=/'],
    ];
    const requests: HttpRequest[] = [];
    const transport: HttpTransport = {
      post: (request) => {
        requests.push(request);
        return Promise.resolve({ status: 200, setCookies: answers.shift() ?? [], body: '{}' });
      },
    };
    // über http zu einem fremden Rechner gehen Secure-Cookies nicht mit
    const site = createSiteSession(transport, { baseUrl: 'http://beispiel.invalid', platform: 'linux', version: '2.1' });
    await site.post('/api/auth/sign-in/email', {}, 'Anmeldung');
    await site.post('/api/broadcast-text', {}, 'x');
    await site.post('/api/broadcast-text', {}, 'x');
    expect(requests[1]?.headers.cookie).toBe('a=1');
    expect(requests[2]?.headers.cookie).toBeUndefined();
  });

  it('nimmt Cookies auch aus Fehlerantworten (wie urllib)', async () => {
    const answers: HttpResponse[] = [
      { status: 500, setCookies: ['x=1; Path=/'], body: '' },
      { status: 200, setCookies: [], body: '{}' },
    ];
    const requests: HttpRequest[] = [];
    const transport: HttpTransport = {
      post: (request) => { requests.push(request); return Promise.resolve(answers.shift() ?? { status: 200, setCookies: [], body: '{}' }); },
    };
    const site = createSiteSession(transport, { baseUrl: BASE, platform: 'linux', version: '2.1' });
    await expect(site.post('/api/broadcast-text', {}, 'x')).rejects.toThrow(UploadError);
    await site.post('/api/broadcast-text', {}, 'x');
    expect(requests[1]?.headers.cookie).toBe('x=1');
  });
});

describe('Fehlertexte', () => {
  const post = (response: Partial<HttpResponse> & { status: number }, what = 'Gesammelte Zeilen') =>
    message(factory(fixed(response).transport)().post('/api/contributions/batch', {}, what));

  it('429', async () => {
    const err = await post({ status: 429 });
    expect(err.message).toBe('Gesammelte Zeilen: zu viele Uploads in der letzten Stunde, bitte später erneut.');
    expect(err.status).toBe(429);
  });

  it('401', async () => {
    const err = await post({ status: 401 }, 'NPC-Texte (Classic Era, deDE)');
    expect(err.message).toBe('NPC-Texte (Classic Era, deDE): nicht angemeldet (Server-Fehler 401) – bitte im Fenster ab- und neu anmelden.');
    expect(err.status).toBe(401);
  });

  it('5xx mit error, mit message, gekürzt auf 200 Zeichen, ohne Detail', async () => {
    expect((await post({ status: 500, body: '{"error":"Datenbank weg"}' })).message)
      .toBe('Gesammelte Zeilen: Server-Fehler 500 – Datenbank weg.');
    expect((await post({ status: 503, body: '{"error":"","message":"Wartung"}' })).message)
      .toBe('Gesammelte Zeilen: Server-Fehler 503 – Wartung.');
    expect((await post({ status: 400, body: JSON.stringify({ error: 'ä'.repeat(300) }) })).message)
      .toBe(`Gesammelte Zeilen: Server-Fehler 400 – ${'ä'.repeat(200)}.`);
    expect((await post({ status: 502, body: '<html>Bad Gateway</html>' })).message)
      .toBe('Gesammelte Zeilen: Server-Fehler 502.');
    expect((await post({ status: 500, body: '[1]' })).message).toBe('Gesammelte Zeilen: Server-Fehler 500.');
    expect((await post({ status: 500, body: '{}' })).status).toBe(500);
    // 3xx wird nicht verfolgt und gilt als Fehler
    expect((await post({ status: 302, body: '' })).message).toBe('Gesammelte Zeilen: Server-Fehler 302.');
  });

  it('Body kein Objekt → „unerwartete Antwort vom Server“', async () => {
    for (const body of ['[]', '"ok"', 'null', '42', 'kein json', '']) {
      expect((await post({ status: 200, body })).message).toBe('Gesammelte Zeilen: unerwartete Antwort vom Server.');
    }
  });

  it('Netzfehler → „keine Verbindung“ mit Grund', async () => {
    const server = new FakeServer();
    server.fail.set('/api/contributions/batch', [{ network: 'ECONNREFUSED' }]);
    const err = await message(factory(server)().post('/api/contributions/batch', {}, 'Gesammelte Zeilen'));
    expect(err.message).toBe('Gesammelte Zeilen: keine Verbindung zu spoken.rusty.one (ECONNREFUSED).');
    expect(err.status).toBeNull();
  });
});

describe('Anmeldung', () => {
  it('401 → „Anmeldung abgelehnt“, andere Fehler mit what = Anmeldung', async () => {
    const server = new FakeServer();
    server.fail.set('/api/auth/sign-in/email', [{ status: 401 }, { status: 500 }]);
    const site = factory(server)();
    const rejected = await message(site.signIn('a@b.c', PASSWORD));
    expect(rejected.message).toBe('Anmeldung abgelehnt – E-Mail oder Passwort stimmen nicht.');
    expect(rejected.status).toBe(401);
    expect((await message(site.signIn('a@b.c', PASSWORD))).message).toBe('Anmeldung: Server-Fehler 500.');
    expect(server.calls[0]?.payload).toEqual({ email: 'a@b.c', password: PASSWORD });
  });

  it('user kein Objekt → {}', async () => {
    const site = factory(fixed({ status: 200, body: '{"user":"x"}' }).transport)();
    expect(await site.signIn('a@b.c', PASSWORD)).toEqual({});
  });

  it('kein Passwort in Fehlermeldungen', async () => {
    const cases: (Partial<HttpResponse> & { status: number })[] = [
      { status: 401 }, { status: 500, body: '{"error":"x"}' }, { status: 200, body: 'kaputt' }, { status: 429 },
    ];
    for (const response of cases) {
      const err = await message(factory(fixed(response).transport)().signIn('a@b.c', PASSWORD));
      expect(err.message).not.toContain(PASSWORD);
      expect(String(err)).not.toContain(PASSWORD);
      expect(err.stack ?? '').not.toContain(PASSWORD);
    }
    const server = new FakeServer();
    server.fail.set('/api/auth/sign-in/email', [{ network: 'ETIMEDOUT' }]);
    const err = await message(factory(server)().signIn('a@b.c', PASSWORD));
    expect(err.message).toBe('Anmeldung: keine Verbindung zu spoken.rusty.one (ETIMEDOUT).');
    expect(String(err)).not.toContain(PASSWORD);
  });
});
