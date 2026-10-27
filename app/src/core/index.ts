import type { Core, CoreEnv } from '../shared/types';
import { createHistoryStore, createHistoryViews } from './history';
import { createLoginStore, createSettingsStore } from './settings';
import { createUploader } from './upload';
import { createWowData } from './wowdata';

/** Verdrahtet den Kern. Einziger Ort, an dem die Pakete (b)–(e) zusammenkommen. */
export function createCore(env: CoreEnv): Core {
  const wowData = createWowData();
  const history = createHistoryStore({ dataDir: env.paths.dataDir, clock: env.clock, wowData });
  const historyViews = createHistoryViews({ store: history, wowData, clock: env.clock });
  const settings = createSettingsStore({ configDir: env.paths.configDir, findWow: () => env.wow.findWow() });
  const login = createLoginStore({ configDir: env.paths.configDir, secrets: env.secrets });
  const uploader = createUploader({ env, wowData, history });
  return { env, wowData, history, historyViews, settings, login, uploader };
}
