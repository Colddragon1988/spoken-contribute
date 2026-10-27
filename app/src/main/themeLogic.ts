/**
 * Hell oder dunkel? (rein, getestet; theme.choose / App.theme_chosen in gui.py)
 *
 * Bei „Wie System“ kann die Abfrage unter Linux (Portal/gsettings) Sekunden dauern. Eine Antwort
 * zu einer inzwischen geänderten Einstellung verfällt – sonst könnte eine langsame Systemabfrage
 * das gerade gewählte „Dunkel“ wieder auf hell stellen.
 */
import type { ThemeView } from '../shared/ipc';
import type { ThemeSetting } from '../shared/types';

/**
 * Ergebnis der Einstellung. useProbe: unter Linux (und in der Sandbox) zählt die eigene
 * Systemabfrage vor nativeTheme, weil Electron das Portal nicht überall erkennt (E. 17).
 */
export function effectiveDark(
  setting: ThemeSetting, nativeDark: boolean, probeDark: boolean | null, useProbe: boolean,
): boolean {
  if (setting === 'hell') return false;
  if (setting === 'dunkel') return true;
  return useProbe ? (probeDark ?? nativeDark) : nativeDark;
}

/** Marke einer Abfrage: zu welcher Einstellung und welcher Generation sie gestellt wurde. */
export interface ThemeToken {
  readonly setting: ThemeSetting;
  readonly generation: number;
}

export interface ThemeTracker {
  readonly view: ThemeView;
  /** neue Einstellung; ältere Abfragen verfallen */
  setSetting(setting: ThemeSetting): void;
  /** vor einer (womöglich langsamen) Abfrage holen */
  token(): ThemeToken;
  /** gilt die Marke noch (keine neuere Einstellung)? */
  isCurrent(token: ThemeToken): boolean;
  /** Antwort einer Abfrage; liefert das neue Design oder null (verfallen oder unverändert) */
  answer(token: ThemeToken, dark: boolean): ThemeView | null;
}

export function createThemeTracker(setting: ThemeSetting, dark: boolean): ThemeTracker {
  let view: ThemeView = { setting, dark };
  let generation = 0;
  const isCurrent = (token: ThemeToken): boolean => token.generation === generation && token.setting === view.setting;
  return {
    get view() { return view; },
    setSetting(next) {
      generation += 1;
      view = { setting: next, dark: view.dark };
    },
    token: () => ({ setting: view.setting, generation }),
    isCurrent,
    answer(token, answerDark) {
      if (!isCurrent(token)) return null;
      if (answerDark === view.dark) return null;
      view = { setting: view.setting, dark: answerDark };
      return view;
    },
  };
}
