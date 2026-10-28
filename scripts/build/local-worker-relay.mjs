#!/usr/bin/env node
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild');
const output = process.argv[2];
if (!output) throw new Error('Usage: node scripts/build/local-worker-relay.mjs OUTPUT_FILE');
await mkdir(dirname(resolve(output)), { recursive: true });
await build({
  entryPoints: [fileURLToPath(new URL('../../packages/agent-teams-worker/src/localWorkerCli.ts', import.meta.url))],
  outfile: resolve(output),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  external: ['./cli.js'],
  banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
});
