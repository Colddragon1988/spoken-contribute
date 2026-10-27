/**
 * Einstellungen (WoW-Ordner, automatischer Upload, Design) in settings.json im Konfig-Ordner (§5.3).
 * Wie Python: kaputte oder fehlende Datei ergibt die Standardwerte; ein leerer WoW-Ordner wird gesucht.
 */
import { join } from 'node:path';
import type { JsonValue, Settings, SettingsStore, ThemeSetting } from '../../shared/types';
import { FILES, THEME_LABELS } from '../../shared/types';
import { readJsonObject, writeFileAtomic } from '../fsutil';

/** Pythons Wahrheitswert eines JSON-Werts (leere Liste/leeres Objekt, 0, "" sind falsch). */
function truthy(value: JsonValue | undefined): boolean {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return Boolean(value);
}

/** Wie Python str(data.get("wow_dir") or ""): Strings unverändert, andere Werte als Text.
 * (Nicht-String-Werte sind ohnehin kein WoW-Ordner; Hauptsache, es wird dann nicht gesucht.) */
function wowDirOf(value: JsonValue | undefined): string {
  if (value === undefined || !truthy(value)) return '';
  return typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function themeOf(value: JsonValue | undefined): ThemeSetting {
  return typeof value === 'string' && Object.hasOwn(THEME_LABELS, value) ? (value as ThemeSetting) : 'system';
}

/** Inhalt von settings.json wie Pythons json.dumps(asdict(settings), ensure_ascii=False, indent=2). */
export function settingsText(settings: Settings): string {
  return JSON.stringify({ wow_dir: settings.wowDir, auto_upload: settings.autoUpload, theme: settings.theme }, null, 2);
}

export function createSettingsStore(deps: { configDir: string; findWow: () => Promise<string | null> }): SettingsStore {
  const file = join(deps.configDir, FILES.settings);

  const save = (settings: Settings): Promise<void> => writeFileAtomic(file, settingsText(settings));

  return {
    /** Gespeicherte Einstellungen; ist noch kein WoW-Ordner eingetragen, wird er gesucht.
     * persistFound=false (--test, Entscheidung 9): der Fund gilt nur im Speicher. */
    async load({ persistFound }) {
      const data = (await readJsonObject(file)) ?? {};
      let settings: Settings = {
        wowDir: wowDirOf(data.wow_dir),
        autoUpload: data.auto_upload === true,
        theme: themeOf(data.theme),
      };
      if (!settings.wowDir) {
        const found = await deps.findWow();
        if (found) {
          settings = { ...settings, wowDir: found };
          if (persistFound) {
            try {
              await save(settings);
            } catch {
              // dann wird beim nächsten Start eben erneut gesucht
            }
          }
        }
      }
      return settings;
    },
    save,
  };
}
