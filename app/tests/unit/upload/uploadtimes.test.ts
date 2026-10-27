// Portiert aus tests/test_upload.py::UploadTimes – die Datei upload-zeiten.json und die Rechnung,
// ab wann wieder ein Upload geht. Läuft nur gegen einen eigenen Temp-Ordner.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import { createLimits, PER_HOUR } from '../../../src/core/upload/limits';
import type { Limits } from '../../../src/core/upload/limits';
import { formatClock, formatIsoLocal } from '../../../src/core/time';

async function setUp(): Promise<{ limits: Limits; write: (content: unknown) => Promise<void> }> {
  const dataDir = await mkdtemp(join(tmpdir(), 'spoken-limits-'));
  onTestFinished(() => rm(dataDir, { recursive: true, force: true }));
  const limits = createLimits({ dataDir, clock: { now: () => new Date() } });
  const write = (content: unknown): Promise<void> =>
    writeFile(limits.file, typeof content === 'string' ? content : JSON.stringify(content), 'utf8');
  return { limits, write };
}

const minutes = (n: number): number => n * 60_000;

describe('UploadTimes', () => {
  it('test_broken_entries_are_skipped', async () => {
    const { limits, write } = await setUp();
    const recent = formatIsoLocal(new Date(Date.now() - minutes(5)));
    const cases: [unknown, number][] = [
      ['kaputt', 0], ['{}', 0], ['[1, null]', 0],
      [['2026-10-25T10:00:00'], 0], // ohne Zeitzone
      [['kein Datum', recent], 1],
    ];
    for (const [content, counted] of cases) {
      await write(content);
      expect(await limits.remaining(), JSON.stringify(content)).toBe(PER_HOUR - counted);
    }
  });

  it('test_times_in_the_future_do_not_block', async () => {
    // Wurde die Uhr zurückgestellt, sperrten sie sonst weit länger als eine Stunde.
    const { limits } = await setUp();
    const future = new Date(Date.now() + 24 * 3_600_000);
    await limits.save(Array.from({ length: PER_HOUR }, () => future));
    expect(await limits.remaining()).toBe(PER_HOUR);
  });

  it('test_free_at_counts_from_the_oldest_uploads', async () => {
    const { limits } = await setUp();
    const now = Date.now();
    const stamps = Array.from({ length: PER_HOUR }, (_, i) => new Date(now - minutes(50 - i)));
    await limits.save(stamps);
    const secondsOf = (d: Date): number => Math.floor(d.getTime() / 1000) * 1000;
    const expected = (i: number): number => secondsOf(stamps[i] ?? new Date(0)) + 3_600_000;
    const at = async (needed: number): Promise<number> => (await limits.freeAt(needed))?.getTime() ?? Number.NaN;
    expect(Math.abs((await at(1)) - expected(0))).toBeLessThanOrEqual(1000);
    expect(Math.abs((await at(3)) - expected(2))).toBeLessThanOrEqual(1000);
  });

  it('test_free_at_with_more_than_an_hour_of_uploads', async () => {
    const { limits } = await setUp();
    await limits.save([new Date(), new Date()]);
    expect(await limits.freeAt(PER_HOUR + 5)).not.toBeNull();
    await limits.save([]);
    expect(await limits.freeAt(PER_HOUR + 5)).toBeNull();
  });

  it('test_free_at_is_in_local_time', async () => {
    // Gespeichert mit anderer Zeitzone (Reise, Sommerzeit): angezeigt wird Ortszeit.
    const { limits, write } = await setUp();
    const stamp = new Date(Date.now() - minutes(10));
    // derselbe Zeitpunkt in +09:00 geschrieben
    const shifted = new Date(stamp.getTime() + 9 * 3_600_000);
    const p2 = (n: number): string => String(n).padStart(2, '0');
    const elsewhere = `${shifted.getUTCFullYear()}-${p2(shifted.getUTCMonth() + 1)}-${p2(shifted.getUTCDate())}T` +
      `${p2(shifted.getUTCHours())}:${p2(shifted.getUTCMinutes())}:${p2(shifted.getUTCSeconds())}+09:00`;
    await write(Array.from({ length: PER_HOUR }, () => elsewhere));
    const freeAt = await limits.freeAt();
    expect(freeAt).not.toBeNull();
    const expected = new Date(Math.floor(stamp.getTime() / 1000) * 1000 + 3_600_000);
    expect(freeAt?.getTime()).toBe(expected.getTime());
    // „wieder ab HH:MM Uhr“ zeigt die Ortszeit (TZ=Europe/Berlin), nicht die Uhrzeit in +09:00
    expect(formatClock(freeAt ?? new Date(0))).toBe(`${p2(expected.getHours())}:${p2(expected.getMinutes())}`);
    // neu geschrieben wird mit lokalem Offset
    await limits.noteUpload();
    const saved = JSON.parse(await readFile(limits.file, 'utf8')) as string[];
    expect(saved.every((s) => /[+-]0[12]:00$/.test(s))).toBe(true);
  });
});
