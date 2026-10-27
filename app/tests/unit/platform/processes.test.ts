// ProcessRunner und ProcessSource (Spezifikation §6.4). Prozesslisten kommen nur aus einem
// vorgetäuschten Runner bzw. einem Fake-/proc im Temp-Ordner – nie vom echten System.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import { createProcessRunner, createProcessSource, runningFlavors } from '../../../src/core/platform';
import { createProcessSource as createProcessSourceWithProc, readProcPrograms } from '../../../src/core/platform/processes';
import type { ProcessResult, ProcessRunner } from '../../../src/shared/types';

interface Call { command: string; args: readonly string[]; timeoutMs: number }

function fakeRunner(answer: ProcessResult | (() => never)): { runner: ProcessRunner; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    runner: {
      run(command, args, options) {
        calls.push({ command, args, timeoutMs: options.timeoutMs });
        return typeof answer === 'function' ? Promise.reject(new Error('kaputt')) : Promise.resolve(answer);
      },
    },
  };
}

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'spoken-platform-'));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

describe('ProcessSource', () => {
  it('Windows: PowerShell ohne Profil, Ausgabe getrimmt und ohne leere Zeilen', async () => {
    const stdout = 'C:\\Windows\\System32\\svchost.exe\r\n\r\n  System Idle Process  \r\n' +
      'C:\\Program Files (x86)\\World of Warcraft\\_classic_era_\\WowClassic.exe\r\n';
    const { runner, calls } = fakeRunner({ ok: true, stdout });
    const programs = await createProcessSource('win32', runner).listPrograms();
    expect(programs).toEqual([
      'C:\\Windows\\System32\\svchost.exe',
      'System Idle Process',
      'C:\\Program Files (x86)\\World of Warcraft\\_classic_era_\\WowClassic.exe',
    ]);
    expect(calls).toEqual([{
      command: 'powershell',
      args: ['-NoProfile', '-NonInteractive', '-Command',
        'Get-CimInstance Win32_Process | ForEach-Object { if ($_.ExecutablePath) { $_.ExecutablePath } else { $_.Name } }'],
      timeoutMs: 30_000,
    }]);
    expect(runningFlavors(programs)).toEqual(new Set(['_classic_era_']));
  });

  it('macOS: ps -axo comm=', async () => {
    const stdout = '/sbin/launchd\n/Applications/World of Warcraft/_classic_era_/World of Warcraft Classic.app/' +
      'Contents/MacOS/World of Warcraft Classic\n';
    const { runner, calls } = fakeRunner({ ok: true, stdout });
    const programs = await createProcessSource('darwin', runner).listPrograms();
    expect(calls.map((c) => [c.command, ...c.args])).toEqual([['ps', '-axo', 'comm=']]);
    expect(programs).toHaveLength(2);
    expect(runningFlavors(programs)).toEqual(new Set(['_classic_era_']));
  });

  it('ein scheiternder oder werfender Runner ergibt eine leere Liste', async () => {
    expect(await createProcessSource('win32', fakeRunner({ ok: false, stdout: '' }).runner).listPrograms()).toEqual([]);
    expect(await createProcessSource('darwin', fakeRunner(() => { throw new Error(); }).runner).listPrograms()).toEqual([]);
  });

  it('Linux: liest /proc/<pid>/cmdline (erstes Argument) aus einem Fake-/proc', async () => {
    const proc = await tempDir();
    const entry = async (name: string, cmdline?: Uint8Array | string): Promise<void> => {
      await mkdir(join(proc, name), { recursive: true });
      if (cmdline !== undefined) await writeFile(join(proc, name, 'cmdline'), cmdline);
    };
    await entry('1', '/sbin/init\0splash\0');
    await entry('42', 'Z:\\home\\x\\Games\\World of Warcraft\\_forever_\\Wow.exe\0-launcherlogin\0');
    await entry('43', ''); // Kernel-Thread: leere Zeile
    await entry('44'); // inzwischen beendet: keine cmdline
    await entry('45', '/usr/bin/kate\0/home/x/Wow.exe\0'); // Argumente zählen nicht
    await entry('46', Uint8Array.from([0x2f, 0x6f, 0x70, 0x74, 0x2f, 0xff, 0x00])); // kaputtes UTF-8
    await entry('self', '/nicht/gezaehlt/Wow.exe\0');
    await writeFile(join(proc, 'uptime'), '1 2');

    const programs = await readProcPrograms(proc);
    expect([...programs].sort()).toEqual(['/opt/\uFFFD', '/sbin/init', '/usr/bin/kate',
      'Z:\\home\\x\\Games\\World of Warcraft\\_forever_\\Wow.exe']);
    const source = createProcessSourceWithProc('linux', fakeRunner({ ok: true, stdout: '' }).runner, { procRoot: proc });
    expect(runningFlavors(await source.listPrograms())).toEqual(new Set(['_forever_']));
  });

  it('Linux: fehlendes /proc ergibt eine leere Liste', async () => {
    const dir = await tempDir();
    expect(await readProcPrograms(join(dir, 'gibt-es-nicht'))).toEqual([]);
  });
});

describe('ProcessRunner', () => {
  // Nur Node selbst wird gestartet – keine Systemabfragen.
  const node = process.execPath;
  const runner = createProcessRunner();

  it('liefert stdout bei Erfolg', async () => {
    expect(await runner.run(node, ['-e', 'process.stdout.write("a\\nä\\n")'], { timeoutMs: 10_000 }))
      .toEqual({ ok: true, stdout: 'a\nä\n' });
  });

  it('Argumente gehen ohne Shell durch', async () => {
    const tricky = '$(echo nein) `x` ; | & "z"';
    const result = await runner.run(node, ['-e', 'process.stdout.write(process.argv[1])', tricky], { timeoutMs: 10_000 });
    expect(result).toEqual({ ok: true, stdout: tricky });
  });

  it('Zeitüberschreitung ergibt { ok: false, stdout: "" }', async () => {
    const result = await runner.run(node, ['-e', 'process.stdout.write("x"); setTimeout(() => {}, 10000)'], { timeoutMs: 300 });
    expect(result).toEqual({ ok: false, stdout: '' });
  });

  it('fehlendes Programm ergibt { ok: false, stdout: "" }', async () => {
    expect(await runner.run('spoken-gibt-es-nicht-4711', [], { timeoutMs: 5_000 })).toEqual({ ok: false, stdout: '' });
  });

  it('Fehlercode: ok false, die Ausgabe bleibt (wie Pythons _output)', async () => {
    const result = await runner.run(node, ['-e', 'process.stdout.write("teil"); process.exit(3)'], { timeoutMs: 10_000 });
    expect(result).toEqual({ ok: false, stdout: 'teil' });
  });
});
