// Local adapter registry (runner-client side).
//
// Maps an adapterType to the same execute() implementation the control plane
// used to call in-process. Each adapter's execute() has the identical signature
// (ctx: AdapterExecutionContext) => Promise<AdapterExecutionResult>, so the
// runner can host any of them and spawn the underlying CLI locally.
//
// Adding a new local adapter is a one-line entry here (plus the workspace dep in
// package.json) — the streaming/result plumbing in execute-run.ts is generic.

import type {
  AdapterExecutionContext,
  AdapterExecutionResult,
} from "@paperclipai/adapter-utils";
import { execute as claudeExecute } from "@paperclipai/adapter-claude-local/server";
import { execute as codexExecute } from "@paperclipai/adapter-codex-local/server";
import { execute as cursorExecute } from "@paperclipai/adapter-cursor-local/server";
import { execute as geminiExecute } from "@paperclipai/adapter-gemini-local/server";
import { execute as opencodeExecute } from "@paperclipai/adapter-opencode-local/server";
import { execute as piExecute } from "@paperclipai/adapter-pi-local/server";

export type LocalAdapterExecute = (
  ctx: AdapterExecutionContext,
) => Promise<AdapterExecutionResult>;

/** adapterType → local execute() implementation. */
const LOCAL_ADAPTERS: Record<string, LocalAdapterExecute> = {
  claude_local: claudeExecute,
  codex_local: codexExecute,
  cursor_local: cursorExecute,
  // The cursor adapter is registered server-side under the bare "cursor" type as
  // well; accept both so a runner agent typed either way resolves.
  cursor: cursorExecute,
  gemini_local: geminiExecute,
  opencode_local: opencodeExecute,
  pi_local: piExecute,
};

/** The adapterTypes this runner can execute locally. */
export const SUPPORTED_LOCAL_ADAPTER_TYPES = Object.freeze(Object.keys(LOCAL_ADAPTERS));

/**
 * Resolve the local execute() for an adapterType. Throws a tagged error
 * (code: "runner_adapter_unsupported") the caller maps to a run.failed frame.
 */
export function resolveLocalExecute(adapterType: string): LocalAdapterExecute {
  const fn = LOCAL_ADAPTERS[adapterType];
  if (!fn) {
    throw Object.assign(
      new Error(
        `runner-client does not support adapterType "${adapterType}". Supported: ${SUPPORTED_LOCAL_ADAPTER_TYPES.join(", ")}`,
      ),
      { code: "runner_adapter_unsupported" },
    );
  }
  return fn;
}
