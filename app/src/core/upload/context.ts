// Gemeinsames der beiden Upload-Teile: Abhängigkeiten, Ergebnis, Dateifehler-Erkennung.
import type { Limits } from './limits';
import type { Credentials, Flavor, HistoryKind, HistoryStore, JsonObject, Outcome, ProgressLog, SiteSession, WowData } from '../../shared/types';

/** Grenzen, die Tests verkleinern können (in Python per mock.patch). */
export interface UploadTuning {
  readonly maxEnvelopes: number;
  readonly broadcastBatch: number;
  readonly maxTextLength: number;
}

export interface UploadContext {
  readonly wowData: WowData;
  readonly history: HistoryStore;
  readonly limits: Limits;
  readonly tuning: UploadTuning;
}

/** Ein Teil des Durchgangs („Gesammelte Zeilen“ oder „NPC-Texte“). */
export type Part = (
  ctx: UploadContext, site: SiteSession, flavors: readonly Flavor[],
  credentials: Credentials | null,
  test: boolean, log: ProgressLog,
) => Promise<Outcome>;

export const outcome = (text: string, sent = false, failed = false): Outcome => ({ text, sent, failed });

/** Dateifehler wie Pythons OSError: Node-Fehler mit Systemcode (ENOENT, ENOSPC, EACCES …). */
export function isFileError(err: unknown): err is NodeJS.ErrnoException {
  if (!(err instanceof Error)) return false;
  const code = (err as NodeJS.ErrnoException).code;
  return typeof code === 'string' && /^E[A-Z0-9]+$/.test(code);
}

/** Einen Fehlschlag im Verlauf vermerken; scheitert auch das, steht er immer noch im Ergebnis. */
export async function recordFailure(history: HistoryStore, kind: HistoryKind, info: JsonObject): Promise<void> {
  try {
    await history.record({ kind, info: { status: 'fehler', ...info } });
  } catch (err) {
    if (!isFileError(err)) throw err;
  }
}
