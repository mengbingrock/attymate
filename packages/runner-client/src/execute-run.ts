// Run executor (runner-client side) — slice 1 / step 5: real execution.
//
// Realizes a local workspace on THIS machine, then invokes the claude_local
// adapter's execute() (the same module the server used to call) so the `claude`
// subprocess is spawned here, not on the control plane. stdout/stderr/spawn are
// forwarded back as run.event frames; the AdapterExecutionResult is returned to
// the control plane verbatim for its existing finalize/cost path.

import fs from "node:fs/promises";
import path from "node:path";
import type {
  AdapterExecutionContext,
  AdapterExecutionResult,
} from "@paperclipai/adapter-utils";
import type {
  RunnerExecutionSpec,
  RunEventFrame,
} from "@paperclipai/adapter-utils/runner-protocol";
import { execute as claudeExecute } from "@paperclipai/adapter-claude-local/server";

export interface RunExecutionCallbacks {
  /** Emit a streamed event back to the control plane. `seq` is assigned by the caller. */
  emit: (event: RunEventFrame["event"]) => void;
}

export interface RunExecutionEnv {
  /** Root under which per-run workspaces are realized locally. */
  workspacesRoot: string;
}

/** Map a spec's adapterType to a local execute() implementation. Slice 1: claude only. */
function resolveLocalExecute(adapterType: string) {
  if (adapterType === "claude_local") return claudeExecute;
  throw Object.assign(
    new Error(`runner-client does not support adapterType "${adapterType}" yet`),
    { code: "runner_adapter_unsupported" },
  );
}

/**
 * Realize the working directory for this run on the local machine.
 *
 * Slice 1 supports `agent_home` (a plain per-run directory). `git_worktree` is
 * stubbed to a plain dir for now with a clear marker; real worktree/clone logic
 * is a later slice. Returns the absolute cwd.
 */
async function realizeWorkspace(
  spec: RunnerExecutionSpec,
  env: RunExecutionEnv,
  cb: RunExecutionCallbacks,
): Promise<string> {
  const cwd = path.join(env.workspacesRoot, spec.runId);
  await fs.mkdir(cwd, { recursive: true });
  if (spec.workspace.strategy === "git_worktree") {
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
  const cwd = await realizeWorkspace(spec, env, cb);

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
  const config: Record<string, unknown> = { ...spec.config, cwd };

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

  return await localExecute(ctx);
}
