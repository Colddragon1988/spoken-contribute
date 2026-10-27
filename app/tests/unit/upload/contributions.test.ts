// Portiert aus tests/test_upload.py::Contributions – ganze Upload-Durchgänge gegen einen vorgetäuschten Server.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createUploaderWith } from '../../../src/core/upload/run';
import type { HistoryStore } from '../../../src/shared/types';
import { contributionsLua, envelope } from '../../helpers/fixtures';
import { useSandbox } from '../../helpers/sandbox';
import type { Sandbox } from '../../helpers/sandbox';
import { reportText } from '../../../src/core/upload';

const BATCH = '/api/contributions/batch';
const quiet = (): void => undefined;

async function setUp(): Promise<{ sb: Sandbox; lua: string }> {
  const sb = await useSandbox();
  const lua = await sb.lua(await sb.flavor());
  return { sb, lua };
}

const runUpload = (sb: Sandbox, test = false) => sb.core.uploader.run(sb.wow, sb.credentials, { test, log: quiet });

describe('Contributions', () => {
  it('test_success_sends_archives_and_clears', async () => {
    const { sb, lua } = await setUp();
    const envelopes = [0, 1, 2].map((i) => envelope(i));
    await writeFile(lua, contributionsLua(envelopes));
    const report = await runUpload(sb);
    expect(report.failed, reportText(report)).toBe(false);
    expect(sb.server.calls.map((c) => c.path)).toEqual([BATCH]);
    expect(sb.server.calls[0]?.payload.envelopes).toEqual(envelopes);
    expect(await sb.core.wowData.envelopesIn(lua)).toEqual([]);
    const entries = await sb.core.history.entries();
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    if (!entry) throw new Error('kein Eintrag');
    const payload = await sb.core.history.payload(entry);
    expect((payload?.gesendet as { envelopes: unknown }).envelopes).toEqual(envelopes);
    expect(entry.info.ergebnis).toEqual({ neu: 2, bekannt: 1, abgelehnt: 0 });
    const original = join(sb.core.history.root, entry.id, 'originale', 'classic_era', 'ACC', 'SpokenContributions.lua');
    expect(await sb.core.wowData.envelopesIn(original)).toEqual(envelopes);
    expect((await runUpload(sb)).head).toBe('Nichts Neues zum Hochladen.');
  });

  it('test_server_error_keeps_everything', async () => {
    const { sb, lua } = await setUp();
    await writeFile(lua, contributionsLua([envelope(1)]));
    sb.server.fail.set(BATCH, [{ status: 500 }]);
    const report = await runUpload(sb);
    expect(report.failed).toBe(true);
    expect(reportText(report)).toContain('Gesammelte Zeilen: Server-Fehler 500.');
    expect(await sb.core.wowData.envelopesIn(lua)).toEqual([envelope(1)]);
    expect((await sb.core.history.entries())[0]?.failed).toBe(true);
  });

  it('test_more_than_2000_lines_go_in_several_uploads', async () => {
    const { sb, lua } = await setUp();
    const range = (from: number, to: number): string[] => Array.from({ length: to - from }, (_, i) => envelope(from + i));
    await writeFile(lua, contributionsLua(range(0, 1500)));
    await writeFile(`${lua}.bak`, contributionsLua(range(1000, 2500)));
    const report = await runUpload(sb);
    expect(report.failed, reportText(report)).toBe(false);
    expect(sb.server.calls.map((c) => (c.payload.envelopes as unknown[]).length)).toEqual([2000, 500]);
    expect(await sb.core.wowData.envelopesIn(lua)).toEqual([]);
  });

  it('test_failure_in_second_upload_clears_nothing', async () => {
    const { sb, lua } = await setUp();
    await writeFile(lua, contributionsLua(Array.from({ length: 2500 }, (_, i) => envelope(i))));
    sb.server.fail.set(BATCH, [null, { status: 502 }]);
    expect((await runUpload(sb)).failed).toBe(true);
    expect(await sb.core.wowData.envelopesIn(lua)).toHaveLength(2500);
  });

  it('test_lines_added_during_upload_are_kept', async () => {
    const { sb, lua } = await setUp();
    await writeFile(lua, contributionsLua([envelope(1)]));
    sb.server.onPost = async (path) => {
      if (path === BATCH) await writeFile(lua, contributionsLua([envelope(1), envelope(2)]));
    };
    const report = await runUpload(sb);
    expect(reportText(report)).toContain('verändert');
    expect(await sb.core.wowData.envelopesIn(lua)).toHaveLength(2);
  });

  it('test_file_needing_more_uploads_than_an_hour_allows_stays_untouched', async () => {
    const { sb, lua } = await setUp();
    await writeFile(lua, contributionsLua(Array.from({ length: 11 }, (_, i) => envelope(i))));
    // wie mock.patch.object(upload, "MAX_ENVELOPES", 1)
    const uploader = createUploaderWith({ env: sb.env, wowData: sb.core.wowData, history: sb.core.history }, { maxEnvelopes: 1 });
    const report = await uploader.run(sb.wow, sb.credentials, { test: false, log: quiet });
    expect(report.failed).toBe(true);
    expect(reportText(report)).toContain('nicht hochladen');
    expect(sb.server.calls).toEqual([]);
    expect(await sb.core.wowData.envelopesIn(lua)).toHaveLength(11);
  });

  it('test_archive_failure_clears_nothing', async () => {
    const { sb, lua } = await setUp();
    await writeFile(lua, contributionsLua([envelope(1)]));
    // wie mock.patch.object(history, "record", side_effect=OSError("Platte voll"))
    const history: HistoryStore = {
      ...sb.core.history,
      record: () => Promise.reject(Object.assign(new Error('Platte voll'), { code: 'ENOSPC' })),
    };
    const uploader = createUploaderWith({ env: sb.env, wowData: sb.core.wowData, history });
    const report = await uploader.run(sb.wow, sb.credentials, { test: false, log: quiet });
    expect(report.failed).toBe(true);
    expect(reportText(report)).toContain('nicht archiviert');
    expect(reportText(report)).toContain('Gesammelte Zeilen: gesendet, aber nicht archiviert (Platte voll).');
    expect(await sb.core.wowData.envelopesIn(lua)).toEqual([envelope(1)]);
  });

  it('test_dry_run_changes_nothing', async () => {
    const { sb, lua } = await setUp();
    await writeFile(lua, contributionsLua([envelope(1)]));
    const before = await readFile(lua);
    const report = await runUpload(sb, true);
    expect(reportText(report)).toContain('würde');
    expect(sb.server.calls).toEqual([]);
    expect(await sb.core.history.entries()).toEqual([]);
    expect(await sb.core.wowData.envelopesIn(lua)).toEqual([envelope(1)]);
    expect(await readFile(lua)).toEqual(before);
  });
});
