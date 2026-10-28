#!/usr/bin/env node
import { createRequire } from 'node:module';
import { mkdir, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

// Use Vite's repository-pinned esbuild, rather than downloading a release tool at build time.
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild');
const output = process.argv[2];
if (!output) throw new Error('Usage: node scripts/build/distributed-worker-bundle.mjs OUTPUT_DIRECTORY');
const dir = resolve(output);
await mkdir(dir, { recursive: true });
for (const name of ['cli', 'controlMcpCli', 'runtimeMcpCli', 'desktopBridgeCli']) {
  await build({
    entryPoints: [`packages/agent-teams-worker/src/${name}.ts`], outfile: join(dir, name + '.js'),
    bundle: true, platform: 'node', format: 'esm', target: 'node24',
    // Optional schema adapters in fastmcp's xsschema dependency; our MCP uses Zod only.
    external: ['effect', 'sury', '@valibot/to-json-schema'],
    banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
  });
}
await build({
  entryPoints: ['packages/agent-teams-worker/src/localWorkerCli.ts'], outfile: join(dir, 'localWorkerCli.js'),
  bundle: true, platform: 'node', format: 'esm', target: 'node24', external: ['./cli.js'],
  banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
});
await copyFile('packages/agent-teams-worker/installer/windows-install.mjs', join(dir, 'windows-install.mjs'));
await build({
  entryPoints: ['packages/agent-teams-relay/src/cli.ts'], outfile: join(dir, 'mac-relay-test.mjs'),
  bundle: true, platform: 'node', format: 'esm', target: 'node24',
  banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
});
console.log('Built distributed Worker and isolated smoke relay in ' + dir);
