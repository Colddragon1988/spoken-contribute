/**
 * Upload im Fensterbetrieb (rein, getestet): nur einer zur Zeit, Ereignisse an das Hauptfenster,
 * automatischer Upload 300 ms nach dem Öffnen (gui.py start_upload/upload_done).
 */
import { errRepr } from '../core/errors';
import type { UploadEvent } from '../shared/ipc';
import { AUTO_UPLOAD_DELAY_MS, type ProgressLog, type Report } from '../shared/types';

export interface UploadControllerDeps {
  /** ein Durchgang; holt Ordner und Zugangsdaten selbst (erst jetzt: der Schlüsselbund kann nachfragen) */
  run(test: boolean, log: ProgressLog): Promise<Report>;
  /** Ereignis an das Hauptfenster */
  emit(event: UploadEvent): void;
  /** nach jedem Durchgang (Verlauf neu laden) */
  finished?(report: Report): void;
  /** für Tests mit vorgetäuschter Zeit */
  readonly setTimer?: (callback: () => void, ms: number) => void;
}

export interface UploadController {
  running(): boolean;
  /** null = es lief schon einer; sonst der Bericht (auch bei unerwartetem Fehler) */
  start(test: boolean): Promise<Report | null>;
  /** echter Upload nach AUTO_UPLOAD_DELAY_MS (nur im Fenster und nur bei auto_upload) */
  scheduleAutoUpload(): void;
}

/** Bericht für einen Programmfehler während des Durchgangs (§7.2). */
export function unexpectedReport(err: unknown): Report {
  return {
    head: 'Unerwarteter Fehler.',
    sections: [errRepr(err), 'Was nicht hochgeladen wurde, bleibt liegen und geht beim nächsten Mal mit.'],
    failed: true,
  };
}

export function createUploadController(deps: UploadControllerDeps): UploadController {
  let busy = false;
  const setTimer = deps.setTimer ?? ((callback: () => void, ms: number) => { setTimeout(callback, ms); });

  async function start(test: boolean): Promise<Report | null> {
    if (busy) return null;
    busy = true;
    let report: Report;
    try {
      deps.emit({ type: 'gestartet', test });
      report = await deps.run(test, (line) => { deps.emit({ type: 'fortschritt', line }); });
    } catch (err) {
      report = unexpectedReport(err);
    } finally {
      busy = false; // vor „fertig“: der Renderer fragt danach womöglich gleich den Zustand ab
    }
    deps.emit({ type: 'fertig', report });
    deps.finished?.(report);
    return report;
  }

  return {
    running: () => busy,
    start,
    scheduleAutoUpload() {
      setTimer(() => { void start(false); }, AUTO_UPLOAD_DELAY_MS);
    },
  };
}
