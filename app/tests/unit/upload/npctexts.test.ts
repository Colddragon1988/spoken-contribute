// Portiert aus tests/test_upload.py::NpcTexts – NPC-Texte aus dem Spiel-Cache mit Anmeldung.
import { access, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { reportText } from '../../../src/core/upload';
import { dbcache } from '../../helpers/fixtures';
import { useSandbox } from '../../helpers/sandbox';
import type { Sandbox } from '../../helpers/sandbox';

const TEXTS = '/api/broadcast-text';
const quiet = (): void => undefined;
const exists = (path: string): Promise<boolean> => access(path).then(() => true, () => false);

async function setUp(): Promise<{ sb: Sandbox; era: string; forever: string }> {
  const sb = await useSandbox();
  const era = await sb.flavor('_classic_era_');
  const forever = await sb.flavor('_forever_');
  await writeFile(await sb.cache(era), dbcache(70003, [[1, 'Hallo', ''], [2, 'x'.repeat(4001), '']]));
  await writeFile(await sb.cache(forever), dbcache(60000, [[3, 'Moin', '']]));
  return { sb, era, forever };
}

describe('NpcTexts', () => {
  it('test_success_archives_and_deletes_cache', async () => {
    const { sb, era } = await setUp();
    const report = await sb.core.uploader.run(sb.wow, sb.credentials, { test: false, log: quiet });
    expect(report.failed, reportText(report)).toBe(false);
    expect(sb.server.paths()).toEqual(['/api/auth/sign-in/email', TEXTS, TEXTS]);
    expect(await exists(await sb.cache(era))).toBe(false);
    const sent = sb.server.calls.filter((c) => c.path === TEXTS).map((c) => c.payload.texts);
    expect(sent).toEqual([[{ id: 1, text: 'Hallo', text1: '' }], [{ id: 3, text: 'Moin', text1: '' }]]);
    const entries = await sb.core.history.entries();
    const eraEntry = entries.find((e) => JSON.stringify(e.info.versionen) === JSON.stringify(['Classic Era']));
    if (!eraEntry) throw new Error('kein Eintrag für Classic Era');
    expect(eraEntry.info.zu_lang).toBe(1);
    const payload = await sb.core.history.payload(eraEntry);
    expect(payload?.nicht_gesendet).toHaveLength(1); // zu lang, aber nicht verloren
  });

  it('test_failure_in_one_version_keeps_its_cache', async () => {
    const { sb, era, forever } = await setUp();
    sb.server.fail.set(TEXTS, [null, { status: 500 }]);
    const report = await sb.core.uploader.run(sb.wow, sb.credentials, { test: false, log: quiet });
    expect(report.failed).toBe(true);
    expect(await exists(await sb.cache(era))).toBe(false);
    expect(await exists(await sb.cache(forever))).toBe(true);
  });

  it('test_not_logged_in_keeps_cache', async () => {
    const { sb, era } = await setUp();
    const report = await sb.core.uploader.run(sb.wow, null, { test: false, log: quiet });
    expect(reportText(report)).toContain('nicht angemeldet');
    expect(await exists(await sb.cache(era))).toBe(true);
  });

  it('test_password_missing_from_keyring_keeps_cache', async () => {
    const { sb, era } = await setUp();
    const report = await sb.core.uploader.run(sb.wow, { email: 'a@b.c', password: null }, { test: false, log: quiet });
    expect(reportText(report)).toContain('Schlüsselbund');
    expect(await exists(await sb.cache(era))).toBe(true);
  });

  it('test_rejected_login', async () => {
    const { sb, era } = await setUp();
    sb.server.fail.set('/api/auth/sign-in/email', [{ status: 401 }]);
    const report = await sb.core.uploader.run(sb.wow, sb.credentials, { test: false, log: quiet });
    expect(reportText(report)).toContain('ab- und neu anmelden');
    expect(await exists(await sb.cache(era))).toBe(true);
  });
});
