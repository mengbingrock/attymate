export interface CodexLaneMcpServerSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface CodexLaneArgsInput {
  /** Agent-teams MCP server launch spec (resolveAgentTeamsMcpLaunchSpec). */
  mcpServer: CodexLaneMcpServerSpec;
  /** Lane working directory; pinned as a trusted project. */
  cwd: string;
  /** 'chatgpt' | 'api' — omitted when the account layer decides. */
  forcedLoginMethod?: 'chatgpt' | 'api';
  model?: string;
  reasoningEffort?: string;
  /** True (default) runs lanes without sandbox/approval prompts. */
  bypassSandbox?: boolean;
  /** Extra raw `-c key=value` overrides appended verbatim. */
  extraConfigOverrides?: string[];
}

/**
 * Codex MCP server name. Underscored so the dotted `-c mcp_servers.<name>.*`
 * paths need no TOML key quoting; tool names are unqualified in codex, so
 * prompts reference plain `task_create` / `message_send` regardless.
 */
export const CODEX_AGENT_TEAMS_MCP_SERVER_NAME = 'agent_teams';

/** Parallel lane cold starts can exceed codex's 10s default in development. */
const MCP_STARTUP_TIMEOUT_SEC = 60;

/** TOML basic strings share JSON's escape grammar for our value set. */
function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlStringArray(values: readonly string[]): string {
  return `[${values.map((value) => tomlString(value)).join(',')}]`;
}

function configOverride(key: string, tomlValue: string): string[] {
  return ['-c', `${key}=${tomlValue}`];
}

/**
 * Build the argv (after the binary) for one interactive codex TUI lane.
 * Everything is expressed as stock `-c` config overrides plus documented
 * global flags — no multimodel-fork `--settings` payloads.
 */
export function buildCodexLaneArgs(input: CodexLaneArgsInput): string[] {
  const mcpKey = `mcp_servers.${CODEX_AGENT_TEAMS_MCP_SERVER_NAME}`;
  const args: string[] = [
    ...configOverride(`${mcpKey}.command`, tomlString(input.mcpServer.command)),
    ...configOverride(`${mcpKey}.args`, tomlStringArray(input.mcpServer.args)),
  ];
  for (const [key, value] of Object.entries(input.mcpServer.env)) {
    args.push(...configOverride(`${mcpKey}.env.${key}`, tomlString(value)));
  }
  // Team coordination is unavailable without this server. Mark it required so
  // codex does not admit the first turn while omitting a still-pending server.
  args.push(...configOverride(`${mcpKey}.required`, 'true'));
  args.push(...configOverride(`${mcpKey}.startup_timeout_sec`, String(MCP_STARTUP_TIMEOUT_SEC)));
  // Best-effort trust pin; the TUI still shows its trust dialog on first run,
  // which the lane launcher auto-answers (verified against codex-cli 0.145.0).
  args.push(
    ...configOverride(`projects.${tomlString(input.cwd)}.trust_level`, tomlString('trusted'))
  );
  if (input.forcedLoginMethod) {
    args.push(...configOverride('forced_login_method', tomlString(input.forcedLoginMethod)));
  }
  if (input.model) {
    args.push('-m', input.model);
  }
  if (input.reasoningEffort) {
    args.push(...configOverride('model_reasoning_effort', tomlString(input.reasoningEffort)));
  }
  if (input.bypassSandbox !== false) {
    args.push('--dangerously-bypass-approvals-and-sandbox');
  }
  for (const override of input.extraConfigOverrides ?? []) {
    args.push('-c', override);
  }
  return args;
}
