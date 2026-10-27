import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished } from 'vitest';
import { createCore } from '../../src/core';
import { createWowLocator } from '../../src/core/platform';
import { createSiteFactory } from '../../src/core/upload';
import type { Core, CoreEnv, Credentials, Logger, Platform, ProcessRunner, RunningFlavors } from '../../src/shared/types';
import { CLIENT_VERSION } from '../../src/shared/types';
import { FakeKeyring } from './fakeKeyring';
import { FakeServer } from './fakeServer';

export class FakeClock {
  fixed: Date | null = null;
  now(): Date {
    return this.fixed ? new Date(this.fixed) : new Date();
  }
}

export const currentPlatform = (): Platform =>
  process.platform === 'win32' || process.platform === 'darwin' ? process.platform : 'linux';

const noRunner: ProcessRunner = { run: () => Promise.resolve({ ok: false, stdout: '' }) };

export interface Sandbox {
  readonly root: string;
  readonly wow: string;
  readonly configDir: string;
  readonly dataDir: string;
  readonly server: FakeServer;
  readonly keyring: FakeKeyring;
  readonly clock: FakeClock;
  readonly logs: string[];
  readonly credentials: Credentials;
  running: RunningFlavors;
  readonly env: CoreEnv;
  readonly core: Core;
  flavor(name?: string, spoken?: boolean): Promise<string>;
  lua(flavorDir: string, account?: string): Promise<string>;
  cache(flavorDir: string, lang?: string): Promise<string>;
  cleanup(): Promise<void>;
}

export async function createSandbox(): Promise<Sandbox> {
  const root = await mkdtemp(join(tmpdir(), 'spoken-test-'));
  const configDir = join(root, 'config');
  const dataDir = join(root, 'data');
  const wow = join(root, 'World of Warcraft');
  const server = new FakeServer();
  const keyring = new FakeKeyring('none');
  const clock = new FakeClock();
  const logs: string[] = [];
  const logger: Logger = {
    info: (m) => logs.push(`info: ${m}`),
    warn: (m) => logs.push(`warn: ${m}`),
    error: (m) => logs.push(`error: ${m}`),
  };
  const platform = currentPlatform();
  const locator = createWowLocator({ platform, env: {}, home: root, runner: noRunner });
  const state: { running: RunningFlavors } = { running: new Set<string>() };
  const env: CoreEnv = {
    platform,
    paths: { configDir, dataDir, home: root },
    clock,
    running: () => Promise.resolve(state.running),
    secrets: keyring,
    openSite: createSiteFactory(server, { baseUrl: 'http://127.0.0.1:9', platform, version: CLIENT_VERSION }),
    wow: {
      isWowRoot: (p) => locator.isWowRoot(p),
      wowRoot: (p) => locator.wowRoot(p),
      findWow: () => Promise.resolve(null), // nie die echte Installation
    },
    logger,
  };
  const core = createCore(env);
  return {
    root, wow, configDir, dataDir, server, keyring, clock, logs, env, core,
    credentials: { email: 'test@example.org', password: 'geheim' },
    get running() { return state.running; },
    set running(value: RunningFlavors) { state.running = value; },
    async flavor(name = '_classic_era_', spoken = true) {
      const dir = join(wow, name);
      await mkdir(join(dir, 'WTF'), { recursive: true });
      if (spoken) await mkdir(join(dir, 'Interface', 'AddOns', 'Spoken'), { recursive: true });
      return dir;
    },
    async lua(flavorDir, account = 'ACC') {
      const dir = join(flavorDir, 'WTF', 'Account', account, 'SavedVariables');
      await mkdir(dir, { recursive: true });
      return join(dir, 'SpokenContributions.lua');
    },
    async cache(flavorDir, lang = 'deDE') {
      const dir = join(flavorDir, 'Cache', 'ADB', lang);
      await mkdir(dir, { recursive: true });
      return join(dir, 'DBCache.bin');
    },
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

/** Sandbox für einen vitest-Test, wird danach automatisch gelöscht. */
export async function useSandbox(): Promise<Sandbox> {
  const sandbox = await createSandbox();
  onTestFinished(() => sandbox.cleanup());
  return sandbox;
}
