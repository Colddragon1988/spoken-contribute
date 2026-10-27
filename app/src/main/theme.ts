/**
 * Hell/Dunkel im Main (Architektur §6.4): nativeTheme.themeSource setzen – dann folgen Titelleiste,
 * native Dialoge und Scrollbalken –, und das Ergebnis per event:theme an alle Fenster schicken.
 * Unter Linux (und in der Sandbox) fragt der Main das System selbst ab, alle 10 s (E. 17).
 */
import type { NativeTheme } from 'electron';
import type { ThemeView } from '../shared/ipc';
import { THEME_POLL_MS, type DarkModeProbe, type ThemeSetting } from '../shared/types';
import { createThemeTracker, effectiveDark } from './themeLogic';

export interface ThemeControllerDeps {
  readonly nativeTheme: NativeTheme;
  readonly probe: DarkModeProbe;
  /** eigene Systemabfrage vor nativeTheme (Linux, Sandbox) */
  readonly useProbe: boolean;
  /** neues Design an alle Fenster */
  readonly broadcast: (view: ThemeView) => void;
}

export interface ThemeController {
  readonly view: ThemeView;
  /** Design zur Einstellung bestimmen (beim Start einmal abwarten) */
  start(setting: ThemeSetting): Promise<ThemeView>;
  setSetting(setting: ThemeSetting): Promise<void>;
  stop(): void;
}

export function createThemeController(deps: ThemeControllerDeps): ThemeController {
  const { nativeTheme, probe, useProbe, broadcast } = deps;
  const tracker = createThemeTracker('system', nativeTheme.shouldUseDarkColors);
  let timer: ReturnType<typeof setInterval> | null = null;

  const setSource = (source: 'light' | 'dark' | 'system'): void => {
    if (nativeTheme.themeSource !== source) nativeTheme.themeSource = source;
  };

  /** Die Farben zur aktuellen Einstellung bestimmen; eine verspätete Antwort verfällt. */
  async function lookUp(): Promise<void> {
    const token = tracker.token();
    const { setting } = token;
    let probed: boolean | null = null;
    if (setting === 'system' && useProbe) {
      try {
        probed = await probe.prefersDark();
      } catch {
        probed = null;
      }
      if (!tracker.isCurrent(token)) return; // inzwischen anders eingestellt
    }
    if (setting === 'system') setSource(probed === null ? 'system' : probed ? 'dark' : 'light');
    else setSource(setting === 'dunkel' ? 'dark' : 'light');
    const changed = tracker.answer(token, effectiveDark(setting, nativeTheme.shouldUseDarkColors, probed, useProbe));
    if (changed) broadcast(changed);
  }

  // Windows/macOS (und Linux ohne Antwort der Abfrage): Electron meldet Systemwechsel selbst.
  nativeTheme.on('updated', () => {
    if (tracker.view.setting !== 'system' || nativeTheme.themeSource !== 'system') return;
    const changed = tracker.answer(tracker.token(), nativeTheme.shouldUseDarkColors);
    if (changed) broadcast(changed);
  });

  return {
    get view() { return tracker.view; },
    async start(setting) {
      tracker.setSetting(setting);
      await lookUp();
      if (useProbe && timer === null) {
        timer = setInterval(() => {
          if (tracker.view.setting === 'system') void lookUp();
        }, THEME_POLL_MS);
        timer.unref();
      }
      return tracker.view;
    },
    async setSetting(setting) {
      tracker.setSetting(setting);
      broadcast(tracker.view); // die Auswahl gilt sofort, die Farben folgen nach der Abfrage
      await lookUp();
    },
    stop() {
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
  };
}
