/**
 * esbuild configuration for bundling the runner-client into a single self-
 * contained file the Electron app can fork via utilityProcess.
 *
 * Bundles all workspace packages (@paperclipai/*) — the runner-client plus its
 * adapter packages and adapter-utils — into one ESM file. External npm packages
 * (ws, picocolors, …) stay as runtime deps resolved from node_modules. The
 * agent CLIs the adapters spawn (claude, codex, …) are NOT bundled; they're the
 * user's own tools, found on PATH at runtime.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");

// Workspace packages whose npm dependencies must be collected as externals.
// (esbuild discovers what to bundle by following imports; we enumerate these
// only to gather their non-@paperclipai deps and keep them external.)
const workspacePaths = [
  "packages/runner-client",
  "packages/adapter-utils",
  "packages/adapters/claude-local",
  "packages/adapters/codex-local",
  "packages/adapters/cursor-local",
  "packages/adapters/gemini-local",
  "packages/adapters/opencode-local",
  "packages/adapters/pi-local",
];

// Collect all external (non-workspace) npm package names so they remain runtime
// dependencies rather than being inlined.
const externals = new Set();
for (const p of workspacePaths) {
  const pkg = JSON.parse(readFileSync(resolve(repoRoot, p, "package.json"), "utf8"));
  for (const name of Object.keys(pkg.dependencies || {})) {
    if (!name.startsWith("@paperclipai/")) externals.add(name);
  }
  for (const name of Object.keys(pkg.optionalDependencies || {})) {
    externals.add(name);
  }
}

/** @type {import('esbuild').BuildOptions} */
export default {
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: "dist/runner-bundle.mjs",
  external: [...externals].sort(),
  treeShaking: true,
  sourcemap: true,
};
