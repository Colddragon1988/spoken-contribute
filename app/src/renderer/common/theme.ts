/**
 * Hell/Dunkel im Fenster (Architektur §6.4): Der Main entscheidet und meldet jeden Wechsel per
 * event:theme; hier wird nur data-theme am Wurzelelement gesetzt. Farben und color-scheme
 * (damit auch Klapplisten und Bildlaufleisten folgen) stehen in theme.css.
 */
import type { ThemeView, Unsubscribe } from '../../shared/ipc';

export function applyTheme(view: ThemeView): void {
  document.documentElement.dataset.theme = view.dark ? 'dunkel' : 'hell';
}

/** Jedem Wechsel sofort folgen; liefert die Abmeldung. */
export function followTheme(onChange?: (view: ThemeView) => void): Unsubscribe {
  return window.spoken.onTheme((view) => {
    applyTheme(view);
    onChange?.(view);
  });
}
