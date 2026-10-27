// Design-Logik (§6.4/§7.1): Portierung von test_gui::Window::test_late_answer… plus Entscheidungstabelle.
import { describe, expect, it } from 'vitest';
import { createThemeTracker, effectiveDark } from '../../../src/main/themeLogic';

describe('Window (Python-Test)', () => {
  it('test_late_answer_for_an_old_theme_setting_is_ignored', () => {
    // Wie gui.py: Die langsame Systemabfrage zu „system“ kommt erst nach dem Wechsel auf „dunkel“ an.
    const tracker = createThemeTracker('system', false);
    const slowSystemLookup = tracker.token();
    tracker.setSetting('dunkel');
    expect(tracker.answer(tracker.token(), true)).toEqual({ setting: 'dunkel', dark: true });
    expect(tracker.answer(slowSystemLookup, false)).toBeNull(); // die langsame Systemabfrage von vorhin
    expect(tracker.view).toEqual({ setting: 'dunkel', dark: true });
  });
});

describe('createThemeTracker', () => {
  it('eine Antwort zur selben Einstellung, aber älteren Generation verfällt', () => {
    const tracker = createThemeTracker('system', false);
    const old = tracker.token();
    tracker.setSetting('hell');
    tracker.setSetting('system');
    expect(tracker.isCurrent(old)).toBe(false);
    expect(tracker.answer(old, true)).toBeNull();
    expect(tracker.answer(tracker.token(), true)).toEqual({ setting: 'system', dark: true });
  });

  it('unveränderte Antwort → null (nichts neu zeichnen)', () => {
    const tracker = createThemeTracker('system', true);
    expect(tracker.answer(tracker.token(), true)).toBeNull();
  });

  it('wiederholte Abfragen zur gleichen Einstellung gelten (10-s-Takt)', () => {
    const tracker = createThemeTracker('system', false);
    const first = tracker.token();
    const second = tracker.token();
    expect(tracker.answer(first, true)).toEqual({ setting: 'system', dark: true });
    expect(tracker.answer(second, false)).toEqual({ setting: 'system', dark: false });
  });
});

describe('effectiveDark', () => {
  it('hell/dunkel stehen fest', () => {
    for (const native of [true, false]) {
      for (const probe of [true, false, null]) {
        for (const useProbe of [true, false]) {
          expect(effectiveDark('hell', native, probe, useProbe)).toBe(false);
          expect(effectiveDark('dunkel', native, probe, useProbe)).toBe(true);
        }
      }
    }
  });

  it('system: Linux fragt selbst, ohne Antwort zählt nativeTheme', () => {
    expect(effectiveDark('system', false, true, true)).toBe(true);
    expect(effectiveDark('system', true, false, true)).toBe(false);
    expect(effectiveDark('system', true, null, true)).toBe(true);
    expect(effectiveDark('system', false, null, true)).toBe(false);
  });

  it('system: Windows/macOS nur nativeTheme', () => {
    expect(effectiveDark('system', true, false, false)).toBe(true);
    expect(effectiveDark('system', false, true, false)).toBe(false);
  });
});
