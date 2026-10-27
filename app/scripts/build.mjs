import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

const common = { bundle: true, sourcemap: 'linked', legalComments: 'none', logLevel: 'info' };
const node = { ...common, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], outExtension: { '.js': '.cjs' } };

await rm('dist', { recursive: true, force: true });
await rm('dist-dev', { recursive: true, force: true });

await build({ ...node, entryPoints: { main: 'src/main/main.ts' }, outdir: 'dist/main' });
await build({ ...node, entryPoints: { preload: 'src/preload/preload.ts' }, outdir: 'dist/preload' });
await build({
  ...common, platform: 'browser', format: 'iife', target: 'es2023',
  entryPoints: { 'main/main': 'src/renderer/main/main.ts', 'history/history': 'src/renderer/history/history.ts' },
  outdir: 'dist/renderer',
});
for (const page of ['main', 'history']) {
  await mkdir(`dist/renderer/${page}`, { recursive: true });
  await cp(`src/renderer/${page}/index.html`, `dist/renderer/${page}/index.html`);
}
await cp('src/renderer/common', 'dist/renderer/common', { recursive: true, filter: (src) => !src.endsWith('.ts') });
await build({ ...node, entryPoints: { 'sandbox-start': 'tests/helpers/sandbox-start.ts' }, outdir: 'dist-dev' });
