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
  agentConfigurationDoc: `# runner_gateway agent configuration

Adapter: runner_gateway

Routes execution to a local execution runner (runner-client) on the user's
machine instead of spawning a subprocess on the control plane.

Core fields:
- runnerAdapterType (string, optional): the real adapter to run on the client.
  Default "claude_local".
- workspace (object, optional): how the client realizes the working directory.
  - strategy ("git_worktree" | "agent_home"): default "agent_home".
  - repoUrl, baseRef, branchTemplate (strings, for git_worktree).

All other config (model, skills, prompt template, secrets) is resolved on the
control plane and forwarded to the client verbatim.
`,
};
