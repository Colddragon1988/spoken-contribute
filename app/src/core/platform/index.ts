// Paket (a): Plattform, Pfade, WoW-Suche, laufende Clients.
// Alles, was je Betriebssystem anders ist; Plattform, Umgebung, Home und Prozess-Runner kommen
// immer von außen (Entscheidung 23), damit Tests nie echte Pfade oder Prozesse berühren.
import type {
  AppPaths, DarkModeProbe, EnvVars, Platform, ProcessRunner, ProcessSource, RunningFlavors, WowLocator,
} from '../../shared/types';
import { createDarkModeProbe as darkModeProbe } from './darkmode';
import { defaultPaths as paths, userDataDir as userData } from './paths';
import { createProcessRunner as processRunner, createProcessSource as processSource } from './processes';
import { runningFlavors as flavorsOf } from './running';
import { createWowLocator as wowLocator } from './wowfind';

export function defaultPaths(platform: Platform, env: EnvVars, home: string): AppPaths {
  return paths(platform, env, home);
}
export function userDataDir(platform: Platform, env: EnvVars, home: string): string {
  return userData(platform, env, home);
}
export function createProcessRunner(): ProcessRunner {
  return processRunner();
}
export function createProcessSource(platform: Platform, runner: ProcessRunner): ProcessSource {
  return processSource(platform, runner);
}
export function runningFlavors(programs: readonly string[]): RunningFlavors {
  return flavorsOf(programs);
}
export function createWowLocator(deps: { platform: Platform; env: EnvVars; home: string; runner: ProcessRunner }): WowLocator {
  return wowLocator(deps);
}
export function createDarkModeProbe(platform: Platform, runner: ProcessRunner): DarkModeProbe {
  return darkModeProbe(platform, runner);
}

export { pathFor } from './paths';
export { normalizePath, parentsOf, WOW_FOLDER } from './wowfind';
