// Ein echter, lokaler HTTP-Server mit der Antwortlogik von FakeServer – nur 127.0.0.1, freier Port.
// Für Tests von createFetchTransport (Timeout, Set-Cookie, Fehlerkörper) und für UI/CLI-E2E.
// Nie ein Weg nach draußen (Regel 2): Er lauscht ausschließlich auf der Loopback-Adresse.
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { NetworkError } from '../../src/core/errors';
import { FakeServer } from './fakeServer';

/** Eine Antwort, die nicht aus der FakeServer-Logik kommt (z. B. kein JSON). */
export interface RawResponse {
  readonly status: number;
  readonly body: string;
  readonly headers?: Readonly<Record<string, string | readonly string[]>>;
}

export interface HttpFakeServer {
  /** z. B. "http://127.0.0.1:43123" – als baseUrl für createSiteFactory */
  readonly url: string;
  /** Logik und Aufzeichnung (calls, fail, onPost) */
  readonly server: FakeServer;
  /** Verzögerung vor jeder Antwort in ms (für Timeout-Tests) */
  delayMs: number;
  /** je Pfad geplante Rohantworten, eine je Aufruf (Vorrang vor der FakeServer-Logik) */
  readonly raw: Map<string, RawResponse[]>;
  close(): Promise<void>;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => { resolve(Buffer.concat(chunks).toString('utf8')); });
    request.on('error', reject);
  });
}

function flatHeaders(request: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.headers)) {
    if (value !== undefined) headers[key] = Array.isArray(value) ? value.join(', ') : value;
  }
  return headers;
}

export async function startHttpFakeServer(): Promise<HttpFakeServer> {
  const logic = new FakeServer();
  const raw = new Map<string, RawResponse[]>();
  const state = { delayMs: 0 };

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await readBody(request);
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    if (state.delayMs > 0) await sleep(state.delayMs);
    if (response.destroyed) return;
    const planned = raw.get(path)?.shift();
    if (planned) {
      response.writeHead(planned.status, { 'content-type': 'application/json', ...planned.headers });
      response.end(planned.body);
      return;
    }
    try {
      const answer = await logic.post({ url: `http://127.0.0.1${request.url ?? '/'}`, headers: flatHeaders(request), body, timeoutMs: 0 });
      const headers: Record<string, string | string[]> = { 'content-type': 'application/json' };
      if (answer.setCookies.length > 0) headers['set-cookie'] = [...answer.setCookies];
      response.writeHead(answer.status, headers);
      response.end(answer.body);
    } catch (err) {
      // geplanter Netzfehler: Verbindung hart trennen
      if (err instanceof NetworkError) request.socket.destroy();
      else {
        response.writeHead(500, { 'content-type': 'text/plain' });
        response.end('Fehler im Testserver');
      }
    }
  }

  const httpServer = createServer((request, response) => {
    handle(request, response).catch(() => request.socket.destroy());
  });
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', () => { resolve(); });
  });
  const { port } = httpServer.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    server: logic,
    raw,
    get delayMs() { return state.delayMs; },
    set delayMs(value: number) { state.delayMs = value; },
    close: () => new Promise<void>((resolve) => {
      httpServer.closeAllConnections();
      httpServer.close(() => { resolve(); });
    }),
  };
}
