/**
 * Die vorgetäuschte Umgebung der UI-Sandbox (Architektur §7.2). Nur aktiv, wenn env.ts die
 * Sandbox unverpackt, unter os.tmpdir() und mit Server 127.0.0.1 zugelassen hat.
 *
 * <sandbox>/system.json wird bei jedem Zugriff neu gelesen, damit Tests laufende Spiele,
 * Systemdesign, Schlüsselbund und Dialogantworten zur Laufzeit ändern können:
 *
 *   { "prozesse": ["…\\_classic_era_\\WoWClassic.exe"],
 *     "dunkel": true | false | null,
 *     "schluesselbund": { "art": "system" | "basic_text" | "none", "gesperrt": false, "eintraege": {} },
 *     "wowSuche": "<Pfad in der Sandbox>" | null,     // Ergebnis von „Suchen“
 *     "ordnerwahl": "<Pfad in der Sandbox>" | null,   // Ergebnis von „Ändern …“
 *     "dialogAntwort": "ja" | "nein" }                // Ja/Nein-Fragen (Standard: nein)
 *
 * Gezeigte Dialoge landen in <sandbox>/dialoge.json, „geöffnete“ Ordner und Adressen in
 * <sandbox>/geoeffnet.json – geöffnet wird in der Sandbox nichts.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { DarkModeProbe, JsonObject, JsonValue, SecretBackend, SecretStore } from '../shared/types';
import type { MessageKind, NativeUi } from './nativeUi';

export const SYSTEM_FILE = 'system.json';
export const DIALOG_LOG = 'dialoge.json';
export const OPENED_LOG = 'geoeffnet.json';

export interface SandboxSystem {
  read(): JsonObject;
  write(system: JsonObject): void;
  /** Programmpfade der „laufenden Prozesse“ */
  programs(): string[];
  /** Systemdesign dunkel? null = keine Antwort */
  dark(): boolean | null;
  /** Pfad nur, wenn er in der Sandbox liegt – nie die echte Installation (Regel 1) */
  pathInside(key: 'wowSuche' | 'ordnerwahl'): string | null;
  /** Eintrag an eine Protokolldatei der Sandbox anhängen */
  append(file: string, entry: JsonObject): void;
}

const isObject = (value: JsonValue | undefined): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function createSandboxSystem(root: string): SandboxSystem {
  const file = join(root, SYSTEM_FILE);
  const inside = (path: string): boolean => {
    const full = resolve(path);
    return full === root || full.startsWith(root + sep);
  };
  const system: SandboxSystem = {
    read() {
      try {
        const value = JSON.parse(readFileSync(file, 'utf8')) as JsonValue;
        return isObject(value) ? value : {};
      } catch {
        return {};
      }
    },
    write(next) {
      writeFileSync(file, JSON.stringify(next, null, 2));
    },
    programs() {
      const list = system.read().prozesse;
      return Array.isArray(list) ? list.filter((p): p is string => typeof p === 'string') : [];
    },
    dark() {
      const value = system.read().dunkel;
      return typeof value === 'boolean' ? value : null;
    },
    pathInside(key) {
      const value = system.read()[key];
      return typeof value === 'string' && inside(value) ? resolve(value) : null;
    },
    append(name, entry) {
      const path = join(root, name);
      let list: JsonValue[] = [];
      try {
        const value = JSON.parse(readFileSync(path, 'utf8')) as JsonValue;
        if (Array.isArray(value)) list = value;
      } catch {
        // noch keine Datei
      }
      list.push(entry);
      writeFileSync(path, JSON.stringify(list, null, 2));
    },
  };
  return system;
}

/** Vorgetäuschter Schlüsselbund aus system.json – verhält sich wie tests/helpers/fakeKeyring.ts. */
export function createSandboxKeyring(system: SandboxSystem): SecretStore {
  const ring = (): { art: SecretBackend; gesperrt: boolean; eintraege: Record<string, string> } => {
    const value = system.read().schluesselbund;
    const object = isObject(value) ? value : {};
    const art = object.art === 'system' || object.art === 'basic_text' ? object.art : 'none';
    const eintraege: Record<string, string> = {};
    if (isObject(object.eintraege)) {
      for (const [key, pw] of Object.entries(object.eintraege)) if (typeof pw === 'string') eintraege[key] = pw;
    }
    return { art, gesperrt: object.gesperrt === true, eintraege };
  };
  const open = (): Record<string, string> => {
    const current = ring();
    if (current.gesperrt) throw new Error('Schlüsselbund gesperrt');
    return current.eintraege;
  };
  const save = (eintraege: Record<string, string>): void => {
    const all = system.read();
    const old = isObject(all.schluesselbund) ? all.schluesselbund : {};
    system.write({ ...all, schluesselbund: { ...old, eintraege } });
  };
  return {
    available: () => ring().art === 'system',
    backend: () => ring().art,
    get: (account) => Promise.resolve().then(() => open()[account] ?? null),
    set: (account, password) => Promise.resolve().then(() => { save({ ...open(), [account]: password }); }),
    delete: (account) => Promise.resolve().then(() => {
      const entries = open();
      if (!(account in entries)) throw new Error(`kein Eintrag für ${account}`);
      const { [account]: _gone, ...rest } = entries;
      save(rest);
    }),
  };
}

export function createSandboxDarkMode(system: SandboxSystem): DarkModeProbe {
  return { prefersDark: () => Promise.resolve(system.dark()) };
}

/** Dialoge und Öffnen ohne echte Fenster: Antworten aus system.json, alles wird protokolliert. */
export function createSandboxUi(system: SandboxSystem): NativeUi {
  return {
    message(_owner, kind: MessageKind, title, text) {
      system.append(DIALOG_LOG, { art: kind, titel: title, text });
      return Promise.resolve();
    },
    confirm(_owner, title, text) {
      system.append(DIALOG_LOG, { art: 'frage', titel: title, text });
      return Promise.resolve(system.read().dialogAntwort === 'ja');
    },
    chooseFolder(_owner, title, start) {
      system.append(DIALOG_LOG, { art: 'ordnerwahl', titel: title, text: start });
      return Promise.resolve(system.pathInside('ordnerwahl'));
    },
    openPath(path) {
      system.append(OPENED_LOG, { art: 'ordner', ziel: path });
      return Promise.resolve('');
    },
    openExternal(url) {
      system.append(OPENED_LOG, { art: 'extern', ziel: url });
      return Promise.resolve();
    },
  };
}
