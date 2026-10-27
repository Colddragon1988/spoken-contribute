import type { SecretBackend, SecretStore } from '../../src/shared/types';

/** Synchrones Ergebnis als Promise; Fehler werden zur Ablehnung. */
function settle<T>(work: () => T): Promise<T> {
  try {
    return Promise.resolve(work());
  } catch (err) {
    return Promise.reject(err instanceof Error ? err : new Error(String(err)));
  }
}

/** Vorgetäuschter Schlüsselbund. kind 'none' = keiner vorhanden (Standard wie die Python-Sandbox). */
export class FakeKeyring implements SecretStore {
  readonly store = new Map<string, string>();
  locked = false;
  /** meldet Erfolg, speichert aber nichts (Verifikationstest) */
  forgetful = false;

  constructor(public kind: SecretBackend = 'none') {}

  available(): boolean {
    return this.kind === 'system';
  }

  backend(): SecretBackend {
    return this.kind;
  }

  private check(): void {
    if (this.locked) throw new Error('Schlüsselbund gesperrt');
  }

  get(account: string): Promise<string | null> {
    return settle(() => {
      this.check();
      return this.store.get(account) ?? null;
    });
  }

  set(account: string, password: string): Promise<void> {
    return settle(() => {
      this.check();
      if (!this.forgetful) this.store.set(account, password);
    });
  }

  delete(account: string): Promise<void> {
    return settle(() => {
      this.check();
      if (!this.store.delete(account)) throw new Error(`kein Eintrag für ${account}`);
    });
  }
}
