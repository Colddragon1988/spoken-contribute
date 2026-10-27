/** Erwarteter Fehler mit fertiger Meldung für den Nutzer; status = HTTP-Code, falls einer. */
export class UploadError extends Error {
  override readonly name = 'UploadError';
  constructor(message: string, readonly status: number | null = null) {
    super(message);
  }
}

/** Verbindungs-/Timeout-Fehler des HttpTransport (wird in SiteSession zur UploadError). */
export class NetworkError extends Error {
  override readonly name = 'NetworkError';
}

/** Entspricht Pythons str(err). */
export function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Entspricht Pythons repr(err) – Entscheidung 13: String(err). */
export function errRepr(err: unknown): string {
  return String(err);
}
