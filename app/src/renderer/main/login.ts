/**
 * Anmeldedialog (Spezifikation §7.3) als modales <dialog> im Hauptfenster (V6).
 * E-Mail und Passwort gehen genau einmal an den Main (account:sign-in); der prüft bei der Website
 * und speichert erst dann. Zurück kommt nur die Konto-Anzeige, nie das Passwort.
 */
import type { AccountView } from '../../shared/types';
import { byId, setStatus } from '../common/dom';
import { signInErrorText, TEXT } from './format';

export interface LoginDialog {
  open(): void;
}

/**
 * @param signedIn nach erfolgreicher Anmeldung mit der neuen Konto-Anzeige
 * @param refresh  Konto-Anzeige neu holen (wenn der Dialog inzwischen geschlossen wurde)
 */
export function createLoginDialog(signedIn: (view: AccountView) => void, refresh: () => void): LoginDialog {
  const dialog = byId('anmelden', HTMLDialogElement);
  const email = byId('login-email', HTMLInputElement);
  const password = byId('login-passwort', HTMLInputElement);
  const reveal = byId('login-zeigen', HTMLInputElement);
  const message = byId('login-meldung', HTMLElement);
  const submitButton = byId('login-senden', HTMLButtonElement);
  let round = 0; // jedes Öffnen zählt hoch; eine Antwort zu einem früheren Öffnen gilt dem Dialog nicht mehr
  let checking = false;

  function reset(): void {
    email.value = '';
    password.value = '';
    password.type = 'password';
    reveal.checked = false;
    setStatus(message, '');
    submitButton.disabled = false;
    checking = false;
  }

  async function submit(): Promise<void> {
    if (checking) return; // die Prüfung läuft schon (Eingabetaste während des Wartens)
    const address = email.value.trim();
    const secret = password.value;
    if (!address || !secret) {
      setStatus(message, TEXT.emptyLogin, true);
      return;
    }
    checking = true;
    submitButton.disabled = true;
    setStatus(message, TEXT.checkingLogin);
    password.value = ''; // das Passwort bleibt nicht im Fenster liegen (Architektur §5.5)
    const mine = round;
    let error: string | null;
    try {
      const result = await window.spoken.signIn(address, secret);
      if (result.ok) {
        if (mine === round && dialog.open) dialog.close();
        signedIn(result.account);
        return;
      }
      error = result.message;
    } catch (err) {
      error = signInErrorText(err);
    }
    if (mine !== round || !dialog.open) {
      refresh(); // inzwischen geschlossen
      return;
    }
    checking = false;
    submitButton.disabled = false;
    setStatus(message, error, true);
    password.focus();
  }

  submitButton.addEventListener('click', () => { void submit(); });
  byId('login-abbrechen', HTMLButtonElement).addEventListener('click', () => { dialog.close(); });
  byId('login-registrieren', HTMLButtonElement).addEventListener('click', () => { void window.spoken.openRegister(); });
  reveal.addEventListener('change', () => { password.type = reveal.checked ? 'text' : 'password'; });
  dialog.addEventListener('keydown', (event) => {
    // Die Eingabetaste meldet an – außer auf einem anderen Knopf, der dann selbst auslöst.
    if (event.key !== 'Enter' || event.isComposing) return;
    if (event.target instanceof HTMLButtonElement && event.target !== submitButton) return;
    event.preventDefault();
    void submit();
  });
  // Escape schließt das <dialog> von selbst (Ereignis „cancel“).
  dialog.addEventListener('close', () => {
    round++;
    password.value = '';
  });

  return {
    open(): void {
      if (dialog.open) return;
      round++;
      reset();
      dialog.showModal();
      email.focus();
    },
  };
}
