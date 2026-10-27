// Portiert aus tests/test_upload.py::RateLimit – die lokale Zählung der Upload-Grenze.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import { createLimits, PER_HOUR } from '../../../src/core/upload/limits';
import { reportText } from '../../../src/core/upload';
import { contributionsLua, envelope } from '../../helpers/fixtures';
import { useSandbox } from '../../helpers/sandbox';
import type { Sandbox } from '../../helpers/sandbox';

const BATCH = '/api/contributions/batch';
const quiet = (): void => undefined;

async function setUp(): Promise<{ sb: Sandbox; lua: string }> {
  const sb = await useSandbox();
  const lua = await sb.lua(await sb.flavor());
  await writeFile(lua, contributionsLua([envelope(1)]));
  return { sb, lua };
}

const limitsOf = (sb: Sandbox) => createLimits({ dataDir: sb.dataDir, clock: sb.clock });

describe('RateLimit', () => {
  it('test_uploads_are_counted', async () => {
    const { sb } = await setUp();
    await sb.core.uploader.run(sb.wow, null, { test: false, log: quiet });
    expect(await limitsOf(sb).remaining()).toBe(PER_HOUR - 1);
  });

  it('test_full_hour_blocks_without_asking_the_server', async () => {
    const { sb, lua } = await setUp();
    const limits = limitsOf(sb);
    for (let i = 0; i < PER_HOUR; i++) await limits.noteUpload();
    const report = await sb.core.uploader.run(sb.wow, null, { test: false, log: quiet });
    expect(report.failed).toBe(true);
    expect(reportText(report)).toContain('Upload-Grenze erreicht');
    expect(sb.server.calls).toEqual([]);
    expect(await sb.core.wowData.envelopesIn(lua)).toEqual([envelope(1)]);
    expect(await limits.freeAt()).not.toBeNull();
  });

  it('test_429_marks_the_hour_as_full', async () => {
    const { sb } = await setUp();
    sb.server.fail.set(BATCH, [{ status: 429 }]);
    await sb.core.uploader.run(sb.wow, null, { test: false, log: quiet });
    expect(await limitsOf(sb).remaining()).toBe(0);
  });

  it('test_old_uploads_expire', async () => {
    // reine Limits-Rechnung: eigener Temp-Ordner statt Sandbox
    const dataDir = await mkdtemp(join(tmpdir(), 'spoken-limits-'));
    onTestFinished(() => rm(dataDir, { recursive: true, force: true }));
    const limits = createLimits({ dataDir, clock: { now: () => new Date() } });
    const old = new Date(Date.now() - 2 * 3_600_000);
    await limits.save(Array.from({ length: PER_HOUR }, () => old));
    expect(await limits.remaining()).toBe(PER_HOUR);
  });
});
