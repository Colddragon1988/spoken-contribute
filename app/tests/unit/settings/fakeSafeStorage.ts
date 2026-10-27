import type { SafeStorageLike } from '../../../src/shared/types';

const MAGIC = [0x76, 0x31, 0x30]; // "v10" wie Chromium, damit der Inhalt nach Verschlüsselung aussieht

/**
 * Vorgetäuschtes Electron-safeStorage (Regel 1: nie das echte). „Verschlüsselt“ per XOR, damit das
 * Passwort im Klartext nicht in der Datei steht. backend = null: getSelectedStorageBackend fehlt
 * (wie unter Windows/macOS).
 */
export class FakeSafeStorage implements SafeStorageLike {
  encryptionAvailable = true;
  /** Entschlüsseln scheitert (z. B. anderer Rechner, gesperrter Schlüsselbund) */
  locked = false;
  decryptCalls = 0;
  getSelectedStorageBackend?: () => string;

  constructor(backend: string | null = 'gnome_libsecret') {
    if (backend !== null) this.getSelectedStorageBackend = () => backend;
  }

  isEncryptionAvailable(): boolean {
    return this.encryptionAvailable;
  }

  encryptString(plainText: string): Uint8Array {
    if (!this.encryptionAvailable) throw new Error('Encryption is not available.');
    const bytes = Buffer.from(plainText, 'utf8').map((b) => b ^ 0x5a);
    return Uint8Array.from([...MAGIC, ...bytes]);
  }

  decryptString(encrypted: Uint8Array): string {
    this.decryptCalls += 1;
    if (this.locked) throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.');
    if (encrypted.length < MAGIC.length || MAGIC.some((b, i) => encrypted[i] !== b)) {
      throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.');
    }
    return Buffer.from(encrypted.subarray(MAGIC.length).map((b) => b ^ 0x5a)).toString('utf8');
  }
}
