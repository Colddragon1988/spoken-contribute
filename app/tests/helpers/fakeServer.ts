import { NetworkError } from '../../src/core/errors';
import type { HttpRequest, HttpResponse, HttpTransport, JsonObject, JsonValue } from '../../src/shared/types';

export type PlannedFailure = { readonly status: number; readonly body?: JsonValue } | { readonly network: string } | null;

export interface RecordedCall {
  readonly path: string;
  readonly payload: JsonObject;
  readonly headers: Readonly<Record<string, string>>;
}

const respond = (body: JsonValue, setCookies: string[] = []): HttpResponse =>
  ({ status: 200, setCookies, body: JSON.stringify(body) });

/** Antwortet wie spoken.rusty.one (wie tests/helpers.py FakeServer), aber auf Transportebene. */
export class FakeServer implements HttpTransport {
  readonly calls: RecordedCall[] = [];
  /** je Pfad geplante Fehler, einer je Aufruf; null = dieser Aufruf gelingt */
  readonly fail = new Map<string, PlannedFailure[]>();
  onPost: ((path: string, payload: JsonObject) => void | Promise<void>) | undefined;

  async post(request: HttpRequest): Promise<HttpResponse> {
    const path = new URL(request.url).pathname;
    const payload = JSON.parse(request.body) as JsonObject;
    this.calls.push({ path, payload, headers: request.headers });
    await this.onPost?.(path, payload);
    const planned = this.fail.get(path)?.shift();
    if (planned) {
      if ('network' in planned) throw new NetworkError(planned.network);
      return { status: planned.status, setCookies: [], body: JSON.stringify(planned.body ?? {}) };
    }
    if (path === '/api/auth/sign-in/email') {
      return respond({ user: { email: payload.email ?? null } }, ['session=test-sitzung; Path=/; HttpOnly']);
    }
    if (path === '/api/contributions/batch') {
      const n = Array.isArray(payload.envelopes) ? payload.envelopes.length : 0;
      return respond({ ok: true, accepted: n, known: 1, counted: n, refused: {} });
    }
    const n = Array.isArray(payload.texts) ? payload.texts.length : 0;
    return respond({ texts: n, added: n, changed: 0 });
  }

  paths(): string[] {
    return this.calls.map((call) => call.path);
  }
}
