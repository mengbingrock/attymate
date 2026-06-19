// Ensures the Codex *desktop app* is installed on the local runner.
//
// Installing the Codex CLI alone is not enough for the Browser/Chrome plugins:
// those drive an in-app browser through `node_repl`, an MCP server bundled
// INSIDE the Codex desktop app (e.g. on macOS
// /Applications/Codex.app/Contents/Resources/cua_node/bin/node_repl). When the
// app is missing, `node_repl` fails to start ("No such file or directory") and
// browser automation breaks. `codex app` installs the desktop app when missing
// (it also downloads ~500MB and briefly launches the GUI), so we run it only on
// the user's own machine, only when the app is absent, and at most once per
// window — and never let it fail the agent run.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  runAdapterExecutionTargetProcess,
  type AdapterExecutionTarget,
} from "@paperclipai/adapter-utils/execution-target";

// macOS bundles node_repl inside the app; its presence is the most reliable
// "desktop app installed" signal.
const MAC_NODE_REPL_PATH = "/Applications/Codex.app/Contents/Resources/cua_node/bin/node_repl";

// Don't relaunch the installer/GUI on every run — attempt at most once per window.
const ATTEMPT_INTERVAL_MS = 12 * 60 * 60 * 1000;

/**
 * Extract the `node_repl` MCP command path from a Codex `config.toml`. Handles
 * both TOML string forms so Windows paths survive:
 *   - basic strings: `command = "C:\\Users\\me\\...\\node_repl.exe"` (backslashes
 *     are escaped in TOML; we unescape them) or with forward slashes.
 *   - literal strings: `command = 'C:\Users\me\...\node_repl.exe'` (no escaping).
 * Returns the native path, or null if there's no node_repl command. Pure +
 * unit-testable (no fs).
 */
export function parseNodeReplCommand(configText: string): string | null {
  const basic = configText.match(/node_repl[\s\S]{0,600}?command\s*=\s*"((?:[^"\\]|\\.)*)"/);
  if (basic) {
    return basic[1].replace(/\\(["\\nrt])/g, (_, c: string) =>
      c === "n" ? "\n" : c === "r" ? "\r" : c === "t" ? "\t" : c,
    );
  }
  const literal = configText.match(/node_repl[\s\S]{0,600}?command\s*=\s*'([^']*)'/);
  if (literal) return literal[1];
  return null;
}

/**
 * Whether the Codex desktop app (which bundles `node_repl`) appears installed.
 * Cross-platform: a fast macOS path check, else the `node_repl` MCP command the
 * app registers in `config.toml` — if that binary exists, the app is installed.
 */
export function codexDesktopAppInstalled(codexHome: string): boolean {
  if (process.platform === "darwin" && existsSync(MAC_NODE_REPL_PATH)) return true;
  try {
    const command = parseNodeReplCommand(readFileSync(path.join(codexHome, "config.toml"), "utf8"));
    if (command && existsSync(command)) return true;
  } catch {
    // no config / unreadable — treat as not installed
  }
  return false;
}

/**
 * Best-effort install of the Codex desktop app on the LOCAL runner (macOS /
 * Windows). No-op on the server, remote sandboxes, SSH targets, and non-desktop
 * platforms. Never throws — a failure here must not fail the agent run.
 */
export async function ensureCodexDesktopApp(input: {
  runId: string;
  executionTarget: AdapterExecutionTarget | null | undefined;
  command: string;
  cwd: string;
  env: Record<string, string>;
  codexHome: string;
  onLog?: (stream: "stdout" | "stderr", chunk: string) => Promise<void>;
}): Promise<void> {
  const { runId, executionTarget, command, cwd, env, codexHome, onLog } = input;
  try {
    // Local runner only — the desktop app is meaningless on the Linux server,
    // remote sandboxes, or SSH hosts.
    if (executionTarget && executionTarget.kind !== "local") return;
    if (process.platform !== "darwin" && process.platform !== "win32") return;
    if (codexDesktopAppInstalled(codexHome)) return;

    // Rate-limit attempts so a machine where install keeps failing (or the
    // user declines) doesn't relaunch the installer/GUI on every single run.
    const marker = path.join(codexHome, ".paperclip-desktop-app-attempt");
    try {
      if (Date.now() - statSync(marker).mtimeMs < ATTEMPT_INTERVAL_MS) return;
    } catch {
      // no marker yet — proceed
    }
    try {
      mkdirSync(codexHome, { recursive: true });
      writeFileSync(marker, new Date().toISOString());
    } catch {
      // best-effort marker; continue even if it can't be written
    }

    await onLog?.(
      "stdout",
      "[paperclip] Codex desktop app not found; installing it (needed for Browser/Chrome plugins via node_repl). A Codex Desktop window may briefly open.\n",
    );
    await runAdapterExecutionTargetProcess(runId, executionTarget ?? { kind: "local" }, command, ["app", cwd], {
      cwd,
      env,
      timeoutSec: 300,
      graceSec: 10,
      onLog: onLog ?? (async () => {}),
    });
  } catch (err) {
    try {
      await onLog?.(
        "stderr",
        `[paperclip] Codex desktop app install skipped (best-effort): ${err instanceof Error ? err.message : String(err)}\n`,
      );
    } catch {
      // ignore logging failures
    }
  }
}
