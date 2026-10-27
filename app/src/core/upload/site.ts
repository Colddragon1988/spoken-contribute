// Die Website spoken.rusty.one: JSON-Anfragen, Anmeldung und verständliche Fehlermeldungen (§3).
import { NetworkError, UploadError } from '../errors';
import { REQUEST_TIMEOUT_MS, SITE_URL } from '../../shared/types';
import type {
  ApiPath, HttpResponse, HttpTransport, JsonObject, JsonValue, Platform, SiteFactory, SiteSession,
} from '../../shared/types';

/** Wie Pythons platform.system(). */
const SYSTEM_NAMES: Readonly<Record<Platform, string>> = { linux: 'Linux', win32: 'Windows', darwin: 'Darwin' };

export const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Wahrheitswert wie in Python: None, False, 0, "", [] und {} sind falsch. */
export function pyTruthy(value: unknown): boolean {
  if (value === null || value === undefined || value === false || value === 0 || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

/** Höchstens n Zeichen (Codepoints wie Pythons Slicing). */
export const truncate = (text: string, n: number): string => Array.from(text).slice(0, n).join('');

/** Die Fehlerbeschreibung aus der JSON-Antwort des Servers, sonst leer. */
function serverDetail(body: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return '';
  }
  if (!isJsonObject(parsed)) return '';
  const error = parsed.error;
  const message = parsed.message;
  const detail = pyTruthy(error) ? error : pyTruthy(message) ? message : '';
  return truncate(typeof detail === 'string' ? detail : JSON.stringify(detail), 200);
}

function httpMessage(what: string, response: HttpResponse): string {
  if (response.status === 429) return `${what}: zu viele Uploads in der letzten Stunde, bitte später erneut.`;
  if (response.status === 401) { // die Sitzung fehlt oder wurde nicht angenommen
    return `${what}: nicht angemeldet (Server-Fehler 401) – bitte im Fenster ab- und neu anmelden.`;
  }
  const detail = serverDetail(response.body);
  if (detail) return `${what}: Server-Fehler ${response.status} – ${detail}.`;
  return `${what}: Server-Fehler ${response.status}.`;
}

interface Cookie {
  readonly value: string;
  readonly path: string;
  readonly secure: boolean;
}

/** Ein einfacher Cookie-Jar im Speicher: Es gibt nur einen Server, also nur Name, Pfad, Secure. */
function createCookieJar() {
  const cookies = new Map<string, Cookie>();
  return {
    store(setCookies: readonly string[], requestPath: string): void {
      for (const line of setCookies) {
        const [pair = '', ...attributes] = line.split(';');
        const eq = pair.indexOf('=');
        if (eq <= 0) continue;
        const name = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1).trim();
        // Standardpfad nach RFC 6265: das „Verzeichnis“ der Anfrage
        let path = requestPath.slice(0, Math.max(requestPath.lastIndexOf('/'), 1));
        let secure = false;
        let expired = false;
        for (const attribute of attributes) {
          const [key = '', ...rest] = attribute.split('=');
          const val = rest.join('=').trim();
          switch (key.trim().toLowerCase()) {
            case 'path':
              if (val.startsWith('/')) path = val;
              break;
            case 'secure':
              secure = true;
              break;
            case 'max-age':
              if (Number(val) <= 0) expired = true;
              break;
            case 'expires': {
              const time = Date.parse(val);
              if (!Number.isNaN(time) && time <= Date.now()) expired = true;
              break;
            }
          }
        }
        if (expired) cookies.delete(name);
        else cookies.set(name, { value, path, secure });
      }
    },
    header(url: URL): string {
      const secureOk = url.protocol === 'https:' || url.hostname === '127.0.0.1' || url.hostname === 'localhost';
      const parts: string[] = [];
      for (const [name, cookie] of cookies) {
        const pathOk = url.pathname === cookie.path || url.pathname.startsWith(cookie.path.endsWith('/') ? cookie.path : `${cookie.path}/`);
        if (pathOk && (secureOk || !cookie.secure)) parts.push(`${name}=${cookie.value}`);
      }
      return parts.join('; ');
    },
  };
}

/** Eine Sitzung: Nach signIn trägt sie das Sitzungs-Cookie bei jeder weiteren Anfrage mit;
 *  sie lebt nur so lange wie das Objekt, also einen Upload-Durchgang. Gespeichert wird nichts. */
export function createSiteSession(
  transport: HttpTransport,
  options: { readonly baseUrl: string; readonly platform: Platform; readonly version: string; readonly timeoutMs?: number },
): SiteSession {
  const jar = createCookieJar();
  const baseHeaders: Readonly<Record<string, string>> = {
    'content-type': 'application/json',
    origin: SITE_URL, // das Auth-System verlangt ihn (CSRF-Schutz)
    'user-agent': `spoken-contribute/${options.version} (${SYSTEM_NAMES[options.platform]})`,
  };
  const base = options.baseUrl.replace(/\/+$/, '');

  const session: SiteSession = {
    async post(path: ApiPath, payload: JsonValue, what: string): Promise<JsonObject> {
      const url = new URL(base + path);
      const headers: Record<string, string> = { ...baseHeaders };
      const cookie = jar.header(url);
      if (cookie) headers.cookie = cookie;
      let response: HttpResponse;
      try {
        response = await transport.post({
          url: url.toString(), headers, body: JSON.stringify(payload), timeoutMs: options.timeoutMs ?? REQUEST_TIMEOUT_MS,
        });
      } catch (err) {
        // Die Meldung nennt nur den Grund, nie die Anfrage (Passwort!).
        if (err instanceof NetworkError) throw new UploadError(`${what}: keine Verbindung zu spoken.rusty.one (${err.message}).`);
        throw err;
      }
      jar.store(response.setCookies, url.pathname);
      if (response.status < 200 || response.status > 299) {
        throw new UploadError(httpMessage(what, response), response.status);
      }
      let result: unknown;
      try {
        result = JSON.parse(response.body);
      } catch {
        result = null;
      }
      if (!isJsonObject(result)) throw new UploadError(`${what}: unerwartete Antwort vom Server.`);
      return result;
    },

    async signIn(email: string, password: string): Promise<JsonObject> {
      let result: JsonObject;
      try {
        result = await session.post('/api/auth/sign-in/email', { email, password }, 'Anmeldung');
      } catch (err) {
        if (err instanceof UploadError && err.status === 401) {
          throw new UploadError('Anmeldung abgelehnt – E-Mail oder Passwort stimmen nicht.', 401);
        }
        throw err;
      }
      const user = result.user;
      return isJsonObject(user) ? user : {};
    },
  };
  return session;
}

export function createSiteFactory(
  transport: HttpTransport, options: { baseUrl: string; platform: Platform; version: string },
): SiteFactory {
  return () => createSiteSession(transport, options);
}
