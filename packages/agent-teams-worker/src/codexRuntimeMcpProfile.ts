import { RUNTIME_BRIDGE_TOOL_NAMES } from './runtimeMcpServer';

export const RUNTIME_MCP_SERVER_NAME = 'agent-teams-runtime';
export const OWNER_CONTROL_MCP_SERVER_NAME = 'agent-teams-control';

export interface CodexRuntimeMcpLaunchSpec {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
}

export const readConfiguredMcpServerNames = (response: unknown): readonly string[] => {
  if (typeof response !== 'object' || response === null || Array.isArray(response)) return [];
  const config = (response as Record<string, unknown>).config;
  if (typeof config !== 'object' || config === null || Array.isArray(config)) return [];
  const servers = (config as Record<string, unknown>).mcp_servers;
  if (typeof servers !== 'object' || servers === null || Array.isArray(servers)) return [];
  return Object.keys(servers).sort();
};

export const buildRestrictedRuntimeMcpConfig = (
  spec: CodexRuntimeMcpLaunchSpec,
  token: string,
  configuredServerNames: readonly string[]
): Readonly<Record<string, unknown>> => {
  const disabled = Object.fromEntries(
    [...new Set([...configuredServerNames, OWNER_CONTROL_MCP_SERVER_NAME])]
      .filter((name) => name !== RUNTIME_MCP_SERVER_NAME)
      .map((name) => [name, { enabled: false }])
  );
  return {
    mcp_servers: {
      ...disabled,
      [RUNTIME_MCP_SERVER_NAME]: {
        command: spec.command,
        args: [...spec.args],
        ...(spec.cwd === undefined ? {} : { cwd: spec.cwd }),
        env: {
          ...spec.env,
          AGENT_TEAMS_RUNTIME_SESSION_TOKEN: token,
        },
        enabled: true,
        required: true,
        startup_timeout_sec: 10,
        tool_timeout_sec: 30,
        default_tools_approval_mode: 'auto',
        enabled_tools: [...RUNTIME_BRIDGE_TOOL_NAMES],
      },
    },
  };
};

export const assertRestrictedRuntimeMcpInventory = (response: unknown): void => {
  if (typeof response !== 'object' || response === null || Array.isArray(response)) {
    throw new Error('Codex runtime MCP inventory response is invalid');
  }
  const data = (response as Record<string, unknown>).data;
  if ((response as Record<string, unknown>).nextCursor != null) {
    throw new Error('Codex runtime MCP inventory exceeded the single-page safety limit');
  }
  if (!Array.isArray(data)) throw new Error('Codex runtime MCP inventory is missing data');
  const servers = data.map((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error('Codex runtime MCP inventory contains an invalid server');
    }
    return entry as Record<string, unknown>;
  });
  const names = servers.map(({ name }) => name).sort();
  if (names.length !== 1 || names[0] !== RUNTIME_MCP_SERVER_NAME) {
    throw new Error(`Codex runtime MCP inventory leaked servers: ${names.join(', ') || '(none)'}`);
  }
  const tools = servers[0]?.tools;
  if (typeof tools !== 'object' || tools === null || Array.isArray(tools)) {
    throw new Error('Codex runtime MCP inventory is missing tools');
  }
  const actualTools = Object.keys(tools).sort();
  const expectedTools = [...RUNTIME_BRIDGE_TOOL_NAMES].sort();
  if (
    actualTools.length !== expectedTools.length ||
    actualTools.some((tool, index) => tool !== expectedTools[index])
  ) {
    throw new Error(`Codex runtime MCP inventory leaked tools: ${actualTools.join(', ')}`);
  }
};
