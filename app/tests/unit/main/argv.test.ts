// parseArgv (§6.2): Schalter von Chromium/Node/Playwright und der App-Pfad zählen nicht als Argumente.
import { describe, expect, it } from 'vitest';
import { appArgs, isForeignSwitch, parseArgv } from '../../../src/main/argv';

const EXE = '/opt/Spoken-Upload/spoken-upload';
const ELECTRON = '/app/node_modules/electron/dist/electron';

describe('appArgs', () => {
  it('verpackt: alles nach dem Programm', () => {
    expect(appArgs([EXE], true)).toEqual([]);
    expect(appArgs([EXE, '--test'], true)).toEqual(['--test']);
    expect(appArgs([EXE, '--ohne-fenster', '--test'], true)).toEqual(['--ohne-fenster', '--test']);
  });

  it('verpackt: ein Nicht-Schalter bleibt (er ist ein unbekanntes Argument)', () => {
    expect(appArgs([EXE, 'foo'], true)).toEqual(['foo']);
  });

  it('unverpackt: der App-Pfad fällt weg', () => {
    expect(appArgs([ELECTRON, '.'], false)).toEqual([]);
    expect(appArgs([ELECTRON, '.', '--test'], false)).toEqual(['--test']);
    expect(appArgs([ELECTRON, '/pfad/app', 'foo'], false)).toEqual(['foo']);
  });

  it('Playwright-Schalter vor dem App-Pfad', () => {
    expect(appArgs([ELECTRON, '--inspect=0', '--remote-debugging-port=0', '.', '--test'], false)).toEqual(['--test']);
  });

  it('Chromium-, Node- und macOS-Schalter werden ignoriert', () => {
    const foreign = [
      '--inspect', '--inspect-brk=9229', '--remote-debugging-port=9222', '--no-sandbox', '--enable-logging',
      '--enable-logging=stderr', '--password-store=basic', '--ozone-platform=wayland',
      '--ozone-platform-hint=auto', '--enable-features=WaylandWindowDecorations', '--disable-gpu',
      '--disable-dev-shm-usage', '-psn_0_123456',
    ];
    expect(appArgs([EXE, ...foreign, '--ohne-fenster'], true)).toEqual(['--ohne-fenster']);
    for (const arg of foreign) expect(isForeignSwitch(arg)).toBe(true);
  });

  it('second-instance: was Electron der Befehlszeile der zweiten Instanz anhängt, zählt nicht', () => {
    // So kommt argv beim ersten Fenster an (gemessen mit Electron 45 unter Linux): Electron hängt die
    // Schalter aus registerSchemesAsPrivileged und --password-store an.
    const argv = [ELECTRON, '--allow-file-access-from-files', '--ozone-platform=wayland', '--secure-schemes=app',
      '--standard-schemes=app', '--password-store=basic', '.'];
    expect(parseArgv(argv, false)).toEqual({ kind: 'mode', mode: 'fenster' });
    expect(parseArgv([EXE, '--allow-file-access-from-files', '--secure-schemes=app', '--standard-schemes=app'], true))
      .toEqual({ kind: 'mode', mode: 'fenster' });
    expect(parseArgv([EXE, '--secure-schemes=app', '--test'], true)).toEqual({ kind: 'mode', mode: 'test' });
  });

  it('eigene und unbekannte Schalter sind keine fremden', () => {
    for (const arg of ['--test', '--ohne-fenster', '--help', '-h', '--gibts-nicht', '--disable-gpu-x']) {
      expect(isForeignSwitch(arg)).toBe(false);
    }
  });
});

describe('parseArgv', () => {
  it('ohne Argumente: Fenster', () => {
    expect(parseArgv([ELECTRON, '.'], false)).toEqual({ kind: 'mode', mode: 'fenster' });
    expect(parseArgv([EXE, '-psn_0_42'], true)).toEqual({ kind: 'mode', mode: 'fenster' });
  });

  it('--test gewinnt über --ohne-fenster', () => {
    expect(parseArgv([EXE, '--ohne-fenster', '--test'], true)).toEqual({ kind: 'mode', mode: 'test' });
    expect(parseArgv([EXE, '--ohne-fenster'], true)).toEqual({ kind: 'mode', mode: 'ohne-fenster' });
  });

  it('unbekannt → USAGE mit 2, mit -h/--help mit 0', () => {
    expect(parseArgv([EXE, '--gibts-nicht'], true)).toEqual({ kind: 'usage', exitCode: 2 });
    expect(parseArgv([EXE, '--help'], true)).toEqual({ kind: 'usage', exitCode: 0 });
    expect(parseArgv([EXE, '--test', '-h'], true)).toEqual({ kind: 'usage', exitCode: 0 });
    expect(parseArgv([ELECTRON, '--inspect=0', '.', 'foo'], false)).toEqual({ kind: 'usage', exitCode: 2 });
  });
});
