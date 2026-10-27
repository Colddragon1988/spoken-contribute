// Der Ablauf eines Durchgangs gegen kleine In-Memory-Fakes von WowData und HistoryStore:
// Reihenfolge Lesen → Senden → Archivieren → Leeren/Löschen (Entscheidung 1), Berichte wörtlich,
// Limits nur für Zeilen, Passwort-Hygiene. Unabhängig von den Paketen (b) und (d).
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import { createLimits, PER_HOUR } from '../../../src/core/upload/limits';
import { createUploaderWith } from '../../../src/core/upload/run';
import { createSiteFactory, reportText } from '../../../src/core/upload';
import type { UploadTuning } from '../../../src/core/upload/context';
import type {
  BroadcastRow, ContributionStore, CoreEnv, Flavor, HistoryEntry, HistoryStore, JsonObject, RecordInput,
  RunningFlavors, Summary, TextsByBuild, WowData,
} from '../../../src/shared/types';
import { FakeKeyring } from '../../helpers/fakeKeyring';
import { FakeServer } from '../../helpers/fakeServer';
import type { PlannedFailure } from '../../helpers/fakeServer';

const PASSWORD = 'Sehr-Geheim-4711';
const BATCH = '/api/contributions/batch';
const TEXTS = '/api/broadcast-text';
const exists = (path: string): Promise<boolean> => access(path).then(() => true, () => false);
const fileError = (message: string, code = 'ENOSPC'): Error => Object.assign(new Error(message), { code });

/** WoW-Daten im Speicher: .lua-Pfad → Umschläge, Cache-Ordner → Texte je Build. */
class MemoryWow implements WowData {
  readonly flavors: Flavor[] = [];
  readonly files = new Map<string, string[]>();
  readonly caches = new Map<string, { files: string[]; texts: Map<number, BroadcastRow[]> }>();
  clearError: Error | null = null;
  /** wird vor dem Leeren aufgerufen (z. B. „WoW schreibt dazu“) */
  beforeClear: (() => void) | null = null;

  constructor(readonly root: string, readonly events: string[]) {}

  flavor(folder: string, name: string): Flavor {
    const flavor = { dir: join(this.root, folder), folder, name };
    this.flavors.push(flavor);
    return flavor;
  }
  flavorName(folder: string): string {
    return folder.replace(/^_+|_+$/g, '');
  }
  spokenFlavors(): Promise<Flavor[]> {
    return Promise.resolve([...this.flavors]);
  }
  envelopesIn(path: string): Promise<string[]> {
    return Promise.resolve([...(this.files.get(path) ?? [])]);
  }
  collectContributions(flavors: readonly Flavor[]): Promise<ContributionStore[]> {
    this.events.push('lesen');
    const stores: ContributionStore[] = [];
    for (const flavor of flavors) {
      for (const [lua, envelopes] of this.files) {
        if (lua.startsWith(flavor.dir + '/')) stores.push({ flavor, lua, envelopes: [...envelopes] });
      }
    }
    return Promise.resolve(stores);
  }
  clearContributions(files: readonly string[], sent: ReadonlySet<string>): Promise<string[]> {
    this.events.push('leeren');
    this.beforeClear?.();
    if (this.clearError) return Promise.reject(this.clearError);
    const kept: string[] = [];
    for (const lua of files) {
      if ((this.files.get(lua) ?? []).every((e) => sent.has(e))) this.files.set(lua, []);
      else kept.push(lua);
    }
    return Promise.resolve(kept);
  }
  parseEnvelope(envelope: string): ReadonlyMap<string, string> {
    return new Map([['source', envelope.split(' ')[1] ?? '?']]);
  }
  summarize(envelopes: readonly string[]): Summary {
    return { kinds: `${envelopes.length} Quest- und Gesprächszeilen`, titles: envelopes.map((e) => `Titel ${e}`) };
  }
  cacheFolders(flavors: readonly Flavor[]): Promise<string[]> {
    return Promise.resolve([...this.caches.keys()].filter((folder) => flavors.some((f) => folder.startsWith(f.dir + '/'))));
  }
  cacheFiles(folder: string): Promise<string[]> {
    return Promise.resolve(this.caches.get(folder)?.files ?? []);
  }
  newestTexts(files: readonly string[]): Promise<TextsByBuild> {
    for (const cache of this.caches.values()) if (cache.files[0] === files[0]) return Promise.resolve(cache.texts);
    return Promise.resolve(new Map());
  }
}

/** Verlauf im Speicher. */
class MemoryHistory implements HistoryStore {
  readonly root = '/verlauf';
  readonly records: RecordInput[] = [];
  error: Error | null = null;
  constructor(readonly events: string[]) {}
  record(input: RecordInput): Promise<HistoryEntry> {
    this.events.push(`archivieren:${input.kind}:${JSON.stringify(input.info.status)}`);
    if (this.error) return Promise.reject(this.error);
    this.records.push(input);
    return Promise.resolve({ id: String(this.records.length), folder: '', info: input.info, time: new Date(), failed: input.info.status !== 'ok' });
  }
  entries(): Promise<HistoryEntry[]> { return Promise.resolve([]); }
  payload(): Promise<JsonObject | null> { return Promise.resolve(null); }
  migrateOldArchive(): Promise<void> { return Promise.resolve(); }
}

async function world(tuning: Partial<UploadTuning> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'spoken-flow-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const events: string[] = [];
  const wow = new MemoryWow(join(root, 'World of Warcraft'), events);
  const history = new MemoryHistory(events);
  const server = new FakeServer();
  server.onPost = (path) => { events.push(`senden:${path}`); };
  const logs: string[] = [];
  const state: { running: RunningFlavors } = { running: new Set() };
  const clock = { now: () => new Date() };
  const env: CoreEnv = {
    platform: 'linux',
    paths: { configDir: join(root, 'config'), dataDir: join(root, 'data'), home: root },
    clock,
    running: () => Promise.resolve(state.running),
    secrets: new FakeKeyring('none'),
    openSite: createSiteFactory(server, { baseUrl: 'http://127.0.0.1:9', platform: 'linux', version: '2.1' }),
    wow: { isWowRoot: () => Promise.resolve(true), wowRoot: (p) => Promise.resolve(p), findWow: () => Promise.resolve(null) },
    logger: { info: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(m) },
  };
  const uploader = createUploaderWith({ env, wowData: wow, history }, tuning);
  const limits = createLimits({ dataDir: env.paths.dataDir, clock });
  const progress: string[] = [];
  const run = (credentials: { email: string; password: string | null } | null = { email: 'a@b.c', password: PASSWORD }, test = false) =>
    uploader.run(wow.root, credentials, { test, log: (line) => progress.push(line) });
  /** Cache-Ordner mit echter Datei anlegen (sie wird nach dem Senden gelöscht). */
  async function cache(flavor: Flavor, lang: string, texts: [number, BroadcastRow[]][]): Promise<string> {
    const folder = join(flavor.dir, 'Cache', 'ADB', lang);
    await mkdir(folder, { recursive: true });
    const file = join(folder, 'DBCache.bin');
    await writeFile(file, 'x');
    wow.caches.set(folder, { files: [file, join(folder, 'DBCache.bin1652.tmp')], texts: new Map(texts) });
    return file;
  }
  return { root, events, wow, history, server, logs, progress, state, limits, run, cache, uploader };
}

const row = (id: number, text: string, text1 = ''): BroadcastRow => ({ id, text, text1 });

describe('Reihenfolge (Entscheidung 1)', () => {
  it('Zeilen: lesen → senden → archivieren → leeren; Bericht wörtlich', async () => {
    const w = await world();
    const era = w.wow.flavor('_classic_era_', 'Classic Era');
    const lua = join(era.dir, 'WTF/Account/ACC/SavedVariables/SpokenContributions.lua');
    w.wow.files.set(lua, ['e1', 'e2', 'e3']);
    const report = await w.run(null);
    expect(w.events).toEqual(['lesen', `senden:${BATCH}`, 'archivieren:zeilen:"ok"', 'leeren']);
    expect(w.progress).toEqual(['Gesammelte Zeilen: sende 3 …']);
    expect(reportText(report)).toBe([
      'Erfolgreich hochgeladen – danke!',
      'Geprüft: Classic Era',
      'Gesammelte Zeilen: 3 Quest- und Gesprächszeilen gesendet (3 aus Classic Era).\n' +
        '  2 neu für das Projekt, 1 kannte es schon\n' +
        '  Titel e1, Titel e2, Titel e3\n' +
        '  Liste in SpokenContributions.lua geleert.',
      'NPC-Texte: keine neuen im Spiel-Cache.',
    ].join('\n\n'));
    expect(report.failed).toBe(false);
    expect(report.head).toBe('Erfolgreich hochgeladen – danke!');
    const [entry] = w.history.records;
    expect(entry?.info).toEqual({
      status: 'ok', versionen: ['Classic Era'], anzahl: 3, zusammenfassung: '3 Quest- und Gesprächszeilen',
      titel: ['Titel e1', 'Titel e2', 'Titel e3'], ergebnis: { neu: 2, bekannt: 1, abgelehnt: 0 },
    });
    expect(Object.keys(entry?.info ?? {})).toEqual(['status', 'versionen', 'anzahl', 'zusammenfassung', 'titel', 'ergebnis']);
    expect(entry?.payload).toEqual({
      gesendet: { envelopes: ['e1', 'e2', 'e3'], name: null, email: null, website: '' },
      antwort: { ok: true, accepted: 3, known: 1, counted: 3, refused: {} },
    });
    expect(w.wow.files.get(lua)).toEqual([]);
  });

  it('Zeilen: Archivfehler → nichts geleert, Fehler-Eintrag versucht', async () => {
    const w = await world();
    const era = w.wow.flavor('_classic_era_', 'Classic Era');
    w.wow.files.set(join(era.dir, 'WTF/Account/ACC/SavedVariables/SpokenContributions.lua'), ['e1']);
    w.history.error = fileError('Platte voll');
    const report = await w.run();
    expect(w.events).toEqual(['lesen', `senden:${BATCH}`, 'archivieren:zeilen:"ok"', 'archivieren:zeilen:"fehler"']);
    expect(report.sections[1]).toBe('Gesammelte Zeilen: gesendet, aber nicht archiviert (Platte voll).\n' +
      '  Nichts gelöscht, beim nächsten Mal wird es erneut versucht.');
    expect(report.head).toBe('Nicht alles hat geklappt.');
  });

  it('Zeilen: Fehler beim Leeren und „verändert“', async () => {
    const w = await world();
    const era = w.wow.flavor('_classic_era_', 'Classic Era');
    const lua = join(era.dir, 'WTF/Account/ACC/SavedVariables/SpokenContributions.lua');
    w.wow.files.set(lua, ['e1']);
    w.wow.clearError = fileError('Zugriff verweigert', 'EACCES');
    let report = await w.run();
    expect(report.failed).toBe(true);
    expect(report.sections[1]).toContain('\n  SpokenContributions.lua ließ sich nicht leeren (Zugriff verweigert). ' +
      'Die Zeilen gehen beim nächsten Mal erneut mit; der Server erkennt sie wieder.');
    w.wow.clearError = null;
    w.wow.beforeClear = () => { w.wow.files.set(lua, ['e1', 'neu']); };
    report = await w.run();
    expect(report.failed).toBe(false);
    expect(report.sections[1]).toContain('\n  1 Datei(en) haben sich während des Uploads verändert und bleiben ' +
      'unberührt; sie gehen beim nächsten Mal mit.');
  });

  it('NPC-Texte: senden → archivieren → löschen; Fehler-Eintrag; Dateifehler', async () => {
    const w = await world({ broadcastBatch: 2 });
    const era = w.wow.flavor('_classic_era_', 'Classic Era');
    const file = await w.cache(era, 'deDE', [[70003, [row(1, 'a'), row(2, 'b'), row(3, 'c')]], [60000, [row(4, 'd')]]]);
    const deletedBeforeArchive: boolean[] = [];
    const record = w.history.record.bind(w.history);
    w.history.record = async (input) => {
      deletedBeforeArchive.push(!(await exists(file)));
      return record(input);
    };
    const report = await w.run();
    expect(w.events).toEqual(['lesen', 'senden:/api/auth/sign-in/email', `senden:${TEXTS}`, `senden:${TEXTS}`, `senden:${TEXTS}`, 'archivieren:npc-texte:"ok"']);
    expect(deletedBeforeArchive).toEqual([false]);
    expect(await exists(file)).toBe(false);
    expect(w.server.calls.filter((c) => c.path === TEXTS).map((c) => [c.payload.build, (c.payload.texts as unknown[]).length]))
      .toEqual([[70003, 2], [70003, 1], [60000, 1]]);
    expect(report.sections[2]).toBe('NPC-Texte (Classic Era, deDE): 4 gesendet, 4 neu, 0 aktualisiert. Cache gelöscht.');
    expect(w.progress).toEqual(['NPC-Texte (Classic Era, deDE): sende 4 …']);
    const info = w.history.records[0]?.info;
    expect(info).toEqual({
      versionen: ['Classic Era'], sprache: 'deDE', builds: [60000, 70003], anzahl: 4, zu_lang: 0,
      status: 'ok', ergebnis: { neu: 4, aktualisiert: 0 },
    });
    expect(Object.keys(info ?? {})).toEqual(['versionen', 'sprache', 'builds', 'anzahl', 'zu_lang', 'status', 'ergebnis']);
  });

  it('NPC-Texte: Serverfehler → nichts gelöscht, Fehler-Eintrag mit info', async () => {
    const w = await world();
    const era = w.wow.flavor('_classic_era_', 'Classic Era');
    const file = await w.cache(era, 'deDE', [[1, [row(1, 'a')]]]);
    w.server.fail.set(TEXTS, [{ status: 500, body: { error: 'kaputt' } }]);
    const report = await w.run();
    expect(await exists(file)).toBe(true);
    expect(report.sections[2]).toBe('NPC-Texte (Classic Era, deDE): Server-Fehler 500 – kaputt.\n' +
      '  Der Cache bleibt liegen und geht beim nächsten Mal erneut mit.');
    const info = w.history.records[0]?.info;
    expect(Object.keys(info ?? {})).toEqual(['status', 'versionen', 'sprache', 'builds', 'anzahl', 'zu_lang', 'fehler']);
    expect(info?.fehler).toBe('NPC-Texte (Classic Era, deDE): Server-Fehler 500 – kaputt.');
  });

  it('NPC-Texte: Archivfehler → Dateifehler-Meldung, Cache bleibt', async () => {
    const w = await world();
    const era = w.wow.flavor('_classic_era_', 'Classic Era');
    const file = await w.cache(era, 'deDE', [[1, [row(1, 'a')]]]);
    w.history.error = fileError('Platte voll');
    const report = await w.run();
    expect(await exists(file)).toBe(true);
    expect(report.sections[2]).toBe('NPC-Texte (Classic Era, deDE): Dateifehler (Platte voll).\n' +
      '  Was vom Cache noch da ist, geht beim nächsten Mal erneut mit.');
    expect(report.failed).toBe(true);
  });
});

describe('Randfälle', () => {
  it('Cache, in dem alle Texte zu lang sind: kein Request, ok-Eintrag mit anzahl 0, Cache gelöscht', async () => {
    const w = await world();
    const era = w.wow.flavor('_classic_era_', 'Classic Era');
    const file = await w.cache(era, 'deDE', [[70003, [row(1, 'x'.repeat(4001)), row(2, '', 'y'.repeat(4001))]]]);
    const report = await w.run();
    expect(w.server.paths()).toEqual(['/api/auth/sign-in/email']);
    expect(await exists(file)).toBe(false);
    const [entry] = w.history.records;
    expect(entry?.info).toMatchObject({ anzahl: 0, zu_lang: 2, status: 'ok', builds: [70003], ergebnis: { neu: 0, aktualisiert: 0 } });
    expect((entry?.payload as { nicht_gesendet: unknown[] }).nicht_gesendet).toHaveLength(2);
    expect(report.sections[2]).toBe('NPC-Texte (Classic Era, deDE): 0 gesendet, 0 neu, 0 aktualisiert. Cache gelöscht.\n' +
      '  2 zu lang (über 4000 Zeichen), vom Server nicht annehmbar – sie stehen im Archiv.');
  });

  it('genau 4000 UTF-16-Einheiten gehen noch, Emoji zählen doppelt', async () => {
    const w = await world();
    const era = w.wow.flavor('_classic_era_', 'Classic Era');
    await w.cache(era, 'deDE', [[1, [row(1, 'x'.repeat(4000)), row(2, '😀'.repeat(2001))]]]);
    await w.run();
    expect(w.server.calls.filter((c) => c.path === TEXTS).map((c) => (c.payload.texts as { id: number }[]).map((t) => t.id))).toEqual([[1]]);
  });

  it('NPC-Uploads zählen nicht in die Upload-Grenze, ein 429 dort markiert nichts', async () => {
    const w = await world();
    const era = w.wow.flavor('_classic_era_', 'Classic Era');
    await w.cache(era, 'deDE', [[1, [row(1, 'a')]]]);
    w.server.fail.set(TEXTS, [{ status: 429 }]);
    const report = await w.run();
    expect(report.sections[2]).toContain('NPC-Texte (Classic Era, deDE): zu viele Uploads in der letzten Stunde, bitte später erneut.');
    expect(await w.limits.remaining()).toBe(PER_HOUR);
    await w.cache(era, 'deDE', [[1, [row(1, 'a')]]]);
    await w.run();
    expect(await w.limits.remaining()).toBe(PER_HOUR);
  });

  it('ok:false zählt trotzdem als Upload und wird zur „unerwarteten Antwort“', async () => {
    const w = await world();
    const era = w.wow.flavor('_classic_era_', 'Classic Era');
    w.wow.files.set(join(era.dir, 'WTF/Account/ACC/SavedVariables/SpokenContributions.lua'), ['e1']);
    w.server.fail.set(BATCH, [{ status: 200, body: { ok: false } }]);
    const report = await w.run();
    expect(report.sections[1]).toBe("Gesammelte Zeilen: unerwartete Antwort {'ok': False}.\n" +
      '  Nichts gelöscht, beim nächsten Mal wird es erneut versucht.');
    expect(await w.limits.remaining()).toBe(PER_HOUR - 1);
    expect(w.wow.files.get(join(era.dir, 'WTF/Account/ACC/SavedVariables/SpokenContributions.lua'))).toEqual(['e1']);
  });

  it('volle Stunde: Testlauf sagt „würde“ mit Hinweis, echter Lauf „bleiben vorerst liegen“', async () => {
    const w = await world();
    const era = w.wow.flavor('_classic_era_', 'Classic Era');
    w.wow.files.set(join(era.dir, 'WTF/Account/ACC/SavedVariables/SpokenContributions.lua'), ['e1']);
    const stamp = new Date(Date.now() - 30 * 60_000);
    await w.limits.save(Array.from({ length: PER_HOUR }, () => stamp));
    const free = new Date(Math.floor(stamp.getTime() / 1000) * 1000 + 3_600_000);
    const hhmm = `${String(free.getHours()).padStart(2, '0')}:${String(free.getMinutes()).padStart(2, '0')}`;
    const note = `  Upload-Grenze erreicht (10 pro Stunde) – wieder möglich ab ${hhmm} Uhr.`;
    let report = await w.run(null, true);
    expect(report.sections[1]).toBe(`Gesammelte Zeilen: würde 1 Quest- und Gesprächszeilen senden (1 aus Classic Era).\n  Titel e1\n${note}`);
    expect(report.head).toBe('Testlauf – nichts gesendet, gelöscht oder archiviert.');
    report = await w.run(null);
    expect(report.sections[1]).toBe(`Gesammelte Zeilen: 1 Quest- und Gesprächszeilen bleiben vorerst liegen (1 aus Classic Era).\n  Titel e1\n${note}`);
    expect(report.failed).toBe(true);
    expect(w.server.calls).toEqual([]);
    const overview = await w.uploader.overview(w.wow.root);
    expect(overview).toEqual({ flavors: ['Classic Era'], running: [], lines: 1, texts: 0, uploadsLeft: 0, freeAt: hhmm });
  });

  it('mehr als 10 Uploads nötig: auch im Testlauf failed, Text wörtlich', async () => {
    const w = await world({ maxEnvelopes: 1 });
    const era = w.wow.flavor('_classic_era_', 'Classic Era');
    w.wow.files.set(join(era.dir, 'WTF/Account/ACC/SavedVariables/SpokenContributions.lua'), Array.from({ length: 11 }, (_, i) => `e${i}`));
    const report = await w.run(null, true);
    expect(report.failed).toBe(true);
    expect(report.sections[1]).toBe([
      'Gesammelte Zeilen: 11 Quest- und Gesprächszeilen bleiben liegen (11 aus Classic Era).',
      'Titel e0, Titel e1, Titel e2, Titel e3, Titel e4, Titel e5, Titel e6, Titel e7, Titel e8, Titel e9 und 1 weitere',
      'Mehr als 1 Zeilen in einer Datei – sie gehen in 11 Uploads.',
      'Das wären 11 Uploads, der Server nimmt aber höchstens 10 pro Stunde an – so lässt sich die Datei nicht hochladen. Sie bleibt unverändert.',
    ].join('\n  '));
  });

  it('Testlauf NPC: „würde … senden“ mit Anmeldehinweis, ohne Login und ohne Löschen', async () => {
    const w = await world();
    const era = w.wow.flavor('_classic_era_', 'Classic Era');
    const file = await w.cache(era, 'deDE', [[1, [row(1, 'a'), row(2, 'x'.repeat(4001))]]]);
    const report = await w.run(null, true);
    expect(report.sections[2]).toBe('NPC-Texte (Classic Era, deDE): würde 1 Texte senden. Anmeldung fehlt noch.\n' +
      '  1 zu lang (über 4000 Zeichen), vom Server nicht annehmbar – sie stehen im Archiv.');
    expect(w.server.calls).toEqual([]);
    expect(w.history.records).toEqual([]);
    expect(await exists(file)).toBe(true);
    expect(await exists(w.limits.file)).toBe(false);
  });

  it('Läufe ohne Spoken, unbekannte und nur laufende Versionen', async () => {
    const w = await world();
    let report = await w.run();
    expect(report).toEqual({ head: 'Keine WoW-Version mit Spoken gefunden.', sections: [`Gesucht in: ${w.wow.root}`], failed: true });
    w.wow.flavor('_classic_era_', 'Classic Era');
    w.state.running = null;
    report = await w.run();
    expect(report).toEqual({ head: 'WoW läuft noch.', sections: ['Welche Version, ist nicht zu erkennen – bitte das Spiel erst komplett beenden.'], failed: true });
    w.state.running = new Set(['_classic_era_']);
    report = await w.run();
    expect(report).toEqual({
      head: 'WoW läuft noch.',
      sections: ['Bitte das Spiel erst komplett beenden: WoW schreibt die Dateien erst beim Ausloggen und würde die geleerte Liste sonst wieder überschreiben.'],
      failed: true,
    });
    w.wow.flavor('_Forever_', 'WoW Forever');
    report = await w.run();
    expect(report.sections.slice(0, 2)).toEqual([
      'Geprüft: WoW Forever',
      'Classic Era: übersprungen, läuft gerade – beim nächsten Mal nach dem Beenden dabei.',
    ]);
    expect(report.head).toBe('Nichts Neues zum Hochladen.');
  });

  it('unerwarteter Fehler in einem Teil verschluckt den anderen nicht', async () => {
    const w = await world();
    const era = w.wow.flavor('_classic_era_', 'Classic Era');
    await w.cache(era, 'deDE', [[1, [row(1, 'a')]]]);
    w.wow.collectContributions = () => Promise.reject(new TypeError('kaputt'));
    const report = await w.run();
    expect(report.sections[1]).toBe('Gesammelte Zeilen: unerwarteter Fehler (TypeError: kaputt).\n' +
      '  Nichts gelöscht, beim nächsten Mal wird es erneut versucht.');
    expect(report.sections[2]).toBe('NPC-Texte (Classic Era, deDE): 1 gesendet, 1 neu, 0 aktualisiert. Cache gelöscht.');
    expect(w.history.records[0]?.info).toEqual({ status: 'fehler', versionen: ['Classic Era'], fehler: 'Gesammelte Zeilen: unerwarteter Fehler (TypeError: kaputt).' });
    expect(w.history.records[0]?.kind).toBe('zeilen');
  });

  it('nicht angemeldet / kein Passwort: Texte wörtlich', async () => {
    const w = await world();
    const era = w.wow.flavor('_classic_era_', 'Classic Era');
    await w.cache(era, 'deDE', [[1, [row(1, 'a')]]]);
    expect((await w.run(null)).sections[2]).toBe('NPC-Texte: nicht angemeldet – bitte im Fenster unter „Konto“ anmelden.\n' +
      '  Die Texte bleiben bis dahin im Spiel-Cache.');
    expect((await w.run({ email: 'a@b.c', password: null })).sections[2]).toBe(
      'NPC-Texte: das Passwort war nicht aus dem Schlüsselbund zu holen (gesperrt oder abgelehnt?).\n' +
      '  Bitte entsperren oder im Fenster ab- und neu anmelden; die Texte bleiben bis dahin im Spiel-Cache.');
    expect(w.server.calls).toEqual([]);
  });
});

describe('Passwort-Hygiene', () => {
  it('Anmeldefehler aller Art: Passwort weder im Bericht, im Verlauf, im Fortschritt noch im Logger', async () => {
    const failures: PlannedFailure[] = [{ status: 401 }, { status: 500, body: { error: 'x' } }, { network: 'ECONNRESET' }, { status: 200, body: [] }];
    for (const failure of failures) {
      const w = await world();
      const era = w.wow.flavor('_classic_era_', 'Classic Era');
      await w.cache(era, 'deDE', [[1, [row(1, 'a')]]]);
      w.server.fail.set('/api/auth/sign-in/email', [failure]);
      const report = await w.run();
      expect(report.failed).toBe(true);
      const everything = JSON.stringify({ report, records: w.history.records, logs: w.logs, progress: w.progress });
      expect(everything).not.toContain(PASSWORD);
    }
  });

  it('Login-401 beim Upload: eigener Text', async () => {
    const w = await world();
    const era = w.wow.flavor('_classic_era_', 'Classic Era');
    await w.cache(era, 'deDE', [[1, [row(1, 'a')]]]);
    w.server.fail.set('/api/auth/sign-in/email', [{ status: 401 }]);
    const report = await w.run();
    expect(report.sections[2]).toBe('NPC-Texte: Anmeldung abgelehnt – E-Mail oder Passwort stimmen nicht mehr. ' +
      'Bitte im Fenster ab- und neu anmelden.\n  Nichts gelöscht, beim nächsten Mal wird es erneut versucht.');
    expect(w.history.records[0]?.info).toEqual({ status: 'fehler', versionen: ['Classic Era'], fehler: 'NPC-Texte: Anmeldung abgelehnt – E-Mail oder Passwort stimmen nicht mehr. Bitte im Fenster ab- und neu anmelden.' });
  });
});
