// Die Upload-Grenze des Servers für gesammelte Zeilen: höchstens 10 Uploads pro Stunde je
// IP-Adresse (saved-variables.ts).
//
// Das Programm zählt seine eigenen Uploads mit, damit es nicht erst am Fehler 429 merkt, dass die
// Grenze erreicht ist. Uploads über die Website kennt es nicht – meldet der Server trotzdem 429,
// gilt die Stunde ab da als voll.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeFileAtomic } from '../fsutil';
import { addHours, formatIsoLocal, parseIso } from '../time';
import { FILES, UPLOADS_PER_HOUR } from '../../shared/types';
import type { Clock } from '../../shared/types';

export const PER_HOUR = UPLOADS_PER_HOUR;
export const WINDOW_MS = 3_600_000;

export interface Limits {
  readonly file: string;
  /** Zeitpunkte der Uploads in der letzten Stunde, die ältesten zuerst. */
  recent(): Promise<Date[]>;
  /** Wie viele Uploads in dieser Stunde noch gehen. */
  remaining(): Promise<number>;
  /** Ab wann wieder `needed` Uploads hintereinander gehen; null, wenn sofort. */
  freeAt(needed?: number): Promise<Date | null>;
  /** Einen gelungenen Upload mitzählen. */
  noteUpload(): Promise<void>;
  /** Der Server hat mit 429 abgelehnt: die Stunde ab jetzt als voll betrachten. */
  noteRefused(): Promise<void>;
  /** Zeitpunkte speichern (wie Pythons _save; auch für Tests). Schreibfehler werden ignoriert. */
  save(stamps: readonly Date[]): Promise<void>;
}

export function createLimits(deps: { readonly dataDir: string; readonly clock: Clock }): Limits {
  const file = join(deps.dataDir, FILES.uploadTimes);

  /** Alle gespeicherten Zeitpunkte. Unlesbares wird übergangen, ebenso Zeitpunkte ohne
   *  Zeitzone – die schreibt das Programm nie, und vergleichen ließen sie sich nicht. */
  async function load(): Promise<Date[]> {
    let texts: unknown;
    try {
      texts = JSON.parse(await readFile(file, 'utf8'));
    } catch {
      return [];
    }
    if (!Array.isArray(texts)) return [];
    const stamps: Date[] = [];
    for (const text of texts) {
      const parsed = parseIso(text);
      if (parsed?.hasOffset === true) stamps.push(parsed.date);
    }
    return stamps;
  }

  async function save(stamps: readonly Date[]): Promise<void> {
    try {
      await writeFileAtomic(file, JSON.stringify(stamps.map(formatIsoLocal)));
    } catch {
      // nur eine Vorwarnung; der Server prüft die Grenze ohnehin selbst
    }
  }

  /** Zeitpunkte in der Zukunft zählen nicht: Wurde die Uhr zurückgestellt, sperrten sie sonst
   *  weit länger als eine Stunde. Zählt das Programm dadurch zu wenig, meldet der Server 429. */
  async function recent(): Promise<Date[]> {
    const now = deps.clock.now().getTime();
    return (await load())
      .filter((stamp) => now - WINDOW_MS < stamp.getTime() && stamp.getTime() <= now)
      .sort((a, b) => a.getTime() - b.getTime());
  }

  return {
    file,
    recent,
    save,
    async remaining() {
      return Math.max(PER_HOUR - (await recent()).length, 0);
    },
    // Mehr als PER_HOUR gehen nie auf einmal – dafür zählt, ab wann die Stunde ganz frei ist.
    async freeAt(needed = 1) {
      const stamps = await recent();
      const mustExpire = stamps.length + Math.min(needed, PER_HOUR) - PER_HOUR;
      const stamp = mustExpire > 0 ? stamps[mustExpire - 1] : undefined;
      return stamp === undefined ? null : addHours(stamp, 1);
    },
    async noteUpload() {
      await save([...(await recent()), deps.clock.now()]);
    },
    async noteRefused() {
      const stamps = await recent();
      const now = deps.clock.now();
      await save([...stamps, ...Array.from({ length: Math.max(PER_HOUR - stamps.length, 0) }, () => now)]);
    },
  };
}
