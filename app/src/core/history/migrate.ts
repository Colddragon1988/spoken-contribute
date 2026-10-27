// Übernahme der losen Sicherungen des früheren Skripts in den Verlauf (§5.5, Migration).
import { readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { HistoryEntry, RecordInput, WowData } from '../../shared/types';
import { FLAVOR_NAMES } from '../../shared/types';
import { parseIso } from '../time';

// Sicherungen des früheren Skripts: <Zeit>_[<Version>_]<Account>_SpokenContributions.lua[.bak]
const OLD_BACKUP = /^(\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d)_(.+)_(SpokenContributions\.lua(?:\.bak)?)$/u;

export const MIGRATION_NOTE =
  'Aus dem Archiv des früheren Skripts übernommen; die Antwort des Servers wurde damals nicht gespeichert.';

interface OldFile {
  readonly path: string;
  readonly name: string;
  readonly middle: string;
  readonly file: string;
}

/** "2026-10-24_17-23-10" als Ortszeit; null bei einem unmöglichen Zeitpunkt (Monat 13 …). */
function stampTime(stamp: string): Date | null {
  const [day = '', time = ''] = stamp.split('_');
  const parsed = parseIso(`${day}T${time.replaceAll('-', ':')}`);
  return parsed ? parsed.date : null;
}

/** Übernimmt die Sicherungen aus dem Datenordner in den Verlauf: je Zeitpunkt ein Eintrag.
 *  Die alten Dateien werden erst gelöscht, wenn ihr Eintrag steht. */
export async function migrateOldArchive(deps: {
  readonly dataDir: string;
  readonly wowData: WowData;
  readonly record: (input: RecordInput) => Promise<HistoryEntry>;
}): Promise<void> {
  let names: string[];
  try {
    names = await readdir(deps.dataDir);
  } catch {
    return; // kein Datenordner: nichts zu übernehmen
  }
  const groups = new Map<string, OldFile[]>();
  for (const name of names) {
    const match = OLD_BACKUP.exec(name);
    if (!match) continue;
    const [, stamp = '', middle = '', file = ''] = match;
    const group = groups.get(stamp) ?? [];
    group.push({ path: join(deps.dataDir, name), name, middle, file });
    groups.set(stamp, group);
  }
  for (const stamp of [...groups.keys()].sort()) {
    const when = stampTime(stamp);
    if (!when) continue; // unmöglicher Zeitpunkt im Namen: die Dateien bleiben einfach liegen
    const files = (groups.get(stamp) ?? []).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    await migrateGroup(deps, when, files);
    for (const { path } of files) await unlink(path);
  }
}

async function migrateGroup(
  deps: Parameters<typeof migrateOldArchive>[0], when: Date, files: readonly OldFile[],
): Promise<void> {
  const envelopes: string[] = [];
  const originals: { source: string; name: string }[] = [];
  const versions: string[] = [];
  for (const { path, middle, file } of files) {
    // am letzten "_" geteilt (wie rpartition); die erste Fassung kannte nur Classic Era
    const cut = middle.lastIndexOf('_');
    const flavor = (cut < 0 ? '' : middle.slice(0, cut)) || 'classic_era';
    const account = middle.slice(cut + 1);
    const key = `_${flavor}_`;
    const name = (Object.hasOwn(FLAVOR_NAMES, key) ? FLAVOR_NAMES[key] : undefined) ?? flavor;
    if (!versions.includes(name)) versions.push(name);
    for (const envelope of await deps.wowData.envelopesIn(path)) envelopes.push(envelope);
    originals.push({ source: path, name: `${flavor}/${account}/${file}` });
  }
  const unique = [...new Set(envelopes)];
  const { kinds, titles } = deps.wowData.summarize(unique);
  await deps.record({
    kind: 'zeilen',
    info: {
      status: 'ok', versionen: versions, anzahl: unique.length,
      zusammenfassung: kinds, titel: [...titles], hinweis: MIGRATION_NOTE,
    },
    payload: { gesendet: { envelopes: unique } },
    originals,
    when,
  });
}
