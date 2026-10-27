// Teil 1 „Gesammelte Zeilen“ (§2.3, §2.4): die Umschläge aus SpokenContributions.lua anonym
// senden, archivieren und erst danach die Liste in der Datei leeren.
import { access } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { UploadError, errText } from '../errors';
import { formatClock } from '../time';
import { PER_HOUR } from './limits';
import { isFileError, outcome } from './context';
import type { Part, UploadContext } from './context';
import {
  batchNotes, contributionPayload, planBatch, pyRepr, resultLine, summedResult,
} from './plan';
import type { Batch, ContributionResult } from './plan';
import { pyTruthy, truncate } from './site';
import type { JsonObject, SiteSession } from '../../shared/types';

const CONTRIBUTIONS = 'SpokenContributions.lua';
const LABEL = 'Gesammelte Zeilen';

const exists = (path: string): Promise<boolean> => access(path).then(() => true, () => false);

/** Die .lua- und .bak-Dateien mit ihrem Namen im Archiv (<Version>/<Account>/<Datei>). */
export async function originalsOf(files: readonly string[]): Promise<{ source: string; name: string }[]> {
  const found: { source: string; name: string }[] = [];
  for (const lua of files) { // …/_classic_era_/WTF/Account/<Account>/SavedVariables/SpokenContributions.lua
    const flavor = basename(dirname(dirname(dirname(dirname(dirname(lua)))))).replace(/^_+|_+$/g, '');
    const account = basename(dirname(dirname(lua)));
    for (const source of [lua, `${lua}.bak`]) {
      if (await exists(source)) found.push({ source, name: `${flavor}/${account}/${basename(source)}` });
    }
  }
  return found;
}

/** Die Umschläge senden, je Upload höchstens maxEnvelopes; gibt die Antworten zurück.
 *  Meist ist es ein einziger Upload – mehrere nur, wenn schon eine Datei allein zu groß ist. */
async function sendEnvelopes(ctx: UploadContext, site: SiteSession, envelopes: readonly string[]): Promise<JsonObject[]> {
  const answers: JsonObject[] = [];
  const step = ctx.tuning.maxEnvelopes;
  for (let start = 0; start < envelopes.length; start += step) {
    const payload = contributionPayload(envelopes.slice(start, start + step));
    let result: JsonObject;
    try {
      result = await site.post('/api/contributions/batch', payload, LABEL);
    } catch (err) {
      if (err instanceof UploadError && err.status === 429) await ctx.limits.noteRefused();
      throw err;
    }
    // Gezählt wird jede Antwort, auch ok:false – der Server hat den Upload trotzdem gesehen.
    await ctx.limits.noteUpload();
    if (!pyTruthy(result.ok)) {
      throw new UploadError(`${LABEL}: unerwartete Antwort ${truncate(pyRepr(result), 200)}.`);
    }
    answers.push(result);
  }
  return answers;
}

/** Das Gesendete samt Originaldateien archivieren. Scheitert das, wird nichts geleert. */
async function archiveContributions(
  ctx: UploadContext, batch: Batch, kinds: string, titles: readonly string[],
  result: ContributionResult, answers: readonly JsonObject[],
): Promise<void> {
  try {
    await ctx.history.record({
      kind: 'zeilen',
      info: {
        status: 'ok', versionen: [...batch.perFlavor.keys()], anzahl: batch.envelopes.length,
        zusammenfassung: kinds, titel: [...titles], ergebnis: { ...result },
      },
      // "antwort" bleibt wie bisher ein Objekt; nur bei mehreren Uploads eine Liste.
      payload: {
        gesendet: contributionPayload(batch.envelopes),
        antwort: answers.length === 1 && answers[0] ? answers[0] : [...answers],
      },
      originals: await originalsOf(batch.files),
    });
  } catch (err) {
    if (isFileError(err)) throw new UploadError(`${LABEL}: gesendet, aber nicht archiviert (${errText(err)}).`);
    throw err;
  }
}

/** Die gesendeten und archivierten Zeilen aus den Dateien entfernen: [Hinweis, fehlgeschlagen]. */
async function clearSent(ctx: UploadContext, batch: Batch): Promise<[string, boolean]> {
  let kept: string[];
  try {
    kept = await ctx.wowData.clearContributions(batch.files, new Set(batch.envelopes));
  } catch (err) {
    if (!isFileError(err)) throw err;
    return [`${CONTRIBUTIONS} ließ sich nicht leeren (${errText(err)}). Die Zeilen gehen beim nächsten Mal ` +
      'erneut mit; der Server erkennt sie wieder.', true];
  }
  if (kept.length > 0) {
    return [`${kept.length} Datei(en) haben sich während des Uploads verändert und bleiben ` +
      'unberührt; sie gehen beim nächsten Mal mit.', false];
  }
  return [`Liste in ${CONTRIBUTIONS} geleert.`, false];
}

/** Alle Versionen in einem Upload: der Server erlaubt nur 10 Uploads pro Stunde. */
export const uploadContributions: Part = async (ctx, site, flavors, _credentials, test, log) => {
  const max = ctx.tuning.maxEnvelopes;
  const batch = planBatch(await ctx.wowData.collectContributions(flavors), max);
  if (batch.envelopes.length === 0) return outcome(`${LABEL}: keine neuen seit dem letzten Upload.`);
  const origin = [...batch.perFlavor].map(([name, n]) => `${n} aus ${name}`).join(', ');
  const { kinds, titles } = ctx.wowData.summarize(batch.envelopes);
  const uploads = Math.ceil(batch.envelopes.length / max);
  const notes = batchNotes(batch, titles, uploads, max);
  if (uploads > PER_HOUR) {
    // Eine Datei geht nur ganz oder gar nicht; so viele Uploads nimmt der Server aber in
    // keiner Stunde an. Nicht anfangen: Die ersten Pakete gingen jede Stunde wieder raus.
    return outcome([
      `${LABEL}: ${kinds} bleiben liegen (${origin}).`, ...notes,
      `Das wären ${uploads} Uploads, der Server nimmt aber höchstens ${PER_HOUR} pro Stunde an – so lässt ` +
        'sich die Datei nicht hochladen. Sie bleibt unverändert.',
    ].join('\n  '), false, true);
  }
  const freeAt = await ctx.limits.freeAt(uploads);
  if (freeAt) notes.push(`Upload-Grenze erreicht (${PER_HOUR} pro Stunde) – wieder möglich ab ${formatClock(freeAt)} Uhr.`);
  if (test) return outcome([`${LABEL}: würde ${kinds} senden (${origin}).`, ...notes].join('\n  '));
  if (freeAt) { // gar nicht erst versuchen; der Server würde mit 429 ablehnen
    return outcome([`${LABEL}: ${kinds} bleiben vorerst liegen (${origin}).`, ...notes].join('\n  '), false, true);
  }

  log(`${LABEL}: sende ${batch.envelopes.length} …`);
  const answers = await sendEnvelopes(ctx, site, batch.envelopes);
  const result = summedResult(answers);
  await archiveContributions(ctx, batch, kinds, titles, result, answers);
  // Erst jetzt leeren: Server und Archiv haben alles.
  const [clearedNote, clearFailed] = await clearSent(ctx, batch);
  const lines = [`${LABEL}: ${kinds} gesendet (${origin}).`, resultLine(result), ...notes, clearedNote];
  return outcome(lines.join('\n  '), true, clearFailed);
};
