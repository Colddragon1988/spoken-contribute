/**
 * Das app://-Protokoll (Architektur §5.1/5.2): liefert nur Dateien aus dist/renderer, nur GET,
 * nur bekannte Endungen, immer mit CSP-Header. Ohne Electron-Import, damit es testbar bleibt;
 * main.ts hängt createAppHandler an die Fenster-Session.
 */
import { readFile } from 'node:fs/promises';
import { extname, normalize, sep } from 'node:path';

export const APP_SCHEME = 'app';
export const APP_HOST = 'spoken';
export const MAIN_PAGE = 'app://spoken/main/index.html';
export const HISTORY_PAGE = 'app://spoken/history/index.html';

/** Content-Security-Policy als HTTP-Header (wörtlich §5.2). */
export const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; " +
  "connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; " +
  "manifest-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

/** Datei unter root zu einer Anfrage, oder null (→ 404). */
export function resolveAppRequest(method: string, url: string, root: string): { path: string; type: string } | null {
  if (method !== 'GET') return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${APP_SCHEME}:` || parsed.host !== APP_HOST) return null;
  let relative: string;
  try {
    relative = decodeURIComponent(parsed.pathname);
  } catch {
    return null; // kaputtes %-Escape
  }
  if (relative.includes('\0')) return null;
  const base = normalize(root);
  const path = normalize(base + sep + relative);
  if (!path.startsWith(base + sep)) return null; // ../ aus dem Ordner heraus
  const type = TYPES[extname(path).toLowerCase()];
  return type === undefined ? null : { path, type };
}

function headers(type: string | null): Record<string, string> {
  const result: Record<string, string> = {
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
  };
  if (type !== null) result['Content-Type'] = type;
  return result;
}

/** Handler für protocol.handle('app', …). */
export function createAppHandler(
  root: string, read: (path: string) => Promise<Uint8Array> = readFile,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const found = resolveAppRequest(request.method, request.url, root);
    if (found !== null) {
      try {
        const body = await read(found.path);
        return new Response(body, { status: 200, headers: headers(found.type) });
      } catch {
        // fehlt oder unlesbar: wie unbekannt
      }
    }
    return new Response('', { status: 404, headers: headers('text/plain; charset=utf-8') });
  };
}
