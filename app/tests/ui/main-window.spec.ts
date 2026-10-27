/**
 * UI-Abnahme Hauptfenster (Architektur §7.5, Spezifikation §7.2/§7.3) gegen die gebaute App in der
 * Sandbox: Temp-Ordner, vorgetäuschter Server auf 127.0.0.1, Schlüsselbund und Prozesse aus
 * system.json. Nie echte Daten, nie spoken.rusty.one (Regeln 1–3).
 *
 * Bildschirmfotos für docs/screenshots/ nur mit SPOKEN_SCREENSHOTS=1.
 */
import { expect, test, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contributionsLua, dbcache, envelope } from '../helpers/fixtures';
import { launchApp, type LaunchedApp } from './launch';

const SCREENSHOTS = process.env.SPOKEN_SCREENSHOTS === '1';
const SCREENSHOT_DIR = fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));

// ---------------------------------------------------------------- Vorbereitung der Sandbox

interface Setup {
  /** WoW mit Spoken (Classic Era: 2 Zeilen, WoW Forever: 1 NPC-Text); false = gar kein WoW */
  readonly wow?: boolean;
  readonly autoUpload?: boolean;
  readonly theme?: 'system' | 'hell' | 'dunkel';
  readonly system?: Record<string, unknown>;
}

const wowDir = (root: string): string => join(root, 'World of Warcraft');

async function prepareWow(root: string): Promise<void> {
  const era = join(wowDir(root), '_classic_era_');
  await mkdir(join(era, 'Interface', 'AddOns', 'Spoken'), { recursive: true });
  const saved = join(era, 'WTF', 'Account', 'ACC', 'SavedVariables');
  await mkdir(saved, { recursive: true });
  await writeFile(join(saved, 'SpokenContributions.lua'), contributionsLua([envelope(1), envelope(2)]));
  const forever = join(wowDir(root), '_forever_');
  await mkdir(join(forever, 'Interface', 'AddOns', 'Spoken'), { recursive: true });
  await mkdir(join(forever, 'WTF'), { recursive: true });
  const cache = join(forever, 'Cache', 'ADB', 'deDE');
  await mkdir(cache, { recursive: true });
  await writeFile(join(cache, 'DBCache.bin'), dbcache(70003, [[1, 'Seid gegrüßt', '']]));
}

async function writeSystem(root: string, system: Record<string, unknown>): Promise<void> {
  await writeFile(join(root, 'system.json'), JSON.stringify(system, null, 2));
}

async function start(setup: Setup = {}): Promise<LaunchedApp> {
  return launchApp({
    prepare: async (root: string) => {
      if (setup.wow !== false) await prepareWow(root);
      await mkdir(join(root, 'config'), { recursive: true });
      await writeFile(join(root, 'config', 'settings.json'), JSON.stringify({
        wow_dir: setup.wow === false ? '' : wowDir(root),
        auto_upload: setup.autoUpload ?? false,
        theme: setup.theme ?? 'hell',
      }, null, 2));
      await writeSystem(root, { prozesse: [], dunkel: false, schluesselbund: { art: 'none', gesperrt: false, eintraege: {} }, ...setup.system });
    },
  });
}

/** Protokoll der „gezeigten“ nativen Dialoge (sandbox.ts) */
async function dialogs(root: string): Promise<{ art: string; titel: string; text: string }[]> {
  try {
    return JSON.parse(await readFile(join(root, 'dialoge.json'), 'utf8')) as { art: string; titel: string; text: string }[];
  } catch {
    return [];
  }
}

const status = (page: Page) => page.locator('#wow-status');
const log = (page: Page) => page.locator('#protokoll');

let launched: LaunchedApp | undefined;
test.afterEach(async () => {
  await launched?.close();
  launched = undefined;
});

// ---------------------------------------------------------------- WoW-Ordner und Statuszeilen

test('Statuszeilen: Versionen, Bereit, Upload-Grenze', async () => {
  launched = await start();
  const page = launched.window;
  await expect(page).toHaveTitle('Spoken – Beiträge hochladen');
  await expect(status(page)).toHaveText('Spoken in: Classic Era, WoW Forever\nBereit: 2 gesammelte Zeilen und 1 NPC-Texte', { useInnerText: true });
  await expect(status(page)).not.toHaveClass(/fehler/);
  await expect(log(page)).toHaveText('„Jetzt hochladen“ sendet alles, was bereitliegt; „Testlauf“ zeigt nur, was gesendet würde.');
});

test('Statuszeilen: laufende Version wird übersprungen, unbekannte stoppt', async () => {
  launched = await start({ system: { prozesse: ['Z:\\home\\x\\Games\\World of Warcraft\\_forever_\\Wow.exe'] } });
  const page = launched.window;
  await expect(status(page)).toHaveText(
    'Spoken in: Classic Era, WoW Forever (läuft gerade)\nBereit: 2 gesammelte Zeilen (ohne WoW Forever – wird beim Upload übersprungen)',
    { useInnerText: true });

  await writeSystem(launched.root, { prozesse: ['Wow.exe'] });
  await page.locator('#wow-pfad').press('Enter');
  await expect(status(page)).toHaveText(
    'Spoken in: Classic Era (läuft gerade), WoW Forever (läuft gerade)\nEin WoW läuft, aber welche Version, ist nicht zu erkennen – bitte erst beenden.',
    { useInnerText: true });
});

test('Statuszeilen: kein WoW-Ordner und Ordner ohne Spoken sind rot', async () => {
  launched = await start({ wow: false });
  const page = launched.window;
  await expect(status(page)).toHaveText('Hier liegt kein World of Warcraft – bitte über „Ändern …“ oder „Suchen“ den Ordner „World of Warcraft“ wählen.');
  await expect(status(page)).toHaveClass(/fehler/);

  const bare = join(wowDir(launched.root), '_classic_era_', 'WTF');
  await mkdir(bare, { recursive: true });
  await page.locator('#wow-pfad').fill(join(wowDir(launched.root), '_classic_era_'));
  await page.locator('#wow-pfad').press('Enter');
  // „Hauptordner von innen“: der Main geht zum Ordner „World of Warcraft“ hinauf
  await expect(page.locator('#wow-pfad')).toHaveValue(wowDir(launched.root));
  await expect(status(page)).toHaveText('Spoken ist in keiner WoW-Version in diesem Ordner installiert.');
  await expect(status(page)).toHaveClass(/fehler/);
});

test('Suchen und Ändern …', async () => {
  launched = await start({ wow: false });
  const page = launched.window;
  await page.getByRole('button', { name: 'Suchen' }).click();
  await expect(status(page)).toHaveText('Kein World of Warcraft gefunden – bitte über „Ändern …“ auswählen.');
  await expect(status(page)).toHaveClass(/fehler/);

  await prepareWow(launched.root);
  await writeSystem(launched.root, { wowSuche: wowDir(launched.root) });
  await page.getByRole('button', { name: 'Suchen' }).click();
  await expect(page.locator('#wow-pfad')).toHaveValue(wowDir(launched.root));
  await expect(status(page)).toContainText('Spoken in: Classic Era, WoW Forever');

  await writeSystem(launched.root, { ordnerwahl: join(wowDir(launched.root), '_forever_') });
  await page.getByRole('button', { name: 'Ändern …' }).click();
  await expect(page.locator('#wow-pfad')).toHaveValue(wowDir(launched.root));
  const shown = await dialogs(launched.root);
  expect(shown.some((d) => d.art === 'ordnerwahl' && d.titel === 'Ordner „World of Warcraft“ wählen')).toBe(true);
  const settings = JSON.parse(await readFile(join(launched.root, 'config', 'settings.json'), 'utf8')) as { wow_dir: string };
  expect(settings.wow_dir).toBe(wowDir(launched.root));
});

// ---------------------------------------------------------------- Konto

test('Anmelden: leere Felder, 401, Erfolg; Abmelden', async () => {
  launched = await start();
  const page = launched.window;
  await expect(page.locator('#konto-text')).toHaveText('Nicht angemeldet');
  await expect(page.locator('#konto-hinweis')).toHaveText('Nur für die NPC-Texte aus dem Spiel-Cache nötig – die gesammelten Zeilen gehen anonym hoch.');

  await page.getByRole('button', { name: 'Anmelden …' }).click();
  const dialog = page.locator('#anmelden');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading')).toHaveText('Bei spoken.rusty.one anmelden');
  await dialog.locator('#login-email').press('Enter');
  await expect(dialog.locator('#login-meldung')).toHaveText('Bitte E-Mail und Passwort eingeben.');
  await expect(dialog.locator('#login-meldung')).toHaveClass(/fehler/);

  launched.server.server.fail.set('/api/auth/sign-in/email', [{ status: 401 }]);
  await dialog.locator('#login-email').fill('test@example.org');
  await dialog.locator('#login-passwort').fill('falsch');
  await dialog.getByRole('button', { name: 'Anmelden' }).click();
  await expect(dialog.locator('#login-meldung')).toHaveText('Anmeldung abgelehnt – E-Mail oder Passwort stimmen nicht.');
  await expect(dialog.getByRole('button', { name: 'Anmelden' })).toBeEnabled();

  await dialog.locator('#login-passwort').fill('geheim');
  await dialog.locator('#login-zeigen').check();
  await expect(dialog.locator('#login-passwort')).toHaveAttribute('type', 'text');
  await dialog.locator('#login-passwort').press('Enter');
  await expect(dialog).toBeHidden();
  await expect(page.locator('#konto-text')).toHaveText('Angemeldet als test@example.org');
  await expect(page.locator('#konto-hinweis')).toHaveText(
    'Das Passwort liegt in einer Datei, die nur du lesen kannst (kein Schlüsselbund gefunden). Die Anmeldung ist nur für die NPC-Texte nötig – die gesammelten Zeilen gehen anonym hoch.');

  // Abmelden: Rückfrage im Main (Sandbox antwortet „ja“)
  await writeSystem(launched.root, { dialogAntwort: 'ja' });
  await page.getByRole('button', { name: 'Abmelden' }).click();
  await expect(page.locator('#konto-text')).toHaveText('Nicht angemeldet');
  const question = (await dialogs(launched.root)).find((d) => d.art === 'frage');
  expect(question?.titel).toBe('Abmelden');
  expect(question?.text).toBe('Die Anmeldung von diesem Rechner löschen (auch aus dem Schlüsselbund)?\n\nOhne Anmeldung bleiben die NPC-Texte im Spiel-Cache liegen, bis du dich wieder anmeldest.');
});

test('Anmeldedialog: Escape schließt, Passwort bleibt nicht im Feld', async () => {
  launched = await start();
  const page = launched.window;
  await page.getByRole('button', { name: 'Anmelden …' }).click();
  await page.locator('#login-passwort').fill('geheim');
  await page.keyboard.press('Escape');
  await expect(page.locator('#anmelden')).toBeHidden();
  await expect(page.locator('#login-passwort')).toHaveValue('');
  if (SCREENSHOTS) {
    for (const theme of ['hell', 'dunkel'] as const) {
      await page.locator('#design').selectOption(theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.getByRole('button', { name: 'Anmelden …' }).click();
      await page.locator('#login-email').fill('test@example.org');
      await page.locator('#login-passwort').fill('geheim'); // Testpasswort, verdeckt dargestellt
      await shoot(page, `anmeldedialog-${theme}.png`);
      await page.keyboard.press('Escape');
      await expect(page.locator('#anmelden')).toBeHidden();
    }
  }
});

test('Konto-Hinweis V1: basic_text', async () => {
  launched = await start({ system: { schluesselbund: { art: 'basic_text', gesperrt: false, eintraege: {} } } });
  const page = launched.window;
  await page.getByRole('button', { name: 'Anmelden …' }).click();
  await page.locator('#login-email').fill('test@example.org');
  await page.locator('#login-passwort').fill('geheim');
  await page.locator('#login-passwort').press('Enter');
  await expect(page.locator('#konto-hinweis')).toHaveText(
    'Das Passwort liegt in einer Datei, die nur du lesen kannst (kein Schlüsselbund gefunden – nur durch die Dateirechte geschützt). Die Anmeldung ist nur für die NPC-Texte nötig – die gesammelten Zeilen gehen anonym hoch.');
});

// ---------------------------------------------------------------- Upload

test('Testlauf zeigt den Bericht, nichts wird gesendet', async () => {
  launched = await start();
  const page = launched.window;
  await expect(status(page)).toContainText('Bereit:');
  await page.getByRole('button', { name: 'Testlauf' }).click();
  const head = log(page).locator('.kopf');
  await expect(head).toHaveText('Testlauf – nichts gesendet, gelöscht oder archiviert.');
  await expect(head).not.toHaveClass(/fehler/);
  await expect(log(page)).toContainText('Gesammelte Zeilen: würde 2 Quest- und Gesprächszeilen senden (2 aus Classic Era).');
  expect(launched.server.server.calls).toHaveLength(0);
});

test('Upload mit Fortschritt, Schließen gesperrt, rote Kopfzeile bei Fehler', async () => {
  launched = await start();
  const page = launched.window;
  await expect(status(page)).toContainText('Bereit:');
  launched.server.delayMs = 1500;
  launched.server.server.fail.set('/api/contributions/batch', [{ status: 500 }]);
  await page.getByRole('button', { name: 'Jetzt hochladen' }).click();
  await expect(page.locator('#fortschritt')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Jetzt hochladen' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Testlauf' })).toBeDisabled();
  await expect(log(page)).toContainText('Lade hoch …');
  await expect(log(page)).toContainText('Gesammelte Zeilen: sende 2 …');

  await page.getByRole('button', { name: 'Schließen' }).click();
  await expect.poll(async () => (await dialogs(launched?.root ?? '')).map((d) => d.text)).toContain('Der Upload läuft noch – bitte kurz warten.');
  expect(launched.app.windows()).toHaveLength(1);

  const head = log(page).locator('.kopf');
  await expect(head).toHaveText('Nicht alles hat geklappt.', { timeout: 15_000 });
  await expect(head).toHaveClass(/fehler/);
  await expect(page.locator('#fortschritt')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Jetzt hochladen' })).toBeEnabled();
  await expect(log(page)).toContainText('Gesammelte Zeilen: Server-Fehler 500.');
});

test('Automatischer Upload nach dem Öffnen', async () => {
  launched = await start({ autoUpload: true });
  const page = launched.window;
  await expect(page.locator('#auto-upload')).toBeChecked();
  await expect(log(page).locator('.kopf')).toHaveText(/Erfolgreich hochgeladen – danke!|Nicht alles hat geklappt\./, { timeout: 15_000 });
  expect(launched.server.server.paths()).toContain('/api/contributions/batch');
});

test('Häkchen „Beim Start automatisch hochladen“ wird sofort gespeichert', async () => {
  launched = await start();
  const page = launched.window;
  await page.getByText('Beim Start automatisch hochladen').click();
  await expect.poll(async () => {
    const saved = JSON.parse(await readFile(join(launched?.root ?? '', 'config', 'settings.json'), 'utf8')) as { auto_upload: boolean };
    return saved.auto_upload;
  }).toBe(true);
});

// ---------------------------------------------------------------- Design

test('Designwechsel sofort, auch für Klapplisten', async () => {
  launched = await start({ theme: 'hell' });
  const page = launched.window;
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'hell');
  await expect(page.locator('#design')).toHaveValue('hell');
  await expect(status(page)).toContainText('Bereit:');
  if (SCREENSHOTS) await shoot(page, 'hauptfenster-hell.png');

  await page.locator('#design').selectOption('dunkel');
  await expect(html).toHaveAttribute('data-theme', 'dunkel');
  expect(await page.locator('body').evaluate(styleOf, 'backgroundColor')).toBe('rgb(30, 31, 34)');
  expect(await page.locator('#design').evaluate(styleOf, 'colorScheme')).toBe('dark');
  expect(await page.locator('#design').evaluate(styleOf, 'backgroundColor')).toBe('rgb(43, 45, 49)');
  if (SCREENSHOTS) await shoot(page, 'hauptfenster-dunkel.png');

  // „Wie System“ folgt dem (vorgetäuschten) Systemdesign
  await writeSystem(launched.root, { dunkel: false });
  await page.locator('#design').selectOption('system');
  await expect(html).toHaveAttribute('data-theme', 'hell');
  const saved = JSON.parse(await readFile(join(launched.root, 'config', 'settings.json'), 'utf8')) as { theme: string };
  expect(saved.theme).toBe('system');
});

/** Im Fenster ausgeführt: berechneter Stilwert (die Node-Seite kennt keine DOM-Typen). */
function styleOf(element: unknown, property: string): string {
  const view = globalThis as unknown as { getComputedStyle(e: unknown): Record<string, string | undefined> };
  return view.getComputedStyle(element)[property] ?? '';
}

async function shoot(page: Page, name: string): Promise<void> {
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: join(SCREENSHOT_DIR, name) });
}
