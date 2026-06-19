// ---------------------------------------------------------------------------
// Local Execution Runner protocol (slice 1)
//
// Shared wire contract between the control-plane `runner_gateway` server adapter
// and the user-machine `runner-client` process. The control plane sends a
// machine-agnostic RunnerExecutionSpec; the client realizes the workspace
// locally, runs the agent subprocess, streams events back, and returns an
// AdapterExecutionResult.
//
// Design refs: cached-foraging-barto.md (Components 1/3/4), runner-slice-1.md.
//
// Slice-1 scope: single transport (WS), static pairing token, server-resolved
// secrets carried in `config` (no per-device encryption yet), one runner per
// company. Suspend/resume and device crypto are later slices.
// ---------------------------------------------------------------------------

import type { AdapterExecutionResult, AdapterRuntimeCommandSpec } from "./types.js";

/** Wire protocol version — bump on breaking frame/spec changes. */
export const RUNNER_PROTOCOL_VERSION = 1;

/** WebSocket path the runner-client dials on the control plane. */
export const RUNNER_WS_PATH = "/api/runner/ws";

/** Header carrying the slice-1 static pairing token on the WS upgrade. */
export const RUNNER_AUTH_HEADER = "x-paperclip-runner-token";
/** Header carrying the company id the runner is pairing for. */
export const RUNNER_COMPANY_HEADER = "x-paperclip-runner-company";

// ---------------------------------------------------------------------------
// Execution spec — what crosses the wire on run.start (server → client)
// ---------------------------------------------------------------------------

export type RunnerWorkspaceStrategy = "git_worktree" | "agent_home" | "user_active";

export interface RunnerWorkspaceSpec {
  /**
   * How the client should realize the working directory locally:
   * - `user_active`: run directly in the user's active Workspace folder, which
   *   the runner resolves itself from the control plane (GET /users/me/workspaces).
   *   No absolute path crosses the wire — the path stays on the user's machine.
   * - `git_worktree`: create a worktree from repoUrl@baseRef.
   * - `agent_home`: a plain per-run directory under the runner's workspace root.
   */
  strategy: RunnerWorkspaceStrategy;
  repoUrl?: string | null;
  baseRef?: string | null;
  branchTemplate?: string | null;
}

export interface RunnerExecutionSpec {
  protocolVersion: number;
  runId: string;
  companyId: string;
  agentId: string;
  /** The underlying local adapter to run on the client (e.g. "claude_local"). */
  adapterType: string;
  /** Agent identity passed through to the adapter context. */
  agent: {
    id: string;
    companyId: string;
    name: string;
    adapterType: string | null;
    adapterConfig: unknown;
  };
  /** Session continuity carried through (sessionId/params/displayId/taskKey). */
  runtime: {
    sessionId: string | null;
    sessionParams: Record<string, unknown> | null;
    sessionDisplayId: string | null;
    taskKey: string | null;
  };
  /**
   * Fully-resolved runtime config (model profile, skills, prompt template, and —
   * slice 1, default secret model 2a — resolved secrets). The client uses it
   * verbatim; no further resolution happens on the client.
   */
  config: Record<string, unknown>;
  /** Wake context (issue/comment/task) — same shape the server uses today. */
  context: Record<string, unknown>;
  /** Workspace realization instructions (a spec, never a server path). */
  workspace: RunnerWorkspaceSpec;
  /** Local-agent JWT injected as PAPERCLIP_API_KEY, when the adapter supports it. */
  authToken?: string | null;
  /**
   * The underlying adapter's runtime command spec (command / detectCommand /
   * install snippets), resolved on the control plane where the adapter registry
   * lives. The client cannot derive this itself, so the server ships it here.
   * The client uses `localInstallCommand` to auto-install a missing CLI on the
   * user's machine before the run.
   */
  runtimeCommandSpec?: AdapterRuntimeCommandSpec | null;
}

// ---------------------------------------------------------------------------
// Frames — server ↔ client (JSON over text WS frames)
//
// Modeled on the openclaw-gateway req/res/event shape, but specialized to one
// long-running operation (a run) per message id.
// ---------------------------------------------------------------------------

/** server → client: begin executing a run. */
export interface RunStartFrame {
  type: "run.start";
  /** Correlation id for this run dispatch (the heartbeat runId in slice 1). */
  id: string;
  spec: RunnerExecutionSpec;
}

/** server → client: request cancellation of an in-flight run. */
export interface RunCancelFrame {
  type: "run.cancel";
  id: string;
  reason?: string;
}

export type RunnerLogStream = "stdout" | "stderr" | "lifecycle";

/** client → server: streamed output/lifecycle for a run. */
export interface RunEventFrame {
  type: "run.event";
  id: string;
  /** Monotonic per-run sequence so the server can order/dedupe. */
  seq: number;
  event:
    | { kind: "log"; stream: RunnerLogStream; chunk: string }
    | { kind: "spawn"; pid: number; processGroupId: number | null; startedAt: string }
    | {
        kind: "meta";
        adapterType: string;
        command: string;
        commandArgs?: string[];
        cwd?: string;
      };
}

/** client → server: terminal result for a run. */
export interface RunResultFrame {
  type: "run.result";
  id: string;
  result: AdapterExecutionResult;
}

/** client → server: the client could not start/finish the run at all. */
export interface RunFailedFrame {
  type: "run.failed";
  id: string;
  errorCode: string;
  errorMessage: string;
}

/** client → server: first frame after connect, identifying the runner. */
export interface RunnerHelloFrame {
  type: "runner.hello";
  protocolVersion: number;
  companyId: string;
  /** Free-form runner identity (hostname/device label) for logs. */
  runnerId: string;
}

/** bidirectional keepalive (in addition to ws ping/pong). */
export interface RunnerPingFrame {
  type: "runner.ping";
}

export type RunnerServerFrame = RunStartFrame | RunCancelFrame | RunnerPingFrame;
export type RunnerClientFrame =
  | RunnerHelloFrame
  | RunEventFrame
  | RunResultFrame
  | RunFailedFrame
  | RunnerPingFrame;
export type RunnerFrame = RunnerServerFrame | RunnerClientFrame;

// ---------------------------------------------------------------------------
// Narrowing helpers (safe parsing of untrusted JSON frames)
// ---------------------------------------------------------------------------

export function parseRunnerFrame(raw: string): RunnerFrame | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const type = (parsed as { type?: unknown }).type;
  if (typeof type !== "string") return null;
  // Trust the shape only enough to dispatch on `type`; consumers validate fields.
  return parsed as RunnerFrame;
}
