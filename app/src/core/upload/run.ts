// Ein Upload-Durchgang (§2.2): laufende WoW-Versionen auslassen, die gesammelten Zeilen und die
// NPC-Texte senden, alles Gesendete archivieren und erst danach aufräumen.
//
// 1. SpokenContributions.lua – Zeilen ohne Vertonung, die das Addon gesammelt hat. Nur die
//    "!SPOKEN"-Umschläge werden gesendet (anonym); danach wird die Liste in der Datei geleert.
// 2. Cache/ADB/<Sprache>/DBCache.bin – die NPC-Texte (BroadcastText) aus dem Spiel-Cache.
//    Verlangt eine Anmeldung; danach wird der Cache gelöscht, WoW legt ihn neu an.
//
// Die Teile sind unabhängig: Was fehlschlägt, bleibt liegen und geht beim nächsten Mal mit.
import { UploadError, errRepr } from '../errors';
import { uploadCaches } from './caches';
import { uploadContributions } from './contributions';
import { outcome, recordFailure } from './context';
import type { Part, UploadContext, UploadTuning } from './context';
import { createLimits } from './limits';
import { createOverview } from './overview';
import { BROADCAST_BATCH, MAX_ENVELOPES, MAX_TEXT_LENGTH } from '../../shared/types';
import type { CoreEnv, HistoryKind, HistoryStore, Outcome, Report, Uploader, WowData } from '../../shared/types';

export const DEFAULT_TUNING: UploadTuning = {
  maxEnvelopes: MAX_ENVELOPES, broadcastBatch: BROADCAST_BATCH, maxTextLength: MAX_TEXT_LENGTH,
};

const PARTS: readonly (readonly [string, HistoryKind, Part])[] = [
  ['Gesammelte Zeilen', 'zeilen', uploadContributions],
  ['NPC-Texte', 'npc-texte', uploadCaches],
];

/** Kopf und alle Abschnitte, getrennt durch eine Leerzeile. */
export function reportText(report: Report): string {
  return [report.head, ...report.sections].join('\n\n');
}

/** Wie createUploader, aber mit verstellbaren Grenzen (für Tests, in Python per mock.patch). */
export function createUploaderWith(
  deps: { env: CoreEnv; wowData: WowData; history: HistoryStore }, tuning: Partial<UploadTuning> = {},
): Uploader {
  const { env, wowData, history } = deps;
  const ctx: UploadContext = {
    wowData, history, limits: createLimits({ dataDir: env.paths.dataDir, clock: env.clock }),
    tuning: { ...DEFAULT_TUNING, ...tuning },
  };

  return {
    /** Ein ganzer Durchgang. test: nur zeigen, was gesendet würde – nichts senden, löschen, archivieren. */
    async run(wow, credentials, { test, log }) {
      let flavors = await wowData.spokenFlavors(wow);
      if (flavors.length === 0) {
        return { head: 'Keine WoW-Version mit Spoken gefunden.', sections: [`Gesucht in: ${wow}`], failed: true };
      }

      // Eine laufende Version schreibt ihre Dateien erst beim Ausloggen und würde Geleertes
      // wieder überschreiben: sie wird übersprungen, die anderen laufen normal. Auch der
      // Testlauf prüft das, damit er zeigt, was ein echter Upload jetzt senden würde.
      const running = await env.running();
      if (running === null) {
        return {
          head: 'WoW läuft noch.',
          sections: ['Welche Version, ist nicht zu erkennen – bitte das Spiel erst komplett beenden.'],
          failed: true,
        };
      }
      const skipped = flavors.filter((f) => running.has(f.folder.toLowerCase()));
      flavors = flavors.filter((f) => !skipped.includes(f));
      if (flavors.length === 0) {
        return {
          head: 'WoW läuft noch.',
          sections: ['Bitte das Spiel erst komplett beenden: WoW schreibt die Dateien erst beim Ausloggen ' +
            'und würde die geleerte Liste sonst wieder überschreiben.'],
          failed: true,
        };
      }
      const sections = [`Geprüft: ${flavors.map((f) => f.name).join(', ')}`];
      sections.push(...skipped.map((f) => `${f.name}: übersprungen, läuft gerade – beim nächsten Mal nach dem Beenden dabei.`));

      // Eine Website-Sitzung (Cookie-Jar) für den ganzen Durchgang.
      const site = env.openSite();
      let failed = false;
      let sent = false;
      for (const [label, kind, part] of PARTS) {
        let result: Outcome;
        try {
          result = await part(ctx, site, flavors, credentials, test, log);
        } catch (err) { // auch ein Programmfehler in einem Teil soll den anderen nicht verschlucken
          const message = err instanceof UploadError ? err.message : `${label}: unerwarteter Fehler (${errRepr(err)}).`;
          result = outcome(`${message}\n  Nichts gelöscht, beim nächsten Mal wird es erneut versucht.`, false, true);
          if (!test) await recordFailure(history, kind, { versionen: flavors.map((f) => f.name), fehler: message });
        }
        failed ||= result.failed;
        sent ||= result.sent;
        sections.push(result.text);
      }

      let head: string;
      if (test) head = 'Testlauf – nichts gesendet, gelöscht oder archiviert.';
      else if (failed) head = 'Nicht alles hat geklappt.';
      else if (sent) head = 'Erfolgreich hochgeladen – danke!';
      else head = 'Nichts Neues zum Hochladen.';
      return { head, sections, failed };
    },

    overview: createOverview(ctx, env),
  };
}
