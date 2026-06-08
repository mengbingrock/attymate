/**
 * esbuild configuration for the AttyMate Electron MAIN process.
 *
 * Bundles main.js + its local modules (bridge-client, runner-host) and ws into a
 * single self-contained ESM file (dist/main.mjs). The packaged app then ships NO
 * runtime node_modules — sidestepping electron-builder's unreliable packaging of
 * pnpm-symlinked dependencies. `electron` stays external (the runtime provides
 * it). The banner gives ESM a `require` so ws's optional native deps resolve-or-
 * throw at runtime (they're absent → ws uses its pure-JS path).
 *
 * preload.cjs is NOT bundled — Electron loads it by path; the build copies it to
 * build/ alongside main.mjs. (build/ = bundled app source; dist/ = electron-builder
 * artifacts, kept separate.)
 */

/** @type {import('esbuild').BuildOptions} */
export default {
  entryPoints: ["main.js"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: "build/main.mjs",
  external: ["electron", "bufferutil", "utf-8-validate"],
  banner: {
    js: "import { createRequire as __pcCreateRequire } from 'node:module'; const require = __pcCreateRequire(import.meta.url);",
  },
  treeShaking: true,
  sourcemap: true,
};
