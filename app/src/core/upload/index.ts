// Paket (c): Server-Client, Upload-Ablauf, Limits.
import { createUploaderWith } from './run';
import type { CoreEnv, HistoryStore, Uploader, WowData } from '../../shared/types';

export { createFetchTransport } from './fetchTransport';
export { createSiteFactory } from './site';
export { reportText } from './run';

export function createUploader(deps: { env: CoreEnv; wowData: WowData; history: HistoryStore }): Uploader {
  return createUploaderWith(deps);
}
