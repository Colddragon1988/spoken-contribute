// Teil 2 „NPC-Texte“ (§2.5): BroadcastText aus Cache/ADB/<Sprache>/DBCache.bin mit Anmeldung
// senden; ein Cache wird erst gelöscht, wenn er ganz gesendet und archiviert ist.
import { unlink } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { UploadError, errText } from '../errors';
import { isFileError, outcome, recordFailure } from './context';
import type { Part, UploadContext } from './context';
import { count } from './plan';
import type { BroadcastRow, Flavor, JsonObject, SiteSession } from '../../shared/types';

/** Der Spiel-Cache einer Version in einer Sprache. */
export interface CacheJob {
  /** …/<Version>/Cache/ADB/<Sprache> */
  readonly folder: string;
  /** DBCache.bin und Zwischenstände; werden nach dem Upload gelöscht */
  readonly files: readonly string[];
  /** zu sendende Texte je Client-Build */
  readonly byBuild: ReadonlyMap<number, readonly BroadcastRow[]>;
  /** Texte, die der Server verwerfen würde; nur fürs Archiv */
  readonly tooLong: readonly BroadcastRow[];
  /** Anzeigename der Version */
  readonly flavorName: string;
  readonly lang: string;
  readonly label: string;
  readonly count: number;
}

/** Länge wie in JavaScript gezählt (UTF-16-Einheiten), so misst auch der Server. */
const utf16Length = (text: string): number => text.length;

/** Alle Caches mit NPC-Texten; zu lange Texte sind schon aussortiert. */
export async function cacheJobs(ctx: UploadContext, flavors: readonly Flavor[]): Promise<CacheJob[]> {
  const max = ctx.tuning.maxTextLength;
  // Ob der Server diesen Text stillschweigend verwerfen würde.
  const isTooLong = (row: BroadcastRow): boolean => utf16Length(row.text) > max || utf16Length(row.text1) > max;
  const jobs: CacheJob[] = [];
  for (const folder of await ctx.wowData.cacheFolders(flavors)) {
    const files = await ctx.wowData.cacheFiles(folder);
    const byBuild = await ctx.wowData.newestTexts(files);
    if (byBuild.size === 0) continue;
    const tooLong: BroadcastRow[] = [];
    const sendable = new Map<number, BroadcastRow[]>();
    for (const [build, rows] of byBuild) {
      tooLong.push(...rows.filter(isTooLong));
      sendable.set(build, rows.filter((row) => !isTooLong(row)));
    }
    const flavorDir = dirname(dirname(dirname(folder)));
    const flavorName = flavors.find((f) => f.dir === flavorDir)?.name ?? ctx.wowData.flavorName(basename(flavorDir));
    const lang = basename(folder);
    jobs.push({
      folder, files, byBuild: sendable, tooLong, flavorName, lang,
      label: `NPC-Texte (${flavorName}, ${lang})`,
      count: [...sendable.values()].reduce((sum, rows) => sum + rows.length, 0),
    });
  }
  return jobs;
}

const rowJson = (row: BroadcastRow): JsonObject => ({ id: row.id, text: row.text, text1: row.text1 });

/** Für die NPC-Texte anmelden; danach trägt `site` das Sitzungs-Cookie. */
async function signIn(site: SiteSession, email: string, password: string): Promise<void> {
  try {
    await site.signIn(email, password);
  } catch (err) {
    if (err instanceof UploadError && err.status === 401) {
      throw new UploadError('NPC-Texte: Anmeldung abgelehnt – E-Mail oder Passwort stimmen nicht ' +
        'mehr. Bitte im Fenster ab- und neu anmelden.');
    }
    throw err;
  }
}

interface Totals {
  readonly texts: number;
  readonly added: number;
  readonly changed: number;
}

/** Einen Cache senden, archivieren und erst dann löschen; gibt die Summen der Antworten zurück. */
async function sendCache(ctx: UploadContext, site: SiteSession, job: CacheJob, info: JsonObject): Promise<Totals> {
  const requests: JsonObject[] = [];
  const answers: JsonObject[] = [];
  const step = ctx.tuning.broadcastBatch;
  for (const [build, rows] of job.byBuild) { // ein Upload je Client-Build, wie die Website
    for (let start = 0; start < rows.length; start += step) { // in Paketen unter dem Server-Limit
      const request: JsonObject = { lang: job.lang, build, texts: rows.slice(start, start + step).map(rowJson) };
      answers.push(await site.post('/api/broadcast-text', request, job.label));
      requests.push(request);
    }
  }
  const sum = (key: string): number => answers.reduce((total, answer) => total + count(answer[key]), 0);
  const total: Totals = { texts: sum('texts'), added: sum('added'), changed: sum('changed') };
  await ctx.history.record({
    kind: 'npc-texte',
    info: { ...info, status: 'ok', ergebnis: { neu: total.added, aktualisiert: total.changed } },
    payload: { gesendet: requests, antwort: answers, nicht_gesendet: job.tooLong.map(rowJson) },
  });
  for (const file of job.files) { // erst jetzt: das Archiv hat alles; WoW legt den Cache neu an
    try {
      await unlink(file);
    } catch (err) {
      if (!(isFileError(err) && err.code === 'ENOENT')) throw err;
    }
  }
  return total;
}

/** NPC-Texte je Version und Sprache hochladen; ein Cache wird erst gelöscht, wenn er ganz
 *  gesendet und archiviert ist. */
export const uploadCaches: Part = async (ctx, site, flavors, credentials, test, log) => {
  const jobs = await cacheJobs(ctx, flavors);
  if (jobs.length === 0) return outcome('NPC-Texte: keine neuen im Spiel-Cache.');
  if (!test) {
    if (!credentials) {
      return outcome('NPC-Texte: nicht angemeldet – bitte im Fenster unter „Konto“ anmelden.\n' +
        '  Die Texte bleiben bis dahin im Spiel-Cache.', false, true);
    }
    if (!credentials.password) {
      return outcome('NPC-Texte: das Passwort war nicht aus dem Schlüsselbund zu holen (gesperrt ' +
        'oder abgelehnt?).\n  Bitte entsperren oder im Fenster ab- und neu anmelden; ' +
        'die Texte bleiben bis dahin im Spiel-Cache.', false, true);
    }
    await signIn(site, credentials.email, credentials.password);
  }

  const lines: string[] = [];
  let sent = false;
  let failed = false;
  for (const job of jobs) {
    const note = job.tooLong.length > 0
      ? `\n  ${job.tooLong.length} zu lang (über ${ctx.tuning.maxTextLength} Zeichen), vom Server ` +
        'nicht annehmbar – sie stehen im Archiv.'
      : '';
    if (test) {
      const login = credentials ? '' : ' Anmeldung fehlt noch.';
      lines.push(`${job.label}: würde ${job.count} Texte senden.${login}${note}`);
      continue;
    }

    log(`${job.label}: sende ${job.count} …`);
    const info: JsonObject = {
      versionen: [job.flavorName], sprache: job.lang, builds: [...job.byBuild.keys()].sort((a, b) => a - b),
      anzahl: job.count, zu_lang: job.tooLong.length,
    };
    let total: Totals;
    try {
      total = await sendCache(ctx, site, job, info);
    } catch (err) {
      if (err instanceof UploadError) { // nichts gelöscht; die übrigen Caches laufen weiter
        await recordFailure(ctx.history, 'npc-texte', { ...info, fehler: err.message });
        lines.push(`${err.message}\n  Der Cache bleibt liegen und geht beim nächsten Mal erneut mit.`);
        failed = true;
        continue;
      }
      if (isFileError(err)) { // beim Archivieren oder Löschen; gesendet ist schon
        const message = `${job.label}: Dateifehler (${errText(err)}).`;
        await recordFailure(ctx.history, 'npc-texte', { ...info, fehler: message });
        lines.push(`${message}\n  Was vom Cache noch da ist, geht beim nächsten Mal erneut mit.`);
        failed = true;
        continue;
      }
      throw err;
    }
    lines.push(`${job.label}: ${total.texts} gesendet, ${total.added} neu, ${total.changed} aktualisiert. Cache gelöscht.${note}`);
    sent = true;
  }
  return outcome(lines.join('\n'), sent, failed);
};
