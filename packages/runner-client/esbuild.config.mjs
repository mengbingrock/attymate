/**
 * esbuild configuration — a SINGLE self-contained ESM bundle of the runner-client
 * for the Electron app to fork via utilityProcess with NO node_modules alongside
 * it (it ships as an extraResource in the packaged app).
 *
 * Everything is inlined: the workspace packages (runner-client + adapter-utils +
 * the adapter packages) AND ws/picocolors. Only ws's optional native deps stay
 * external — they aren't installed here, so ws falls back to its pure-JS path.
 * The banner gives the ESM output a `require` (via createRequire) so esbuild's
 * external-require shim can resolve-or-throw those optional deps at runtime.
 *
 * The agent CLIs the adapters spawn (claude, codex, …) are NOT bundled; they're
 * the user's own tools, found on PATH at runtime.
 */

/** @type {import('esbuild').BuildOptions} */
export default {
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: "dist/runner-bundle.mjs",
  // ws lazily require()s these optional native acceleration deps inside try/catch;
  // they're absent, so keep them external and let the runtime require throw → pure JS.
  external: ["bufferutil", "utf-8-validate"],
  banner: {
    js: "import { createRequire as __pcCreateRequire } from 'node:module'; const require = __pcCreateRequire(import.meta.url);",
  },
  treeShaking: true,
  sourcemap: true,
};
