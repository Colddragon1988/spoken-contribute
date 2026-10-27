/**
 * Texte des Hauptfensters (Spezifikation §7.2, Architektur V1/V2): Statuszeilen zum WoW-Ordner,
 * Konto-Anzeige und Darstellung des Berichts. Rein, ohne DOM – damit mit vitest prüfbar.
 */
import type { OverviewResult } from '../../shared/ipc';
import type { AccountView, Overview, Report } from '../../shared/types';
import { UPLOADS_PER_HOUR } from '../../shared/types';

export const TITLE = 'Spoken – Beiträge hochladen';

/** Anfangstext im Rahmen „Ergebnis“ (gedämpft). */
export const INITIAL_LOG = '„Jetzt hochladen“ sendet alles, was bereitliegt; „Testlauf“ zeigt nur, was gesendet würde.';

export const TEXT = {
  checking: 'Prüfe …',
  searching: 'Suche …',
  notFound: 'Kein World of Warcraft gefunden – bitte über „Ändern …“ auswählen.',
  noWow: 'Hier liegt kein World of Warcraft – bitte über „Ändern …“ oder „Suchen“ den Ordner „World of Warcraft“ wählen.',
  noSpoken: 'Spoken ist in keiner WoW-Version in diesem Ordner installiert.',
  unknownRunning: 'Ein WoW läuft, aber welche Version, ist nicht zu erkennen – bitte erst beenden.',
  testRun: 'Testlauf …',
  uploading: 'Lade hoch …',
  stillRunning: 'Der Upload läuft noch – bitte kurz warten.',
  emptyLogin: 'Bitte E-Mail und Passwort eingeben.',
  checkingLogin: 'Prüfe die Anmeldung …',
} as const;

/** Eine Statusanzeige: Text (mehrzeilig mit "\n") und ob er rot erscheint. */
export interface StatusText {
  readonly text: string;
  readonly error: boolean;
}

/** „Fehler beim Prüfen: {error}“ */
export const checkFailed = (message: string): StatusText => ({ text: `Fehler beim Prüfen: ${message}`, error: true });

/** Die Statuszeilen unter dem WoW-Pfad zu einer Antwort von wow:overview. */
export function overviewStatus(result: OverviewResult): StatusText {
  switch (result.kind) {
    case 'keinWow':
      return { text: TEXT.noWow, error: true };
    case 'fehler':
      return checkFailed(result.message);
    case 'ok':
      return overviewLines(result.overview);
  }
}

/** Zeile 1: Versionen, Zeile 2: was bereitliegt, Zeile 3: Upload-Grenze (§7.2, §4). */
export function overviewLines(overview: Overview): StatusText {
  if (overview.flavors.length === 0) return { text: TEXT.noSpoken, error: true };
  const runningNames = overview.running;
  const unknown = runningNames === null; // WoW läuft, Version unbekannt: alle gelten als laufend
  const running = overview.flavors.filter((name) => runningNames === null || runningNames.includes(name));
  const names = overview.flavors.map((name) => (running.includes(name) ? `${name} (läuft gerade)` : name));
  const lines = [`Spoken in: ${names.join(', ')}`];
  if (unknown) {
    lines.push(TEXT.unknownRunning);
  } else {
    const ready: string[] = [];
    if (overview.lines) ready.push(`${overview.lines} gesammelte Zeilen`);
    if (overview.texts) ready.push(`${overview.texts} NPC-Texte`);
    let text = `Bereit: ${ready.length ? ready.join(' und ') : 'nichts Neues'}`;
    if (running.length) text += ` (ohne ${running.join(', ')} – wird beim Upload übersprungen)`;
    lines.push(text);
  }
  const limit = limitLine(overview);
  if (limit) lines.push(limit);
  return { text: lines.join('\n'), error: false };
}

/** Anzeige der Upload-Grenze; null, solange noch alle Uploads der Stunde frei sind. */
export function limitLine(overview: Pick<Overview, 'freeAt' | 'uploadsLeft'>): string | null {
  if (overview.freeAt) {
    return `Upload-Grenze erreicht (${UPLOADS_PER_HOUR} pro Stunde) – gesammelte Zeilen wieder ab ${overview.freeAt} Uhr.`;
  }
  if (overview.uploadsLeft < UPLOADS_PER_HOUR) {
    return `Noch ${overview.uploadsLeft} von ${UPLOADS_PER_HOUR} Uploads in dieser Stunde frei.`;
  }
  return null;
}

// ---------------------------------------------------------------- Konto

export interface AccountText {
  readonly label: string;
  readonly button: string;
  readonly hint: string;
  readonly signedIn: boolean;
}

const ANONYMOUS = 'Die Anmeldung ist nur für die NPC-Texte nötig – die gesammelten Zeilen gehen anonym hoch.';

/** Text, Knopf und Hinweis im Rahmen „Konto bei spoken.rusty.one“ (§7.2, V1, V2). */
export function accountText(view: AccountView): AccountText {
  if (view.email === null) {
    return {
      label: 'Nicht angemeldet',
      button: 'Anmelden …',
      hint: 'Nur für die NPC-Texte aus dem Spiel-Cache nötig – die gesammelten Zeilen gehen anonym hoch.',
      signedIn: false,
    };
  }
  return { label: `Angemeldet als ${view.email}`, button: 'Abmelden', hint: passwordHint(view), signedIn: true };
}

function passwordHint(view: AccountView): string {
  switch (view.place) {
    case 'schluesselbund':
      return `Das Passwort liegt im Schlüsselbund des Systems. ${ANONYMOUS}`;
    case 'unlesbar': // V2: angemeldet, aber nicht mehr zu entschlüsseln
      return `Das Passwort ist auf diesem Rechner nicht mehr lesbar – bitte ab- und neu anmelden. ${ANONYMOUS}`;
    case 'datei':
    case null:
      // V1: unter Linux ohne Schlüsselbund-Dienst schützt nur das Dateirecht – das ehrlich sagen
      return view.backend === 'basic_text'
        ? `Das Passwort liegt in einer Datei, die nur du lesen kannst (kein Schlüsselbund gefunden – nur durch die Dateirechte geschützt). ${ANONYMOUS}`
        : `Das Passwort liegt in einer Datei, die nur du lesen kannst (kein Schlüsselbund gefunden). ${ANONYMOUS}`;
  }
}

// ---------------------------------------------------------------- Bericht und Meldungen

/** Der Bericht im Rahmen „Ergebnis“: Kopfzeile fett (rot bei failed), darunter die Abschnitte. */
export interface ReportView {
  readonly head: string;
  readonly failed: boolean;
  /** folgt direkt auf die Kopfzeile, beginnt also mit dem Zeilenumbruch nach ihr */
  readonly rest: string;
}

export function reportView(report: Report): ReportView {
  return { head: report.head, failed: report.failed, rest: '\n\n' + report.sections.join('\n\n') + '\n' };
}

/** Bericht für einen Fehler, mit dem niemand gerechnet hat (§7.2). */
export function unexpectedReport(error: unknown): Report {
  return {
    head: 'Unerwarteter Fehler.',
    sections: [String(error), 'Was nicht hochgeladen wurde, bleibt liegen und geht beim nächsten Mal mit.'],
    failed: true,
  };
}

/** „Testlauf …“ bzw. „Lade hoch …“ */
export const startText = (test: boolean): string => (test ? TEXT.testRun : TEXT.uploading);

export const saveErrorText = (err: string): string =>
  `Die Einstellungen ließen sich nicht speichern (${err}). Sie gelten nur bis zum Schließen.`;

export const unexpectedText = (error: unknown): string => `Unerwarteter Fehler:\n\n${String(error)}`;

/** Fehlertext im Anmeldedialog: Meldung des Main oder „Unerwarteter Fehler: …“. */
export const signInErrorText = (error: unknown): string => `Unerwarteter Fehler: ${String(error)}`;
