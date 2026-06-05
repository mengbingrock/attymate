// runner_gateway adapter — server side (slice 1).
//
// The control-plane seam that ships a run to the user-machine runner-client
// instead of spawning a subprocess on the server. It builds a machine-agnostic
// RunnerExecutionSpec from the already-resolved execution context, dispatches it
// over the per-company runner channel (server/src/realtime/runner-ws.ts), pipes
// streamed events into the standard onLog/onMeta/onSpawn callbacks, and returns
// the AdapterExecutionResult the runner produced.
//
// Slice-1 limits (see runner-slice-1.md): if no runner is online the run fails
// cleanly with errorCode "runner_offline" (suspend/resume is a later slice); the
// underlying adapterType to run on the client is read from config.runnerAdapterType
// (default "claude_local").

import type { AdapterExecutionContext, AdapterExecutionResult } from "../types.js";
import {
  RUNNER_PROTOCOL_VERSION,
  type RunnerExecutionSpec,
  type RunnerWorkspaceSpec,
} from "@paperclipai/adapter-utils/runner-protocol";
import { asString, parseObject } from "../utils.js";
import { dispatchRun, isRunnerOnline } from "../../realtime/runner-ws.js";

function buildWorkspaceSpec(config: Record<string, unknown>): RunnerWorkspaceSpec {
  const ws = parseObject(config.workspace);
  const strategy = asString(ws.strategy, "");
  if (strategy === "git_worktree") {
    return {
      strategy: "git_worktree",
      repoUrl: asString(ws.repoUrl, "") || null,
      baseRef: asString(ws.baseRef, "") || null,
      branchTemplate: asString(ws.branchTemplate, "") || null,
    };
  }
  // Default: a plain per-agent home directory on the client.
  return { strategy: "agent_home" };
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const companyId = ctx.agent.companyId;

  if (!isRunnerOnline(companyId)) {
    return {
      exitCode: null,
      signal: null,
      timedOut: false,
      errorMessage:
        "No local execution runner is connected for this company. Start the runner-client on your machine.",
      errorCode: "runner_offline",
    };
  }

  // The real adapter to run on the client. The runner-client supports
  // claude_local / codex_local / cursor_local / gemini_local / opencode_local /
  // pi_local; defaults to claude_local when unset.
  const runnerAdapterType = asString(ctx.config.runnerAdapterType, "claude_local");

  const spec: RunnerExecutionSpec = {
    protocolVersion: RUNNER_PROTOCOL_VERSION,
    runId: ctx.runId,
    companyId,
    agentId: ctx.agent.id,
    adapterType: runnerAdapterType,
    agent: {
      id: ctx.agent.id,
      companyId: ctx.agent.companyId,
      name: ctx.agent.name,
      adapterType: runnerAdapterType,
      adapterConfig: ctx.agent.adapterConfig,
    },
    runtime: {
      sessionId: ctx.runtime.sessionId,
      sessionParams: ctx.runtime.sessionParams,
      sessionDisplayId: ctx.runtime.sessionDisplayId,
      taskKey: ctx.runtime.taskKey,
    },
    // The server has already resolved model profile, skills, prompt template and
    // (slice 1, default secret model 2a) secrets into config. The client uses it
    // verbatim. We do not forward our own runnerAdapterType/workspace keys as
    // adapter config noise — the client reads adapterType/workspace from the spec.
    config: ctx.config,
    context: ctx.context,
    workspace: buildWorkspaceSpec(ctx.config),
    authToken: ctx.authToken ?? null,
  };

  try {
    const result = await dispatchRun(companyId, spec, {
      onEvent: async (event) => {
        if (event.kind === "log") {
          await ctx.onLog(event.stream === "lifecycle" ? "stdout" : event.stream, event.chunk);
        } else if (event.kind === "spawn") {
          await ctx.onSpawn?.({
            pid: event.pid,
            processGroupId: event.processGroupId,
            startedAt: event.startedAt,
          });
        } else if (event.kind === "meta") {
          await ctx.onMeta?.({
            adapterType: event.adapterType,
            command: event.command,
            commandArgs: event.commandArgs,
            cwd: event.cwd,
          });
        }
      },
    });
    return result;
  } catch (err) {
    const code =
      typeof (err as { code?: unknown })?.code === "string"
        ? ((err as { code?: string }).code as string)
        : "runner_dispatch_failed";
    return {
      exitCode: null,
      signal: null,
      timedOut: false,
      errorMessage: err instanceof Error ? err.message : String(err),
      errorCode: code,
    };
  }
}
