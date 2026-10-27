/**
 * Prüfer für alles, was der Renderer per IPC schickt (rein, getestet; Architektur §4.1).
 * Der Renderer gilt als nicht vertrauenswürdig: falscher Typ, zu lang, NUL-Zeichen oder
 * zusätzliche Schlüssel ergeben INVALID – kein Wurf, damit Electron nichts protokolliert.
 */
import { ART_FILTERS, LIMITS, THEME_SETTINGS, type HistoryQuery, type MessageRequest } from '../shared/ipc';
import type { ArtFilter, ThemeSetting } from '../shared/types';

export const INVALID: unique symbol = Symbol('ungültig');
export type Invalid = typeof INVALID;

export function isInvalid(value: unknown): value is Invalid {
  return value === INVALID;
}

/** Zeichenkette mit höchstens max UTF-16-Einheiten und ohne NUL. */
export function text(value: unknown, max: number): string | Invalid {
  if (typeof value !== 'string' || value.length > max || value.includes('\0')) return INVALID;
  return value;
}

export function bool(value: unknown): boolean | Invalid {
  return typeof value === 'boolean' ? value : INVALID;
}

export function oneOf<T extends string>(value: unknown, members: readonly T[]): T | Invalid {
  return typeof value === 'string' && (members as readonly string[]).includes(value) ? (value as T) : INVALID;
}

/** Ganzzahl ≥ 0 im sicheren Bereich. */
export function count(value: unknown): number | Invalid {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : INVALID;
}

/** Einfaches Objekt mit genau diesen Schlüsseln (kein Array, keine Klasse, nichts zusätzlich). */
export function exactObject<K extends string>(value: unknown, keys: readonly K[]): Record<K, unknown> | Invalid {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return INVALID;
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return INVALID;
  const own = Object.keys(value);
  if (own.length !== keys.length || !keys.every((key) => Object.hasOwn(value, key))) return INVALID;
  return value as Record<K, unknown>;
}

/** Ordnername eines Verlaufseintrags: nur ein Name, kein Pfad (ob es ihn gibt, prüft der Verlauf). */
export function entryId(value: unknown): string | Invalid {
  const id = text(value, LIMITS.entryId);
  if (isInvalid(id) || id === '' || id.includes('/') || id.includes('\\') || id.includes('..')) return INVALID;
  return id;
}

export const wowPath = (value: unknown): string | Invalid => text(value, LIMITS.path);

export const themeSetting = (value: unknown): ThemeSetting | Invalid => oneOf(value, THEME_SETTINGS);

/** Anmeldedaten; die E-Mail wird getrimmt. Leere Felder sind gültig – das meldet der Handler. */
export function signInArgs(value: unknown): { email: string; password: string } | Invalid {
  const object = exactObject(value, ['email', 'password']);
  if (isInvalid(object)) return INVALID;
  const email = text(object.email, LIMITS.email);
  const password = text(object.password, LIMITS.password);
  if (isInvalid(email) || isInvalid(password)) return INVALID;
  return { email: email.trim(), password };
}

export function uploadArgs(value: unknown): { test: boolean } | Invalid {
  const object = exactObject(value, ['test']);
  if (isInvalid(object)) return INVALID;
  const test = bool(object.test);
  return isInvalid(test) ? INVALID : { test };
}

export function historyQuery(value: unknown): HistoryQuery | Invalid {
  const object = exactObject(value, ['seq', 'search', 'art', 'version']);
  if (isInvalid(object)) return INVALID;
  const seq = count(object.seq);
  const search = text(object.search, LIMITS.search);
  const art: ArtFilter | Invalid = oneOf(object.art, ART_FILTERS);
  const version = text(object.version, LIMITS.version);
  if (isInvalid(seq) || isInvalid(search) || isInvalid(art) || isInvalid(version)) return INVALID;
  return { seq, search, art, version };
}

export function messageRequest(value: unknown): MessageRequest | Invalid {
  const object = exactObject(value, ['kind', 'title', 'text']);
  if (isInvalid(object)) return INVALID;
  const kind = oneOf(object.kind, ['info', 'warnung', 'fehler'] as const);
  const title = text(object.title, LIMITS.title);
  const body = text(object.text, LIMITS.messageText);
  if (isInvalid(kind) || isInvalid(title) || isInvalid(body)) return INVALID;
  return { kind, title, text: body };
}

/** Wie Pythons Path.expanduser für „~“ und „~/…“ (unter Windows auch „~\…“). */
export function expandUser(path: string, home: string, windows: boolean): string {
  if (path === '~') return home;
  if (path.startsWith('~/') || (windows && path.startsWith('~\\'))) return home + path.slice(1);
  return path;
}

// ------------------------------------------------------------------ Absender

export type WindowKind = 'haupt' | 'verlauf';
/** Welche Fenster einen Kanal benutzen dürfen (Spalte „Fenster“ in §4.2). */
export type ChannelWindows = WindowKind | 'beide';

export const APP_ORIGIN = 'app://spoken/';

export interface SenderInfo {
  /** event.senderFrame vorhanden? (fehlt, wenn der Frame schon weg ist) */
  readonly hasFrame: boolean;
  /** senderFrame === sender.mainFrame (kein iframe) */
  readonly isMainFrame: boolean;
  readonly url: string;
  /** zu welchem unserer Fenster der Absender gehört; null = keinem */
  readonly window: WindowKind | null;
}

/** Absenderprüfung (§4.1): Hauptframe, unsere Seite, unser Fenster, passender Kanal. */
export function senderAllowed(sender: SenderInfo, allowed: ChannelWindows): boolean {
  if (!sender.hasFrame || !sender.isMainFrame || !sender.url.startsWith(APP_ORIGIN)) return false;
  if (sender.window === null) return false;
  return allowed === 'beide' || allowed === sender.window;
}
