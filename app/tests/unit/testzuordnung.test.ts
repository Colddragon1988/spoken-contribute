// Phase 4: Jeder Test der früheren Python-Fassung hat einen TS-Test, dessen it(...)/test(...)-Name den
// Python-Methodennamen enthält (Architektur §8.1). Die Python-Fassung ist entfernt; die Liste ihrer
// 57 Tests steht in docs/electron-testzuordnung.md und bleibt die Grundlage dieser Prüfung.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const tsTests = join(appDir, 'tests');
const table = readFileSync(join(appDir, '..', 'docs', 'electron-testzuordnung.md'), 'utf8');

interface PythonTest {
  readonly file: string;
  readonly cls: string;
  readonly method: string;
}

/** Python-Tests aus der Tabelle: `datei.py::Klasse::test_methode`. */
const all: PythonTest[] = [...table.matchAll(/`(test_\w+\.py)::(\w+)::(test_\w+)`/g)]
  .map((m) => ({ file: m[1] ?? '', cls: m[2] ?? '', method: m[3] ?? '' }));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** Namen aller it(...)/test(...) in den TS-Tests (vitest und Playwright), je Datei. */
function tsTestNames(): { file: string; name: string }[] {
  const self = fileURLToPath(import.meta.url);
  const call = /\b(?:it|test)(?:\.(?:only|skip|concurrent|fails))?\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
  return walk(tsTests)
    .filter((path) => /\.(?:test|spec)\.ts$/.test(path) && path !== self)
    .flatMap((path) => [...readFileSync(path, 'utf8').matchAll(call)]
      .map((m) => ({ file: relative(appDir, path).replaceAll('\\', '/'), name: m[2] ?? '' })));
}

describe('Testzuordnung Python → TS', () => {
  it('die Tabelle nennt alle 57 Python-Tests, jeden einmal', () => {
    expect(all).toHaveLength(57);
    expect(new Set(all.map((t) => `${t.file}::${t.cls}::${t.method}`)).size).toBe(57);
  });

  it('jeder Python-Test hat einen gleichnamigen TS-Test', () => {
    const names = tsTestNames();
    const missing = all.filter(({ method }) =>
      !names.some(({ name }) => new RegExp(`(^|[^A-Za-z0-9_])${method}($|[^A-Za-z0-9_])`).test(name)));
    expect(missing.map((t) => `${t.file}::${t.cls}::${t.method}`)).toEqual([]);
  });
});
