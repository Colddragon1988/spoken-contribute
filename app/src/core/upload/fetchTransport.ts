// HttpTransport über Node-fetch: der einzige Ort im Kern, der ins Netz geht (Lint-Regel).
import { NetworkError } from '../errors';
import type { HttpRequest, HttpResponse, HttpTransport } from '../../shared/types';

/** Der Grund einer Verbindungsstörung, kurz: Fehlercode des Systems (ECONNREFUSED …) oder die Meldung.
 *  Nie die Anfrage selbst – im Body kann ein Passwort stehen. */
function reason(err: unknown): string {
  if (err instanceof Error) {
    // Zeitüberschreitung: wie Pythons socket.timeout „timed out“
    if (err.name === 'TimeoutError' || err.name === 'AbortError') return 'timed out';
    const cause: unknown = (err as { cause?: unknown }).cause;
    if (typeof cause === 'object' && cause !== null) {
      const code = (cause as { code?: unknown }).code;
      if (typeof code === 'string' && code !== '') return code;
      const message = (cause as { message?: unknown }).message;
      if (typeof message === 'string' && message !== '') return message;
    }
    return err.message;
  }
  return String(err);
}

export function createFetchTransport(fetchImpl: typeof fetch): HttpTransport {
  return {
    async post(request: HttpRequest): Promise<HttpResponse> {
      try {
        const response = await fetchImpl(request.url, {
          method: 'POST',
          headers: request.headers,
          body: request.body,
          // Keiner Weiterleitung folgen: Passwort und Sitzung gehen nur an die eine Adresse.
          redirect: 'manual',
          signal: AbortSignal.timeout(request.timeoutMs),
        });
        // Auch das Lesen des Bodys steht unter dem Timeout (gleiches Signal).
        const body = await response.text();
        return { status: response.status, setCookies: response.headers.getSetCookie(), body };
      } catch (err) {
        throw new NetworkError(reason(err));
      }
    },
  };
}
