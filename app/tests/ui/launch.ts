/**
 * Playwright-Helfer: die gebaute App in einer frischen Sandbox starten (Architektur §7.2).
 * Vorher „npm run build“. Jede Sandbox hat eigenen Temp-Ordner, eigenen vorgetäuschten Server auf
 * 127.0.0.1 und eigenes userData – dadurch auch eine eigene Einzelinstanz-Sperre.
 */
import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { _electron, type ElectronApplication, type Page } from '@playwright/test';
import { startHttpFakeServer, type HttpFakeServer } from '../helpers/httpFakeServer';
import { appEnvironment, createSandboxRoot, electronBinary } from '../helpers/sandbox-start';

/** Der Ordner app/ (cwd der App, dort liegen package.json und dist/). */
export const APP_DIR = fileURLToPath(new URL('../..', import.meta.url));

export interface LaunchOptions {
  /** Sandbox füllen, bevor die App startet (WoW, config/settings.json, system.json, Verlauf …) */
  readonly prepare?: (root: string) => Promise<void>;
  /** zusätzliche App-Argumente */
  readonly args?: readonly string[];
}

export interface LaunchedApp {
  /** Sandbox-Ordner (config/, data/, userdata/, home/, system.json, dialoge.json, geoeffnet.json) */
  readonly root: string;
  readonly app: ElectronApplication;
  /** das Hauptfenster */
  readonly window: Page;
  readonly server: HttpFakeServer;
  /** bisherige Ausgaben des App-Prozesses */
  stdout(): string;
  stderr(): string;
  /** App beenden, Server schließen, Sandbox löschen */
  close(): Promise<void>;
}

export async function launchApp(options: LaunchOptions = {}): Promise<LaunchedApp> {
  const root = await createSandboxRoot();
  const server = await startHttpFakeServer();
  try {
    await options.prepare?.(root);
    const app = await _electron.launch({
      args: ['.', ...(options.args ?? [])],
      cwd: APP_DIR,
      env: appEnvironment(root, server.url),
    });
    const out: string[] = [];
    const err: string[] = [];
    app.process().stdout?.on('data', (chunk: Buffer) => { out.push(chunk.toString('utf8')); });
    app.process().stderr?.on('data', (chunk: Buffer) => { err.push(chunk.toString('utf8')); });
    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    let closed = false;
    return {
      root, app, window, server,
      stdout: () => out.join(''),
      stderr: () => err.join(''),
      async close() {
        if (closed) return;
        closed = true;
        await app.close().catch(() => undefined);
        await server.close();
        await rm(root, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await server.close();
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

export interface CliRun {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Die gebaute App als Kommandozeile starten und auf das Ende warten.
 * env ersetzt die Sandbox-Umgebung ganz (für Tests der Sandbox-Prüfung selbst).
 */
export function runApp(
  args: readonly string[], options: { readonly env: Record<string, string>; readonly timeoutMs?: number },
): Promise<CliRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(electronBinary(APP_DIR), ['.', ...args], { cwd: APP_DIR, env: options.env });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => { out.push(chunk); });
    child.stderr.on('data', (chunk: Buffer) => { err.push(chunk); });
    const timer = setTimeout(() => { child.kill(); }, options.timeoutMs ?? 30_000);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') });
    });
  });
}

/** Kommandozeile in einer frischen Sandbox; inspect sieht die Sandbox vor dem Aufräumen. */
export async function runInSandbox(
  args: readonly string[],
  options: {
    readonly prepare?: (root: string, server: HttpFakeServer) => Promise<void>;
    readonly inspect?: (root: string, server: HttpFakeServer, run: CliRun) => Promise<void>;
  } = {},
): Promise<CliRun> {
  const root = await createSandboxRoot();
  const server = await startHttpFakeServer();
  try {
    await options.prepare?.(root, server);
    const run = await runApp(args, { env: appEnvironment(root, server.url) });
    await options.inspect?.(root, server, run);
    return run;
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
}
