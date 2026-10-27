/**
 * Umgebung des Kerns (CoreEnv): Produktion oder Sandbox. Ohne Electron-Import – safeStorage und
 * fetch reicht main.ts herein.
 *
 * Die Sandbox-Variablen gelten nur unverpackt, nur für einen Ordner unter os.tmpdir() und nur mit
 * einem Server auf 127.0.0.1 (Architektur §5.4). So kann selbst eine verirrte Umgebungsvariable
 * weder echte Daten noch spoken.rusty.one erreichen.
 */
import { realpathSync } from 'node:fs';
import { isAbsolute, join, sep } from 'node:path';
import {
  createProcessRunner, createProcessSource, createWowLocator, defaultPaths, runningFlavors,
} from '../core/platform';
import { createSafeStorageSecretStore } from '../core/settings';
import { createFetchTransport, createSiteFactory } from '../core/upload';
import {
  CLIENT_VERSION, SITE_URL,
  type CoreEnv, type DarkModeProbe, type EnvVars, type Logger, type Platform, type SafeStorageLike,
} from '../shared/types';
import { createSandboxDarkMode, createSandboxKeyring, createSandboxSystem, type SandboxSystem } from './sandbox';

export const SANDBOX_VAR = 'SPOKEN_UPLOAD_SANDBOX';
export const SERVER_VAR = 'SPOKEN_UPLOAD_SERVER';
/** Schutz bis Phase 6: unverpackt ohne Sandbox nur mit dieser Variable (= "1") gegen echte Daten. */
export const REAL_DATA_VAR = 'SPOKEN_UPLOAD_ECHTE_DATEN';

export type SandboxCheck =
  | { readonly kind: 'keine' }
  | { readonly kind: 'sandbox'; readonly root: string; readonly server: string }
  | { readonly kind: 'fehler'; readonly message: string };

const SERVER_PATTERN = /^http:\/\/127\.0\.0\.1:(\d{1,5})\/?$/;

export function currentPlatform(platform: string = process.platform): Platform {
  return platform === 'win32' || platform === 'darwin' ? platform : 'linux';
}

/** Darf die Sandbox gelten? realpath: Symlinks aus dem Temp-Ordner hinaus zählen nicht. */
export function checkSandbox(
  vars: EnvVars, packaged: boolean, tmpdir: string,
  realpath: (path: string) => string = (path) => realpathSync.native(path),
): SandboxCheck {
  if (packaged) return { kind: 'keine' }; // ausgelieferte App: Sandbox-Variablen zählen nie
  const root = vars[SANDBOX_VAR];
  const server = vars[SERVER_VAR];
  if (root === undefined && server === undefined) return { kind: 'keine' };
  if (root === undefined || root === '' || server === undefined) {
    return { kind: 'fehler', message: `Sandbox abgelehnt: ${SANDBOX_VAR} und ${SERVER_VAR} gehören zusammen.` };
  }
  const port = SERVER_PATTERN.exec(server)?.[1];
  if (port === undefined || Number(port) < 1 || Number(port) > 65535) {
    return { kind: 'fehler', message: `Sandbox abgelehnt: ${SERVER_VAR} muss http://127.0.0.1:<Port> sein.` };
  }
  let realRoot: string;
  let realTmp: string;
  try {
    if (!isAbsolute(root)) throw new Error('relativ');
    realRoot = realpath(root);
    realTmp = realpath(tmpdir);
  } catch {
    return { kind: 'fehler', message: `Sandbox abgelehnt: ${SANDBOX_VAR} ist kein vorhandener Ordner.` };
  }
  if (!realRoot.startsWith(realTmp + sep)) {
    return { kind: 'fehler', message: `Sandbox abgelehnt: ${SANDBOX_VAR} muss unter ${realTmp} liegen.` };
  }
  return { kind: 'sandbox', root: realRoot, server: server.replace(/\/$/, '') };
}

/** fetch, das nur 127.0.0.1 erreicht (Sandbox: Regel 2 doppelt abgesichert). */
export function localOnlyFetch(fetchImpl: typeof fetch): typeof fetch {
  return (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== '127.0.0.1') {
      return Promise.reject(new Error(`Sandbox: kein Netz außer 127.0.0.1 (${url.host})`));
    }
    return fetchImpl(input, init);
  };
}

export interface EnvDeps {
  readonly platform: Platform;
  readonly vars: EnvVars;
  readonly home: string;
  readonly fetchImpl: typeof fetch;
  readonly logger: Logger;
}

/** Die echte Umgebung: Pfade wie die Python-Fassung, Passwort über safeStorage. */
export function productionEnv(deps: EnvDeps & { readonly safeStorage: SafeStorageLike }): CoreEnv {
  const { platform, vars, home } = deps;
  const paths = defaultPaths(platform, vars, home);
  const runner = createProcessRunner();
  const source = createProcessSource(platform, runner);
  return {
    platform,
    paths,
    clock: { now: () => new Date() },
    running: async () => runningFlavors(await source.listPrograms()),
    secrets: createSafeStorageSecretStore({ configDir: paths.configDir, safeStorage: deps.safeStorage, platform }),
    openSite: createSiteFactory(createFetchTransport(deps.fetchImpl), { baseUrl: SITE_URL, platform, version: CLIENT_VERSION }),
    wow: createWowLocator({ platform, env: vars, home, runner }),
    logger: deps.logger,
  };
}

export interface SandboxEnv {
  readonly env: CoreEnv;
  readonly system: SandboxSystem;
  readonly darkMode: DarkModeProbe;
}

/**
 * Die Sandbox: Konfig, Daten und Home im Temp-Ordner, Prozesse, Schlüsselbund und Design aus
 * system.json, Server auf 127.0.0.1. Die WoW-Suche schaut nie auf echte Pfade.
 */
export function sandboxEnv(
  sandbox: { readonly root: string; readonly server: string },
  deps: Omit<EnvDeps, 'vars' | 'home'>,
): SandboxEnv {
  const { root, server } = sandbox;
  const { platform } = deps;
  const system = createSandboxSystem(root);
  const noRunner = { run: () => Promise.resolve({ ok: false, stdout: '' }) };
  const locator = createWowLocator({ platform, env: {}, home: root, runner: noRunner });
  const env: CoreEnv = {
    platform,
    paths: { configDir: join(root, 'config'), dataDir: join(root, 'data'), home: root },
    clock: { now: () => new Date() },
    running: () => Promise.resolve(runningFlavors(system.programs())),
    secrets: createSandboxKeyring(system),
    openSite: createSiteFactory(createFetchTransport(localOnlyFetch(deps.fetchImpl)), {
      baseUrl: server, platform, version: CLIENT_VERSION,
    }),
    wow: {
      isWowRoot: (path) => locator.isWowRoot(path),
      wowRoot: (path) => locator.wowRoot(path),
      findWow: () => Promise.resolve(system.pathInside('wowSuche')),
    },
    logger: deps.logger,
  };
  return { env, system, darkMode: createSandboxDarkMode(system) };
}

/** userData der Sandbox – nie der Konfig-Ordner der Python-Fassung (E. 16). */
export const sandboxUserData = (root: string): string => join(root, 'userdata');
