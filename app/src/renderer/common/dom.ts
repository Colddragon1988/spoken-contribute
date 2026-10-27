/**
 * Kleine DOM-Helfer für beide Fenster. Text kommt nur über textContent/Textknoten ins Dokument
 * (CSP und Schutz vor eingeschleustem HTML: Verlaufsinhalte stammen aus Spieldaten).
 */
import { LIMITS } from '../../shared/ipc';

/** Element mit dieser id und diesem Typ – fehlt es, ist das ein Programmfehler im HTML. */
export function byId<T extends HTMLElement>(id: string, type: new () => T): T {
  const element = document.getElementById(id);
  if (!(element instanceof type)) throw new Error(`Element #${id} fehlt oder hat den falschen Typ`);
  return element;
}

type Child = Node | string | null | undefined | false;

/** Element erzeugen: h('td', { class: 'zahl' }, '12'). Attribute als Text, Kinder als Knoten/Text. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs: Readonly<Record<string, string>> = {}, ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, value);
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child);
  }
  return element;
}

/** Inhalt ersetzen (statt innerHTML). */
export function replaceChildren(element: Element, ...children: Child[]): void {
  element.replaceChildren(...children.filter((c): c is Node | string => c !== null && c !== undefined && c !== false));
}

/** Text setzen und die Fehlerfarbe an- oder abschalten. */
export function setStatus(element: HTMLElement, text: string, error = false): void {
  element.textContent = text;
  element.classList.toggle('fehler', error);
}

/** Fehlertexte für den nativen Dialog kürzen, damit die Prüfung im Main sie nicht ablehnt. */
export const clip = (text: string, max: number = LIMITS.messageText): string =>
  text.length > max ? text.slice(0, max - 1) + '…' : text;

/**
 * Unerwartete Fehler im Fenster anzeigen statt still in der Konsole verschwinden (wie
 * show_crash der Python-Fassung): „Unerwarteter Fehler:\n\n{String(err)}“.
 */
export function showUnexpectedErrors(title: string): void {
  const show = (error: unknown): void => {
    void window.spoken.showMessage({ kind: 'fehler', title, text: clip(`Unerwarteter Fehler:\n\n${String(error)}`) })
      .catch(() => undefined); // geht auch das nicht, bleibt nur die Konsole
  };
  window.addEventListener('error', (event) => { show(event.error ?? event.message); });
  window.addEventListener('unhandledrejection', (event) => { show(event.reason); });
}
