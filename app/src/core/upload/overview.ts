// Übersicht für das Fenster (§2.9): was ein Upload jetzt senden würde – liest nur, ändert nichts.
import { formatClock } from '../time';
import { cacheJobs } from './caches';
import type { UploadContext } from './context';
import type { CoreEnv, Overview } from '../../shared/types';

export function createOverview(ctx: UploadContext, env: CoreEnv): (wow: string) => Promise<Overview> {
  return async (wow) => {
    const flavors = await ctx.wowData.spokenFlavors(wow);
    const running = await env.running();
    // Laufende Versionen überspringt der Upload, also zählen sie hier auch nicht mit.
    const idle = running === null ? [] : flavors.filter((f) => !running.has(f.folder.toLowerCase()));
    const lines = new Set<string>();
    for (const store of await ctx.wowData.collectContributions(idle)) {
      for (const e of store.envelopes) lines.add(e);
    }
    const texts = (await cacheJobs(ctx, idle)).reduce((sum, job) => sum + job.count, 0);
    const freeAt = await ctx.limits.freeAt();
    return {
      flavors: flavors.map((f) => f.name),
      running: running === null ? null : flavors.filter((f) => running.has(f.folder.toLowerCase())).map((f) => f.name),
      lines: lines.size,
      texts,
      uploadsLeft: await ctx.limits.remaining(),
      freeAt: freeAt === null ? null : formatClock(freeAt),
    };
  };
}
