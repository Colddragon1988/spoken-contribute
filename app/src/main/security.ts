/**
 * Härtung (Architektur §5.4): keine Navigation, keine neuen Fenster, keine webviews, keine
 * Berechtigungen und kein Netz für die Fenster – nur app://spoken/… (und devtools:// im Dev).
 */
import type { App, Session } from 'electron';

/** Darf eine Anfrage der Fenster-Session durch? */
export function requestAllowed(url: string): boolean {
  return url.startsWith('app://spoken/') || url.startsWith('devtools://');
}

/** Für alle WebContents, auch künftige: vor ready aufrufen. */
export function hardenWebContents(app: App): void {
  app.on('web-contents-created', (_event, contents) => {
    // Nur dieselbe Adresse (Neu laden im Dev) – sonst bleibt jede Seite, wo sie ist.
    const stay = (event: Electron.Event, url: string): void => {
      if (url !== contents.getURL()) event.preventDefault();
    };
    contents.on('will-navigate', (event, url) => { stay(event, url); });
    contents.on('will-redirect', (event, url) => { stay(event, url); });
    contents.on('will-attach-webview', (event) => { event.preventDefault(); });
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  });
}

/** Berechtigungen und Netzsperre einer Session (Fenster-Session und, sicherheitshalber, Standard). */
export function hardenSession(session: Session): void {
  session.setPermissionRequestHandler((_contents, _permission, callback) => { callback(false); });
  session.setPermissionCheckHandler(() => false);
  session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !requestAllowed(details.url) });
  });
}
