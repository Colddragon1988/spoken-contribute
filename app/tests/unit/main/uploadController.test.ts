// Upload im Fenster: nur einer zur Zeit, Ereignisfolge, unerwartete Fehler, Auto-Upload nach 300 ms.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUploadController, unexpectedReport } from '../../../src/main/uploadController';
import type { UploadEvent } from '../../../src/shared/ipc';
import type { ProgressLog, Report } from '../../../src/shared/types';

const REPORT: Report = { head: 'Erfolgreich hochgeladen – danke!', sections: ['Geprüft: Classic Era'], failed: false };

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

afterEach(() => { vi.useRealTimers(); });

describe('uploadController', () => {
  it('Ereignisfolge gestartet → fortschritt → fertig, dann finished', async () => {
    const events: UploadEvent[] = [];
    const finished = vi.fn();
    const controller = createUploadController({
      run: (test, log) => {
        expect(test).toBe(true);
        log('Gesammelte Zeilen: sende 2 …');
        return Promise.resolve(REPORT);
      },
      emit: (event) => { events.push(event); },
      finished,
    });
    expect(await controller.start(true)).toEqual(REPORT);
    expect(events).toEqual([
      { type: 'gestartet', test: true },
      { type: 'fortschritt', line: 'Gesammelte Zeilen: sende 2 …' },
      { type: 'fertig', report: REPORT },
    ]);
    expect(finished).toHaveBeenCalledWith(REPORT);
  });

  it('zweiter Start während des ersten → null; danach geht es wieder', async () => {
    const gate = deferred<Report>();
    const runs: boolean[] = [];
    const controller = createUploadController({
      run: (test) => { runs.push(test); return gate.promise; },
      emit: () => undefined,
    });
    const first = controller.start(false);
    expect(controller.running()).toBe(true);
    expect(await controller.start(true)).toBeNull();
    gate.resolve(REPORT);
    expect(await first).toEqual(REPORT);
    expect(controller.running()).toBe(false);
    expect(runs).toEqual([false]);
    await controller.start(true);
    expect(runs).toEqual([false, true]);
  });

  it('beim Ereignis „fertig“ läuft nichts mehr', async () => {
    let runningAtEnd: boolean | null = null;
    const controller = createUploadController({
      run: () => Promise.resolve(REPORT),
      emit: (event) => { if (event.type === 'fertig') runningAtEnd = controller.running(); },
    });
    await controller.start(false);
    expect(runningAtEnd).toBe(false);
  });

  it('unerwarteter Fehler wird zum Bericht (§7.2)', async () => {
    const events: UploadEvent[] = [];
    const controller = createUploadController({
      run: () => Promise.reject(new TypeError('kaputt')),
      emit: (event) => { events.push(event); },
    });
    const report = await controller.start(false);
    expect(report).toEqual({
      head: 'Unerwarteter Fehler.',
      sections: ['TypeError: kaputt', 'Was nicht hochgeladen wurde, bleibt liegen und geht beim nächsten Mal mit.'],
      failed: true,
    });
    expect(events.at(-1)).toEqual({ type: 'fertig', report });
    expect(controller.running()).toBe(false);
    expect(unexpectedReport('x').sections[0]).toBe('x');
  });

  it('Auto-Upload startet nach 300 ms einen echten Upload', async () => {
    vi.useFakeTimers();
    const run = vi.fn((_test: boolean, _log: ProgressLog) => Promise.resolve(REPORT));
    const controller = createUploadController({ run, emit: () => undefined });
    controller.scheduleAutoUpload();
    await vi.advanceTimersByTimeAsync(299);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]).toBe(false);
  });

  it('Auto-Upload über eingespeisten Zeitgeber', () => {
    const timers: [() => void, number][] = [];
    const run = vi.fn(() => Promise.resolve(REPORT));
    const controller = createUploadController({
      run, emit: () => undefined, setTimer: (callback, ms) => { timers.push([callback, ms]); },
    });
    controller.scheduleAutoUpload();
    expect(timers.map(([, ms]) => ms)).toEqual([300]);
    timers[0]?.[0]();
    expect(run).toHaveBeenCalledTimes(1);
  });
});
