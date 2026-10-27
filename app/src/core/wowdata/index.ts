// Paket (b): Was in einer WoW-Installation für Spoken liegt – welche Versionen Spoken haben, die
// gesammelten Zeilen in SpokenContributions.lua und die NPC-Texte im Spiel-Cache (DBCache.bin).
import type { WowData } from '../../shared/types';
import { newestTexts } from './adb';
import { cacheFiles, cacheFolders } from './caches';
import { clearContributions, collectContributions, envelopesIn } from './contributions';
import { parseEnvelope, summarize } from './envelope';
import { flavorName, spokenFlavors } from './flavors';

export function createWowData(): WowData {
  return {
    flavorName,
    spokenFlavors,
    envelopesIn,
    collectContributions,
    clearContributions,
    parseEnvelope,
    summarize,
    cacheFolders,
    cacheFiles,
    newestTexts,
  };
}

// zusätzlich rein exportiert, für Tests und Gegenprobe
export { parseCache } from './adb';
export { backupOf, contributionFiles, CONTRIBUTIONS } from './contributions';
export { cleared, decodeLua, envelopesInBytes, luaLiterals } from './lua';
export { decodeUtf8, decodeUtf8Text } from './utf8';
export { cacheFiles, cacheFolders, clearContributions, collectContributions, envelopesIn, flavorName, newestTexts, parseEnvelope, spokenFlavors, summarize };
