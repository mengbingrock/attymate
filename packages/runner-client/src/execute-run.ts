// Run executor (runner-client side) — real execution.
//
// Realizes a local workspace on THIS machine, then invokes the underlying local
// adapter's execute() (the same module the server used to call) so the agent CLI
// (claude/codex/cursor/gemini/opencode/pi) is spawned here, not on the control
// plane. stdout/stderr/spawn are forwarded back as run.event frames; the
// AdapterExecutionResult is returned to the control plane verbatim for its
// existing finalize/cost path.

import fs from "node:fs/promises";
import path from "node:path";
import type { AdapterExecutionContext } from "@paperclipai/adapter-utils";
import type { AdapterExecutionResult } from "@paperclipai/adapter-utils";
import type {
  RunnerExecutionSpec,
  RunEventFrame,
} from "@paperclipai/adapter-utils/runner-protocol";
import { materializeRunnerConfig } from "@paperclipai/adapter-utils/runner-materialize";
import { resolveLocalExecute } from "./adapters.js";
import type { RunnerClientConfig } from "./config.js";
import { resolveActiveWorkspacePath } from "./active-workspace.js";
import { ensureCodexAuthProvisioned } from "./codex-auth.js";

export interface RunExecutionCallbacks {
  /** Emit a streamed event back to the control plane. `seq` is assigned by the caller. */
  emit: (event: RunEventFrame["event"]) => void;
}

export interface RunExecutionEnv {
  /** Root under which fallback per-run workspaces are realized locally. */
  workspacesRoot: string;
  /** Full runner config, so workspace resolution can call the control plane as the user. */
  config: RunnerClientConfig;
}

/** Thrown when the run can't be placed in a real working directory. */
class WorkspaceError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Realize the working directory for this run on the local machine.
 *
 * - `user_active` (default for desktop agents): run DIRECTLY in the user's active
 *   Workspace folder, resolved by the runner from the control plane. If none is
 *   granted or the folder is gone, fail with a clear typed error rather than
 *   silently using a throwaway dir.
 * - `agent_home`: a plain per-run directory under the runner root (headless/token
 *   runners, or explicit opt-in).
 * - `git_worktree`: still stubbed → plain per-run dir with a marker.
 */
async function realizeWorkspace(
  spec: RunnerExecutionSpec,
  env: RunExecutionEnv,
  cb: RunExecutionCallbacks,
): Promise<string> {
  const strategy = spec.workspace.strategy;

  if (strategy === "user_active") {
    const active = await resolveActiveWorkspacePath(env.config);
    if (!active) {
      throw new WorkspaceError(
        "runner_no_workspace",
        "No active Workspace folder. Open AttyMate → WORKSPACE, add a folder and mark it active, then retry.",
      );
    }
    let stat: import("node:fs").Stats;
    try {
      stat = await fs.stat(active);
    } catch {
      throw new WorkspaceError(
        "runner_no_workspace",
        `Active Workspace folder no longer exists: ${active}. Pick a different folder in AttyMate → WORKSPACE.`,
      );
    }
    if (!stat.isDirectory()) {
      throw new WorkspaceError(
        "runner_no_workspace",
        `Active Workspace path is not a directory: ${active}.`,
      );
    }
    cb.emit({
      kind: "log",
      stream: "lifecycle",
      chunk: `[runner-client] running in active workspace ${active}\n`,
    });
    return active;
  }

  // Fallback strategies use a per-run dir under the runner root.
  const cwd = path.join(env.workspacesRoot, spec.runId);
  await fs.mkdir(cwd, { recursive: true });
  if (strategy === "git_worktree") {
    // TODO(later slice): create a real git worktree from repoUrl@baseRef.
    cb.emit({
      kind: "log",
      stream: "lifecycle",
      chunk:
        "[runner-client] git_worktree strategy not yet implemented; using a plain directory\n",
    });
  }
  cb.emit({
    kind: "log",
    stream: "lifecycle",
    chunk: `[runner-client] workspace ready at ${cwd}\n`,
  });
  return cwd;
}

export async function executeRun(
  spec: RunnerExecutionSpec,
  cb: RunExecutionCallbacks,
  env: RunExecutionEnv,
): Promise<AdapterExecutionResult> {
  const localExecute = resolveLocalExecute(spec.adapterType);
  let cwd: string;
  try {
    cwd = await realizeWorkspace(spec, env, cb);
  } catch (err) {
    if (err instanceof WorkspaceError) {
      cb.emit({ kind: "log", stream: "lifecycle", chunk: `[runner-client] ${err.message}\n` });
      return {
        exitCode: null,
        signal: null,
        timedOut: false,
        errorMessage: err.message,
        errorCode: err.code,
      };
    }
    throw err;
  }

  // The adapter resolves its working directory from context.paperclipWorkspace.cwd
  // first, then config.cwd. Inject our locally-realized cwd into both so the
  // subprocess runs HERE regardless of any server-side path in the spec.
  const incomingContext =
    spec.context && typeof spec.context === "object" ? spec.context : {};
  const incomingWorkspace =
    (incomingContext as Record<string, unknown>).paperclipWorkspace &&
    typeof (incomingContext as Record<string, unknown>).paperclipWorkspace === "object"
      ? ((incomingContext as Record<string, unknown>).paperclipWorkspace as Record<string, unknown>)
      : {};
  const context: Record<string, unknown> = {
    ...incomingContext,
    paperclipWorkspace: { ...incomingWorkspace, cwd, source: "runner_local" },
  };
  // The control plane embedded skill/instruction file CONTENTS in the spec
  // (their server paths don't exist here). Materialize them into a staging dir
  // beside the workspace and rewrite the paths to local copies before the
  // adapter reads them.
  const stagingRoot = path.join(env.workspacesRoot, ".runtime", spec.runId);
  const portableConfig = await materializeRunnerConfig(spec.config, stagingRoot);
  const config: Record<string, unknown> = { ...portableConfig, cwd };

  const ctx: AdapterExecutionContext = {
    runId: spec.runId,
    agent: {
      id: spec.agent.id,
      companyId: spec.agent.companyId,
      name: spec.agent.name,
      adapterType: spec.agent.adapterType,
      adapterConfig: spec.agent.adapterConfig,
    },
    runtime: {
      sessionId: spec.runtime.sessionId,
      sessionParams: spec.runtime.sessionParams,
      sessionDisplayId: spec.runtime.sessionDisplayId,
      taskKey: spec.runtime.taskKey,
    },
    config,
    context,
    // Resolved on the control plane (the runner has no adapter registry). Drives
    // local auto-install of a missing CLI via localInstallCommand.
    runtimeCommandSpec: spec.runtimeCommandSpec ?? null,
    onLog: async (stream, chunk) => {
      cb.emit({ kind: "log", stream, chunk });
    },
    onMeta: async (meta) => {
      cb.emit({
        kind: "meta",
        adapterType: meta.adapterType,
        command: meta.command,
        commandArgs: meta.commandArgs,
        cwd: meta.cwd,
      });
    },
    onSpawn: async (meta) => {
      cb.emit({
        kind: "spawn",
        pid: meta.pid,
        processGroupId: meta.processGroupId,
        startedAt: meta.startedAt,
      });
    },
    authToken: spec.authToken ?? undefined,
  };

  // Reconcile codex auth with the agent's configured source (useServerCodexAuth):
  // pull the server's auth (backing up the user's local), restore the local on
  // switch-back, or provision when a fresh machine has no login. Best-effort; the
  // adapter's own auto-install handles the binary.
  await ensureCodexAuthProvisioned(env.config, spec.adapterType, spec.config, (chunk) =>
    cb.emit({ kind: "log", stream: "lifecycle", chunk }),
  );

  return await localExecute(ctx);
}
