/**
 * UI-Abnahme Verlaufsfenster (Architektur §7.5, Spezifikation §7.4) gegen die gebaute App in der
 * Sandbox. Die Verlaufseinträge werden im Format der Python-Fassung von Hand angelegt (§5.5).
 * Enthält die Portierung von tests/test_gui.py:
 *   test_dropdown_list_follows_the_theme, test_search_finds_text_in_the_sent_data
 * (test_late_answer_for_an_old_theme_setting_is_ignored liegt rein in tests/unit/main/themeLogic.test.ts).
 *
 * Bildschirmfotos für docs/screenshots/ nur mit SPOKEN_SCREENSHOTS=1.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { contributionsLua, envelope } from '../helpers/fixtures';
import { launchApp, type LaunchedApp } from './launch';

const SCREENSHOTS = process.env.SPOKEN_SCREENSHOTS === '1';
const SCREENSHOT_DIR = fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));

// ---------------------------------------------------------------- Verlauf im Python-Format

const p2 = (n: number): string => String(n).padStart(2, '0');

/** Zeitpunkt vor `daysAgo` Tagen um hh:mm, als ISO mit Offset und als Ordnerstempel. */
function when(daysAgo: number, hour: number, minute: number): { iso: string; stamp: string } {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const day = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  const iso = `${day}T${p2(hour)}:${p2(minute)}:00${sign}${p2(Math.floor(Math.abs(offset) / 60))}:${p2(Math.abs(offset) % 60)}`;
  return { iso, stamp: `${day}_${p2(hour)}-${p2(minute)}-00` };
}

async function entry(root: string, daysAgo: number, art: 'zeilen' | 'npc-texte', info: Record<string, unknown>, payload?: unknown): Promise<void> {
  const time = when(daysAgo, 10 + daysAgo % 10, 5);
  const dir = join(root, 'data', 'verlauf', `${time.stamp}_${art}`);
  await mkdir(dir, { recursive: true });
  if (payload !== undefined) await writeFile(join(dir, 'daten.json.gz'), gzipSync(JSON.stringify(payload, null, 1)));
  await writeFile(join(dir, 'eintrag.json'), JSON.stringify({ zeit: time.iso, art, ...info }, null, 2));
}

/** Drei Einträge: Zeilen ok (Classic Era), NPC-Texte ok (WoW Forever, 3000 Texte), Zeilen fehlgeschlagen. */
async function prepareHistory(root: string): Promise<void> {
  await entry(root, 3, 'zeilen', {
    status: 'ok', versionen: ['Classic Era'], anzahl: 1, zusammenfassung: '1 Quest- und Gesprächszeilen',
    titel: ['Quest 1'], ergebnis: { neu: 1, bekannt: 0, abgelehnt: 0 },
  }, { gesendet: { envelopes: [envelope(1)], name: null, email: null, website: '' }, antwort: { ok: true } });
  const texts = Array.from({ length: 3000 }, (_, i) => ({ id: i, text: `Seid gegrüßt ${i}`, text1: '' }));
  await entry(root, 1, 'npc-texte', {
    versionen: ['WoW Forever'], sprache: 'deDE', builds: [1], anzahl: 3000, zu_lang: 0, status: 'ok',
    ergebnis: { neu: 3000, aktualisiert: 0 },
  }, { gesendet: [{ lang: 'deDE', build: 1, texts }], antwort: [{ texts: 3000, added: 3000, changed: 0 }], nicht_gesendet: [] });
  await entry(root, 0, 'zeilen', {
    status: 'fehler', versionen: ['Classic Era'], fehler: 'Gesammelte Zeilen: Server-Fehler 500.',
  });
}

async function start(options: { history?: boolean; theme?: string } = {}): Promise<LaunchedApp> {
  return launchApp({
    prepare: async (root: string) => {
      const era = join(root, 'World of Warcraft', '_classic_era_');
      await mkdir(join(era, 'Interface', 'AddOns', 'Spoken'), { recursive: true });
      const saved = join(era, 'WTF', 'Account', 'ACC', 'SavedVariables');
      await mkdir(saved, { recursive: true });
      await writeFile(join(saved, 'SpokenContributions.lua'), contributionsLua([envelope(7)]));
      await mkdir(join(root, 'config'), { recursive: true });
      await writeFile(join(root, 'config', 'settings.json'), JSON.stringify({
        wow_dir: join(root, 'World of Warcraft'), auto_upload: false, theme: options.theme ?? 'hell',
      }, null, 2));
      await writeFile(join(root, 'system.json'), JSON.stringify({ prozesse: [], dunkel: false }));
      if (options.history !== false) await prepareHistory(root);
    },
  });
}

/** Verlaufsfenster über „Verlauf …“ öffnen und als Page liefern. */
async function openHistory(app: ElectronApplication, main: Page): Promise<Page> {
  const opened = app.waitForEvent('window');
  await main.getByRole('button', { name: 'Verlauf …' }).click();
  const page = await opened;
  await expect(page).toHaveTitle('Spoken – Verlauf der Uploads');
  return page;
}

const rows = (page: Page) => page.locator('#zeilen tr');

let launched: LaunchedApp | undefined;
test.afterEach(async () => {
  await launched?.close();
  launched = undefined;
});

// ---------------------------------------------------------------- Tests

test('nur eine Instanz, Escape schließt', async () => {
  launched = await start();
  const history = await openHistory(launched.app, launched.window);
  await launched.window.getByRole('button', { name: 'Verlauf …' }).click();
  await expect.poll(() => launched?.app.windows().length).toBe(2);
  expect(history.isClosed()).toBe(false); // dasselbe Fenster, nur nach vorn geholt
  // Escape schließt das Fenster schon, während press() noch auf die Seite wartet
  await history.keyboard.press('Escape').catch(() => undefined);
  await expect.poll(() => history.isClosed()).toBe(true);
  await expect.poll(() => launched?.app.windows().length).toBe(1);
});

test('Tabelle, erster Eintrag gewählt, Summenzeile, Fehlerfarbe', async () => {
  launched = await start();
  const page = await openHistory(launched.app, launched.window);
  await expect(rows(page)).toHaveCount(3);
  await expect(rows(page).first()).toHaveAttribute('aria-selected', 'true');
  await expect(rows(page).first()).toHaveClass(/fehler/);
  await expect(rows(page).first().locator('td').nth(4)).toHaveText('Fehlgeschlagen');
  await expect(page.locator('#details .kopf')).toContainText('Gesammelte Zeilen – ');
  await expect(page.locator('#details')).toContainText('Gelöscht wurde dabei nichts; die Daten gingen beim nächsten Upload erneut mit.');
  await expect(page.locator('#summe')).toHaveText('2 Uploads: 1 gesammelte Zeilen und 3000 NPC-Texte, davon 3001 neu für das Projekt · 1 fehlgeschlagen');
  await expect(page.getByRole('button', { name: 'Ordner dieses Uploads öffnen' })).toBeEnabled();

  // Zeitpunkt mit zwei Leerzeichen, Anzahl rechtsbündig
  await expect(rows(page).nth(1).locator('td').first()).toHaveText(/^\d\d\.\d\d\.\d{4} {2}\d\d:\d\d$/);
  expect(await rows(page).nth(1).locator('td').nth(3).evaluate(styleOf, 'textAlign')).toBe('right');

  // Pfeiltasten wechseln die Auswahl (Einzelauswahl)
  await rows(page).first().click();
  await page.keyboard.press('ArrowDown');
  await expect(rows(page).nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#zeilen tr[aria-selected="true"]')).toHaveCount(1);
  await expect(page.locator('#details .kopf')).toContainText('NPC-Texte – ');
});

test('Filter Art und Version', async () => {
  launched = await start();
  const page = await openHistory(launched.app, launched.window);
  await expect(rows(page)).toHaveCount(3);
  await page.locator('#art').selectOption('fehlgeschlagen');
  await expect(rows(page)).toHaveCount(1);
  await expect(page.locator('#summe')).toHaveText('0 Uploads: 0 gesammelte Zeilen und 0 NPC-Texte · 1 fehlgeschlagen   (gefiltert: 1 von 3)');
  await page.locator('#art').selectOption('zeilen');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).not.toHaveClass(/fehler/);
  await page.locator('#art').selectOption('alle');
  await expect(page.locator('#version option')).toHaveText(['Alle', 'Classic Era', 'WoW Forever']);
  await page.locator('#version').selectOption('WoW Forever');
  await expect(rows(page)).toHaveCount(1);
  await page.locator('#art').selectOption('zeilen');
  await expect(rows(page)).toHaveCount(0);
  await expect(page.locator('#summe')).toHaveText('Keine Uploads passen zu Suche und Filter.');
  await expect(page.getByRole('button', { name: 'Ordner dieses Uploads öffnen' })).toBeDisabled();
  await expect(page.locator('#details')).toHaveText('');
});

test('test_search_finds_text_in_the_sent_data', async () => {
  launched = await start();
  const page = await openHistory(launched.app, launched.window);
  await expect(rows(page)).toHaveCount(3);

  await page.locator('#suche').fill('gegrüßt 2999');
  await expect(rows(page)).toHaveCount(1); // nach 250 ms Pause, Suche im Main
  await expect(rows(page).first().locator('td').nth(1)).toHaveText('NPC-Texte');

  await page.locator('#suche').fill('seid'); // 3000 Treffer im Detailtext
  await expect(rows(page)).toHaveCount(1);
  await expect(page.locator('#details mark')).toHaveCount(1000);
  await expect(page.locator('#details mark').first()).toHaveText('Seid');

  // casefold wie im Main: „GEGRÜSST“ findet „gegrüßt“
  await page.locator('#suche').fill('GEGRÜSST 1');
  await expect(rows(page)).toHaveCount(1);
  await expect(page.locator('#details mark').first()).toHaveText('gegrüßt 1');
  if (SCREENSHOTS) await shootSearchAndFilter(page, 'verlauf-suche-filter-hell.png');
});

test('Entprellung: erst 250 ms nach dem letzten Tastendruck wird gesucht', async () => {
  launched = await start();
  const page = await openHistory(launched.app, launched.window);
  await expect(rows(page)).toHaveCount(3);
  // Gesteuerte Uhr statt echter Wartezeit: sonst entscheidet die Rechnerlast, ob 250 ms schon um sind.
  await page.clock.install();
  await page.locator('#suche').pressSequentially('Quest 1');
  await page.clock.runFor(200);
  await expect(rows(page)).toHaveCount(3); // noch nicht gesucht
  await page.clock.runFor(100);
  await expect(rows(page)).toHaveCount(1);
});

test('test_dropdown_list_follows_the_theme', async () => {
  launched = await start({ theme: 'hell' });
  const page = await openHistory(launched.app, launched.window);
  const kinds = page.locator('#art');
  expect(await kinds.evaluate(styleOf, 'backgroundColor')).toBe('rgb(255, 255, 255)');
  await launched.window.locator('#design').selectOption('dunkel');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dunkel');
  // Klappliste: Feldfarbe des dunklen Designs und color-scheme dark für das native Popup
  expect(await kinds.evaluate(styleOf, 'backgroundColor')).toBe('rgb(43, 45, 49)');
  expect(await kinds.evaluate(styleOf, 'colorScheme')).toBe('dark');
  expect(await page.locator('#version option').first().evaluate(styleOf, 'backgroundColor')).toBe('rgb(43, 45, 49)');
  if (SCREENSHOTS) await shootSearchAndFilter(page, 'verlauf-suche-filter-dunkel.png');
});

test('Statistik und Diagramm gelten für die gefilterten Einträge', async () => {
  launched = await start();
  const page = await openHistory(launched.app, launched.window);
  await page.getByRole('tab', { name: 'Statistik' }).click();
  const text = page.locator('#statistik-text');
  await expect(text.locator('.kopf')).toHaveText('Statistik');
  await expect(text).toContainText('2 Uploads, 1 fehlgeschlagen – vom ');
  await expect(text).toContainText('Gesammelte Zeilen: 1 gesendet, 1 neu für das Projekt, 0 schon bekannt');
  await expect(text).toContainText('NPC-Texte: 3000 gesendet, 3000 neu, 0 aktualisiert');
  const svg = page.locator('#diagramm svg');
  await expect(svg).toBeVisible();
  await expect(svg.locator('text').first()).toHaveText('Gesendet pro Tag, letzte 30 Tage');
  await expect(svg.locator('rect.lines')).toHaveCount(2); // Legende + 1 Balken
  await expect(svg.locator('rect.texts')).toHaveCount(2);
  await expect(svg.locator('text', { hasText: '3000' })).toHaveCount(1); // Skala oben
  if (SCREENSHOTS) await shoot(page, 'statistik-hell.png');

  await page.locator('#version').selectOption('Classic Era');
  await expect(text.locator('.kopf')).toHaveText('Statistik (gefiltert)');
  await expect(svg.locator('rect.texts')).toHaveCount(1); // nur noch die Legende

  await launched.window.locator('#design').selectOption('dunkel');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dunkel');
  // das Diagramm wird beim Designwechsel neu gezeichnet – daher wiederholt abfragen
  await expect.poll(() => svg.locator('rect.lines').first().evaluate(styleOf, 'fill')).toBe('rgb(111, 159, 224)');
  if (SCREENSHOTS) {
    await page.locator('#version').selectOption('');
    await expect(svg.locator('rect.texts')).toHaveCount(2);
    await shoot(page, 'statistik-dunkel.png');
  }
});

test('nach einem Upload wird der Verlauf neu geladen', async () => {
  launched = await start({ history: false });
  const page = await openHistory(launched.app, launched.window);
  await expect(page.locator('#summe')).toHaveText('Noch keine Uploads archiviert.');
  await expect(page.getByRole('button', { name: 'Ordner dieses Uploads öffnen' })).toBeDisabled();
  await launched.window.getByRole('button', { name: 'Jetzt hochladen' }).click();
  await expect(rows(page)).toHaveCount(1, { timeout: 15_000 });
  await expect(rows(page).first().locator('td').nth(1)).toHaveText('Gesammelte Zeilen');
});

/** Im Fenster ausgeführt: berechneter Stilwert (die Node-Seite kennt keine DOM-Typen). */
function styleOf(element: unknown, property: string): string {
  const view = globalThis as unknown as { getComputedStyle(e: unknown): Record<string, string | undefined> };
  return view.getComputedStyle(element)[property] ?? '';
}

/** Verlauf mit aktiver Suche und aktivem Filter (Art und Version) fotografieren. */
async function shootSearchAndFilter(page: Page, name: string): Promise<void> {
  await page.locator('#art').selectOption('npc-texte');
  await page.locator('#version').selectOption('WoW Forever');
  await page.locator('#suche').fill('seid');
  await expect(rows(page)).toHaveCount(1);
  await expect(page.locator('#details mark')).toHaveCount(1000);
  await expect(page.locator('#details mark').first()).toHaveText('Seid'); // Hervorhebung der neuen Suche
  await expect(page.locator('#summe')).toContainText('(gefiltert: 1 von 3)');
  await shoot(page, name);
}

async function shoot(page: Page, name: string): Promise<void> {
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: join(SCREENSHOT_DIR, name) });
}
