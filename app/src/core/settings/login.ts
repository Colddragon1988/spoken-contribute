/**
 * Anmeldung bei spoken.rusty.one (§6.6). Die E-Mail-Adresse steht immer in login.json; das Passwort
 * im Schlüsselbund (SecretStore), wenn es einen benutzbaren gibt, sonst ebenfalls in login.json, die nur
 * der Benutzer lesen darf. „Abmelden“ löscht beides.
 *
 * Grundsatz: Das Passwort steht immer an mindestens einer Stelle. Aus login.json verschwindet es erst,
 * wenn es nachweislich im Schlüsselbund steht (wieder ausgelesen und verglichen).
 *
 * Das Passwort taucht in keiner Fehlermeldung auf: Fehler des Schlüsselbunds werden geschluckt, Fehler
 * beim Schreiben von login.json sind Dateifehler (Pfad, nicht Inhalt).
 */
import { join } from 'node:path';
import type { AccountView, Credentials, JsonObject, LoginStore, SecretStore } from '../../shared/types';
import { FILES } from '../../shared/types';
import { readJsonObject, writeFileAtomic } from '../fsutil';
import { compactJson, unlinkIfExists } from './compact';

export function createLoginStore(deps: { configDir: string; secrets: SecretStore }): LoginStore {
  const file = join(deps.configDir, FILES.login);
  const ring = deps.secrets;

  const readLogin = async (): Promise<JsonObject> => (await readJsonObject(file)) ?? {};

  const emailIn = (login: JsonObject): string | null => {
    const email = login.email;
    return typeof email === 'string' && email ? email : null;
  };

  const passwordIn = (login: JsonObject): string | null => {
    const password = login.password;
    return typeof password === 'string' && password ? password : null;
  };

  const account = async (): Promise<string | null> => emailIn(await readLogin());

  const passwordInKeyring = async (): Promise<boolean> => {
    const login = await readLogin();
    return emailIn(login) !== null && passwordIn(login) === null;
  };

  /** Ohne benutzbaren Schlüsselbund (wie Python priority 0) wird er gar nicht angesprochen. */
  const keyringGet = async (email: string): Promise<string | null> => {
    if (!ring.available()) return null;
    try {
      return await ring.get(email);
    } catch {
      return null; // gesperrt, abgelehnt oder nicht entschlüsselbar
    }
  };

  /** Passwort in den Schlüsselbund schreiben; true nur, wenn es nachweislich dort steht. */
  const keyringSet = async (email: string, password: string): Promise<boolean> => {
    if (!ring.available()) return false;
    try {
      await ring.set(email, password);
      return (await ring.get(email)) === password;
    } catch {
      return false;
    }
  };

  /** Eintrag aus dem Schlüsselbund löschen; true, wenn danach nachweislich keiner mehr da ist. */
  const keyringDelete = async (email: string): Promise<boolean> => {
    if (!ring.available()) return false;
    try {
      await ring.delete(email);
    } catch {
      // gab es nicht – oder der Schlüsselbund ist gesperrt; das klärt die Probe
    }
    try {
      return (await ring.get(email)) === null;
    } catch {
      return false;
    }
  };

  /** login.json im Python-Kompaktstil, 0600, Ordner beim Anlegen 0700, atomar. */
  const writeLogin = (email: string, password: string | null): Promise<void> => {
    const pairs: [string, string][] = [['email', email]];
    if (password) pairs.push(['password', password]);
    return writeFileAtomic(file, compactJson(pairs), { private: true });
  };

  return {
    account,
    passwordInKeyring,

    /** Was die Konto-Anzeige braucht (Entscheidung 12): Steht das Passwort nicht in der Datei, wird
     * tatsächlich nachgesehen, ob der Schlüsselbund es herausgibt – kann eine Entsperr-Abfrage auslösen. */
    async accountView(): Promise<AccountView> {
      const backend = ring.backend();
      const login = await readLogin();
      const email = emailIn(login);
      if (email === null) return { email: null, place: null, backend };
      if (passwordIn(login) !== null) return { email, place: 'datei', backend };
      const password = await keyringGet(email);
      return { email, place: password !== null ? 'schluesselbund' : 'unlesbar', backend };
    },

    /** {email, password} der Anmeldung, null wenn nicht angemeldet. password ist null, wenn der
     * Schlüsselbund es nicht herausgibt. Kann eine Entsperr-Abfrage auslösen. */
    async credentials(): Promise<Credentials | null> {
      const login = await readLogin();
      const email = emailIn(login);
      if (email === null) return null;
      const password = passwordIn(login) ?? (await keyringGet(email));
      return { email, password };
    },

    /** Anmeldung speichern; das Passwort möglichst im Schlüsselbund, sonst in login.json.
     * Die bisherige Anmeldung wird erst ersetzt, wenn die neue sicher steht. */
    async saveLogin(email, password) {
      const previous = await account();
      // passwort.safestorage hat nur einen Platz: Beim Kontowechsel das alte Passwort merken, damit es
      // zurückgeschrieben werden kann, falls login.json danach nicht geschrieben werden kann.
      const previousPassword = previous && previous !== email ? await keyringGet(previous) : null;
      if (await keyringSet(email, password)) {
        try {
          await writeLogin(email, null);
        } catch (err) {
          if (previous && previousPassword !== null) await keyringSet(previous, previousPassword);
          throw err;
        }
      } else {
        await writeLogin(email, password);
      }
      if (previous && previous !== email) {
        await keyringDelete(previous); // das Passwort des alten Kontos nicht herumliegen lassen
      }
    },

    /** Ein Passwort, das noch in login.json steht (frühere Fassung oder damals kein Schlüsselbund),
     * in den Schlüsselbund umziehen – sobald es einen gibt. Scheitert das Schreiben von login.json,
     * wird der Fehler weitergeworfen; das Passwort steht dann eben an beiden Stellen. */
    async movePasswordToKeyring() {
      const login = await readLogin();
      const email = emailIn(login);
      const password = passwordIn(login);
      if (email && password && (await keyringSet(email, password))) {
        await writeLogin(email, null);
      }
    },

    /** Abmelden: login.json und den Eintrag im Schlüsselbund löschen. false, wenn das Passwort
     * womöglich im Schlüsselbund zurückbleibt (gesperrt oder nicht erreichbar) – abgemeldet ist der
     * Nutzer trotzdem, login.json ist dann schon weg. */
    async deleteLogin() {
      const email = await account();
      if (!email) {
        await unlinkIfExists(file);
        return true;
      }
      const inKeyring = await passwordInKeyring();
      const removed = await keyringDelete(email); // auch sonst versuchen: ein Rest von früher wäre möglich
      await unlinkIfExists(file);
      return removed || !inKeyring;
    },
  };
}
