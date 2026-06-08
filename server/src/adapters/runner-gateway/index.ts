import { LOCAL_RUNNER_AGENT_TYPES, localRunnerVariantType } from "@paperclipai/shared";
import type { AdapterExecutionContext } from "../types.js";
import type { ServerAdapterModule } from "../types.js";
import { execute } from "./execute.js";
import { testEnvironment } from "./test.js";

export const runnerGatewayAdapter: ServerAdapterModule = {
  type: "runner_gateway",
  execute,
  testEnvironment,
  models: [],
  // The runner_gateway forwards a local-agent JWT to the client so the executed
  // agent gets PAPERCLIP_API_KEY, same as a server-side local adapter.
  supportsLocalAgentJwt: true,
  // It forwards the agent's managed instructions bundle to the client verbatim,
  // so the instructions UI applies. (Model + skills config belong to the
  // underlying runner adapter — default claude_local — surfaced by the UI.)
  supportsInstructionsBundle: true,
  agentConfigurationDoc: `# runner_gateway agent configuration

Adapter: runner_gateway

Routes execution to a local execution runner (runner-client) on the user's
machine instead of spawning a subprocess on the control plane.

Core fields:
- runnerAdapterType (string, optional): the real adapter to run on the client.
  One of: claude_local, codex_local, cursor_local, gemini_local,
  opencode_local, pi_local. Default "claude_local".
- workspace (object, optional): how the client realizes the working directory.
  - strategy ("git_worktree" | "agent_home"): default "agent_home".
  - repoUrl, baseRef, branchTemplate (strings, for git_worktree).

All other config (model, skills, prompt template, secrets) is resolved on the
control plane and forwarded to the client verbatim.
`,
};

/**
 * One selectable adapter per local agent that runs on the user's machine via
 * the runner-client. Each is a thin wrapper over the runner_gateway engine that
 * pins `runnerAdapterType` to its agent, so the saved adapterType (e.g.
 * `claude_local_runner`) routes correctly without any client-side translation.
 */
export const runnerGatewayVariantAdapters: ServerAdapterModule[] = LOCAL_RUNNER_AGENT_TYPES.map(
  (agentType): ServerAdapterModule => ({
    type: localRunnerVariantType(agentType),
    execute: (ctx: AdapterExecutionContext) =>
      execute({ ...ctx, config: { ...ctx.config, runnerAdapterType: agentType } }),
    testEnvironment,
    models: [],
    supportsLocalAgentJwt: true,
    supportsInstructionsBundle: true,
    agentConfigurationDoc: `Runs the ${agentType} agent on the user's machine via the local runner-client (runner_gateway engine, runnerAdapterType="${agentType}").`,
  }),
);
