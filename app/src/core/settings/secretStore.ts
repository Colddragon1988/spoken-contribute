/**
 * SecretStore über Electrons safeStorage (Entscheidung 15, V5): safeStorage verschlüsselt nur, es
 * speichert nichts. Der verschlüsselte Wert steht deshalb base64-kodiert in passwort.safestorage im
 * Konfig-Ordner, zusammen mit dem Konto: {"email": "…", "verschluesselt": "<base64>"} (0600, atomar).
 * Die Kontobindung sorgt dafür, dass „alten Eintrag beim Kontowechsel löschen“ den neuen nicht trifft.
 *
 * Unter Linux zählt nur ein echtes Backend (Secret Service oder KWallet). Bei „basic_text“ verschlüsselt
 * Chromium mit einem festen Schlüssel – dann gilt available() = false, und das Passwort liegt wie in der
 * Python-Fassung in login.json (V1).
 *
 * Fehlertexte nennen weder Passwort noch verschlüsselten Wert.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Platform, SafeStorageLike, SecretBackend, SecretStore } from '../../shared/types';
import { FILES } from '../../shared/types';
import { writeFileAtomic } from '../fsutil';
import { compactJson, isMissing, unlinkIfExists } from './compact';

/** Backends von getSelectedStorageBackend(), die einen echten Schlüsselbund bedeuten. */
const LINUX_SYSTEM_BACKENDS: ReadonlySet<string> = new Set(['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6']);

interface StoredSecret {
  readonly email: string;
  readonly encrypted: string;
}

export function createSafeStorageSecretStore(
  deps: { configDir: string; safeStorage: SafeStorageLike; platform: Platform },
): SecretStore {
  const file = join(deps.configDir, FILES.secret);
  const safe = deps.safeStorage;

  /** Linux-Backend laut Chromium; null, wenn unbekannt oder nicht abfragbar. */
  const linuxBackend = (): string | null => {
    try {
      return safe.getSelectedStorageBackend?.() ?? null;
    } catch {
      return null;
    }
  };

  const encryptionAvailable = (): boolean => {
    try {
      return safe.isEncryptionAvailable();
    } catch {
      return false;
    }
  };

  const available = (): boolean => {
    if (!encryptionAvailable()) return false;
    if (deps.platform !== 'linux') return true;
    const backend = linuxBackend();
    return backend !== null && LINUX_SYSTEM_BACKENDS.has(backend);
  };

  /** Inhalt von passwort.safestorage; null, wenn es die Datei nicht gibt. Beschädigt → Wurf. */
  const readStored = async (): Promise<StoredSecret | null> => {
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch (err) {
      if (isMissing(err)) return null;
      throw err;
    }
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`${FILES.secret} ist beschädigt.`);
    }
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      throw new Error(`${FILES.secret} ist beschädigt.`);
    }
    const { email, verschluesselt } = data as Record<string, unknown>;
    if (typeof email !== 'string' || typeof verschluesselt !== 'string') {
      throw new Error(`${FILES.secret} ist beschädigt.`);
    }
    return { email, encrypted: verschluesselt };
  };

  return {
    available,

    backend(): SecretBackend {
      if (available()) return 'system';
      return deps.platform === 'linux' && linuxBackend() === 'basic_text' ? 'basic_text' : 'none';
    },

    /** null, wenn kein Eintrag oder einer für ein anderes Konto; nicht entschlüsselbar → Wurf
     * (wie ein gesperrter Schlüsselbund). Ein fremdes Konto wird gar nicht erst entschlüsselt. */
    async get(account) {
      const stored = await readStored();
      if (stored?.email !== account) return null;
      try {
        return safe.decryptString(Buffer.from(stored.encrypted, 'base64'));
      } catch {
        throw new Error('Das Passwort ließ sich nicht entschlüsseln.');
      }
    },

    /** Ersetzt einen Eintrag für ein anderes Konto (es gibt nur eine Datei). Erfolg prüft der
     * Aufrufer per get(). */
    async set(account, password) {
      if (!available()) throw new Error('Kein Schlüsselbund verfügbar.');
      let encrypted: string;
      try {
        encrypted = Buffer.from(safe.encryptString(password)).toString('base64');
      } catch {
        throw new Error('Das Passwort ließ sich nicht verschlüsseln.');
      }
      await writeFileAtomic(file, compactJson([['email', account], ['verschluesselt', encrypted]]), { private: true });
    },

    /** Wirft wie ein Schlüsselbund, wenn es keinen Eintrag für dieses Konto gibt. */
    async delete(account) {
      const stored = await readStored();
      if (stored?.email !== account) throw new Error('Kein Eintrag für dieses Konto.');
      await unlinkIfExists(file);
    },
  };
}
