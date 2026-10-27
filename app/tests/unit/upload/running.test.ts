// Portiert aus tests/test_upload.py::RunningGame – laufende WoW-Versionen werden übersprungen.
import { writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { reportText } from '../../../src/core/upload';
import { contributionsLua, envelope } from '../../helpers/fixtures';
import { useSandbox } from '../../helpers/sandbox';
import type { Sandbox } from '../../helpers/sandbox';

const quiet = (): void => undefined;

async function setUp(): Promise<{ sb: Sandbox; era: string; forever: string }> {
  const sb = await useSandbox();
  const era = await sb.flavor('_classic_era_');
  const forever = await sb.flavor('_forever_');
  await writeFile(await sb.lua(era), contributionsLua([envelope(1)]));
  await writeFile(await sb.lua(forever), contributionsLua([envelope(2), envelope(3)]));
  return { sb, era, forever };
}

describe('RunningGame', () => {
  it('test_running_version_is_skipped', async () => {
    const { sb, era } = await setUp();
    sb.running = new Set(['_classic_era_']);
    const report = await sb.core.uploader.run(sb.wow, null, { test: false, log: quiet });
    expect(reportText(report)).toContain('Classic Era: übersprungen');
    expect(sb.server.calls[0]?.payload.envelopes).toEqual([envelope(2), envelope(3)]);
    expect(await sb.core.wowData.envelopesIn(await sb.lua(era))).toEqual([envelope(1)]);
  });

  it('test_unknown_running_version_stops', async () => {
    const { sb } = await setUp();
    sb.running = null;
    expect((await sb.core.uploader.run(sb.wow, null, { test: false, log: quiet })).failed).toBe(true);
    expect(sb.server.calls).toEqual([]);
  });

  it('test_overview_leaves_out_running_versions', async () => {
    const { sb } = await setUp();
    sb.running = new Set(['_classic_era_']);
    const overview = await sb.core.uploader.overview(sb.wow);
    expect(overview.lines).toBe(2);
    expect(overview.flavors).toHaveLength(2);
    expect(overview.running).toEqual(['Classic Era']);
  });
});
